using System.Text.Json.Nodes;
using TourVirtual.Api.Models;

namespace TourVirtual.Api.Data;

public static class PaymentAudit
{
    public static void Record(AppDbContext db, string? previous, string next, string username)
    {
        var before = JsonNode.Parse(previous ?? "{}")?["categories"] as JsonObject;
        var after = JsonNode.Parse(next)?["categories"] as JsonObject;
        if (after is null) return;
        foreach (var (category, value) in after)
        {
            if (value is not JsonObject current) continue;
            var old = before?[category];
            Compare("inscriptionPaidTeamIds", old, current, "Inscripción");
            if (current["weeks"] is JsonArray weeks)
                for (var i = 0; i < weeks.Count; i++)
                {
                    var oldWeeks = old?["weeks"] as JsonArray;
                    Compare("paidTeamIds", oldWeeks is not null && i < oldWeeks.Count ? oldWeeks[i] : null,
                        weeks[i], i + 1 == current["weekLimit"]?.GetValue<int>() ? "GRAN FINAL" : $"Semana {i + 1}");
                }

            void Compare(string key, JsonNode? from, JsonNode? to, string payment)
            {
                var oldIds = Ids(from?[key]);
                var newIds = Ids(to?[key]);
                foreach (var id in oldIds.Union(newIds).Where(id => oldIds.Contains(id) != newIds.Contains(id)))
                {
                    var team = (current["teams"] as JsonArray)?.FirstOrDefault(t => t?["id"]?.GetValue<string>() == id)
                        ?? (old?["teams"] as JsonArray)?.FirstOrDefault(t => t?["id"]?.GetValue<string>() == id);
                    var entry = new JsonObject
                    {
                        ["username"] = username, ["category"] = category, ["teamId"] = id,
                        ["teamName"] = team?["name"]?.GetValue<string>() ?? id,
                        ["payment"] = payment, ["paid"] = newIds.Contains(id),
                        ["timestamp"] = DateTimeOffset.UtcNow.ToString("O")
                    };
                    db.AppStates.Add(new AppStateRecord { Key = "audit:" + Guid.NewGuid().ToString("N"), Json = entry.ToJsonString() });
                }
            }
        }
    }

    private static HashSet<string> Ids(JsonNode? node) => node is JsonArray array
        ? array.Select(item => item?.GetValue<string>() ?? "").Where(id => id.Length > 0).ToHashSet()
        : [];
}
