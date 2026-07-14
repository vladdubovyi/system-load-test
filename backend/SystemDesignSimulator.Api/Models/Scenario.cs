using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace SystemDesignSimulator.Api.Models;

public class Scenario
{
    public Guid Id { get; set; }
    
    public Guid ChallengeId { get; set; }
    public Challenge? Challenge { get; set; }
    
    public int DurationSeconds { get; set; }
    
    public decimal BaseRps { get; set; }
    
    public decimal? SpikeMultiplier { get; set; }
    
    public decimal? SpikeChance { get; set; }
    
    public decimal? ReadRatio { get; set; }
    
    [Required]
    public string ScenarioConfig { get; set; } = "{}";
    
    [Required]
    public string ScoringWeights { get; set; } = "{}";
    
    public JsonDocument GetScenarioConfig() => JsonDocument.Parse(ScenarioConfig);
    
    public JsonDocument GetScoringWeights() => JsonDocument.Parse(ScoringWeights);
}
