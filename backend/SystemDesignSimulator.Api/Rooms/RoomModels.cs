using System.Text.Json;
using System.Text.Json.Serialization;

namespace SystemDesignSimulator.Api.Rooms;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum RoomRole
{
    Host,
    Participant,
}

/// <summary>
/// One board entity as the server sees it: opaque JSON under a kind and an ID
/// (docs/specs/interview-platform.md §5.2). The server never interprets
/// <see cref="Value"/> beyond the belt endpoint check in
/// <see cref="RoomBoard"/>.
/// </summary>
public sealed record BoardEntity(string Kind, string Id, JsonElement Value);

/// <summary>A client's change to one entity. <c>After</c> null means removed.</summary>
public sealed record EntityChange(string Kind, string Id, JsonElement? After);

public sealed record BoardDiffMessage(int BaseVersion, IReadOnlyList<EntityChange> Changes);

/// <summary>Broadcast after a merge. <c>Origin</c> lets the author skip its own change.</summary>
public sealed record BoardChangedMessage(int Version, string Origin, IReadOnlyList<EntityChange> Changes);

public sealed record BoardSnapshotMessage(int Version, IReadOnlyList<BoardEntity> Board);

public sealed record ParticipantInfo(string ConnectionId, string Name, RoomRole Role);

public sealed record PresenceMessage(IReadOnlyList<ParticipantInfo> Participants);

public sealed record CursorMessage(string ConnectionId, double X, double Y);

public sealed record RoomEndedMessage(string Reason);

public sealed record CreateRoomRequest(
    string ScenarioSlug,
    JsonElement? ScenarioOverride,
    IReadOnlyList<BoardEntity> Board,
    JsonElement? TrafficOverride = null);

public sealed record RoomCreatedMessage(
    string JoinCode,
    string HostSecret,
    string ConnectionId,
    string Name,
    int Version,
    IReadOnlyList<ParticipantInfo> Participants);

public sealed record RoomJoinedMessage(
    RoomRole Role,
    string ConnectionId,
    string Name,
    /// <summary>Shown to the host only; participants already hold it.</summary>
    string? JoinCode,
    /// <summary>Null for interview-mode participants (§6.1): the slug identifies the scenario.</summary>
    string? ScenarioSlug,
    /// <summary>Interview-mode participants only: the stripped catalog entry (§6.1).</summary>
    JsonElement? Challenge,
    JsonElement? ScenarioOverride,
    JsonElement? TrafficOverride,
    int Version,
    IReadOnlyList<BoardEntity> Board,
    IReadOnlyList<ParticipantInfo> Participants,
    RunStateMessage? Run,
    RoomSettings Settings,
    string? PenHolder,
    bool ReportReleased);

/// <summary>
/// Room settings (docs/specs/interview-platform.md §4). All host-controlled,
/// all live, none persisted. Null <c>LintVisible</c> / <c>ReportVisibility</c>
/// mean "the default for the mode".
/// </summary>
public sealed record RoomSettings(
    string Mode = "open",
    string Pen = "shared",
    bool? LintVisible = null,
    int? Seed = null,
    string? ReportVisibility = null,
    string WhoCanRun = "anyone")
{
    public static readonly IReadOnlySet<string> Modes = new HashSet<string> { "open", "interview" };
    public static readonly IReadOnlySet<string> Pens = new HashSet<string> { "shared", "single" };
    public static readonly IReadOnlySet<string> Visibilities = new HashSet<string> { "everyone", "hostOnly" };
    public static readonly IReadOnlySet<string> Runners = new HashSet<string> { "anyone", "hostOnly" };

    public bool IsInterview => Mode == "interview";
    public bool EffectiveLintVisible => LintVisible ?? !IsInterview;
    public string EffectiveReportVisibility => ReportVisibility ?? (IsInterview ? "hostOnly" : "everyone");

    public bool IsValid() =>
        Modes.Contains(Mode) && Pens.Contains(Pen) && Runners.Contains(WhoCanRun)
        && (ReportVisibility is null || Visibilities.Contains(ReportVisibility))
        && (Seed is null || Seed > 0);
}

