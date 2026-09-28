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
var viewerNames = new ConcurrentDictionary<string, string>();
var viewerTimeout = TimeSpan.FromSeconds(35);

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
    UserAuth.Seed(db).GetAwaiter().GetResult();
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

    var username = payload.TryGetProperty("username", out var usernameProperty)
        ? usernameProperty.GetString()?.Trim().ToLowerInvariant() ?? "" : "";
    var user = await UserAuth.Find(db, username);
    if (user is null || password is null || !UserAuth.Verify(user, password))
    {
        return Results.Unauthorized();
    }

    var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        .Replace("+", "-", StringComparison.Ordinal)
        .Replace("/", "_", StringComparison.Ordinal)
        .TrimEnd('=');

    db.AppStates.Add(new AppStateRecord { Key = SessionKey(token), Json = JsonSerializer.Serialize(new UserSession(user.Username, user.Version)) });
    await db.SaveChangesAsync();
    return Results.Ok(new { token, username = user.Username, canManageUsers = user.Username == "piero" });
});

app.MapGet("/api/auth/session", async (HttpContext context, AppDbContext db) =>
{
    context.Response.Headers.CacheControl = "no-store";
    var user = await UserAuth.Current(context, db);
    return user is null ? Results.Unauthorized() : Results.Ok(new { username = user.Username, canManageUsers = user.Username == "piero" });
});

app.MapGet("/api/users", async (HttpContext context, AppDbContext db) =>
{
    var user = await UserAuth.Current(context, db);
    if (user is null) return Results.Unauthorized();
    if (user.Username != "piero") return Results.StatusCode(403);
    return Results.Ok(UserAuth.Usernames.Select(username => new { username }));
});

app.MapPut("/api/users/{username}/password", async (string username, JsonElement payload, HttpContext context, AppDbContext db) =>
{
    var current = await UserAuth.Current(context, db);
    if (current is null) return Results.Unauthorized();
    if (current.Username != "piero") return Results.StatusCode(403);
    if (!UserAuth.Usernames.Contains(username)) return Results.NotFound();
    var password = payload.TryGetProperty("password", out var property) ? property.GetString() : null;
    if (string.IsNullOrWhiteSpace(password) || password.Length < 4 || password.Length > 100)
        return Results.BadRequest(new { error = "Usa entre 4 y 100 caracteres." });
    var row = await db.AppStates.FirstAsync(row => row.Key == "user:" + username);
    row.Json = JsonSerializer.Serialize(UserAuth.WithPassword(username, password));
    row.UpdatedAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();
    foreach (var viewer in viewerNames.Where(item => item.Value == username)) viewerNames.TryRemove(viewer.Key, out _);
    return Results.NoContent();
});

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
    var user = await UserAuth.Current(httpContext, db);
    if (user is null)
    {
        return Results.Unauthorized();
    }

    var json = payload.GetRawText();
    var record = await db.AppStates.FirstOrDefaultAsync(item => item.Key == "default");
    PaymentAudit.Record(db, record?.Json, json, user.Username);

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

app.MapGet("/api/payment-audit", async (HttpContext context, AppDbContext db) =>
{
    context.Response.Headers.CacheControl = "no-store";
    if (await UserAuth.Current(context, db) is null) return Results.Unauthorized();
    var rows = await db.AppStates.AsNoTracking().Where(row => row.Key.StartsWith("audit:")).OrderByDescending(row => row.Id).ToListAsync();
    return Results.Ok(rows.Select(row => JsonSerializer.Deserialize<JsonElement>(row.Json)));
});

app.MapPost("/api/presence", async (JsonElement payload, HttpContext context, AppDbContext db) =>
{
    var viewerId = payload.TryGetProperty("viewerId", out var viewerIdProperty)
        ? viewerIdProperty.GetString()
        : null;

    if (string.IsNullOrWhiteSpace(viewerId))
    {
        return Results.BadRequest(new { error = "viewerId is required" });
    }

    var now = DateTimeOffset.UtcNow;
    var user = await UserAuth.Current(context, db);
    viewerNames[viewerId] = user?.Username ?? "Visitante";
    activeViewers[viewerId] = now;
    RemoveExpiredViewers(activeViewers, now, viewerTimeout);
    foreach (var id in viewerNames.Keys) if (!activeViewers.ContainsKey(id)) viewerNames.TryRemove(id, out _);

    return Results.Ok(new
    {
        activeViewers = activeViewers.Count,
        sessionValid = user is not null,
        viewers = activeViewers.Keys.OrderBy(id => id).Select(id => new { name = viewerNames.GetValueOrDefault(id, "Visitante") })
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

static string AdminToken(HttpContext context)
{
    var header = context.Request.Headers.Authorization.ToString();
    return header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
        ? header[7..].Trim() : context.Request.Headers["X-Admin-Token"].ToString();
}

static string SessionKey(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
