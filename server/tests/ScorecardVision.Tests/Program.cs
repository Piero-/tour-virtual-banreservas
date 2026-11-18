using System.Net;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Configuration;
using TourVirtual.Api.Data;

static void Check(bool value) { if (!value) throw new Exception("Assertion failed"); }
var handler = new FakeHandler();
var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
    ["OPENAI_API_KEY"] = "test-only-key", ["OPENAI_VISION_MODEL"] = "test-model"
}).Build();
var service = new ScorecardVision(new FakeClients(handler), config);
Check(service.Enabled);
Check(!new ScorecardVision(new FakeClients(handler), new ConfigurationBuilder().Build()).Enabled);
for (var i = 0; i < 60; i++) Check(service.Allow("test"));
Check(!service.Allow("test"));
Check(service.Allow("another-user"));
var table = new JsonObject { ["par"] = new JsonArray(), ["groups"] = new JsonArray() };
handler.Response = new JsonObject { ["status"] = "completed", ["output"] = new JsonArray(
    new JsonObject { ["type"] = "reasoning" },
    new JsonObject { ["content"] = new JsonArray(new JsonObject { ["type"]="output_text", ["text"]=table.ToJsonString() }) }) }.ToJsonString();
var result = await service.Read([255,216,255,0], default);
Check(result["groups"] is JsonArray);
Check(handler.Payload?["model"]?.GetValue<string>() == "test-model");
Check(handler.Payload?["store"]?.GetValue<bool>() == false);
Check(handler.Payload?["text"]?["format"]?["strict"]?.GetValue<bool>() == true);
Check(handler.Payload?["input"]?[0]?["content"]?[0]?["image_url"]?.GetValue<string>().StartsWith("data:image/jpeg;base64,") == true);
Check(handler.Authorization == "Bearer test-only-key");
handler.Response = "{\"status\":\"incomplete\",\"output\":[]}";
try { await service.Read([255,216,255,0], default); throw new Exception("Expected incomplete failure"); }
catch (InvalidDataException) { }
handler.Status = HttpStatusCode.Forbidden;
try { await service.Read([255,216,255,0], default); throw new Exception("Expected permission failure"); }
catch (HttpRequestException ex) { Check(ex.StatusCode == HttpStatusCode.Forbidden); }
Console.WriteLine("Vision transport, schema, refusal, quota and permission tests passed (no API calls).");

sealed class FakeClients(FakeHandler handler) : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => new(handler, disposeHandler:false);
}
sealed class FakeHandler : HttpMessageHandler
{
    public string Response = "{}";
    public HttpStatusCode Status = HttpStatusCode.OK;
    public JsonNode? Payload;
    public string? Authorization;
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.RequestUri?.ToString() != "https://api.openai.com/v1/responses") throw new Exception("Wrong endpoint");
        Payload = JsonNode.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
        Authorization = request.Headers.Authorization?.ToString();
        return new HttpResponseMessage(Status) { Content = new StringContent(Response, System.Text.Encoding.UTF8, "application/json") };
    }
}
