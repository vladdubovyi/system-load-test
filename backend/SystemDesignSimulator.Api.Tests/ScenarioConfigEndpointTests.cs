using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace SystemDesignSimulator.Api.Tests;

/// <summary>
/// PUT /api/challenges/slug/{slug}/scenario-config — the authoring endpoint
/// from docs/specs/flow-authoring.md §3.2, exercised against the real app
/// and a real PostgreSQL database.
/// </summary>
public class ScenarioConfigEndpointTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public ScenarioConfigEndpointTests(ApiFactory factory) => _factory = factory;

    private const string Slug = "url-shortener";
    private static string Url(string slug = Slug) => $"/api/challenges/slug/{slug}/scenario-config";

    private static readonly object MinimalFlows = new
    {
        flows = new[]
        {
            new
            {
                kind = "create",
                steps = new[]
                {
                    new { id = "persist", require = new { capability = "durable-store" }, terminal = true },
                },
            },
        },
    };

    private async Task<JsonElement> GetScenarioConfig(string slug = Slug)
    {
        using var client = _factory.CreateClient();
        var challenge = await client.GetFromJsonAsync<JsonElement>($"/api/challenges/slug/{slug}");
        return challenge.GetProperty("scenario").GetProperty("scenarioConfig");
    }

    [Fact]
    public async Task Rejects_anonymous_callers()
    {
        using var client = _factory.CreateClient();
        var response = await client.PutAsJsonAsync(Url(), MinimalFlows);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Rejects_signed_in_users_who_are_not_authors()
    {
        using var client = _factory.CreateClientFor("someone-else@example.com");
        var response = await client.PutAsJsonAsync(Url(), MinimalFlows);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Author_can_replace_flows_and_the_change_is_persisted()
    {
        using var client = _factory.CreateClientFor(ApiFactory.AuthorEmail);
        var tags = new[] { new { id = "write-service", label = "Write service" } };

        var response = await client.PutAsJsonAsync(Url(), new
        {
            flows = ((dynamic)MinimalFlows).flows,
            tags,
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        // The response body is the challenge in the same shape as GET.
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var config = body.GetProperty("scenario").GetProperty("scenarioConfig");
        Assert.Equal("create", config.GetProperty("flows")[0].GetProperty("kind").GetString());
        Assert.Equal("write-service", config.GetProperty("tags")[0].GetProperty("id").GetString());

        // And a fresh read sees the same thing, so it really hit the database.
        var persisted = await GetScenarioConfig();
        Assert.Equal("create", persisted.GetProperty("flows")[0].GetProperty("kind").GetString());
        Assert.Single(persisted.GetProperty("flows").EnumerateArray());
    }

    [Fact]
    public async Task Leaves_untouched_keys_of_the_scenario_config_alone()
    {
        using var client = _factory.CreateClientFor(ApiFactory.AuthorEmail);

        var before = await GetScenarioConfig();
        var requirementsBefore = before.GetProperty("requirements").GetArrayLength();
        var drainBefore = before.GetProperty("drainDuration").GetInt32();
        Assert.True(requirementsBefore > 0);

        var response = await client.PutAsJsonAsync(Url(), new { objectives = new { maxViolationRate = 0.25 } });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var after = await GetScenarioConfig();
        Assert.Equal(requirementsBefore, after.GetProperty("requirements").GetArrayLength());
        Assert.Equal(drainBefore, after.GetProperty("drainDuration").GetInt32());
        Assert.Equal(0.25, after.GetProperty("objectives").GetProperty("maxViolationRate").GetDouble());
        // Flows were not part of this request, so the seeded ones survive.
        Assert.True(after.GetProperty("flows").GetArrayLength() >= 2);
    }

    [Theory]
    [InlineData("""{"flows":{"kind":"create"}}""")]          // flows must be an array
    [InlineData("""{"objectives":[1,2]}""")]                  // objectives must be an object
    [InlineData("""{"tags":{"id":"x"}}""")]                   // tags must be an array
    [InlineData("""{"flows":[{"kind":"create"}]}""")]         // a flow needs steps
    [InlineData("""{"flows":[{"steps":[]}]}""")]              // a flow needs a kind
    [InlineData("""{"flows":[42]}""")]                        // a flow must be an object
    [InlineData("""{"nothing":"recognised"}""")]              // no authorable keys
    public async Task Rejects_malformed_documents(string json)
    {
        using var client = _factory.CreateClientFor(ApiFactory.AuthorEmail);
        var content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");

        var response = await client.PutAsync(Url(), content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rejects_a_body_that_is_not_an_object()
    {
        using var client = _factory.CreateClientFor(ApiFactory.AuthorEmail);
        var content = new StringContent("[]", System.Text.Encoding.UTF8, "application/json");

        var response = await client.PutAsync(Url(), content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Returns_404_for_an_unknown_challenge()
    {
        using var client = _factory.CreateClientFor(ApiFactory.AuthorEmail);
        var response = await client.PutAsJsonAsync(Url("no-such-challenge"), MinimalFlows);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Saved_flows_survive_a_jsonb_round_trip_with_their_nested_structure()
    {
        using var client = _factory.CreateClientFor(ApiFactory.AuthorEmail);

        // A branch with a nested miss arm: the shape the frontend's
        // interpreter cares about most.
        var response = await client.PutAsJsonAsync(Url("rate-limiter"), new
        {
            flows = new[]
            {
                new
                {
                    kind = "check",
                    steps = new object[]
                    {
                        new { id = "ingress", require = new { capability = "ingress" } },
                        new
                        {
                            id = "cache",
                            require = new { capability = "cache" },
                            optional = true,
                            branch = new
                            {
                                probability = "cacheHitRatio",
                                onHit = "complete",
                                onMiss = new[]
                                {
                                    new { id = "db", require = new { capability = "durable-store" }, terminal = true },
                                },
                            },
                        },
                    },
                },
            },
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var config = await GetScenarioConfig("rate-limiter");
        var branch = config.GetProperty("flows")[0].GetProperty("steps")[1].GetProperty("branch");
        Assert.Equal("cacheHitRatio", branch.GetProperty("probability").GetString());
        Assert.Equal("complete", branch.GetProperty("onHit").GetString());
        Assert.Equal("db", branch.GetProperty("onMiss")[0].GetProperty("id").GetString());
        Assert.True(branch.GetProperty("onMiss")[0].GetProperty("terminal").GetBoolean());
    }
}

/// <summary>
/// With no CHALLENGE_AUTHORS configured the endpoint is closed to everyone —
/// the secure default from flow-authoring.md §3.2.
/// </summary>
public class ScenarioConfigAuthorlessTests : IClassFixture<ScenarioConfigAuthorlessTests.AuthorlessFactory>
{
    public class AuthorlessFactory : ApiFactory
    {
        public AuthorlessFactory() => ChallengeAuthors = null;
    }

    private readonly AuthorlessFactory _factory;

    public ScenarioConfigAuthorlessTests(AuthorlessFactory factory) => _factory = factory;

    [Fact]
    public async Task Nobody_can_author_when_the_allowlist_is_unset()
    {
        using var client = _factory.CreateClientFor(ApiFactory.AuthorEmail);
        var response = await client.PutAsJsonAsync(
            "/api/challenges/slug/url-shortener/scenario-config",
            new { flows = Array.Empty<object>() });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
