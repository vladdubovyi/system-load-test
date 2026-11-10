using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using SystemDesignSimulator.Api.Data;
using SystemDesignSimulator.Api.Data.Seed;

namespace SystemDesignSimulator.Api.Tests;

/// <summary>
/// What the in-memory challenge catalog serves, read back through the API
/// the frontend calls (flow-authoring.md §2.1 and §2.2;
/// interview-platform.md §2.3).
/// </summary>
public class CatalogTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public CatalogTests(ApiFactory factory) => _factory = factory;

    [Theory]
    [InlineData("url-shortener", 2)]
    [InlineData("instagram-feed", 3)]
    [InlineData("dropbox", 3)]
    [InlineData("rate-limiter", 1)]
    [InlineData("chat-messaging", 2)]
    [InlineData("ticket-booking", 2)]
    [InlineData("search-autocomplete", 2)]
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

        Assert.Equal(7, challenges.GetArrayLength());
        foreach (var challenge in challenges.EnumerateArray())
        {
            var config = challenge.GetProperty("scenario").GetProperty("scenarioConfig");
            Assert.True(
                config.GetProperty("flows").GetArrayLength() > 0,
                $"{challenge.GetProperty("slug")} has no flows");
        }
    }

    [Fact]
    public async Task A_challenge_can_be_fetched_by_the_id_the_list_gave_out()
    {
        using var client = _factory.CreateClient();
        var challenges = await client.GetFromJsonAsync<JsonElement>("/api/challenges");
        var first = challenges.EnumerateArray().First();
        var id = first.GetProperty("id").GetGuid();

        var byId = await client.GetFromJsonAsync<JsonElement>($"/api/challenges/{id}");

        Assert.Equal(first.GetProperty("slug").GetString(), byId.GetProperty("slug").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/challenges/{Guid.NewGuid()}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/challenges/slug/no-such-challenge")).StatusCode);
    }

    [Fact]
    public void Ids_are_the_same_on_every_start()
    {
        // The catalog is rebuilt on every boot of every instance. A link that
        // carries a challenge id must keep working across restarts.
        var first = new ChallengeCatalog();
        var second = new ChallengeCatalog();

        Assert.Equal(first.Challenges.Select(c => c.Id), second.Challenges.Select(c => c.Id));
        Assert.Equal(first.Challenges.Select(c => c.Scenario!.Id), second.Challenges.Select(c => c.Scenario!.Id));
        Assert.Equal(first.Components.Select(c => c.Id), second.Components.Select(c => c.Id));
        Assert.Equal(ChallengeSeeder.StableId("challenge:url-shortener"), first.FindChallenge("url-shortener")!.Id);
    }

    [Fact]
    public void Every_allowed_component_is_a_defined_component()
    {
        var catalog = new ChallengeCatalog();

        foreach (var challenge in catalog.Challenges)
        {
            Assert.NotNull(challenge.Scenario);
            Assert.NotEmpty(challenge.ChallengeComponents);
            foreach (var allowed in challenge.ChallengeComponents)
            {
                Assert.True(
                    catalog.FindComponent(allowed.ComponentType) is { Enabled: true },
                    $"{challenge.Slug} allows unknown or disabled component '{allowed.ComponentType}'");
            }
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
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/components/no-such-type")).StatusCode);
    }

    [Fact]
    public async Task Components_can_be_filtered_by_category()
    {
        using var client = _factory.CreateClient();
        var storage = await client.GetFromJsonAsync<JsonElement>("/api/components?category=storage");

        Assert.NotEqual(0, storage.GetArrayLength());
        Assert.All(storage.EnumerateArray(), c => Assert.Equal("storage", c.GetProperty("category").GetString()));
    }
}
