using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Npgsql;
using SystemDesignSimulator.Api.Data;
using SystemDesignSimulator.Api.Models;
using SystemDesignSimulator.Api.Services;

namespace SystemDesignSimulator.Api.Tests;

/// <summary>
/// Hosts the real API against a throwaway PostgreSQL database — the same
/// engine as production, so `jsonb` columns and System.Text.Json round-trips
/// behave exactly as they will in the deployed app. Each factory creates its
/// own database and drops it on dispose.
///
/// Settings that <c>Program.cs</c> reads **while building the host** (the
/// connection string and the JWT secret) must be supplied as environment
/// variables, not through <c>ConfigureAppConfiguration</c>: the latter is
/// applied after the entry point has already captured those values, which
/// would silently leave the tests pointing at the developer's real database.
/// <see cref="IsolationTests"/> guards that. Settings read per request (the
/// author allowlist) can safely come from in-memory configuration.
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>
{
    /// <summary>Server the test database is created on. Override with TEST_POSTGRES.</summary>
    private static string AdminConnectionString =>
        Environment.GetEnvironmentVariable("TEST_POSTGRES")
        ?? "Host=localhost;Port=5432;Database=postgres;Username=postgres;Password=postgres";

    public const string JwtSecret = "integration-test-secret-key-at-least-32-chars";
    public const string AuthorEmail = "author@example.com";

    /// <summary>Databases whose name starts with this are safe to create and drop.</summary>
    public const string DatabasePrefix = "breakit_test_";

    public string DatabaseName { get; } = $"{DatabasePrefix}{Guid.NewGuid():N}";

    /// <summary>Value of CHALLENGE_AUTHORS for this host; null leaves it unset.</summary>
    public string? ChallengeAuthors { get; init; } = AuthorEmail;

    public ApiFactory()
    {
        Execute(AdminConnectionString, $"CREATE DATABASE \"{DatabaseName}\"");
    }

    public string TestConnectionString =>
        new NpgsqlConnectionStringBuilder(AdminConnectionString) { Database = DatabaseName }
            .ConnectionString;

    protected override IHost CreateHost(IHostBuilder builder)
    {
        // Applied here, immediately before the entry point runs, so the values
        // are already in the default environment-variable configuration source
        // when Program.cs reads them. Tests run serially (see
        // AssemblyInfo.cs), so these process-wide values cannot interleave.
        Environment.SetEnvironmentVariable("DATABASE_URL", null);
        Environment.SetEnvironmentVariable("ConnectionStrings__DefaultConnection", TestConnectionString);
        Environment.SetEnvironmentVariable("JWT_SECRET", JwtSecret);

        try
        {
            return base.CreateHost(builder);
        }
        finally
        {
            Environment.SetEnvironmentVariable("ConnectionStrings__DefaultConnection", null);
            Environment.SetEnvironmentVariable("JWT_SECRET", null);
        }
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureAppConfiguration((_, configuration) =>
        {
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CHALLENGE_AUTHORS"] = ChallengeAuthors,
            });
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (!disposing) return;

        // The host leaves pooled connections behind; DROP DATABASE blocks on them.
        NpgsqlConnection.ClearAllPools();
        Execute(
            AdminConnectionString,
            $"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{DatabaseName}' AND pid <> pg_backend_pid()");
        Execute(AdminConnectionString, $"DROP DATABASE IF EXISTS \"{DatabaseName}\"");
    }

    private static void Execute(string connectionString, string sql)
    {
        using var connection = new NpgsqlConnection(connectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    /// <summary>A bearer token signed exactly as the real login flow signs it.</summary>
    public string TokenFor(string email)
    {
        using var scope = Services.CreateScope();
        var tokens = scope.ServiceProvider.GetRequiredService<JwtTokenService>();
        var (token, _) = tokens.CreateToken(new ApplicationUser
        {
            Id = Guid.NewGuid().ToString(),
            Email = email,
            UserName = email,
            DisplayName = "Test Author",
        });
        return token;
    }

    /// <summary>An HttpClient carrying a token for the given email, or anonymous when null.</summary>
    public HttpClient CreateClientFor(string? email)
    {
        var client = CreateClient();
        if (email != null)
        {
            client.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", TokenFor(email));
        }
        return client;
    }

    /// <summary>Run an action against the application's own DbContext.</summary>
    public void WithDbContext(Action<ApplicationDbContext> action)
    {
        using var scope = Services.CreateScope();
        action(scope.ServiceProvider.GetRequiredService<ApplicationDbContext>());
    }

    /// <summary>The database the running application is actually connected to.</summary>
    public string ConnectedDatabaseName()
    {
        string? name = null;
        WithDbContext(context => name = context.Database.GetDbConnection().Database);
        return name!;
    }
}
