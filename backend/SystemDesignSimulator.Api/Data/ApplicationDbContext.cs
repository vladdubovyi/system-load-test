using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using SystemDesignSimulator.Api.Models;

namespace SystemDesignSimulator.Api.Data;

public class ApplicationDbContext : IdentityDbContext<ApplicationUser>
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) 
        : base(options)
    {
    }
    
    public DbSet<Challenge> Challenges { get; set; }
    public DbSet<Scenario> Scenarios { get; set; }
    public DbSet<ComponentDefinition> ComponentDefinitions { get; set; }
    public DbSet<ChallengeComponent> ChallengeComponents { get; set; }
    
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        
        modelBuilder.Entity<Challenge>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Slug).IsUnique();
            entity.Property(e => e.Name).IsRequired().HasMaxLength(255);
            entity.Property(e => e.Slug).IsRequired().HasMaxLength(100);
            entity.Property(e => e.Difficulty).HasMaxLength(20);
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("NOW()");
        });
        
        modelBuilder.Entity<Scenario>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasOne(e => e.Challenge)
                .WithOne(c => c.Scenario)
                .HasForeignKey<Scenario>(e => e.ChallengeId)
                .OnDelete(DeleteBehavior.Cascade);
            
            entity.Property(e => e.BaseRps).HasColumnType("decimal(10,2)");
            entity.Property(e => e.SpikeMultiplier).HasColumnType("decimal(5,2)");
            entity.Property(e => e.SpikeChance).HasColumnType("decimal(5,4)");
            entity.Property(e => e.ReadRatio).HasColumnType("decimal(5,4)");
            entity.Property(e => e.ScenarioConfig).HasColumnType("jsonb");
            entity.Property(e => e.ScoringWeights).HasColumnType("jsonb");
        });
        
        modelBuilder.Entity<ComponentDefinition>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.ComponentType);
            entity.Property(e => e.ComponentType).IsRequired().HasMaxLength(100);
            entity.Property(e => e.Label).HasMaxLength(255);
            entity.Property(e => e.Category).HasMaxLength(50);
            entity.Property(e => e.MonthlyCost).HasColumnType("decimal(10,2)");
            entity.Property(e => e.ConfigSchema).HasColumnType("jsonb");
        });
        
        modelBuilder.Entity<ChallengeComponent>(entity =>
        {
            entity.HasKey(e => new { e.ChallengeId, e.ComponentType });
            entity.HasOne(e => e.Challenge)
                .WithMany(c => c.ChallengeComponents)
                .HasForeignKey(e => e.ChallengeId)
                .OnDelete(DeleteBehavior.Cascade);
            
            entity.Property(e => e.ComponentType).IsRequired().HasMaxLength(100);
        });
    }
}
