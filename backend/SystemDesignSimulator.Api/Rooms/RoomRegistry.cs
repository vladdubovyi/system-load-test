using System.Text.Json;

namespace SystemDesignSimulator.Api.Rooms;

public sealed class RoomException : Exception
{
    public RoomException(string message) : base(message) { }
}

public sealed record ApplyDiffResult(int Version, IReadOnlyList<EntityChange> Changes);

public sealed record ExpiredRoom(Room Room, string Reason, IReadOnlyList<string> Connections);

/// <summary>
/// Every live room, in process memory (docs/specs/interview-platform.md §3).
/// Indexed by join code and by the hash of the host secret; never by anything
/// that identifies a person. A single lock guards it all — rooms are few and
/// operations are small.
/// </summary>
public sealed class RoomRegistry
{
    public const string NoRoomMessage = "No room with that code.";
    public const string NoHostRoomMessage = "No room for that host link.";
    public const string TooManyRoomsMessage = "Too many rooms right now. Try again in a few minutes.";
    public const string BoardTooLargeMessage = "That board is too large for a room.";
    public const string DiffTooLargeMessage = "That change is too large.";
    public const string BoardLockedMessage = "The board is locked while a run is in progress.";
    public const string RunInProgressMessage = "A run is already in progress.";
    public const string NoRunMessage = "No run is in progress.";
    public const string NotControllerMessage = "Only the run's controller can do that.";
    public const string HostRunsMessage = "Only the host can control runs in this room.";
    public const string BadSettingsMessage = "Those settings are not valid.";

    private readonly object _gate = new();
    private readonly Dictionary<string, Room> _rooms = new();
    private readonly Dictionary<string, Room> _byCode = new();
    private readonly Dictionary<string, Room> _byHostHash = new();
    private readonly Dictionary<string, Room> _byConnection = new();
    private readonly TimeProvider _clock;

    public RoomRegistry(TimeProvider clock) => _clock = clock;

    public int Count
    {
        get { lock (_gate) return _rooms.Count; }
    }

    public Room Create(CreateRoomRequest request, string connectionId, out string hostSecret)
    {
        lock (_gate)
        {
            if (_rooms.Count >= RoomLimits.MaxRoomsPerProcess)
            {
                throw new RoomException(TooManyRoomsMessage);
            }
            if (request.Board.Count > RoomLimits.MaxEntitiesPerBoard)
            {
                throw new RoomException(BoardTooLargeMessage);
            }

            LeaveLocked(connectionId);

            hostSecret = JoinCodes.NewHostSecret();
            var now = _clock.GetUtcNow();
            var room = new Room
            {
                Id = Guid.NewGuid().ToString("N"),
                JoinCode = UniqueCode(),
                HostSecretHash = JoinCodes.HashHostSecret(hostSecret),
                CreatedAt = now,
                LastActivityAt = now,
                ScenarioSlug = request.ScenarioSlug,
                ScenarioOverride = request.ScenarioOverride?.Clone(),
                TrafficOverride = request.TrafficOverride?.Clone(),
            };
            room.Board.Load(request.Board);
            if (room.Board.ApproximateBytes > RoomLimits.MaxBoardBytes)
            {
                throw new RoomException(BoardTooLargeMessage);
            }

            _rooms[room.Id] = room;
            _byCode[room.JoinCode] = room;
            _byHostHash[room.HostSecretHash] = room;
            JoinLocked(room, connectionId, RoomRole.Host);
            return room;
        }
    }

    public Room? FindByCode(string canonicalCode)
    {
        lock (_gate) return _byCode.GetValueOrDefault(canonicalCode);
    }

    public Room? FindByHostSecret(string secret)
    {
        lock (_gate) return _byHostHash.GetValueOrDefault(JoinCodes.HashHostSecret(secret));
    }

    public Room? RoomOf(string connectionId)
    {
        lock (_gate) return _byConnection.GetValueOrDefault(connectionId);
    }

    public Participant? ParticipantOf(string connectionId)
    {
        lock (_gate)
        {
            var room = _byConnection.GetValueOrDefault(connectionId);
            return room?.Participants.FirstOrDefault(p => p.ConnectionId == connectionId);
        }
    }

    public Participant Join(Room room, string connectionId, RoomRole role)
    {
        lock (_gate)
        {
            if (!_rooms.ContainsKey(room.Id)) throw new RoomException(NoRoomMessage);
            LeaveLocked(connectionId);
            return JoinLocked(room, connectionId, role);
        }
    }