public sealed record SettingsChangedMessage(RoomSettings Settings, string? PenHolder);

/// <summary>
/// One connection's current view of the room's scenario (§6.1). Sent when the
/// host applies an edit, and re-sent to participants when a settings change
/// alters what they may see (a mode switch, the lint toggle).
/// </summary>
public sealed record ScenarioChangedMessage(
    string? ScenarioSlug,
    JsonElement? Challenge,
    JsonElement? ScenarioOverride);

public sealed record PenChangedMessage(string? PenHolder);

public sealed record PenRequestedMessage(string ConnectionId, string Name);

public sealed class Participant
{
    public required string ConnectionId { get; init; }
    public required string Name { get; init; }
    public required RoomRole Role { get; init; }
    public required DateTimeOffset ConnectedAt { get; init; }

    public ParticipantInfo ToInfo() => new(ConnectionId, Name, Role);
}

/// <summary>
/// Room state (docs/specs/interview-platform.md §3.3). Lives in process
/// memory only; no field identifies a person. Mutated only under the
/// registry's lock.
/// </summary>
public sealed class Room
{
    public required string Id { get; init; }
    public required string JoinCode { get; set; }
    public required string HostSecretHash { get; set; }
    public required DateTimeOffset CreatedAt { get; init; }
    public required DateTimeOffset LastActivityAt { get; set; }
    /// <summary>Set while no connection is in the room; drives the 30-minute grace.</summary>
    public DateTimeOffset? EmptySince { get; set; }
    public required string ScenarioSlug { get; init; }
    public JsonElement? ScenarioOverride { get; set; }
    /// <summary>The Traffic-panel profile everyone runs with, if one was applied.</summary>
    public JsonElement? TrafficOverride { get; set; }
    /// <summary>The run in progress (§4.4); null between runs.</summary>
    public RoomRun? Run { get; set; }
    public RoomSettings Settings { get; set; } = new();
    /// <summary>Host released the last run's report to participants (§4).</summary>
    public bool ReportReleased { get; set; }
    public RoomBoard Board { get; } = new();
    public int BoardVersion { get; set; }
    public string? PenHolder { get; set; }
    public List<Participant> Participants { get; } = new();

    public IReadOnlyList<ParticipantInfo> ParticipantInfos() =>
        Participants.Select(p => p.ToInfo()).ToList();
}

/// <summary>
/// Entities keyed by kind and ID, kept in insertion order so every client
/// that applies the same sequence of changes ends up with the same board
/// order (which the engine depends on, §8).
/// </summary>
public sealed class RoomBoard
{
    public static readonly IReadOnlySet<string> Kinds =
        new HashSet<string> { "component", "belt", "config", "text", "stroke" };

    private const string SourceId = "__source__";

    private readonly Dictionary<string, Dictionary<string, JsonElement>> _byKind =
        Kinds.ToDictionary(k => k, _ => new Dictionary<string, JsonElement>());

    private readonly List<(string Kind, string Id)> _order = new();

    public int Count => _order.Count;

    /// <summary>Approximate size in bytes of the JSON the board would serialise to.</summary>
    public long ApproximateBytes { get; private set; }

    public IReadOnlyList<BoardEntity> Snapshot() =>
        _order.Select(k => new BoardEntity(k.Kind, k.Id, _byKind[k.Kind][k.Id])).ToList();

    public bool Contains(string kind, string id) =>
        _byKind.TryGetValue(kind, out var bucket) && bucket.ContainsKey(id);

    public void Load(IEnumerable<BoardEntity> entities)
    {
        foreach (var e in entities)
        {
            if (!Kinds.Contains(e.Kind)) continue;
            Set(e.Kind, e.Id, e.Value);
        }
        DropOrphanBelts(new List<EntityChange>());
    }

