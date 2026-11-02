using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SystemDesignSimulator.Api.Data;
using SystemDesignSimulator.Api.Models;

namespace SystemDesignSimulator.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ChallengesController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly ILogger<ChallengesController> _logger;
    private readonly IConfiguration _configuration;

    /// <summary>Keys of ScenarioConfig the authoring endpoint may replace, with the JSON kind each must have.</summary>
    private static readonly (string Key, JsonValueKind Kind)[] AuthorableKeys =
    {
        ("flows", JsonValueKind.Array),
        ("objectives", JsonValueKind.Object),
        ("tags", JsonValueKind.Array),
        ("requestTypes", JsonValueKind.Object),
    };

    public ChallengesController(
        ApplicationDbContext context,
        ILogger<ChallengesController> logger,
        IConfiguration configuration)
    {
        _context = context;
        _logger = logger;
        _configuration = configuration;
    }

    [HttpGet]
    public async Task<IActionResult> GetChallenges()
    {
        var challenges = await _context.Challenges
            .Include(c => c.Scenario)
            .Include(c => c.ChallengeComponents)
            .OrderBy(c => c.CreatedAt)
            .ToListAsync();

        var result = challenges.Select(c => new
        {
            c.Id,
            c.Name,
            c.Slug,
            c.Description,
            c.OverviewContent,
            c.VideoUrl,
            c.Difficulty,
            c.CreatedAt,
            Scenario = c.Scenario != null ? new
            {
                c.Scenario.Id,
                c.Scenario.DurationSeconds,
                c.Scenario.BaseRps,
                c.Scenario.SpikeMultiplier,
                c.Scenario.SpikeChance,
                c.Scenario.ReadRatio,
                ScenarioConfig = JsonSerializer.Deserialize<JsonElement>(c.Scenario.ScenarioConfig),
                ScoringWeights = JsonSerializer.Deserialize<JsonElement>(c.Scenario.ScoringWeights)
            } : null,
            AllowedComponents = c.ChallengeComponents.Select(cc => cc.ComponentType).ToList()
        });

        return Ok(result);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetChallenge(Guid id)
    {
        var challenge = await _context.Challenges
            .Include(c => c.Scenario)
            .Include(c => c.ChallengeComponents)
            .FirstOrDefaultAsync(c => c.Id == id);

        if (challenge == null)
        {
            return NotFound(new { error = "Challenge not found" });
        }

        var result = new
        {
            challenge.Id,
            challenge.Name,
            challenge.Slug,
            challenge.Description,
            challenge.OverviewContent,
            challenge.VideoUrl,
            challenge.Difficulty,
            challenge.CreatedAt,
            Scenario = challenge.Scenario != null ? new
            {
                challenge.Scenario.Id,
                challenge.Scenario.DurationSeconds,
                challenge.Scenario.BaseRps,
                challenge.Scenario.SpikeMultiplier,
                challenge.Scenario.SpikeChance,
                challenge.Scenario.ReadRatio,
                ScenarioConfig = JsonSerializer.Deserialize<JsonElement>(challenge.Scenario.ScenarioConfig),
                ScoringWeights = JsonSerializer.Deserialize<JsonElement>(challenge.Scenario.ScoringWeights)
            } : null,
            AllowedComponents = challenge.ChallengeComponents.Select(cc => cc.ComponentType).ToList()
        };

        return Ok(result);
    }

    [HttpGet("slug/{slug}")]
    public async Task<IActionResult> GetChallengeBySlug(string slug)
    {
        var challenge = await _context.Challenges
            .Include(c => c.Scenario)
            .Include(c => c.ChallengeComponents)
            .FirstOrDefaultAsync(c => c.Slug == slug);

        if (challenge == null)
        {
            return NotFound(new { error = "Challenge not found" });
        }

        var result = new
        {
            challenge.Id,
            challenge.Name,
            challenge.Slug,
            challenge.Description,
            challenge.OverviewContent,
            challenge.VideoUrl,
            challenge.Difficulty,
            challenge.CreatedAt,
            Scenario = challenge.Scenario != null ? new
            {
                challenge.Scenario.Id,
                challenge.Scenario.DurationSeconds,
                challenge.Scenario.BaseRps,
                challenge.Scenario.SpikeMultiplier,
                challenge.Scenario.SpikeChance,
                challenge.Scenario.ReadRatio,
                ScenarioConfig = JsonSerializer.Deserialize<JsonElement>(challenge.Scenario.ScenarioConfig),
                ScoringWeights = JsonSerializer.Deserialize<JsonElement>(challenge.Scenario.ScoringWeights)
            } : null,
            AllowedComponents = challenge.ChallengeComponents.Select(cc => cc.ComponentType).ToList()
        };

        return Ok(result);
    }

    /// <summary>
    /// Authoring (docs/specs/flow-authoring.md §3.2): replace the given keys of
    /// the challenge's scenario config. Semantic validation of flows lives in
    /// the frontend editor; this endpoint checks shape and authorship only.
    /// </summary>
    [Authorize]
    [HttpPut("slug/{slug}/scenario-config")]
    public async Task<IActionResult> UpdateScenarioConfig(string slug, [FromBody] JsonElement body)
    {
        if (!IsAuthor())
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "You are not an author for this deployment" });
        }

        if (body.ValueKind != JsonValueKind.Object)
        {
            return BadRequest(new { error = "Expected a JSON object" });
        }

        var challenge = await _context.Challenges
            .Include(c => c.Scenario)
            .Include(c => c.ChallengeComponents)
            .FirstOrDefaultAsync(c => c.Slug == slug);

        if (challenge?.Scenario == null)
        {
            return NotFound(new { error = "Challenge not found" });
        }

        var config = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(challenge.Scenario.ScenarioConfig)
            ?? new Dictionary<string, JsonElement>();

        var touched = 0;
        foreach (var (key, expectedKind) in AuthorableKeys)
        {
            if (!body.TryGetProperty(key, out var value)) continue;
            if (value.ValueKind != expectedKind)
            {
                return BadRequest(new { error = $"\"{key}\" must be a JSON {expectedKind}" });
            }
            if (key == "flows" && !value.EnumerateArray().All(IsFlowShaped))
            {
                return BadRequest(new { error = "Every flow needs a string \"kind\" and a \"steps\" array" });
            }
            // Clone: the request body's JsonDocument does not outlive this call.
            config[key] = value.Clone();
            touched++;
        }

        if (touched == 0)
        {
            return BadRequest(new { error = "Nothing to update: send flows, objectives, tags and/or requestTypes" });
        }

        challenge.Scenario.ScenarioConfig = JsonSerializer.Serialize(config);
        await _context.SaveChangesAsync();
        _logger.LogInformation("Scenario config for {Slug} updated by {Email}", slug, CurrentEmail());

        return Ok(ToDto(challenge));
    }

    private static bool IsFlowShaped(JsonElement flow) =>
        flow.ValueKind == JsonValueKind.Object
        && flow.TryGetProperty("kind", out var kind) && kind.ValueKind == JsonValueKind.String
        && flow.TryGetProperty("steps", out var steps) && steps.ValueKind == JsonValueKind.Array;

    private string? CurrentEmail() =>
        User.FindFirstValue(ClaimTypes.Email) ?? User.FindFirstValue("email");

    /// <summary>
    /// Authors are an allowlist of emails in CHALLENGE_AUTHORS (env or
    /// appsettings). Unset means nobody — secure by default.
    /// </summary>
    private bool IsAuthor()
    {
        var raw = _configuration["CHALLENGE_AUTHORS"];
        if (string.IsNullOrWhiteSpace(raw)) return false;
        var email = CurrentEmail();
        if (string.IsNullOrWhiteSpace(email)) return false;
        return raw
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(author => string.Equals(author, email, StringComparison.OrdinalIgnoreCase));
    }

    private static object ToDto(Challenge challenge) => new
    {
        challenge.Id,
        challenge.Name,
        challenge.Slug,
        challenge.Description,
        challenge.OverviewContent,
        challenge.VideoUrl,
        challenge.Difficulty,
        challenge.CreatedAt,
        Scenario = challenge.Scenario != null ? new
        {
            challenge.Scenario.Id,
            challenge.Scenario.DurationSeconds,
            challenge.Scenario.BaseRps,
            challenge.Scenario.SpikeMultiplier,
            challenge.Scenario.SpikeChance,
            challenge.Scenario.ReadRatio,
            ScenarioConfig = JsonSerializer.Deserialize<JsonElement>(challenge.Scenario.ScenarioConfig),
            ScoringWeights = JsonSerializer.Deserialize<JsonElement>(challenge.Scenario.ScoringWeights)
        } : null,
        AllowedComponents = challenge.ChallengeComponents.Select(cc => cc.ComponentType).ToList()
    };
}
