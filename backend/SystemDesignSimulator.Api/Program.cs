using System.Net;
using Microsoft.AspNetCore.HttpOverrides;
using SystemDesignSimulator.Api.Data;
using SystemDesignSimulator.Api.Rooms;

// BreakIT API — anonymous and database-free (docs/specs/interview-platform.md §2).
// There is no persistence of any kind: the challenge library is built from the
// seed source into memory at startup, and there are no accounts, tokens or
// write endpoints. Keep it that way; §2.1 is the checklist.

var builder = WebApplication.CreateBuilder(args);

// Railway injects PORT; bind Kestrel explicitly (exec-form ENTRYPOINT won't expand $PORT)
var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrEmpty(port))
{
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
}

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddSingleton<IChallengeCatalog, ChallengeCatalog>();

// Rooms (docs/specs/interview-platform.md §3, §5, §7): one hub, state in
// process memory, no persistence. Detailed errors stay off so a stack trace
// never carries a payload to a client; the hub itself logs nothing sensitive.
builder.Services.AddSignalR(options =>
{
    options.EnableDetailedErrors = false;
    options.MaximumReceiveMessageSize = RoomLimits.MaxDiffBytes + 64 * 1024;
});
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<RoomRegistry>();
builder.Services.AddSingleton<RoomGuards>();
builder.Services.AddSingleton<ScenarioProjector>();
builder.Services.AddHostedService<RoomExpiryService>();

// Behind a reverse proxy the rate limits (§7) key on X-Forwarded-For, but
// only from proxies we name: KNOWN_PROXIES is a comma-separated list of IPs
// or CIDR ranges. Unset, every client appears as the proxy and shares one
// bucket, which is safe but blunt.
var knownProxies = Environment.GetEnvironmentVariable("KNOWN_PROXIES") ?? builder.Configuration["KNOWN_PROXIES"];
if (!string.IsNullOrWhiteSpace(knownProxies))
{
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.KnownNetworks.Clear();
        options.KnownProxies.Clear();
        foreach (var entry in knownProxies.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var slash = entry.IndexOf('/');
            if (slash > 0 && IPAddress.TryParse(entry[..slash], out var network) && int.TryParse(entry[(slash + 1)..], out var prefix))
            {
                options.KnownNetworks.Add(new Microsoft.AspNetCore.HttpOverrides.IPNetwork(network, prefix));
            }
            else if (IPAddress.TryParse(entry, out var proxy))
            {
                options.KnownProxies.Add(proxy);
            }
        }
    });
}

static string NormalizeOrigin(string origin) =>
    origin.Trim().Trim('"', '\'').TrimEnd('/');

// Configure CORS — explicit origins only (set CORS_ORIGINS in the host's variables)
var corsOrigins =
    Environment.GetEnvironmentVariable("CORS_ORIGINS") ??
    builder.Configuration["CORS_ORIGINS"];

var allowedOrigins = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
{
    "http://localhost:5173",
    "http://localhost:4173",
    "https://vladdubovyi.github.io",
};

if (!string.IsNullOrWhiteSpace(corsOrigins))
{
    foreach (var origin in corsOrigins.Split(',', StringSplitOptions.RemoveEmptyEntries))
    {
        allowedOrigins.Add(NormalizeOrigin(origin));
    }
}

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins(allowedOrigins.ToArray())
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

app.Logger.LogInformation(
    "CORS allowed origins: {Origins}",
    string.Join(", ", allowedOrigins));

if (builder.Environment.IsProduction() && string.IsNullOrWhiteSpace(corsOrigins))
{
    app.Logger.LogWarning(
        "CORS_ORIGINS is not set. Set it to your frontend URL, e.g. CORS_ORIGINS=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}");
}

var catalog = app.Services.GetRequiredService<IChallengeCatalog>();
app.Logger.LogInformation(
    "Challenge catalog loaded: {Challenges} challenges, {Components} component definitions",
    catalog.Challenges.Count,
    catalog.Components.Count);

if (!string.IsNullOrWhiteSpace(knownProxies))
{
    app.UseForwardedHeaders();
}

app.UseCors("AllowFrontend");

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.MapControllers().RequireCors("AllowFrontend");
app.MapHub<RoomHub>("/hubs/room").RequireCors("AllowFrontend");

app.Run();

/// <summary>
/// Exposed so the integration test project can host the real application
/// with WebApplicationFactory&lt;Program&gt;.
/// </summary>
public partial class Program { }
