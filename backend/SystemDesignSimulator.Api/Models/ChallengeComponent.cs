using System.ComponentModel.DataAnnotations;

namespace SystemDesignSimulator.Api.Models;

public class ChallengeComponent
{
    public Guid ChallengeId { get; set; }
    public Challenge? Challenge { get; set; }
    
    [Required]
    [MaxLength(100)]
    public string ComponentType { get; set; } = string.Empty;
}
