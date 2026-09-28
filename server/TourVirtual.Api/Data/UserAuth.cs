using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TourVirtual.Api.Models;

namespace TourVirtual.Api.Data;

public sealed record UserAccount(string Username, string Salt, string PasswordHash, string Version);
public sealed record UserSession(string Username, string Version);

public static class UserAuth
{
    public static readonly string[] Usernames = ["piero", "duba", "brea", "manuel"];

    public static UserAccount WithPassword(string username, string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, 100000, HashAlgorithmName.SHA256, 32);
        return new(username, Convert.ToBase64String(salt), Convert.ToBase64String(hash), Guid.NewGuid().ToString());
    }

    public static async Task Seed(AppDbContext db)
    {
        foreach (var username in Usernames)
        {
            if (await db.AppStates.AnyAsync(row => row.Key == "user:" + username)) continue;
            db.AppStates.Add(new AppStateRecord {
                Key = "user:" + username,
                Json = JsonSerializer.Serialize(WithPassword(username, username + "20"))
            });
        }
        await db.SaveChangesAsync();
    }

    public static async Task<UserAccount?> Find(AppDbContext db, string username)
    {
        var row = await db.AppStates.AsNoTracking().FirstOrDefaultAsync(row => row.Key == "user:" + username);
        return row is null ? null : JsonSerializer.Deserialize<UserAccount>(row.Json);
    }

    public static bool Verify(UserAccount user, string password)
    {
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, Convert.FromBase64String(user.Salt), 100000, HashAlgorithmName.SHA256, 32);
        return CryptographicOperations.FixedTimeEquals(hash, Convert.FromBase64String(user.PasswordHash));
    }

    public static async Task<UserAccount?> Current(HttpContext context, AppDbContext db)
    {
        var header = context.Request.Headers.Authorization.ToString();
        if (!header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return null;
        var token = header[7..].Trim();
        if (token.Length == 0) return null;
        var key = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token)));
        var row = await db.AppStates.AsNoTracking().FirstOrDefaultAsync(row => row.Key == key);
        if (row is null) return null;
        var session = JsonSerializer.Deserialize<UserSession>(row.Json);
        if (string.IsNullOrEmpty(session?.Username)) return null;
        var user = await Find(db, session.Username);
        return user?.Version == session.Version ? user : null;
    }
}
