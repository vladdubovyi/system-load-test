using System.Text.Json;
using SystemDesignSimulator.Api.Rooms;

namespace SystemDesignSimulator.Api.Tests;

/// <summary>
/// Room state and merge semantics (docs/specs/interview-platform.md §3.3,
/// §3.4, §5.2), without a network: the registry is driven directly with a
/// fake clock.
/// </summary>
public class RoomRegistryTests
{
    private sealed class FakeClock : TimeProvider
    {
        public DateTimeOffset Now { get; private set; } = new(2026, 11, 7, 12, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
        public void Advance(TimeSpan by) => Now += by;
    }

    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();

    private static BoardEntity Component(string id, int x = 0) =>
        new("component", id, Json($$"""{"id":"{{id}}","type":"backend-service","x":{{x}},"y":0}"""));

    private static BoardEntity Belt(string id, string from, string to) =>
        new("belt", id, Json($$"""{"id":"{{id}}","fromPortId":"{{from}}:out","toPortId":"{{to}}:in","capacity":100}"""));

    private static EntityChange Set(BoardEntity e) => new(e.Kind, e.Id, e.Value);
    private static EntityChange Remove(string kind, string id) => new(kind, id, null);

    private static CreateRoomRequest Request(params BoardEntity[] board) =>
        new("url-shortener", null, board);

    [Fact]
    public void Create_issues_a_code_and_a_secret_and_the_creator_is_host()
    {
        var registry = new RoomRegistry(new FakeClock());

        var room = registry.Create(Request(Component("a")), "conn-host", out var secret);

        Assert.Same(room, registry.FindByCode(room.JoinCode));
        Assert.Same(room, registry.FindByHostSecret(secret));
        Assert.Null(registry.FindByHostSecret("not-the-secret"));
        Assert.Null(registry.FindByCode("ZZZZZZZZ"));
        Assert.DoesNotContain(secret, room.HostSecretHash);

        var host = Assert.Single(room.Participants);
        Assert.Equal(RoomRole.Host, host.Role);
        Assert.Equal("conn-host", host.ConnectionId);
        Assert.Matches("^[A-Z][a-z]+ [A-Z][a-z]+$", host.Name);
        Assert.Equal(0, room.BoardVersion);
        Assert.Equal(new[] { "a" }, room.Board.Snapshot().Select(e => e.Id));
    }

    [Fact]
    public void Joiners_get_distinct_generated_names_and_leaving_marks_the_room_empty()
    {
        var clock = new FakeClock();
        var registry = new RoomRegistry(clock);
        var room = registry.Create(Request(), "host", out _);

        var p1 = registry.Join(room, "p1", RoomRole.Participant);
        var p2 = registry.Join(room, "p2", RoomRole.Participant);
        Assert.NotEqual(p1.Name, p2.Name);
        Assert.Equal(3, room.Participants.Count);
        Assert.Same(room, registry.RoomOf("p2"));

        registry.Leave("p1");
        registry.Leave("p2");
        Assert.Null(room.EmptySince);
        Assert.Same(room, registry.Leave("host"));
        Assert.Equal(clock.Now, room.EmptySince);
        Assert.Null(registry.RoomOf("host"));
    }

    [Fact]
    public void A_connection_is_in_at_most_one_room()
    {
        var registry = new RoomRegistry(new FakeClock());
        var first = registry.Create(Request(), "c", out _);
        var second = registry.Create(Request(), "c", out _);

        Assert.Empty(first.Participants);
        Assert.Single(second.Participants);
        Assert.Same(second, registry.RoomOf("c"));
    }

    [Fact]
    public void Diffs_merge_last_writer_wins_per_entity_and_bump_the_version()
    {
        var registry = new RoomRegistry(new FakeClock());
        var room = registry.Create(Request(Component("a"), Component("b")), "host", out _);

        var r1 = registry.ApplyDiff(room, "host", new[] { Set(Component("a", 10)) });
        var r2 = registry.ApplyDiff(room, "host", new[] { Set(Component("a", 20)), Set(Component("c")) });
        var r3 = registry.ApplyDiff(room, "host", new[] { Remove("component", "b") });

        Assert.Equal(new[] { 1, 2, 3 }, new[] { r1.Version, r2.Version, r3.Version });
        var snapshot = room.Board.Snapshot();
        // Insertion order is kept for existing entities; adds append.
        Assert.Equal(new[] { "a", "c" }, snapshot.Select(e => e.Id));
        Assert.Equal(20, snapshot[0].Value.GetProperty("x").GetInt32());
        Assert.Single(r3.Changes);
        Assert.Null(r3.Changes[0].After);
    }

    [Fact]
    public void Removing_a_component_drops_its_belts_and_reports_them_as_changes()
    {
        var registry = new RoomRegistry(new FakeClock());
        var room = registry.Create(
            Request(Component("a"), Component("b"), Belt("src", "__source__", "a"), Belt("ab", "a", "b")),
            "host", out _);

        var result = registry.ApplyDiff(room, "host", new[] { Remove("component", "b") });

        Assert.Equal(
            new[] { "component:b", "belt:ab" },
            result.Changes.Select(c => $"{c.Kind}:{c.Id}"));
        Assert.All(result.Changes, c => Assert.Null(c.After));
        Assert.Equal(new[] { "a", "src" }, room.Board.Snapshot().Select(e => e.Id));
    }

