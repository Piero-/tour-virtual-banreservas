using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using TourVirtual.Api.Models;

namespace TourVirtual.Api.Data;

public sealed record ScorecardAlias(string Key, string Raw, string TeamId, string MemberSlot, string MemberName,
    string? UpdatedBy = null, DateTimeOffset? UpdatedAt = null, bool Manual = false, bool Pending = false, bool Denied = false);
public sealed record ScorecardAliasUpdate(ScorecardAlias[]? Aliases, string? Revision = null);

public sealed class ScorecardAliases(string key, string? original, JsonArray teams, string season)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const int Limit = 500;
    public ScorecardAlias[] Entries { get; } = original is null ? [] : JsonSerializer.Deserialize<ScorecardAlias[]>(original, Json) ?? [];
    public string Revision => Hash(original ?? "");
    public string Season => season;
    public JsonArray Teams => teams;

    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    public static async Task<ScorecardAliases?> Open(AppDbContext db, string category, string? season)
    {
        if (category is not ("A" or "C")) return null;
        var state = await db.AppStates.AsNoTracking().SingleOrDefaultAsync(row => row.Key == "default");
        var root = state is null ? null : JsonNode.Parse(state.Json);
        var tour = root?["categories"]?[category];
        var archive = (root?["archives"] as JsonArray)?.LastOrDefault(item =>
            (item?["categoryId"]?.ToString() ?? "A") == category);
        var expected = (tour?["registrationId"]?.ToString() ?? "") + ":" + (archive?["id"]?.ToString() ?? "");
        if (season is not null && season != expected) return null;
        var roster = tour?["teams"] as JsonArray ?? new JsonArray();
        var count = int.TryParse(tour?["teamCount"]?.ToString(), out var activeCount) ? activeCount : roster.Count;
        var key = "aliases:" + Hash(category + ":" + expected)[..48];
        var row = await db.AppStates.AsNoTracking().SingleOrDefaultAsync(item => item.Key == key);
        return new ScorecardAliases(key, row?.Json, new JsonArray(roster.Take(count).Select(item => item?.DeepClone()).ToArray()), expected);
    }

    private static string Normalize(string value)
    {
        var unaccented = new string(value.Normalize(NormalizationForm.FormD)
            .Where(ch => CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark).ToArray());
        return Regex.Replace(unaccented.ToLowerInvariant(), "[^a-z0-9]+", " ").Trim();
    }

    public ScorecardAlias[]? Prepare(ScorecardAlias[]? incoming, bool replace, string username)
    {
        if (incoming is null || incoming.Length > Limit) return null;
        var existing = Entries.ToDictionary(item => item.Key);
        var result = replace ? new Dictionary<string, ScorecardAlias>() : new(existing);
        foreach (var item in incoming)
        {
            if (item?.Raw is null || item.Raw.Length > 80) return null;
            var raw = item.Raw.Trim();
            var normalized = Normalize(raw);
            if (normalized.Count(char.IsLetterOrDigit) < 3 || !Regex.IsMatch(raw, @"^\p{L}[\p{L}\p{M} .'-]*$")) return null;
            if (!replace && result.ContainsKey(normalized)) continue;
            if (replace && result.ContainsKey(normalized)) return null;
            if (result.Count >= Limit) break;
            existing.TryGetValue(normalized, out var saved);
            if (replace && saved is not null && saved.Raw == raw && saved.TeamId == item.TeamId &&
                saved.MemberSlot == item.MemberSlot && saved.MemberName == item.MemberName)
            {
                var pending = item.Pending && !item.Denied;
                result.Add(normalized, saved.Pending == pending && saved.Denied == item.Denied ? saved :
                    saved with { Pending = pending, Denied = item.Denied, Manual = true, UpdatedBy = username, UpdatedAt = DateTimeOffset.UtcNow });
                continue;
            }
            var team = teams.FirstOrDefault(team => team?["id"]?.ToString() == item.TeamId);
            var slot = item.MemberSlot ?? "";
            if (team is null || slot is not ("" or "A" or "B" or "C")) return null;
            var member = slot == "" ? "" : team["members"]?[slot]?.ToString();
            if (member is null || (slot != "" && string.IsNullOrWhiteSpace(member))) return null;
            if (!replace && member != item.MemberName) continue;
            result.Add(normalized, new(normalized, raw, item.TeamId, slot, member, username, DateTimeOffset.UtcNow,
                replace, replace ? item.Pending && !item.Denied : slot == "" || normalized != Normalize(member), replace && item.Denied));
        }
        return result.Values.ToArray();
    }

    public async Task<bool> Save(AppDbContext db, ScorecardAlias[] entries)
    {
        var json = JsonSerializer.Serialize(entries, Json);
        if (json == original || (original is null && entries.Length == 0)) return true;
        var now = DateTimeOffset.UtcNow;
        if (original is not null)
            return await db.AppStates.Where(row => row.Key == key && row.Json == original)
                .ExecuteUpdateAsync(update => update.SetProperty(row => row.Json, json).SetProperty(row => row.UpdatedAt, now)) == 1;
        db.AppStates.Add(new AppStateRecord { Key = key, Json = json, UpdatedAt = now });
        try { await db.SaveChangesAsync(); return true; }
        catch (DbUpdateException) { return false; }
    }
}
