using System.Text.Json;
using SystemDesignSimulator.Api.Data.Seed;

namespace SystemDesignSimulator.Api.Tests;

/// <summary>
/// The serialized shape of flows, objectives and capabilities. These are read
/// by the frontend's flow interpreter, so the JSON must match what
/// <c>src/game/flow-types.ts</c> expects exactly.
/// </summary>
public class FlowDefinitionsTests
{
    public static TheoryData<string, string[]> SeededChallenges => new()
    {
        { "url-shortener", new[] { "create", "read" } },
        { "instagram-feed", new[] { "feedLoad", "post", "like" } },
        { "dropbox", new[] { "upload", "download", "metadata" } },
        { "rate-limiter", new[] { "check" } },
    };

    private static JsonElement SerializeFlows(string slug) =>
        JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(FlowDefinitions.Flows(slug)));

    [Theory]
    [MemberData(nameof(SeededChallenges))]
    public void Every_seeded_challenge_defines_a_flow_per_request_kind(string slug, string[] expectedKinds)
    {
        var kinds = SerializeFlows(slug)
            .EnumerateArray()
            .Select(f => f.GetProperty("kind").GetString())
            .ToArray();

        Assert.Equal(expectedKinds, kinds);
    }

    [Theory]
    [MemberData(nameof(SeededChallenges))]
    public void Serialized_flows_contain_no_null_members(string slug, string[] kinds)
    {
        // System.Text.Json writes unset members as null, and the frontend
        // treats `componentType: null` as a criterion that never matches.
        // The step builders omit absent members instead.
        Assert.NotEmpty(kinds);
        AssertNoNulls(SerializeFlows(slug), $"flows({slug})");
    }

    [Theory]
    [MemberData(nameof(SeededChallenges))]
    public void Every_flow_has_a_way_to_complete(string slug, string[] kinds)
    {
        Assert.NotEmpty(kinds);
        foreach (var flow in SerializeFlows(slug).EnumerateArray())
        {
            Assert.True(
                CanComplete(flow.GetProperty("steps")),
                $"{slug}/{flow.GetProperty("kind").GetString()} can never complete");
        }
    }

    [Theory]
    [MemberData(nameof(SeededChallenges))]
    public void Every_step_has_an_id_and_a_non_empty_selector(string slug, string[] kinds)
    {
        Assert.NotEmpty(kinds);
        foreach (var step in SerializeFlows(slug).EnumerateArray().SelectMany(f => AllSteps(f.GetProperty("steps"))))
        {
            Assert.False(string.IsNullOrWhiteSpace(step.GetProperty("id").GetString()));
            var require = step.GetProperty("require");
            Assert.True(
                require.TryGetProperty("capability", out _)
                || require.TryGetProperty("componentType", out _)
                || require.TryGetProperty("tag", out _),
                $"{slug}: step {step.GetProperty("id")} has an empty selector");
        }
    }

    [Theory]
    [MemberData(nameof(SeededChallenges))]
    public void Objectives_cover_every_request_kind_and_forbid_violations(string slug, string[] expectedKinds)
    {
        var objectives = JsonSerializer.Deserialize<JsonElement>(
            JsonSerializer.Serialize(FlowDefinitions.ObjectivesFor(slug)));

        Assert.Equal(0, objectives.GetProperty("maxViolationRate").GetDouble());
        Assert.True(objectives.GetProperty("noComponentFailures").GetBoolean());

        var floors = objectives.GetProperty("minCompletionRate");
        foreach (var kind in expectedKinds)
        {
            var floor = floors.GetProperty(kind).GetDouble();
            Assert.InRange(floor, 0, 1);
        }
    }

    [Fact]
    public void An_unknown_slug_has_no_flows_or_objectives()
    {
        Assert.Empty(FlowDefinitions.Flows("not-a-challenge"));
        Assert.Null(FlowDefinitions.ObjectivesFor("not-a-challenge"));
    }

    [Fact]
    public void An_empty_branch_miss_arm_serializes_as_an_empty_array()
    {
        // Instagram's CDN edge step: a miss simply continues with the
        // remaining steps, which the interpreter models as `onMiss: []`.
        var edge = SerializeFlows("instagram-feed")[0].GetProperty("steps")[1];
        var branch = edge.GetProperty("branch");

        Assert.Equal(JsonValueKind.Array, branch.GetProperty("onMiss").ValueKind);
        Assert.Empty(branch.GetProperty("onMiss").EnumerateArray());
        Assert.Equal("complete", branch.GetProperty("onHit").GetString());
    }

    [Theory]
    [InlineData("redis", new[] { "cache" })]
    [InlineData("cdn", new[] { "traffic-filter", "cache" })]
    [InlineData("database", new[] { "durable-store" })]
    [InlineData("nosql-database", new[] { "durable-store" })]
    [InlineData("object-storage", new[] { "durable-store" })]
    [InlineData("load-balancer", new[] { "ingress" })]
    [InlineData("api-gateway", new[] { "ingress" })]
    [InlineData("rate-limiter", new[] { "traffic-filter" })]
    [InlineData("backend-service", new[] { "compute" })]
    [InlineData("worker-service", new[] { "compute" })]
    [InlineData("message-queue", new[] { "queue" })]
    [InlineData("kafka", new[] { "queue" })]
    public void Capabilities_mirror_the_frontend_fallback_table(string type, string[] expected)
    {
        Assert.Equal(expected, FlowDefinitions.Capabilities(type));
    }

    [Fact]
    public void Redis_is_never_a_durable_store()
    {
        // The single rule that kills the "cache instead of a database"
        // exploit (flow-correctness.md §3).
        Assert.DoesNotContain("durable-store", FlowDefinitions.Capabilities("redis"));
    }

    [Fact]
    public void Capabilities_round_trip_through_the_config_schema()
    {
        var schema = FlowDefinitions.CapabilitiesSchema("cdn");
        Assert.Equal(new[] { "traffic-filter", "cache" }, FlowDefinitions.CapabilitiesFromSchema(schema));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not json at all")]
    [InlineData("[1,2,3]")]
    [InlineData("""{"other":"keys"}""")]
    [InlineData("""{"capabilities":"not-an-array"}""")]
    public void Reading_capabilities_out_of_a_bad_schema_returns_null(string? schema)
    {
        Assert.Null(FlowDefinitions.CapabilitiesFromSchema(schema));
    }

    [Fact]
    public void Unknown_component_types_have_no_capabilities()
    {
        Assert.Empty(FlowDefinitions.Capabilities("quantum-mainframe"));
    }

    // ---- helpers ----------------------------------------------------------

    private static IEnumerable<JsonElement> AllSteps(JsonElement steps)
    {
        foreach (var step in steps.EnumerateArray())
        {
            yield return step;
            if (!step.TryGetProperty("branch", out var branch)) continue;
            if (branch.TryGetProperty("onHit", out var onHit) && onHit.ValueKind == JsonValueKind.Array)
            {
                foreach (var nested in AllSteps(onHit)) yield return nested;
            }
            if (branch.TryGetProperty("onMiss", out var onMiss) && onMiss.ValueKind == JsonValueKind.Array)
            {
                foreach (var nested in AllSteps(onMiss)) yield return nested;
            }
        }
    }

    private static bool CanComplete(JsonElement steps) =>
        steps.EnumerateArray().Any(step =>
        {
            if (step.TryGetProperty("terminal", out var terminal) && terminal.GetBoolean()) return true;
            if (!step.TryGetProperty("branch", out var branch)) return false;
            var onHit = branch.GetProperty("onHit");
            if (onHit.ValueKind == JsonValueKind.String && onHit.GetString() == "complete") return true;
            if (onHit.ValueKind == JsonValueKind.Array && CanComplete(onHit)) return true;
            return CanComplete(branch.GetProperty("onMiss"));
        });

    private static void AssertNoNulls(JsonElement element, string path)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Null:
                Assert.Fail($"Null member at {path}");
                break;
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    AssertNoNulls(property.Value, $"{path}.{property.Name}");
                }
                break;
            case JsonValueKind.Array:
                var index = 0;
                foreach (var item in element.EnumerateArray())
                {
                    AssertNoNulls(item, $"{path}[{index++}]");
                }
                break;
        }
    }
}
