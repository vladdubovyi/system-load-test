using Microsoft.EntityFrameworkCore;

namespace SystemDesignSimulator.Api.Tests;

/// <summary>
/// Guards the test harness itself. Program.cs reads its connection string
/// while the host is being built, so configuration supplied the usual
/// WebApplicationFactory way arrives too late and the suite silently runs
/// against the developer's real database — mutating seeded challenges. These
/// tests fail loudly if that regresses.
/// </summary>
public class IsolationTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public IsolationTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public void The_application_is_connected_to_this_factorys_throwaway_database()
    {
        Assert.Equal(_factory.DatabaseName, _factory.ConnectedDatabaseName());
    }

    [Fact]
    public void The_application_never_touches_a_non_test_database()
    {
        var connected = _factory.ConnectedDatabaseName();

        Assert.StartsWith(ApiFactory.DatabasePrefix, connected);
        Assert.NotEqual("systemdesignsim", connected);
    }

    [Fact]
    public void Seeding_ran_inside_the_throwaway_database()
    {
        // Proves the migrations and seeder executed against the isolated
        // database rather than finding an already-populated shared one.
        _factory.WithDbContext(context =>
        {
            Assert.Equal(_factory.DatabaseName, context.Database.GetDbConnection().Database);
            Assert.Equal(4, context.Challenges.Count());
        });
    }
}