    /// <summary>Remove a connection from its room. Returns the room left, if any.</summary>
    public Room? Leave(string connectionId)
    {
        lock (_gate) return LeaveLocked(connectionId);
    }

    /// <summary>
    /// Merge a gesture into the room's board. The size caps are checked
    /// before anything is written so a refused diff leaves the board, and
    /// every client's copy of it, untouched.
    /// </summary>
    public ApplyDiffResult ApplyDiff(Room room, string connectionId, IReadOnlyList<EntityChange> changes, long diffBytes = 0)
    {
        lock (_gate)
        {
            if (!_rooms.ContainsKey(room.Id)) throw new RoomException(NoRoomMessage);
            if (room.Run is not null) throw new RoomException(BoardLockedMessage);
            if (room.Settings.Pen == "single" && room.PenHolder != connectionId)
            {
                var holder = room.Participants.FirstOrDefault(p => p.ConnectionId == room.PenHolder);
                throw new RoomException(holder is null ? "Nobody holds the pen; ask the host for it." : $"{holder.Name} holds the pen.");
            }
            var adds = changes.Count(c => c.After is not null && !room.Board.Contains(c.Kind, c.Id));
            if (room.Board.Count + adds > RoomLimits.MaxEntitiesPerBoard
                || room.Board.ApproximateBytes + diffBytes > RoomLimits.MaxBoardBytes)
            {
                throw new RoomException(BoardTooLargeMessage);
            }
            var applied = room.Board.Apply(changes);
            room.BoardVersion++;
            room.LastActivityAt = _clock.GetUtcNow();
            return new ApplyDiffResult(room.BoardVersion, applied);
        }
    }

    public BoardSnapshotMessage Snapshot(Room room)
    {
        lock (_gate) return new BoardSnapshotMessage(room.BoardVersion, room.Board.Snapshot());
    }

    public void SetScenarioOverride(Room room, JsonElement? scenarioOverride)
    {
        lock (_gate)
        {
            room.ScenarioOverride = scenarioOverride?.Clone();
            room.LastActivityAt = _clock.GetUtcNow();
        }
    }

    public void SetTrafficOverride(Room room, string connectionId, JsonElement? trafficOverride)
    {
        lock (_gate)
        {
            RequireRunnerLocked(room, connectionId);
            room.TrafficOverride = trafficOverride?.Clone();
            room.LastActivityAt = _clock.GetUtcNow();
        }
    }

    public void Touch(Room room)
    {
        lock (_gate) room.LastActivityAt = _clock.GetUtcNow();
    }

    // ── Settings (§4) ──────────────────────────────────────────────────────

    public bool IsHost(Room room, string connectionId)
    {
        lock (_gate) return room.Participants.Any(p => p.ConnectionId == connectionId && p.Role == RoomRole.Host);
    }

    /// <summary>Replace the settings. Switching the pen to single hands it to the host.</summary>
    public void UpdateSettings(Room room, string hostConnectionId, RoomSettings settings)
    {
        lock (_gate)
        {
            if (!settings.IsValid()) throw new RoomException(BadSettingsMessage);
            var wasShared = room.Settings.Pen == "shared";
            room.Settings = settings;
            if (settings.Pen == "single" && (wasShared || room.PenHolder is null))
            {
                room.PenHolder = hostConnectionId;
            }
            if (settings.Pen == "shared") room.PenHolder = null;
            room.LastActivityAt = _clock.GetUtcNow();
        }
    }

    public void AssignPen(Room room, string? connectionId)
    {
        lock (_gate)
        {
            if (connectionId is not null && room.Participants.All(p => p.ConnectionId != connectionId))
            {
                throw new RoomException("That person is no longer in the room.");
            }
            room.PenHolder = connectionId;
            room.LastActivityAt = _clock.GetUtcNow();
        }
    }

    public void ReleaseReport(Room room)
    {
        lock (_gate) room.ReportReleased = true;
    }

    private void RequireRunnerLocked(Room room, string connectionId)
    {
        if (room.Settings.WhoCanRun == "hostOnly"
            && !room.Participants.Any(p => p.ConnectionId == connectionId && p.Role == RoomRole.Host))
        {
            throw new RoomException(HostRunsMessage);
        }
    }

    // ── Runs (§4.4) ────────────────────────────────────────────────────────

