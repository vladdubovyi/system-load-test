using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SystemDesignSimulator.Api.Data;
using System.Text.Json;

namespace SystemDesignSimulator.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ChallengesController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly ILogger<ChallengesController> _logger;

    public ChallengesController(ApplicationDbContext context, ILogger<ChallengesController> logger)
    {
        _context = context;
        _logger = logger;
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
}
