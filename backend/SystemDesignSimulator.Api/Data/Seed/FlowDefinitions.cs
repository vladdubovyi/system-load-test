using System.Text.Json;

namespace SystemDesignSimulator.Api.Data.Seed;

/// <summary>
/// Flow specs, objectives and component capabilities for the seeded
/// challenges (docs/specs/flow-authoring.md §2). These are serialized into
/// <c>Scenario.ScenarioConfig</c> / <c>ComponentDefinition.ConfigSchema</c>
/// (jsonb) and mirror the frontend's <c>flow-presets.ts</c> /
/// <c>capabilities.ts</c>, which remain the offline fallback.
///
/// Steps are built as dictionaries so that unset members are simply absent:
/// a <c>"componentType": null</c> would be read by the frontend as a
/// criterion that can never match.
/// </summary>
public static class FlowDefinitions
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    // ---- selector helpers -------------------------------------------------

    private static Dictionary<string, object> Cap(string capability) =>
        new() { ["capability"] = capability };

    private static Dictionary<string, object> Type(string componentType) =>
        new() { ["componentType"] = componentType };

    private static Dictionary<string, object> Step(
        string id,
        Dictionary<string, object> require,
        string? label = null,
        bool optional = false,
        bool terminal = false,
        Dictionary<string, object>? branch = null)
    {
        var step = new Dictionary<string, object> { ["id"] = id, ["require"] = require };
        if (label != null) step["label"] = label;
        if (optional) step["optional"] = true;
        if (terminal) step["terminal"] = true;
        if (branch != null) step["branch"] = branch;
        return step;
    }

    /// <summary>Cache-style branch: hit completes, miss continues with the given steps.</summary>
    private static Dictionary<string, object> CacheBranch(params Dictionary<string, object>[] onMiss) =>
        new()
        {
            ["probability"] = "cacheHitRatio",
            ["onHit"] = "complete",
            ["onMiss"] = onMiss,
        };

    private static Dictionary<string, object> Flow(string kind, params Dictionary<string, object>[] steps) =>
        new() { ["kind"] = kind, ["steps"] = steps };

    private static Dictionary<string, object> Objectives(
        Dictionary<string, double> minCompletionRate,
        double maxViolationRate = 0) =>
        new()
        {
            ["minCompletionRate"] = minCompletionRate,
            ["maxViolationRate"] = maxViolationRate,
            ["noComponentFailures"] = true,
        };

    // ---- per-challenge definitions ----------------------------------------

    public static object[] Flows(string slug) => slug switch
    {
        "url-shortener" => new object[]
        {
            Flow("create",
                Step("ingress", Cap("ingress"), "Ingress"),
                Step("service", Cap("compute"), "Shortening service"),
                Step("persist", Cap("durable-store"), "Persist mapping", terminal: true),
                Step("warm", Cap("cache"), "Warm cache", optional: true)),
            Flow("read",
                Step("ingress", Cap("ingress"), "Ingress"),
                Step("service", Cap("compute"), "Redirect service"),
                Step("cache", Cap("cache"), "Cache lookup", optional: true,
                    branch: CacheBranch(
                        Step("db-read", Cap("durable-store"), "Database lookup (cache miss)", terminal: true))),
                Step("db-direct", Cap("durable-store"), "Database lookup", terminal: true)),
        },
        "instagram-feed" => new object[]
        {
            Flow("feedLoad",
                Step("ingress", Cap("ingress"), "Ingress"),
                Step("edge", Type("cdn"), "Edge cache (CDN)", optional: true, branch: CacheBranch()),
                Step("service", Cap("compute"), "Feed service"),
                Step("cache", Cap("cache"), "Feed cache lookup", optional: true,
                    branch: CacheBranch(
                        Step("feed-db-read", Cap("durable-store"), "Feed store lookup (cache miss)", terminal: true))),
                Step("feed-db", Cap("durable-store"), "Feed store lookup", terminal: true)),
            Flow("post",
                Step("ingress", Cap("ingress"), "Ingress"),
                Step("service", Cap("compute"), "Feed service"),
                Step("store", Cap("durable-store"), "Persist post", terminal: true)),
            Flow("like",
                Step("ingress", Cap("ingress"), "Ingress"),
                Step("service", Cap("compute"), "Feed service"),
                Step("count", Cap("durable-store"), "Persist like", terminal: true)),
        },
        "dropbox" => new object[]
        {
            Flow("upload",
                Step("ingress", Cap("ingress"), "Ingress"),
                Step("gateway", Cap("ingress"), "API gateway", optional: true),
                Step("service", Cap("compute"), "Upload service"),
                Step("enqueue", Cap("queue"), "Queue for processing", optional: true),
                Step("worker", Cap("compute"), "Processing worker", optional: true),
                Step("store", Type("object-storage"), "Store file blob", terminal: true)),
            Flow("download",
                Step("ingress", Cap("ingress"), "Ingress"),
                Step("gateway", Cap("ingress"), "API gateway", optional: true),
                Step("service", Cap("compute"), "Download service"),
                Step("cache", Cap("cache"), "Content cache", optional: true,
                    branch: CacheBranch(
                        Step("blob-read", Type("object-storage"), "Fetch blob (cache miss)", terminal: true))),
                Step("blob-direct", Type("object-storage"), "Fetch blob", terminal: true)),
            Flow("metadata",
                Step("ingress", Cap("ingress"), "Ingress"),
                Step("gateway", Cap("ingress"), "API gateway", optional: true),
                Step("service", Cap("compute"), "Metadata service"),
                Step("meta-db", Type("database"), "Metadata lookup", terminal: true)),
        },
        "rate-limiter" => new object[]
        {
            Flow("check",
                Step("ingress", Cap("ingress"), "Ingress"),
                Step("limiter", Cap("traffic-filter"), "Rate limiter"),
                Step("service", Cap("compute"), "API service"),
                Step("counters", Cap("cache"), "Counter lookup", optional: true,
                    branch: CacheBranch(
                        Step("db-read", Cap("durable-store"), "Limit lookup (cache miss)", terminal: true))),
                Step("db-direct", Cap("durable-store"), "Limit lookup", terminal: true)),
        },
        _ => Array.Empty<object>(),
    };

    /// <summary>
    /// Completion floors, calibrated so that each challenge's starter board
    /// does not pass and its reference solution does, on every seed
    /// (docs/specs/interview-platform.md §8). Mirrors
    /// <c>src/game/flow-presets.ts</c>; change both, and re-run the frontend's
    /// calibration test before moving a number.
    /// </summary>
    public static object? ObjectivesFor(string slug) => slug switch
    {
        "url-shortener" => Objectives(new() { ["create"] = 0.99, ["read"] = 0.99 }),
        "instagram-feed" => Objectives(new() { ["feedLoad"] = 0.95, ["post"] = 0.95, ["like"] = 0.95 }),
        "dropbox" => Objectives(new() { ["upload"] = 0.95, ["download"] = 0.95, ["metadata"] = 0.95 }),
        "rate-limiter" => Objectives(new() { ["check"] = 0.95 }),
        _ => null,
    };

    // ---- component capabilities -------------------------------------------

    /// <summary>Mirror of FALLBACK_CAPABILITIES in the frontend's capabilities.ts.</summary>
    public static string[] Capabilities(string componentType) => componentType switch
    {
        "load-balancer" or "api-gateway" or "reverse-proxy" => new[] { "ingress" },
        "rate-limiter" or "dns" => new[] { "traffic-filter" },
        "cdn" => new[] { "traffic-filter", "cache" },
        "backend-service" or "microservice" or "worker-service" or "serverless-function" or "container"
            => new[] { "compute" },
        "database" or "nosql-database" or "object-storage" or "file-system" => new[] { "durable-store" },
        "redis" => new[] { "cache" },
        "message-queue" or "kafka" or "rabbitmq" or "pubsub" => new[] { "queue" },
        _ => Array.Empty<string>(),
    };

    /// <summary>ConfigSchema document carrying the capabilities for a component type.</summary>
    public static string CapabilitiesSchema(string componentType) =>
        JsonSerializer.Serialize(new { capabilities = Capabilities(componentType) }, JsonOptions);

    /// <summary>Read the capabilities array back out of a ConfigSchema document, if present.</summary>
    public static string[]? CapabilitiesFromSchema(string? configSchema)
    {
        if (string.IsNullOrWhiteSpace(configSchema)) return null;
        try
        {
            using var doc = JsonDocument.Parse(configSchema);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
            if (!doc.RootElement.TryGetProperty("capabilities", out var caps)) return null;
            if (caps.ValueKind != JsonValueKind.Array) return null;
            return caps.EnumerateArray()
                .Where(e => e.ValueKind == JsonValueKind.String)
                .Select(e => e.GetString()!)
                .ToArray();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static string Serialize(object value) => JsonSerializer.Serialize(value, JsonOptions);
}
