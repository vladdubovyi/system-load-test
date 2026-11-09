using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;

namespace SystemDesignSimulator.Api.Tests;

/// <summary>
/// The MVP is anonymous and database-free (docs/specs/interview-platform.md
/// §2). The account surface and the authoring endpoint are not gated or
/// hidden — they are gone, along with Identity and Entity Framework. These
/// tests fail if any of it comes back.
/// </summary>
public class AnonymousMvpTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public AnonymousMvpTests(ApiFactory factory) => _factory = factory;

    public static TheoryData<HttpMethod, string> RemovedRoutes => new()
    {
        { HttpMethod.Post, "/api/auth/register" },
        { HttpMethod.Post, "/api/auth/login" },
        { HttpMethod.Post, "/api/auth/google" },
        { HttpMethod.Get, "/api/auth/me" },
    };

    [Theory]
    [MemberData(nameof(RemovedRoutes))]
    public async Task Auth_routes_do_not_exist(HttpMethod method, string path)
    {
        using var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(method, path);
        if (method == HttpMethod.Post)
        {
            request.Content = JsonContent.Create(new { email = "someone@example.com", password = "a-password" });
        }

        var response = await client.SendAsync(request);

        // 404, not 401: there is no endpoint to authenticate against.
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task There_is_no_write_endpoint_for_scenarios()
    {
        using var client = _factory.CreateClient();

        var response = await client.PutAsJsonAsync(
            "/api/challenges/slug/url-shortener/scenario-config",
            new { flows = Array.Empty<object>() });

        Assert.Contains(response.StatusCode, new[] { HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed });
    }

    [Fact]
    public async Task A_bearer_token_changes_nothing()
    {
        // No authentication middleware is registered, so a token is just an
        // ignored header — the response is identical to the anonymous one.
        using var anonymous = _factory.CreateClient();
        using var withToken = _factory.CreateClient();
        withToken.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "any-token-at-all");

        var a = await anonymous.GetStringAsync("/api/challenges/slug/url-shortener");
        var b = await withToken.GetStringAsync("/api/challenges/slug/url-shortener");

        Assert.Equal(a, b);
    }

    [Fact]
    public async Task No_authentication_identity_or_database_is_wired_up()
    {
        // No authentication scheme means no middleware that could ever read a
        // credential; no loaded EF, Identity or Npgsql assembly means there is
        // no path to a database at all.
        // The framework always registers the scheme provider; what matters is
        // that nothing has been added to it.
        var schemes = await _factory.Services
            .GetRequiredService<Microsoft.AspNetCore.Authentication.IAuthenticationSchemeProvider>()
            .GetAllSchemesAsync();
        Assert.Empty(schemes);

        var persistenceAssemblies = AppDomain.CurrentDomain.GetAssemblies()
            .Select(a => a.GetName().Name ?? "")
            .Where(n => n.StartsWith("Microsoft.EntityFrameworkCore", StringComparison.Ordinal)
                     || n.StartsWith("Microsoft.AspNetCore.Identity", StringComparison.Ordinal)
                     || n.StartsWith("Microsoft.AspNetCore.Authentication.JwtBearer", StringComparison.Ordinal)
                     || n.StartsWith("Npgsql", StringComparison.Ordinal))
            .ToList();
        Assert.Empty(persistenceAssemblies);
    }

    [Fact]
    public async Task The_endpoints_the_MVP_does_use_stay_anonymous()
    {
        using var client = _factory.CreateClient();

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/challenges")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/challenges/slug/url-shortener")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/components")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/components/redis")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/health")).StatusCode);
    }
}
