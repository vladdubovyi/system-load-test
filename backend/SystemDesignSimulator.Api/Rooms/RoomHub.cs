using System.Text.Json;
using Microsoft.AspNetCore.SignalR;

namespace SystemDesignSimulator.Api.Rooms;

/// <summary>
/// The one hub (docs/specs/interview-platform.md §3, §5). One SignalR group
/// per room, keyed by the internal room ID, which clients never see.
///
/// Credentials arrive in invocations (<see cref="JoinByCode"/>,
/// <see cref="JoinAsHost"/>), never in the query string. Nothing here logs a
/// payload, a join code or a host secret (§7); the log-redaction test holds
/// that line.
/// </summary>
public sealed class RoomHub : Hub
{
    public const string NotInRoomMessage = "You are not in a room.";
    public const string HostOnlyMessage = "Only the host can do that.";

    private readonly RoomRegistry _rooms;
    private readonly RoomGuards _guards;
    private readonly ScenarioProjector _projector;

    public RoomHub(RoomRegistry rooms, RoomGuards guards, ScenarioProjector projector)
    {
        _rooms = rooms;
        _guards = guards;
        _projector = projector;
    }

    public override Task OnConnectedAsync()
    {
        _guards.Track(Context);
        return base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _guards.Forget(Context.ConnectionId);
        var room = _rooms.Leave(Context.ConnectionId);
        if (room is not null)
        {
            await Clients.Group(room.Id).SendAsync("PresenceChanged", new PresenceMessage(room.ParticipantInfos()));
            await Clients.Group(room.Id).SendAsync("PenChanged", new PenChangedMessage(room.PenHolder));
            await HandleControllerLoss(room, Context.ConnectionId);
        }
        await base.OnDisconnectedAsync(exception);
    }

    public async Task<RoomCreatedMessage> CreateRoom(CreateRoomRequest request)
    {
        if (!_guards.AllowRoomCreation(ClientIp()))
        {
            throw new HubException(RoomGuards.TooManyAttemptsMessage);
        }
        if (string.IsNullOrWhiteSpace(request.ScenarioSlug) || request.ScenarioSlug.Length > 100)
        {
            throw new HubException("A room needs a scenario.");
        }

        await LeaveCurrentGroup();
        Room room;
        string hostSecret;
        try
        {
            room = _rooms.Create(request, Context.ConnectionId, out hostSecret);
        }
        catch (RoomException e)
        {
            throw new HubException(e.Message);
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, room.Id);
        var me = _rooms.ParticipantOf(Context.ConnectionId)!;
        return new RoomCreatedMessage(
            JoinCodes.Format(room.JoinCode),
            hostSecret,
            Context.ConnectionId,
            me.Name,
            room.BoardVersion,
            room.ParticipantInfos());
    }

    public Task<RoomJoinedMessage> JoinByCode(string code)
    {
        var canonical = JoinCodes.Normalize(code);
        return JoinWith(
            canonical is null ? null : _rooms.FindByCode(canonical),
            RoomRole.Participant,
            RoomRegistry.NoRoomMessage);
    }

    public Task<RoomJoinedMessage> JoinAsHost(string hostSecret)
    {
        var room = string.IsNullOrEmpty(hostSecret) || hostSecret.Length > 64
            ? null
            : _rooms.FindByHostSecret(hostSecret);
        return JoinWith(room, RoomRole.Host, RoomRegistry.NoHostRoomMessage);
    }