    /// <summary>
    /// Fix the run: seed and board version, with the requester as controller.
    /// The board is locked until <see cref="EndRun"/>.
    /// </summary>
    public RoomRun StartRun(Room room, string controllerConnectionId, int? seed)
    {
        lock (_gate)
        {
            if (!_rooms.ContainsKey(room.Id)) throw new RoomException(NoRoomMessage);
            if (room.Run is not null) throw new RoomException(RunInProgressMessage);
            RequireRunnerLocked(room, controllerConnectionId);
            var run = new RoomRun
            {
                Seed = room.Settings.Seed ?? seed ?? Random.Shared.Next(1, int.MaxValue),
                BoardVersion = room.BoardVersion,
                ControllerConnectionId = controllerConnectionId,
            };
            room.Run = run;
            room.ReportReleased = false;
            room.LastActivityAt = _clock.GetUtcNow();
            return run;
        }
    }

    /// <summary>The controller's clock advanced; record stamps for later joiners.</summary>
    public RoomRun ReportTick(Room room, string connectionId, RunTickMessage tick)
    {
        lock (_gate)
        {
            var run = room.Run ?? throw new RoomException(NoRunMessage);
            if (run.ControllerConnectionId != connectionId) throw new RoomException(NotControllerMessage);
            if (tick.Tick > run.LastTick) run.LastTick = tick.Tick;
            foreach (var stamp in tick.Stamps)
            {
                var i = run.Events.FindIndex(e => e.Seq == stamp.Seq);
                if (i >= 0 && run.Events[i].ApplyAtTick is null)
                {
                    run.Events[i] = run.Events[i] with { ApplyAtTick = stamp.ApplyAtTick };
                }
            }
            room.LastActivityAt = _clock.GetUtcNow();
            return run;
        }
    }

    /// <summary>Queue a control event; the controller stamps it.</summary>
    public RunEventMessage AddRunEvent(Room room, string from, string kind, JsonElement? payload)
    {
        lock (_gate)
        {
            var run = room.Run ?? throw new RoomException(NoRunMessage);
            RequireRunnerLocked(room, from);
            var evt = new RunEventMessage(run.NextSeq++, kind, payload?.Clone(), from, null);
            run.Events.Add(evt);
            room.LastActivityAt = _clock.GetUtcNow();
            return evt;
        }
    }

    /// <summary>Unlock the board. Returns false when there was no run to end.</summary>
    public bool EndRun(Room room, string connectionId, bool controllerOnly)
    {
        lock (_gate)
        {
            var run = room.Run;
            if (run is null) return false;
            if (controllerOnly && run.ControllerConnectionId != connectionId) throw new RoomException(NotControllerMessage);
            room.Run = null;
            room.LastActivityAt = _clock.GetUtcNow();
            return true;
        }
    }

    /// <summary>
    /// The controller is gone (§4.4): a connected host takes over, or the run
    /// is abandoned. Returns the new controller, or null when abandoned; the
    /// out flag says whether anything changed.
    /// </summary>
    public string? ReassignController(Room room, string lostConnectionId, out bool changed)
    {
        lock (_gate)
        {
            changed = false;
            var run = room.Run;
            if (run is null || run.ControllerConnectionId != lostConnectionId) return null;
            changed = true;
            var host = room.Participants.FirstOrDefault(p => p.Role == RoomRole.Host && p.ConnectionId != lostConnectionId);
            if (host is null)
            {
                room.Run = null;
                return null;
            }
            run.ControllerConnectionId = host.ConnectionId;
            return host.ConnectionId;
        }
    }

    /// <summary>Invalidate the current code and link; connected participants stay (§3.2).</summary>
    public string RotateJoinCode(Room room)
    {
        lock (_gate)
        {
            _byCode.Remove(room.JoinCode);
            room.JoinCode = UniqueCode();
            _byCode[room.JoinCode] = room;
            room.LastActivityAt = _clock.GetUtcNow();
            return room.JoinCode;
        }
    }

    /// <summary>
    /// Issue a new host secret. Returns it together with the other host
    /// connections, which the caller disconnects (§3.2).
    /// </summary>
    public (string Secret, IReadOnlyList<string> OtherHostConnections) RotateHostSecret(Room room, string keepConnectionId)
    {
        lock (_gate)
        {
            _byHostHash.Remove(room.HostSecretHash);
            var secret = JoinCodes.NewHostSecret();
            room.HostSecretHash = JoinCodes.HashHostSecret(secret);
            _byHostHash[room.HostSecretHash] = room;
            room.LastActivityAt = _clock.GetUtcNow();
            var others = room.Participants
                .Where(p => p.Role == RoomRole.Host && p.ConnectionId != keepConnectionId)
                .Select(p => p.ConnectionId)
                .ToList();
            return (secret, others);
        }
    }

