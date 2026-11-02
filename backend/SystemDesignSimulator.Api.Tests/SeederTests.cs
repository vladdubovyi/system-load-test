using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SystemDesignSimulator.Api.Data.Seed;

namespace SystemDesignSimulator.Api.Tests;

/// <summary>
/// What a freshly migrated and seeded database actually contains, read back
/// through the API the frontend calls (flow-authoring.md §2.1 and §2.2).
/// </summary>
public class SeederTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public SeederTests(ApiFactory factory) => _factory = factory;

    [Theory]
    [InlineData("url-shortener", 2)]
    [InlineData("instagram-feed", 3)]
    [InlineData("dropbox", 3)]
    [InlineData("rate-limiter", 1)]
    public async Task Seeded_challenges_serve_flows_and_objectives(string slug, int flowCount)
    {
        using var client = _factory.CreateClient();
        var challenge = await client.GetFromJsonAsync<JsonElement>($"/api/challenges/slug/{slug}");
        var config = challenge.GetProperty("scenario").GetProperty("scenarioConfig");

        Assert.Equal(flowCount, config.GetProperty("flows").GetArrayLength());
        Assert.Equal(0, config.GetProperty("objectives").GetProperty("maxViolationRate").GetDouble());

        // Every request kind in the traffic mix has a flow — the condition the
        // frontend lint enforces on the board.
        var kinds = config.GetProperty("flows").EnumerateArray()
            .Select(f => f.GetProperty("kind").GetString()!)
            .ToHashSet();
        foreach (var requestType in config.GetProperty("requestTypes").EnumerateObject())
        {
            Assert.Contains(requestType.Name, kinds);
        }
    }

    [Fact]
    public async Task The_challenge_list_carries_flows_too()
    {
        using var client = _factory.CreateClient();
        var challenges = await client.GetFromJsonAsync<JsonElement>("/api/challenges");

        Assert.Equal(4, challenges.GetArrayLength());
        foreach (var challenge in challenges.EnumerateArray())
        {
            var config = challenge.GetProperty("scenario").GetProperty("scenarioConfig");
            Assert.True(
                config.GetProperty("flows").GetArrayLength() > 0,
                $"{challenge.GetProperty("slug")} has no flows");
        }
    }

    [Fact]
    public async Task Component_definitions_expose_their_capabilities()
    {
        using var client = _factory.CreateClient();
        var components = await client.GetFromJsonAsync<JsonElement>("/api/components");

        var byType = components.EnumerateArray()
            .ToDictionary(c => c.GetProperty("componentType").GetString()!, c => c);

        Assert.Equal(
            new[] { "cache" },
            byType["redis"].GetProperty("capabilities").EnumerateArray().Select(c => c.GetString()));
        Assert.Equal(
            new[] { "durable-store" },
            byType["database"].GetProperty("capabilities").EnumerateArray().Select(c => c.GetString()));
        Assert.Equal(
            new[] { "traffic-filter", "cache" },
            byType["cdn"].GetProperty("capabilities").EnumerateArray().Select(c => c.GetString()));
    }

    [Fact]
    public async Task A_single_component_lookup_exposes_capabilities()
    {
        using var client = _factory.CreateClient();
        var component = await client.GetFromJsonAsync<JsonElement>("/api/components/load-balancer");

        Assert.Equal(
            new[] { "ingress" },
            component.GetProperty("capabilities").EnumerateArray().Select(c => c.GetString()));
    }

    [Fact]
    public void EnsureFlowDefinitions_backfills_a_scenario_that_predates_flows()
    {
        // Simulate a database seeded before flow correctness: strip the keys
        // back out, then re-run the backfill the app runs at startup.
        _factory.WithDbContext(context =>
        {
            var scenario = context.Scenarios
                .Include(s => s.Challenge)
                .First(s => s.Challenge!.Slug == "dropbox");

            scenario.ScenarioConfig = JsonSerializer.Serialize(new
            {
                requirements = new[] { "Store files up to 2GB" },
                drainDuration = 15,
                requestTypes = new { upload = 0.2, download = 0.5, metadata = 0.3 },
            });
            context.SaveChanges();
        });

        _factory.WithDbContext(ChallengeSeeder.EnsureFlowDefinitions);

        _factory.WithDbContext(context =>
        {
            var scenario = context.Scenarios
                .Include(s => s.Challenge)
                .First(s => s.Challenge!.Slug == "dropbox");
            var config = JsonSerializer.Deserialize<JsonElement>(scenario.ScenarioConfig);

            Assert.Equal(3, config.GetProperty("flows").GetArrayLength());
            Assert.True(config.TryGetProperty("objectives", out _));
            // Pre-existing keys are preserved.
            Assert.Equal(15, config.GetProperty("drainDuration").GetInt32());
            Assert.Single(config.GetProperty("requirements").EnumerateArray());
        });
    }

    [Fact]
    public void EnsureFlowDefinitions_never_overwrites_authored_flows()
    {
        _factory.WithDbContext(context =>
        {
            var scenario = context.Scenarios
                .Include(s => s.Challenge)
                .First(s => s.Challenge!.Slug == "instagram-feed");

            scenario.ScenarioConfig = JsonSerializer.Serialize(new
            {
                requestTypes = new { feedLoad = 1.0 },
                flows = new[] { new { kind = "feedLoad", steps = Array.Empty<object>() } },
            });
            context.SaveChanges();
        });

        _factory.WithDbContext(ChallengeSeeder.EnsureFlowDefinitions);

        _factory.WithDbContext(context =>
        {
            var scenario = context.Scenarios
                .Include(s => s.Challenge)
                .First(s => s.Challenge!.Slug == "instagram-feed");
            var config = JsonSerializer.Deserialize<JsonElement>(scenario.ScenarioConfig);

            // Still the author's single (empty) flow, not the three seeded ones.
            Assert.Single(config.GetProperty("flows").EnumerateArray());
            // The missing objectives key was still filled in.
            Assert.True(config.TryGetProperty("objectives", out _));
        });
    }

    [Fact]
    public void EnsureFlowDefinitions_is_idempotent()
    {
        string? first = null;
        _factory.WithDbContext(context =>
        {
            ChallengeSeeder.EnsureFlowDefinitions(context);
            first = context.Scenarios.Include(s => s.Challenge)
                .First(s => s.Challenge!.Slug == "url-shortener").ScenarioConfig;
        });

        _factory.WithDbContext(ChallengeSeeder.EnsureFlowDefinitions);

        _factory.WithDbContext(context =>
        {
            var second = context.Scenarios.Include(s => s.Challenge)
                .First(s => s.Challenge!.Slug == "url-shortener").ScenarioConfig;
            Assert.Equal(first, second);
        });
    }

    [Fact]
    public void EnsureFlowDefinitions_backfills_capabilities_onto_older_component_rows()
    {
        _factory.WithDbContext(context =>
        {
            var redis = context.ComponentDefinitions.First(c => c.ComponentType == "redis");
            redis.ConfigSchema = null;
            context.SaveChanges();
        });

        _factory.WithDbContext(ChallengeSeeder.EnsureFlowDefinitions);

        _factory.WithDbContext(context =>
        {
            var redis = context.ComponentDefinitions.First(c => c.ComponentType == "redis");
            Assert.Equal(new[] { "cache" }, FlowDefinitions.CapabilitiesFromSchema(redis.ConfigSchema));
        });
    }
}
