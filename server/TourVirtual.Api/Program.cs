using System.Collections.Concurrent;
using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using TourVirtual.Api.Data;
using TourVirtual.Api.Models;

var builder = WebApplication.CreateBuilder(args);
var activeViewers = new ConcurrentDictionary<string, DateTimeOffset>();
var viewerTimeout = TimeSpan.FromSeconds(35);
var adminSessionTimeout = TimeSpan.FromDays(30);
var adminPassword = Environment.GetEnvironmentVariable("ADMIN_PASSWORD") ?? "hoyo2010";

var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrWhiteSpace(port))
{
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
}

var connectionString = ResolveConnectionString(builder.Configuration);

builder.Services.AddDbContext<AppDbContext>(options =>
{
    if (IsPostgresConnectionString(connectionString))
    {
        options.UseNpgsql(connectionString);
    }
    else
    {
        options.UseSqlite(connectionString);
    }
});
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        var allowedOrigins = ResolveAllowedOrigins(builder.Configuration);

        policy.AllowAnyHeader()
            .AllowAnyMethod();

        if (allowedOrigins.Length > 0)
        {
            policy.SetIsOriginAllowed(origin => IsAllowedOrigin(origin, allowedOrigins));
        }
        else
        {
            policy.AllowAnyOrigin();
        }
    });
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
}

app.UseCors();
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/state", async (AppDbContext db) =>
{
    var record = await db.AppStates.AsNoTracking().FirstOrDefaultAsync(item => item.Key == "default");
    return Results.Text(record?.Json ?? "null", "application/json");
});

app.MapPost("/api/auth/login", async (JsonElement payload, AppDbContext db) =>
{
    var password = payload.TryGetProperty("password", out var passwordProperty)
        ? passwordProperty.GetString()
        : null;

    if (password != adminPassword)
    {
        return Results.Unauthorized();
    }

    var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        .Replace("+", "-", StringComparison.Ordinal)
        .Replace("/", "_", StringComparison.Ordinal)
        .TrimEnd('=');

    db.AppStates.Add(new AppStateRecord { Key = SessionKey(token), Json = "{}" });
    await db.SaveChangesAsync();
    return Results.Ok(new { token });
});

app.MapGet("/api/auth/session", async (HttpContext context, AppDbContext db) =>
    await IsAuthorizedAdmin(context, db, DateTimeOffset.UtcNow, adminSessionTimeout)
        ? Results.NoContent() : Results.Unauthorized());

app.MapPost("/api/auth/logout", async (HttpContext context, AppDbContext db) =>
{
    var key = SessionKey(AdminToken(context));
    var session = await db.AppStates.FirstOrDefaultAsync(item => item.Key == key);
    if (session is not null)
    {
        db.AppStates.Remove(session);
        await db.SaveChangesAsync();
    }
    return Results.NoContent();
});

app.MapPut("/api/state", async (JsonElement payload, AppDbContext db, HttpContext httpContext) =>
{
    if (!await IsAuthorizedAdmin(httpContext, db, DateTimeOffset.UtcNow, adminSessionTimeout))
    {
        return Results.Unauthorized();
    }

    var json = payload.GetRawText();
    var record = await db.AppStates.FirstOrDefaultAsync(item => item.Key == "default");

    if (record is null)
    {
        record = new AppStateRecord { Key = "default", Json = json };
        db.AppStates.Add(record);
    }
    else
    {
        record.Json = json;
        record.UpdatedAt = DateTimeOffset.UtcNow;
    }

    await db.SaveChangesAsync();
    return Results.NoContent();
});

app.MapPost("/api/presence", (JsonElement payload) =>
{
    var viewerId = payload.TryGetProperty("viewerId", out var viewerIdProperty)
        ? viewerIdProperty.GetString()
        : null;

    if (string.IsNullOrWhiteSpace(viewerId))
    {
        return Results.BadRequest(new { error = "viewerId is required" });
    }

    var now = DateTimeOffset.UtcNow;
    activeViewers[viewerId] = now;
    RemoveExpiredViewers(activeViewers, now, viewerTimeout);

    return Results.Ok(new
    {
        activeViewers = activeViewers.Count
    });
});

app.MapFallbackToFile("index.html");

app.Run();