    private async Task<RoomJoinedMessage> JoinWith(Room? room, RoomRole role, string failureMessage)
    {
        var ip = ClientIp();
        if (!_guards.JoinAttemptsAllowed(ip))
        {
            throw new HubException(RoomGuards.TooManyAttemptsMessage);
        }
        if (room is null)
        {
            _guards.RecordFailedJoin(ip);
            throw new HubException(failureMessage);
        }

        await LeaveCurrentGroup();
        Participant me;
        try
        {
            me = _rooms.Join(room, Context.ConnectionId, role);
        }
        catch (RoomException)
        {
            _guards.RecordFailedJoin(ip);
            throw new HubException(failureMessage);
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, room.Id);
        var snapshot = _rooms.Snapshot(room);
        var participants = room.ParticipantInfos();
        await Clients.OthersInGroup(room.Id).SendAsync("PresenceChanged", new PresenceMessage(participants));
        // §6.1: the scenario leaves the server already projected for the role.
        var scenario = _projector.Project(room, role);
        var run = room.Run?.ToState();
        if (run is not null && role == RoomRole.Participant && room.Settings.IsInterview)
        {
            // Joining mid-run: the engine needs the flows now (§6.2).
            run = run with { Flows = _projector.FlowBundle(room) };
        }
        return new RoomJoinedMessage(
            role,
            Context.ConnectionId,
            me.Name,
            role == RoomRole.Host ? JoinCodes.Format(room.JoinCode) : null,
            scenario.ScenarioSlug,
            scenario.Challenge,
            scenario.ScenarioOverride,
            room.TrafficOverride,
            snapshot.Version,
            snapshot.Board,
            participants,
            run,
            room.Settings,
            room.PenHolder,
            room.ReportReleased);
    }

