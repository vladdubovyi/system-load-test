using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using SystemDesignSimulator.Api.Data;
using SystemDesignSimulator.Api.Models;

namespace SystemDesignSimulator.Api.Controllers;

/// <summary>
/// Read-only view of the challenge library. There is deliberately no write
/// endpoint (docs/specs/interview-platform.md §2.3): the MVP is anonymous
/// and database-free, so scenarios are authored in the seed source and
/// edited on the spot inside rooms.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class ChallengesController : ControllerBase
{
    private readonly IChallengeCatalog _catalog;

    public ChallengesController(IChallengeCatalog catalog)
    {
        _catalog = catalog;
    }

    [HttpGet]
    public IActionResult GetChallenges() =>
        Ok(_catalog.Challenges.Select(ToDto));

    [HttpGet("{id:guid}")]
    public IActionResult GetChallenge(Guid id)
    {
        var challenge = _catalog.FindChallenge(id);
        return challenge == null
            ? NotFound(new { error = "Challenge not found" })
            : Ok(ToDto(challenge));
    }

    [HttpGet("slug/{slug}")]
    public IActionResult GetChallengeBySlug(string slug)
    {
        var challenge = _catalog.FindChallenge(slug);
        return challenge == null
            ? NotFound(new { error = "Challenge not found" })
            : Ok(ToDto(challenge));
    }

    /// <summary>The wire shape the frontend's <c>mapChallengeFromApi</c> expects; unchanged from the database-backed API.</summary>
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
