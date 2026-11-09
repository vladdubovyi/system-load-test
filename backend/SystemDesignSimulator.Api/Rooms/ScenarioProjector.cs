using System.Text.Json;
using SystemDesignSimulator.Api.Data;

namespace SystemDesignSimulator.Api.Rooms;

/// <summary>
/// Server-side scenario projection (docs/specs/interview-platform.md §6.1).
/// The server holds the full scenario — the catalog entry for the room's slug
/// plus any applied override — and each connection receives only what its
/// role may see. Hosts and open-mode rooms get everything. Interview-mode
/// participants get a whitelisted document: title, description, requirements,
/// duration, traffic, allowed components and tags. Flows, objectives, scoring
/// weights and the scenario slug are withheld by construction (the stripped
/// payloads are built from a whitelist, never by deleting fields).
///
/// Flows are still needed to simulate, so <see cref="FlowBundle"/> produces
/// the opaque bundle a participant's engine receives with a run (§6.2), and
/// the projection includes flows only while the host has made the lint
/// visible (§6.3).
/// </summary>
public sealed class ScenarioProjector
{
    /// <summary>Override fields a participant may keep in interview mode.</summary>
    private static readonly string[] KeptOverrideFields = { "requestTypes", "tags" };

    /// <summary>Scenario-config fields a participant may keep in interview mode.</summary>
    private static readonly string[] KeptConfigFields =
        { "requirements", "drainDuration", "pattern", "requestTypes", "characteristics", "tags" };

    private readonly IChallengeCatalog _catalog;

    public ScenarioProjector(IChallengeCatalog catalog) => _catalog = catalog;

    /// <summary>One role's view of the room's scenario.</summary>
    public ScenarioChangedMessage Project(Room room, RoomRole role)
    {
        if (role == RoomRole.Host || !room.Settings.IsInterview)
        {
            return new ScenarioChangedMessage(room.ScenarioSlug, null, room.ScenarioOverride);
        }
        var includeFlows = room.Settings.EffectiveLintVisible;
        return new ScenarioChangedMessage(
            null,
            StripChallenge(room.ScenarioSlug, includeFlows),
            StripOverride(room.ScenarioOverride, includeFlows));
    }

    /// <summary>
    /// The flows a participant's engine needs for one run (§6.2): the
    /// override's, or the catalog's for the room's scenario. Null when
    /// neither defines any.
    /// </summary>
    public JsonElement? FlowBundle(Room room)
    {
        if (room.ScenarioOverride is { ValueKind: JsonValueKind.Object } over
            && over.TryGetProperty("flows", out var overrideFlows)
            && overrideFlows.ValueKind == JsonValueKind.Array)
        {
            return overrideFlows.Clone();
        }
        if (CatalogConfig(room.ScenarioSlug) is { } config
            && config.TryGetProperty("flows", out var catalogFlows)
            && catalogFlows.ValueKind == JsonValueKind.Array)
        {
            return catalogFlows.Clone();
        }
        return null;
    }

    private JsonElement? CatalogConfig(string slug)
    {
        var scenario = _catalog.FindChallenge(slug)?.Scenario;
        if (scenario is null) return null;
        try
        {
            return JsonSerializer.Deserialize<JsonElement>(scenario.ScenarioConfig);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// The catalog entry as an interview participant may see it, in the same
    /// wire shape as <c>GET /api/challenges</c> so the frontend reuses its
    /// mapper. Identity (id, slug, overview, video) never enters the payload.
    /// </summary>
    private JsonElement? StripChallenge(string slug, bool includeFlows)
    {
        var challenge = _catalog.FindChallenge(slug);
        if (challenge?.Scenario is null) return null;
        var config = CatalogConfig(slug);

        var keptConfig = new Dictionary<string, JsonElement>();
        if (config is { ValueKind: JsonValueKind.Object } c)
        {
            foreach (var field in KeptConfigFields)
            {
                if (c.TryGetProperty(field, out var value) && value.ValueKind is not JsonValueKind.Null)
                {
                    keptConfig[field] = value.Clone();
                }
            }
            if (includeFlows && c.TryGetProperty("flows", out var flows) && flows.ValueKind == JsonValueKind.Array)
            {
                keptConfig["flows"] = flows.Clone();
            }
        }

        return JsonSerializer.SerializeToElement(new
        {
            id = "",
            name = challenge.Name,
            slug = "",
            description = challenge.Description,
            createdAt = challenge.CreatedAt,
            scenario = new
            {
                id = "",
                durationSeconds = challenge.Scenario.DurationSeconds,
                baseRps = challenge.Scenario.BaseRps,
                spikeMultiplier = challenge.Scenario.SpikeMultiplier,
                spikeChance = challenge.Scenario.SpikeChance,
                readRatio = challenge.Scenario.ReadRatio,
                scenarioConfig = keptConfig,
            },
            allowedComponents = challenge.ChallengeComponents.Select(cc => cc.ComponentType).ToList(),
        });
    }

    /// <summary>The applied override, reduced to what a participant may keep.</summary>
    private static JsonElement? StripOverride(JsonElement? scenarioOverride, bool includeFlows)
    {
        if (scenarioOverride is not { ValueKind: JsonValueKind.Object } doc) return null;
        var kept = new Dictionary<string, JsonElement>();
        foreach (var field in KeptOverrideFields)
        {
            if (doc.TryGetProperty(field, out var value) && value.ValueKind is not JsonValueKind.Null)
            {
                kept[field] = value.Clone();
            }
        }
        if (includeFlows && doc.TryGetProperty("flows", out var flows) && flows.ValueKind == JsonValueKind.Array)
        {
            kept["flows"] = flows.Clone();
        }
        return kept.Count == 0 ? null : JsonSerializer.SerializeToElement(kept);
    }
}