    public async Task LeaveRoom()
    {
        var room = _rooms.Leave(Context.ConnectionId);
        if (room is null) return;
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, room.Id);
        await Clients.Group(room.Id).SendAsync("PresenceChanged", new PresenceMessage(room.ParticipantInfos()));
        await Clients.Group(room.Id).SendAsync("PenChanged", new PenChangedMessage(room.PenHolder));
        await HandleControllerLoss(room, Context.ConnectionId);
    }

    // ── Settings (§4) ──────────────────────────────────────────────────────

    /// <summary>Host: replace the room settings; everyone hears the result.</summary>
    public async Task UpdateSettings(RoomSettings settings)
    {
        var room = RequireHost();
        var before = room.Settings;
        try
        {
            _rooms.UpdateSettings(room, Context.ConnectionId, settings);
        }
        catch (RoomException e)
        {
            throw new HubException(e.Message);
        }
        await Clients.Group(room.Id).SendAsync("SettingsChanged", new SettingsChangedMessage(room.Settings, room.PenHolder));
        // §4.2, §6.3: a mode switch or a lint toggle changes what participants
        // may see, so they are re-projected immediately.
        if (before.IsInterview != room.Settings.IsInterview
            || before.EffectiveLintVisible != room.Settings.EffectiveLintVisible)
        {
            await SendScenarioProjections(room, participantsOnly: true);
        }
    }

    /// <summary>Send each connection its own view of the scenario (§6.1).</summary>
    private async Task SendScenarioProjections(Room room, bool participantsOnly)
    {
        var host = _projector.Project(room, RoomRole.Host);
        var participant = _projector.Project(room, RoomRole.Participant);
        foreach (var p in room.Participants.ToList())
        {
            if (participantsOnly && p.Role == RoomRole.Host) continue;
            await Clients.Client(p.ConnectionId)
                .SendAsync("ScenarioChanged", p.Role == RoomRole.Host ? host : participant);
        }
    }

    /// <summary>Host: hand the pen to a connection (§4.3); null takes it back.</summary>
    public async Task AssignPen(string? connectionId)
    {
        var room = RequireHost();
        try
        {
            _rooms.AssignPen(room, connectionId);
        }
        catch (RoomException e)
        {
            throw new HubException(e.Message);
        }
        await Clients.Group(room.Id).SendAsync("PenChanged", new PenChangedMessage(room.PenHolder));
    }

    /// <summary>Participant: raise a hand for the pen; hosts see a badge.</summary>
    public async Task RequestPen()
    {
        var room = RequireRoom();
        var me = _rooms.ParticipantOf(Context.ConnectionId);
        if (me is null) throw new HubException(NotInRoomMessage);
        var hosts = room.Participants.Where(p => p.Role == RoomRole.Host).Select(p => p.ConnectionId).ToList();
        await Clients.Clients(hosts).SendAsync("PenRequested", new PenRequestedMessage(me.ConnectionId, me.Name));
    }

    /// <summary>Host: let participants see the last run's report (§4).</summary>
    public async Task ReleaseReport()
    {
        var room = RequireHost();
        _rooms.ReleaseReport(room);
        await Clients.Group(room.Id).SendAsync("ReportReleased", new { });
    }

    /// <summary>Anyone allowed to run may set the traffic profile between runs (§4).</summary>
    public async Task SetTrafficOverride(JsonElement? trafficOverride)
    {
        var room = RequireRoom();
        if (room.Run is not null) throw new HubException(RoomRegistry.BoardLockedMessage);
        if (trafficOverride is { } doc && doc.GetRawText().Length > RoomLimits.MaxDiffBytes)
        {
            throw new HubException(RoomRegistry.DiffTooLargeMessage);
        }
        try
        {
            _rooms.SetTrafficOverride(room, Context.ConnectionId, trafficOverride);
        }
        catch (RoomException e)
        {
            throw new HubException(e.Message);
        }
        await Clients.Group(room.Id).SendAsync("TrafficChanged", new { trafficOverride });
    }

    // ── Runs (§4.4) ────────────────────────────────────────────────────────

    /// <summary>Start a run: the server fixes seed and board version and names the controller.</summary>
    public async Task StartRun(int? seed)
    {
        var room = RequireRoom();
        RoomRun run;
        try
        {
            run = _rooms.StartRun(room, Context.ConnectionId, seed);
        }
        catch (RoomException e)
        {
            throw new HubException(e.Message);
        }
        // §6.2: interview-mode participants receive the opaque flow bundle
        // with the run, since their projection withholds the flows their
        // engine needs. Everyone else runs on the scenario they already hold.
        var bundle = room.Settings.IsInterview ? _projector.FlowBundle(room) : null;
        foreach (var p in room.Participants.ToList())
        {
            await Clients.Client(p.ConnectionId).SendAsync(
                "RunStarted",
                new RunStartedMessage(
                    run.Seed,
                    run.BoardVersion,
                    run.ControllerConnectionId,
                    p.Role == RoomRole.Participant ? bundle : null));
        }
    }

    /// <summary>The controller's clock, about four times a second (§4.4).</summary>
    public async Task ReportTick(RunTickMessage tick)
    {
        var room = RequireRoom();
        if (!_guards.AllowDiff(Context.ConnectionId)) return;
        try
        {
            _rooms.ReportTick(room, Context.ConnectionId, tick);
        }
        catch (RoomException e)
        {
            throw new HubException(e.Message);
        }
        await Clients.OthersInGroup(room.Id).SendAsync("RunTick", tick);
    }

    /// <summary>Pause, resume, speed, failure injection or stop, relayed for the controller to stamp.</summary>
    public async Task SendRunEvent(string kind, JsonElement? payload)
    {
        var room = RequireRoom();
        if (!RoomRun.EventKinds.Contains(kind)) throw new HubException("That is not a run event.");
        if (!_guards.AllowDiff(Context.ConnectionId)) throw new HubException(RoomGuards.TooManyAttemptsMessage);
        if (payload is { } p && p.GetRawText().Length > 4096) throw new HubException(RoomRegistry.DiffTooLargeMessage);
        RunEventMessage evt;
        try
        {
            evt = _rooms.AddRunEvent(room, Context.ConnectionId, kind, payload);
        }
        catch (RoomException e)
        {
            throw new HubException(e.Message);
        }
        await Clients.Group(room.Id).SendAsync("RunEvent", evt);
    }

    /// <summary>The controller's run finished or was stopped; the board unlocks.</summary>
    public async Task EndRun(string reason)
    {
        var room = RequireRoom();
        bool ended;
        try
        {
            ended = _rooms.EndRun(room, Context.ConnectionId, controllerOnly: true);
        }
        catch (RoomException e)
        {
            throw new HubException(e.Message);
        }
        if (!ended) return;
        var safeReason = reason == "stopped" ? "stopped" : "finished";
        await Clients.Group(room.Id).SendAsync("RunEnded", new RunEndedMessage(safeReason));
    }

    private async Task HandleControllerLoss(Room room, string lostConnectionId)
    {
        var next = _rooms.ReassignController(room, lostConnectionId, out var changed);
        if (!changed) return;
        if (next is null)
        {
            await Clients.Group(room.Id).SendAsync("RunEnded", new RunEndedMessage("interrupted"));
        }
        else
        {
            await Clients.Group(room.Id).SendAsync(
                "RunControllerChanged",
                new RunControllerChangedMessage(next, room.Run?.LastTick ?? 0));
        }
    }

    /// <summary>
    /// Merge a gesture's changes (§5.2) and broadcast the result, including
    /// to the author, so every client sees one ordered stream of versions.
    /// </summary>
    public async Task ApplyBoardDiff(BoardDiffMessage diff)
    {
        var room = RequireRoom();
        if (!_guards.AllowDiff(Context.ConnectionId))
        {
            throw new HubException(RoomGuards.TooManyAttemptsMessage);
        }
        var diffBytes = ApproximateBytes(diff.Changes);
        if (diff.Changes.Count > RoomLimits.MaxEntitiesPerBoard || diffBytes > RoomLimits.MaxDiffBytes)
        {
            throw new HubException(RoomRegistry.DiffTooLargeMessage);
        }
        foreach (var change in diff.Changes)
        {
            if (!RoomBoard.Kinds.Contains(change.Kind) || string.IsNullOrEmpty(change.Id) || change.Id.Length > 200)
            {
                throw new HubException("That change is not a board change.");
            }
        }

        ApplyDiffResult result;
        try
        {
            result = _rooms.ApplyDiff(room, Context.ConnectionId, diff.Changes, diffBytes);
        }
        catch (RoomException e)
        {
            throw new HubException(e.Message);
        }

        await Clients.Group(room.Id).SendAsync(
            "BoardChanged",
            new BoardChangedMessage(result.Version, Context.ConnectionId, result.Changes));
    }

    public BoardSnapshotMessage RequestBoard() => _rooms.Snapshot(RequireRoom());

    /// <summary>Live cursor: unreliable, high-frequency, never touches the version.</summary>
    public Task MoveCursor(double x, double y)
    {
        var room = _rooms.RoomOf(Context.ConnectionId);
        if (room is null || !_guards.AllowCursor(Context.ConnectionId)) return Task.CompletedTask;
        if (!double.IsFinite(x) || !double.IsFinite(y)) return Task.CompletedTask;
        return Clients.OthersInGroup(room.Id).SendAsync("CursorMoved", new CursorMessage(Context.ConnectionId, x, y));
    }

    /// <summary>Host: replace the room's applied scenario document (§4.1).</summary>
    public async Task SetScenarioOverride(JsonElement? scenarioOverride)
    {
        var room = RequireHost();
        if (scenarioOverride is { } doc && doc.GetRawText().Length > RoomLimits.MaxDiffBytes)
        {
            throw new HubException(RoomRegistry.DiffTooLargeMessage);
        }
        _rooms.SetScenarioOverride(room, scenarioOverride);
        await SendScenarioProjections(room, participantsOnly: false);
    }

    /// <summary>Host: invalidate the current code and link (§3.2).</summary>
    public string RotateJoinCode()
    {
        var room = RequireHost();
        return JoinCodes.Format(_rooms.RotateJoinCode(room));
    }

    /// <summary>Host: issue a new host link and drop every other host connection (§3.2).</summary>
    public async Task<string> RotateHostLink()
    {
        var room = RequireHost();
        var (secret, others) = _rooms.RotateHostSecret(room, Context.ConnectionId);
        foreach (var connectionId in others)
        {
            await Clients.Client(connectionId).SendAsync("RoomEnded", new RoomEndedMessage("host-link-rotated"));
            _guards.Abort(connectionId);
        }
        return secret;
    }

    private Room RequireRoom() =>
        _rooms.RoomOf(Context.ConnectionId) ?? throw new HubException(NotInRoomMessage);

    private Room RequireHost()
    {
        var room = RequireRoom();
        var me = _rooms.ParticipantOf(Context.ConnectionId);
        if (me is null || me.Role != RoomRole.Host) throw new HubException(HostOnlyMessage);
        return room;
    }

    private async Task LeaveCurrentGroup()
    {
        var current = _rooms.RoomOf(Context.ConnectionId);
        if (current is null) return;
        _rooms.Leave(Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, current.Id);
        await Clients.Group(current.Id).SendAsync("PresenceChanged", new PresenceMessage(current.ParticipantInfos()));
    }

    private string ClientIp() =>
        Context.GetHttpContext()?.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    private static long ApproximateBytes(IReadOnlyList<EntityChange> changes)
    {
        long total = 0;
        foreach (var c in changes)
        {
            total += c.Id.Length + (c.After?.GetRawText().Length ?? 0);
        }
        return total;
    }
}
