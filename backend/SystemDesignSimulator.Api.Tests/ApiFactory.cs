using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace SystemDesignSimulator.Api.Tests;

/// <summary>
/// Hosts the real application in-process. The API is database-free
/// (docs/specs/interview-platform.md §2.3), so there is nothing to provision
/// or clean up: every factory serves the same in-memory catalog that
/// production does.
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
    }
}
