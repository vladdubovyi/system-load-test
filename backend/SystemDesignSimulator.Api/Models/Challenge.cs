using System.ComponentModel.DataAnnotations;

namespace SystemDesignSimulator.Api.Models;

public class Challenge
{
    public Guid Id { get; set; }
    
    [Required]
    [MaxLength(255)]
    public string Name { get; set; } = string.Empty;
    
    [Required]
    [MaxLength(100)]
    public string Slug { get; set; } = string.Empty;
    
    public string? Description { get; set; }
    
    [MaxLength(20)]
    public string Difficulty { get; set; } = "medium";
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    public Scenario? Scenario { get; set; }
    
    public ICollection<ChallengeComponent> ChallengeComponents { get; set; } = new List<ChallengeComponent>();
}
