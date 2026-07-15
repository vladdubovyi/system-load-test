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

// Configure CORS — explicit origins only (set CORS_ORIGINS in Railway Variables)
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