    /// <summary>
    /// Delete rooms past their expiry (§3.4): empty for the grace period, or
    /// idle for the timeout. Rooms ended while people were connected are
    /// returned with reason <c>idle</c> so the hub can tell them why.
    /// </summary>
    public IReadOnlyList<ExpiredRoom> Sweep()
    {
        lock (_gate)
        {
            var now = _clock.GetUtcNow();
            var expired = new List<ExpiredRoom>();
            foreach (var room in _rooms.Values.ToList())
            {
                string? reason = null;
                if (room.Participants.Count == 0)
                {
                    if (room.EmptySince is { } since && now - since >= RoomLimits.EmptyRoomGrace)
                    {
                        reason = "empty";
                    }
                }
                else if (now - room.LastActivityAt >= RoomLimits.IdleRoomTimeout)
                {
                    reason = "idle";
                }
                if (reason is null) continue;

                var connections = room.Participants.Select(p => p.ConnectionId).ToList();
                RemoveLocked(room);
                expired.Add(new ExpiredRoom(room, reason, connections));
            }
            return expired;
        }
    }

    private Participant JoinLocked(Room room, string connectionId, RoomRole role)
    {
        var participant = new Participant
        {
            ConnectionId = connectionId,
            Name = ParticipantNames.Pick(room.Participants.Select(p => p.Name)),
            Role = role,
            ConnectedAt = _clock.GetUtcNow(),
        };
        room.Participants.Add(participant);
        room.EmptySince = null;
        room.LastActivityAt = _clock.GetUtcNow();
        _byConnection[connectionId] = room;
        return participant;
    }

    private Room? LeaveLocked(string connectionId)
    {
        if (!_byConnection.Remove(connectionId, out var room)) return null;
        room.Participants.RemoveAll(p => p.ConnectionId == connectionId);
        if (room.PenHolder == connectionId)
        {
            // §4.3: the pen returns to the host.
            room.PenHolder = room.Participants.FirstOrDefault(p => p.Role == RoomRole.Host)?.ConnectionId;
        }
        if (room.Participants.Count == 0)
        {
            room.EmptySince = _clock.GetUtcNow();
        }
        return room;
    }

    private void RemoveLocked(Room room)
    {
        _rooms.Remove(room.Id);
        _byCode.Remove(room.JoinCode);
        _byHostHash.Remove(room.HostSecretHash);
        foreach (var p in room.Participants)
        {
            _byConnection.Remove(p.ConnectionId);
        }
        room.Participants.Clear();
    }

    private string UniqueCode()
    {
        for (var i = 0; i < 32; i++)
        {
            var code = JoinCodes.NewJoinCode();
            if (!_byCode.ContainsKey(code)) return code;
        }
        throw new RoomException(TooManyRoomsMessage);
    }
}

/// <summary>
/// Generated display names ("Blue Heron"), per connection and not editable:
/// a free-text name field invites real names (§2.1).
/// </summary>
public static class ParticipantNames
{
    private static readonly string[] Adjectives =
    {
        "Amber", "Blue", "Brisk", "Calm", "Coral", "Crimson", "Dusky", "Early", "Golden", "Green",
        "Hazel", "Indigo", "Ivory", "Jade", "Keen", "Lively", "Mellow", "Misty", "Olive", "Pale",
        "Quiet", "Rosy", "Scarlet", "Silver", "Swift", "Tawny", "Umber", "Violet", "Wild", "Young",
    };

    private static readonly string[] Birds =
    {
        "Avocet", "Bittern", "Crane", "Curlew", "Dipper", "Dunlin", "Egret", "Falcon", "Finch", "Gannet",
        "Godwit", "Heron", "Ibis", "Jay", "Kestrel", "Kite", "Lapwing", "Linnet", "Merlin", "Osprey",
        "Owl", "Petrel", "Plover", "Puffin", "Robin", "Sandpiper", "Swift", "Tern", "Wren", "Yellowhammer",
    };

    public static string Pick(IEnumerable<string> taken)
    {
        var used = new HashSet<string>(taken);
        for (var attempt = 0; attempt < 64; attempt++)
        {
            var name = $"{Adjectives[Random.Shared.Next(Adjectives.Length)]} {Birds[Random.Shared.Next(Birds.Length)]}";
            if (used.Add(name)) return name;
        }
        return $"Guest {used.Count + 1}";
    }
}
