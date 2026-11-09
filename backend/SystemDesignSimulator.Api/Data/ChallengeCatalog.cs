using SystemDesignSimulator.Api.Data.Seed;
using SystemDesignSimulator.Api.Models;

namespace SystemDesignSimulator.Api.Data;

/// <summary>
/// The challenge library the API serves (docs/specs/interview-platform.md
/// §2.3). Built once at startup from the seed source and held in memory:
/// the MVP has no database, so this is the only place challenge data lives
/// while the process runs. Editing a challenge means editing the seed and
/// redeploying; hosts edit scenarios on the spot inside rooms instead.
///
/// This interface is also the seam where a database-backed catalog would
/// plug back in if the parked platform (§10) is ever un-parked.
/// </summary>
public interface IChallengeCatalog
{
    /// <summary>Every challenge, in library order, with its scenario and allowed components attached.</summary>
    IReadOnlyList<Challenge> Challenges { get; }

    /// <summary>Every component definition, including disabled ones.</summary>
    IReadOnlyList<ComponentDefinition> Components { get; }

    Challenge? FindChallenge(Guid id);

    Challenge? FindChallenge(string slug);

    ComponentDefinition? FindComponent(string componentType);
}

public sealed class ChallengeCatalog : IChallengeCatalog
{
    private readonly Dictionary<Guid, Challenge> _byId;
    private readonly Dictionary<string, Challenge> _bySlug;
    private readonly Dictionary<string, ComponentDefinition> _componentsByType;

    public ChallengeCatalog()
        : this(ChallengeSeeder.Challenges(), ChallengeSeeder.ComponentDefinitions())
    {
    }

    public ChallengeCatalog(IReadOnlyList<Challenge> challenges, IReadOnlyList<ComponentDefinition> components)
    {
        Challenges = challenges;
        Components = components;
        _byId = challenges.ToDictionary(c => c.Id);
        _bySlug = challenges.ToDictionary(c => c.Slug, StringComparer.Ordinal);
        _componentsByType = components.ToDictionary(c => c.ComponentType, StringComparer.Ordinal);
    }

    public IReadOnlyList<Challenge> Challenges { get; }

    public IReadOnlyList<ComponentDefinition> Components { get; }

    public Challenge? FindChallenge(Guid id) => _byId.GetValueOrDefault(id);

    public Challenge? FindChallenge(string slug) => _bySlug.GetValueOrDefault(slug);

    public ComponentDefinition? FindComponent(string componentType) =>
        _componentsByType.GetValueOrDefault(componentType);
}
