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
            var oldDebts = Receivables(old);
            var newDebts = Receivables(current);
            foreach (var id in oldDebts.Keys.Union(newDebts.Keys))
            {
                oldDebts.TryGetValue(id, out var prior);
                newDebts.TryGetValue(id, out var debt);
                if (prior is not null && debt is not null && JsonNode.DeepEquals(prior, debt)) continue;
                var item = debt ?? prior!;
                var action = prior is null ? "Registró deuda" : debt is null ? "Quitó deuda" :
                    prior["paidWeek"] is null && debt["paidWeek"] is not null ? "Marcó cobrada" :
                    prior["paidWeek"] is not null && debt["paidWeek"] is null ? "Volvió a pendiente" : "Corrigió deuda";
                var entry = new JsonObject {
                    ["kind"] = "receivable", ["username"] = username, ["category"] = category,
                    ["name"] = item["name"]?.DeepClone(), ["amount"] = item["amount"]?.DeepClone(),
                    ["action"] = action, ["receivableId"] = id, ["timestamp"] = DateTimeOffset.UtcNow.ToString("O")
                };
                db.AppStates.Add(new AppStateRecord { Key = "audit:" + Guid.NewGuid().ToString("N"), Json = entry.ToJsonString() });
            }
            var instantWeeks = ((old?["finance"]?["instantCounts"] as JsonObject)?.Select(p => p.Key) ?? [])
                .Union((current["finance"]?["instantCounts"] as JsonObject)?.Select(p => p.Key) ?? []);
            foreach (var week in instantWeeks)
            {
                if (!int.TryParse(week, out var number) || number < 1 || number > 11) continue;
                var from = InstantCount(old, week);
                var to = InstantCount(current, week);
                if (from == to) continue;
                var entry = new JsonObject {
                    ["kind"] = "instant", ["username"] = username, ["category"] = category,
                    ["payment"] = number == current["weekLimit"]?.GetValue<int>() ? "GRAN FINAL" : $"Semana {number}",
                    ["week"] = number, ["count"] = to, ["delta"] = to - from, ["amount"] = to * 100,
                    ["timestamp"] = DateTimeOffset.UtcNow.ToString("O")
                };
                db.AppStates.Add(new AppStateRecord { Key = "audit:" + Guid.NewGuid().ToString("N"), Json = entry.ToJsonString() });
            }
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

    private static Dictionary<string, JsonObject> Receivables(JsonNode? category) =>
        (category?["finance"]?["receivables"] as JsonArray ?? [])
            .OfType<JsonObject>().Take(500).Where(item => item["id"] is JsonValue value && value.TryGetValue<string>(out _))
            .GroupBy(item => item["id"]!.GetValue<string>()).ToDictionary(group => group.Key, group => group.Last());

    private static int InstantCount(JsonNode? category, string week) =>
        category?["finance"]?["instantCounts"]?[week] is JsonValue value && value.TryGetValue<int>(out var count)
            && count >= 0 && count <= 10000 ? count : 0;

    private static HashSet<string> Ids(JsonNode? node) => node is JsonArray array
        ? array.Select(item => item?.GetValue<string>() ?? "").Where(id => id.Length > 0).ToHashSet()
        : [];
}
