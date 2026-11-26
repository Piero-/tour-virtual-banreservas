using Microsoft.EntityFrameworkCore;
using System.Text.Json.Nodes;
using TourVirtual.Api.Data;

static void Check(bool condition) { if (!condition) throw new Exception("Assertion failed"); }
static string State(int a, int c = 0) => new JsonObject {
    ["categories"] = new JsonObject {
        ["A"] = new JsonObject { ["weekLimit"]=2, ["finance"]=new JsonObject { ["instantCounts"]=new JsonObject { ["1"]=a } } },
        ["C"] = new JsonObject { ["weekLimit"]=2, ["finance"]=new JsonObject { ["instantCounts"]=new JsonObject { ["2"]=c } } }
    }
}.ToJsonString();
using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite("Data Source=:memory:").Options);
db.Database.OpenConnection();db.Database.EnsureCreated();
PaymentAudit.Record(db, State(0), State(2), "piero");
db.SaveChanges();
var entry = JsonNode.Parse(db.AppStates.Single().Json)!;
Check(entry["kind"]!.GetValue<string>()=="instant");
Check(entry["category"]!.GetValue<string>()=="A");
Check(entry["count"]!.GetValue<int>()==2 && entry["delta"]!.GetValue<int>()==2);
Check(entry["amount"]!.GetValue<int>()==200);
Check(entry["username"]!.GetValue<string>()=="piero");
PaymentAudit.Record(db,State(2),State(1),"manuel");db.SaveChanges();
var correction = JsonNode.Parse(db.AppStates.OrderByDescending(r=>r.Id).First().Json)!;
Check(correction["delta"]!.GetValue<int>()==-1 && correction["count"]!.GetValue<int>()==1);
PaymentAudit.Record(db,State(1),State(1),"piero");db.SaveChanges();
Check(db.AppStates.Count()==2);
PaymentAudit.Record(db,State(1),State(1,1),"piero");db.SaveChanges();
var final = JsonNode.Parse(db.AppStates.OrderByDescending(r=>r.Id).First().Json)!;
Check(final["category"]!.GetValue<string>()=="C");Check(final["payment"]!.GetValue<string>()=="GRAN FINAL");
PaymentAudit.Record(db,State(1,1),State(0,1),"piero");db.SaveChanges();
var removed = JsonNode.Parse(db.AppStates.OrderByDescending(r=>r.Id).First().Json)!;
Check(removed["count"]!.GetValue<int>()==0 && removed["delta"]!.GetValue<int>()==-1);
Console.WriteLine("Instant payment audit: additions, corrections, no duplicates, zero and category isolation passed.");