    /// <summary>
    /// Last-writer-wins per entity: adds and changes write the new value, a
    /// removal deletes. Returns the changes actually applied, plus any belt
    /// dropped because an endpoint component is gone.
    /// </summary>
    public IReadOnlyList<EntityChange> Apply(IReadOnlyList<EntityChange> changes)
    {
        var applied = new List<EntityChange>(changes.Count);
        foreach (var change in changes)
        {
            if (!Kinds.Contains(change.Kind)) continue;
            if (change.After is null || change.After.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            {
                if (Remove(change.Kind, change.Id))
                {
                    applied.Add(new EntityChange(change.Kind, change.Id, null));
                }
                continue;
            }
            Set(change.Kind, change.Id, change.After.Value);
            applied.Add(new EntityChange(change.Kind, change.Id, change.After));
        }
        DropOrphanBelts(applied);
        return applied;
    }

    private void Set(string kind, string id, JsonElement value)
    {
        var bucket = _byKind[kind];
        if (bucket.TryGetValue(id, out var old))
        {
            ApproximateBytes -= old.GetRawText().Length;
        }
        else
        {
            _order.Add((kind, id));
        }
        bucket[id] = value.Clone();
        ApproximateBytes += value.GetRawText().Length;
    }

    private bool Remove(string kind, string id)
    {
        var bucket = _byKind[kind];
        if (!bucket.Remove(id, out var old)) return false;
        ApproximateBytes -= old.GetRawText().Length;
        _order.Remove((kind, id));
        return true;
    }

    private void DropOrphanBelts(List<EntityChange> applied)
    {
        var components = _byKind["component"];
        var orphans = new List<string>();
        foreach (var (id, belt) in _byKind["belt"])
        {
            if (!EndpointExists(belt, "fromPortId", components) || !EndpointExists(belt, "toPortId", components))
            {
                orphans.Add(id);
            }
        }
        foreach (var id in orphans)
        {
            Remove("belt", id);
            applied.Add(new EntityChange("belt", id, null));
        }
    }

    private static bool EndpointExists(JsonElement belt, string property, Dictionary<string, JsonElement> components)
    {
        if (belt.ValueKind != JsonValueKind.Object) return false;
        if (!belt.TryGetProperty(property, out var port) || port.ValueKind != JsonValueKind.String) return false;
        var portId = port.GetString() ?? "";
        var sep = portId.LastIndexOf(':');
        var owner = sep == -1 ? portId : portId[..sep];
        return owner == SourceId || components.ContainsKey(owner);
    }
}

// ── Runs in rooms (docs/specs/interview-platform.md §4.4) ──────────────────

/// <summary>
/// A control event during a run. The controller stamps <c>ApplyAtTick</c>;
/// until then it is null and clients hold the event.
/// </summary>
public sealed record RunEventMessage(int Seq, string Kind, JsonElement? Payload, string From, int? ApplyAtTick);

public sealed record TickStamp(int Seq, int ApplyAtTick);

/// <summary>The controller's clock: its current tick and any newly stamped events.</summary>
public sealed record RunTickMessage(int Tick, IReadOnlyList<TickStamp> Stamps);

/// <summary>
/// <c>Flows</c> is the opaque flow bundle (§6.2): set only for interview-mode
/// participants, whose projection withholds the flows their engine needs.
/// </summary>
public sealed record RunStartedMessage(int Seed, int BoardVersion, string ControllerConnectionId, JsonElement? Flows = null);

public sealed record RunControllerChangedMessage(string ControllerConnectionId, int LastTick);

public sealed record RunEndedMessage(string Reason);

/// <summary>What a mid-run joiner needs to fast-forward from tick 0.</summary>
public sealed record RunStateMessage(
    int Seed,
    int BoardVersion,
    string ControllerConnectionId,
    int LastTick,
    IReadOnlyList<RunEventMessage> Events,
    /// <summary>The opaque flow bundle (§6.2) for an interview-mode participant joining mid-run.</summary>
    JsonElement? Flows = null);

public sealed class RoomRun
{
    public static readonly IReadOnlySet<string> EventKinds =
        new HashSet<string> { "pause", "resume", "speed", "failure", "stop" };

    public required int Seed { get; init; }
    public required int BoardVersion { get; init; }
    public required string ControllerConnectionId { get; set; }
    public int LastTick { get; set; }
    public List<RunEventMessage> Events { get; } = new();
    public int NextSeq { get; set; } = 1;

    public RunStateMessage ToState() =>
        new(Seed, BoardVersion, ControllerConnectionId, LastTick, Events.ToList());
}
