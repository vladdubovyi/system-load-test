using Microsoft.EntityFrameworkCore;
using SystemDesignSimulator.Api.Data;
using SystemDesignSimulator.Api.Data.Seed;

var builder = WebApplication.CreateBuilder(args);

// Railway injects PORT; bind Kestrel explicitly (exec-form ENTRYPOINT won't expand $PORT)
var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrEmpty(port))
{
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
}

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Configure database
// Support both appsettings.json and DATABASE_URL environment variable (Railway/Render)
var connectionString = Environment.GetEnvironmentVariable("DATABASE_URL");

if (!string.IsNullOrEmpty(connectionString))
{
    // Railway/Render format: postgresql://user:password@host:port/database
    // Convert to Npgsql format
    try
    {
        var databaseUri = new Uri(connectionString);
        var userInfo = databaseUri.UserInfo.Split(':');
        
        connectionString = $"Host={databaseUri.Host};" +
                          $"Port={databaseUri.Port};" +
                          $"Database={databaseUri.LocalPath.TrimStart('/')};" +
                          $"Username={userInfo[0]};" +
                          $"Password={userInfo[1]};" +
                          $"SSL Mode=Require;" +
                          $"Trust Server Certificate=true";
    }
    catch (Exception ex)
    {
        builder.Logging.AddConsole().AddDebug();
        var logger = builder.Services.BuildServiceProvider().GetRequiredService<ILogger<Program>>();
        logger.LogWarning(ex, "Failed to parse DATABASE_URL, falling back to appsettings.json");
        connectionString = builder.Configuration.GetConnectionString("DefaultConnection") 
            ?? "Host=localhost;Port=5432;Database=systemdesignsim;Username=postgres;Password=postgres";
    }
}
else
{
    // Fallback to appsettings.json
    connectionString = builder.Configuration.GetConnectionString("DefaultConnection") 
        ?? "Host=localhost;Port=5432;Database=systemdesignsim;Username=postgres;Password=postgres";
}

builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseNpgsql(connectionString));

static string NormalizeOrigin(string origin) =>
    origin.Trim().Trim('"', '\'').TrimEnd('/');

static bool IsRailwayAppOrigin(string origin) =>
    Uri.TryCreate(origin, UriKind.Absolute, out var uri) &&
    uri.Host.EndsWith(".up.railway.app", StringComparison.OrdinalIgnoreCase);

// Configure CORS — read from env or config (Railway Variables tab)
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

var allowRailwayOrigins = builder.Environment.IsProduction();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.SetIsOriginAllowed(origin =>
        {
            if (string.IsNullOrWhiteSpace(origin)) return false;
            var normalized = NormalizeOrigin(origin);
            if (allowedOrigins.Contains(normalized)) return true;
            return allowRailwayOrigins && IsRailwayAppOrigin(normalized);
        })
        .AllowAnyHeader()
        .AllowAnyMethod();
    });
});

var app = builder.Build();

app.Logger.LogInformation(
    "CORS configured with {Count} explicit origin(s){RailwaySuffix}",
    allowedOrigins.Count,
    allowRailwayOrigins ? " plus *.up.railway.app" : string.Empty);

if (string.IsNullOrWhiteSpace(corsOrigins))
{
    app.Logger.LogWarning(
        "CORS_ORIGINS is not set. In production, *.up.railway.app origins are allowed automatically.");
}

// Apply migrations and seed data
using (var scope = app.Services.CreateScope())
{
    var services = scope.ServiceProvider;
    try
    {
        var context = services.GetRequiredService<ApplicationDbContext>();
        
        // Apply pending migrations
        context.Database.Migrate();
        
        // Seed data
        ChallengeSeeder.SeedData(context);
        
        app.Logger.LogInformation("Database initialized successfully");
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "An error occurred while initializing the database");
    }
}

// Configure the HTTP request pipeline
app.UseCors("AllowFrontend");

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseAuthorization();

app.MapControllers().RequireCors("AllowFrontend");

app.Run();
