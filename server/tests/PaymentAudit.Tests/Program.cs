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
static string DebtState(string name, decimal amount, int? week, bool include = true) => new JsonObject {
    ["categories"]=new JsonObject { ["A"]=new JsonObject {
        ["weekLimit"]=2, ["finance"]=new JsonObject { ["receivables"]=include ? new JsonArray(new JsonObject {
            ["id"]="debt", ["name"]=name, ["amount"]=amount, ["paidWeek"]=week
        }) : new JsonArray() }
    } }
}.ToJsonString();
var pending=DebtState("Ana",500,null);var collected=DebtState("Ana",500,1);
PaymentAudit.Record(db,DebtState("Ana",500,null,false),pending,"piero");db.SaveChanges();
var registered=JsonNode.Parse(db.AppStates.OrderByDescending(r=>r.Id).First().Json)!;
Check(registered["kind"]!.GetValue<string>()=="receivable");Check(registered["action"]!.GetValue<string>()=="Registró deuda");
PaymentAudit.Record(db,pending,collected,"manuel");db.SaveChanges();
var paid=JsonNode.Parse(db.AppStates.OrderByDescending(r=>r.Id).First().Json)!;
Check(paid["action"]!.GetValue<string>()=="Marcó cobrada");
var countBefore=db.AppStates.Count();PaymentAudit.Record(db,collected,collected,"piero");db.SaveChanges();Check(db.AppStates.Count()==countBefore);
PaymentAudit.Record(db,collected,DebtState("Ana",600,1),"piero");db.SaveChanges();
var edited=JsonNode.Parse(db.AppStates.OrderByDescending(r=>r.Id).First().Json)!;
Check(edited["action"]!.GetValue<string>()=="Corrigió deuda");Check(edited["amount"]!.GetValue<decimal>()==600);
PaymentAudit.Record(db,collected,pending,"piero");db.SaveChanges();
Check(JsonNode.Parse(db.AppStates.OrderByDescending(r=>r.Id).First().Json)!["action"]!.GetValue<string>()=="Volvió a pendiente");
PaymentAudit.Record(db,pending,DebtState("Ana",500,null,false),"piero");db.SaveChanges();
Check(JsonNode.Parse(db.AppStates.OrderByDescending(r=>r.Id).First().Json)!["action"]!.GetValue<string>()=="Quitó deuda");
Console.WriteLine("Receivable audit: creation, collection, corrections, undo, removal and unchanged saves passed.");