static string ResolveConnectionString(IConfiguration configuration)
{
    var databaseUrl = Environment.GetEnvironmentVariable("DATABASE_URL");
    var configuredConnection = configuration.GetConnectionString("Default");
    var rawConnection = string.IsNullOrWhiteSpace(databaseUrl)
        ? configuredConnection
        : databaseUrl;

    if (string.IsNullOrWhiteSpace(rawConnection))
    {
        return "Data Source=tourvirtual.db";
    }

    return rawConnection.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase)
        || rawConnection.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase)
        ? ConvertDatabaseUrl(rawConnection)
        : rawConnection;
}

static bool IsPostgresConnectionString(string connectionString)
{
    return connectionString.StartsWith("Host=", StringComparison.OrdinalIgnoreCase)
        || connectionString.StartsWith("Server=", StringComparison.OrdinalIgnoreCase);
}

static string ConvertDatabaseUrl(string databaseUrl)
{
    var uri = new Uri(databaseUrl);
    var userInfo = uri.UserInfo.Split(':', 2);
    var query = ParseQuery(uri.Query);
    var builder = new NpgsqlConnectionStringBuilder
    {
        Host = uri.Host,
        Port = uri.Port > 0 ? uri.Port : 5432,
        Database = uri.AbsolutePath.TrimStart('/'),
        Username = Uri.UnescapeDataString(userInfo.ElementAtOrDefault(0) ?? string.Empty),
        Password = Uri.UnescapeDataString(userInfo.ElementAtOrDefault(1) ?? string.Empty),
        SslMode = ResolveSslMode(query),
        ChannelBinding = ResolveChannelBinding(query)
    };

    return builder.ConnectionString;
}

static Dictionary<string, string> ParseQuery(string query)
{
    return query
        .TrimStart('?')
        .Split('&', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Select(part => part.Split('=', 2))
        .Where(parts => parts.Length == 2)
        .ToDictionary(
            parts => Uri.UnescapeDataString(parts[0]).Replace("_", string.Empty, StringComparison.OrdinalIgnoreCase),
            parts => Uri.UnescapeDataString(parts[1]),
            StringComparer.OrdinalIgnoreCase);
}

static SslMode ResolveSslMode(IReadOnlyDictionary<string, string> query)
{
    return query.TryGetValue("sslmode", out var sslMode)
        && Enum.TryParse<SslMode>(sslMode, ignoreCase: true, out var parsed)
            ? parsed
            : SslMode.Require;
}

static ChannelBinding ResolveChannelBinding(IReadOnlyDictionary<string, string> query)
{
    return query.TryGetValue("channelbinding", out var channelBinding)
        && Enum.TryParse<ChannelBinding>(channelBinding, ignoreCase: true, out var parsed)
            ? parsed
            : ChannelBinding.Prefer;
}

static string[] ResolveAllowedOrigins(IConfiguration configuration)
{
    var rawOrigins = Environment.GetEnvironmentVariable("ALLOWED_ORIGINS")
        ?? configuration["AllowedOrigins"]
        ?? string.Empty;

    return rawOrigins
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Where(origin => Uri.TryCreate(origin, UriKind.Absolute, out _))
        .ToArray();
}

static bool IsAllowedOrigin(string origin, IReadOnlyCollection<string> allowedOrigins)
{
    if (allowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase))
    {
        return true;
    }

    return Uri.TryCreate(origin, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps
        && uri.Host.EndsWith(".vercel.app", StringComparison.OrdinalIgnoreCase);
}

static void RemoveExpiredViewers(
    ConcurrentDictionary<string, DateTimeOffset> activeViewers,
    DateTimeOffset now,
    TimeSpan viewerTimeout)
{
    foreach (var viewer in activeViewers)
    {
        if (now - viewer.Value > viewerTimeout)
        {
            activeViewers.TryRemove(viewer.Key, out _);
        }
    }
}

static async Task<bool> IsAuthorizedAdmin(
    HttpContext httpContext,
    AppDbContext db,
    DateTimeOffset now,
    TimeSpan adminSessionTimeout)
{
    var token = AdminToken(httpContext);
    if (string.IsNullOrWhiteSpace(token)) return false;
    var key = SessionKey(token);
    var session = await db.AppStates.FirstOrDefaultAsync(item => item.Key == key);
    if (session is null) return false;
    if (now - session.UpdatedAt > adminSessionTimeout)
    {
        db.AppStates.Remove(session);
        await db.SaveChangesAsync();
        return false;
    }
    session.UpdatedAt = now;
    await db.SaveChangesAsync();
    return true;
}

static string AdminToken(HttpContext context)
{
    var header = context.Request.Headers.Authorization.ToString();
    return header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
        ? header[7..].Trim() : context.Request.Headers["X-Admin-Token"].ToString();
}

static string SessionKey(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
