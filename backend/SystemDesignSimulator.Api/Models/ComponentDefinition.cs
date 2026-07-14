using System.ComponentModel.DataAnnotations;

namespace SystemDesignSimulator.Api.Models;

public class ComponentDefinition
{
    public Guid Id { get; set; }
    
    [Required]
    [MaxLength(100)]
    public string ComponentType { get; set; } = string.Empty;
    
    [MaxLength(255)]
    public string? Label { get; set; }
    
    [MaxLength(50)]
    public string Category { get; set; } = "compute";
    
    public int DefaultCapacity { get; set; }
    
    public int DefaultQueueLimit { get; set; }
    
    public decimal MonthlyCost { get; set; }
    
    public string? ConfigSchema { get; set; }
    
    [MaxLength(10)]
    public string? Emoji { get; set; }
    
    public int Width { get; set; } = 140;
    
    public int Height { get; set; } = 72;
    
    public string? Description { get; set; }
    
    public bool Enabled { get; set; } = true;
}