    [Fact]
    public void A_belt_to_a_component_that_never_existed_is_dropped_on_arrival()
    {
        var registry = new RoomRegistry(new FakeClock());
        var room = registry.Create(Request(Component("a")), "host", out _);

        var result = registry.ApplyDiff(room, "host", new[] { Set(Belt("ghost", "a", "nowhere")) });

        Assert.False(room.Board.Contains("belt", "ghost"));
        Assert.Contains(result.Changes, c => c.Kind == "belt" && c.Id == "ghost" && c.After is null);
    }

    [Fact]
    public void Unknown_kinds_are_ignored_not_stored()
    {
        var registry = new RoomRegistry(new FakeClock());
        var room = registry.Create(Request(new BoardEntity("note-about-a-person", "x", Json("{}"))), "host", out _);

        var result = registry.ApplyDiff(room, "host", new[] { new EntityChange("user", "u1", Json("""{"email":"a@b.c"}""")) });

        Assert.Empty(room.Board.Snapshot());
        Assert.Empty(result.Changes);
    }

    [Fact]
    public void Rotating_the_join_code_invalidates_the_old_one_and_keeps_participants()
    {
        var registry = new RoomRegistry(new FakeClock());
        var room = registry.Create(Request(), "host", out _);
        registry.Join(room, "p1", RoomRole.Participant);
        var oldCode = room.JoinCode;

        var newCode = registry.RotateJoinCode(room);

        Assert.NotEqual(oldCode, newCode);
        Assert.Null(registry.FindByCode(oldCode));
        Assert.Same(room, registry.FindByCode(newCode));
        Assert.Equal(2, room.Participants.Count);
    }

    [Fact]
    public void Rotating_the_host_secret_names_the_other_host_connections()
    {
        var registry = new RoomRegistry(new FakeClock());
        var room = registry.Create(Request(), "host-a", out var oldSecret);
        registry.Join(room, "host-b", RoomRole.Host);
        registry.Join(room, "p1", RoomRole.Participant);

        var (secret, others) = registry.RotateHostSecret(room, keepConnectionId: "host-a");

        Assert.Equal(new[] { "host-b" }, others);
        Assert.Null(registry.FindByHostSecret(oldSecret));
        Assert.Same(room, registry.FindByHostSecret(secret));
    }

    [Fact]
    public void An_empty_room_is_kept_for_thirty_minutes_then_deleted()
    {
        var clock = new FakeClock();
        var registry = new RoomRegistry(clock);
        var room = registry.Create(Request(), "host", out _);
        registry.Leave("host");

        clock.Advance(RoomLimits.EmptyRoomGrace - TimeSpan.FromSeconds(1));
        Assert.Empty(registry.Sweep());
        Assert.Same(room, registry.FindByCode(room.JoinCode));

        clock.Advance(TimeSpan.FromSeconds(2));
        var expired = Assert.Single(registry.Sweep());
        Assert.Equal("empty", expired.Reason);
        Assert.Empty(expired.Connections);
        Assert.Null(registry.FindByCode(room.JoinCode));
        Assert.Equal(0, registry.Count);
    }

    [Fact]
    public void Rejoining_within_the_grace_period_rescues_the_room()
    {
        var clock = new FakeClock();
        var registry = new RoomRegistry(clock);
        var room = registry.Create(Request(), "host", out _);
        registry.Leave("host");
        clock.Advance(TimeSpan.FromMinutes(29));
        registry.Join(room, "host-again", RoomRole.Host);
        clock.Advance(TimeSpan.FromMinutes(5));

        Assert.Empty(registry.Sweep());
        Assert.Null(room.EmptySince);
    }

    [Fact]
    public void An_occupied_but_idle_room_ends_after_twelve_hours_and_its_connections_are_reported()
    {
        var clock = new FakeClock();
        var registry = new RoomRegistry(clock);
        var room = registry.Create(Request(), "host", out _);
        registry.Join(room, "p1", RoomRole.Participant);

        clock.Advance(TimeSpan.FromHours(11));
        registry.ApplyDiff(room, "host", new[] { Set(Component("a")) }); // activity resets the clock
        clock.Advance(TimeSpan.FromHours(11));
        Assert.Empty(registry.Sweep());

        clock.Advance(TimeSpan.FromHours(1) + TimeSpan.FromSeconds(1));
        var expired = Assert.Single(registry.Sweep());
        Assert.Equal("idle", expired.Reason);
        Assert.Equal(new[] { "host", "p1" }, expired.Connections.OrderBy(c => c));
        Assert.Null(registry.RoomOf("p1"));
    }

    [Fact]
    public void Room_creation_stops_at_the_process_cap()
    {
        var registry = new RoomRegistry(new FakeClock());
        for (var i = 0; i < RoomLimits.MaxRoomsPerProcess; i++)
        {
            registry.Create(Request(), $"c{i}", out _);
        }

        var error = Assert.Throws<RoomException>(() => registry.Create(Request(), "one-more", out _));
        Assert.Equal(RoomRegistry.TooManyRoomsMessage, error.Message);
    }

    [Fact]
    public void A_board_over_the_entity_cap_is_refused_before_it_is_stored()
    {
        var registry = new RoomRegistry(new FakeClock());
        var room = registry.Create(Request(), "host", out _);
        var tooMany = Enumerable.Range(0, RoomLimits.MaxEntitiesPerBoard + 1)
            .Select(i => Set(Component($"c{i}")))
            .ToList();

        Assert.Throws<RoomException>(() => registry.ApplyDiff(room, "host", tooMany));
        Assert.Equal(0, room.Board.Count);
        Assert.Equal(0, room.BoardVersion);
    }
}
