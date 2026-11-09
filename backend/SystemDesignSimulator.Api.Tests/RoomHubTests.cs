using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Logging;
using SystemDesignSimulator.Api.Rooms;

namespace SystemDesignSimulator.Api.Tests;

/// <summary>
/// The hub end to end (docs/specs/interview-platform.md §3, §5, §7), with
/// real SignalR clients talking to the in-process server.
/// </summary>
public class RoomHubTests : IClassFixture<RoomHubTests.LoggingApiFactory>, IAsyncLifetime
{
    /// <summary>Hosts the API and captures every log line the process writes.</summary>
    public sealed class LoggingApiFactory : ApiFactory
    {
        public ConcurrentQueue<string> Logs { get; } = new();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureLogging(logging =>
            {
                logging.SetMinimumLevel(LogLevel.Trace);
                logging.AddProvider(new CaptureProvider(Logs));
            });
        }

        private sealed class CaptureProvider : ILoggerProvider
        {
            private readonly ConcurrentQueue<string> _sink;
            public CaptureProvider(ConcurrentQueue<string> sink) => _sink = sink;
            public ILogger CreateLogger(string categoryName) => new CaptureLogger(categoryName, _sink);
            public void Dispose() { }

            private sealed class CaptureLogger : ILogger
            {
                private readonly string _category;
                private readonly ConcurrentQueue<string> _sink;
                public CaptureLogger(string category, ConcurrentQueue<string> sink) => (_category, _sink) = (category, sink);
                public IDisposable BeginScope<TState>(TState state) where TState : notnull => new Scope();
                public bool IsEnabled(LogLevel logLevel) => true;
                public void Log<TState>(LogLevel level, EventId id, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
                {
                    _sink.Enqueue($"[{level}] {_category}: {formatter(state, exception)} {exception}");
                    if (state is IReadOnlyList<KeyValuePair<string, object?>> pairs)
                    {
                        foreach (var pair in pairs) _sink.Enqueue($"  {pair.Key}={pair.Value}");
                    }
                }
                private sealed class Scope : IDisposable { public void Dispose() { } }
            }
        }
    }

    private readonly LoggingApiFactory _factory;
    private readonly List<HubConnection> _connections = new();

    public RoomHubTests(LoggingApiFactory factory) => _factory = factory;

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var c in _connections) await c.DisposeAsync();
    }

    private async Task<HubConnection> Connect()
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(_factory.Server.BaseAddress, "hubs/room"), options =>
            {
                options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                options.Transports = HttpTransportType.LongPolling;
            })
            .Build();
        await connection.StartAsync();
        _connections.Add(connection);
        return connection;
    }

    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();

    private static BoardEntity Component(string id, int x = 0) =>
        new("component", id, Json($$"""{"id":"{{id}}","type":"redis","x":{{x}},"y":0}"""));

    private static CreateRoomRequest Request(params BoardEntity[] board) => new("url-shortener", null, board);

    private static async Task<T> Within<T>(Task<T> task, string what)
    {
        var done = await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(10)));
        Assert.True(done == task, $"Timed out waiting for {what}");
        return await task;
    }

    private static TaskCompletionSource<T> Expect<T>(HubConnection connection, string method)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<T>(method, m => tcs.TrySetResult(m));
        return tcs;
    }

    [Fact]
    public async Task Share_then_join_by_code_puts_both_on_the_same_board()
    {
        var host = await Connect();
        var presenceAtHost = Expect<PresenceMessage>(host, "PresenceChanged");
        var created = await host.InvokeAsync<RoomCreatedMessage>("CreateRoom", Request(Component("a", 5)));

        Assert.Matches("^[0-9A-Z]{4}-[0-9A-Z]{4}$", created.JoinCode);
        Assert.Equal(22, created.HostSecret.Length);
        Assert.Single(created.Participants);

        var guest = await Connect();
        // Typed the way people type: lowercase, spaces instead of the dash.
        var typed = created.JoinCode.Replace('-', ' ').ToLowerInvariant();
        var joined = await guest.InvokeAsync<RoomJoinedMessage>("JoinByCode", typed);

        Assert.Equal(RoomRole.Participant, joined.Role);
        Assert.Null(joined.JoinCode);
        Assert.Equal("url-shortener", joined.ScenarioSlug);
        Assert.Equal(0, joined.Version);
        var entity = Assert.Single(joined.Board);
        Assert.Equal(5, entity.Value.GetProperty("x").GetInt32());
        Assert.Equal(2, joined.Participants.Count);
        Assert.NotEqual(created.Name, joined.Name);

        var presence = await Within(presenceAtHost.Task, "presence at host");
        Assert.Equal(2, presence.Participants.Count);
        Assert.Contains(presence.Participants, p => p.ConnectionId == joined.ConnectionId && p.Role == RoomRole.Participant);
    }

    [Fact]
    public async Task A_diff_from_one_client_reaches_everyone_with_the_next_version()
    {
        var host = await Connect();
        var created = await host.InvokeAsync<RoomCreatedMessage>("CreateRoom", Request(Component("a")));
        var guest = await Connect();
        await guest.InvokeAsync<RoomJoinedMessage>("JoinByCode", created.JoinCode);

        var atHost = Expect<BoardChangedMessage>(host, "BoardChanged");
        var atGuest = Expect<BoardChangedMessage>(guest, "BoardChanged");

        await guest.InvokeAsync("ApplyBoardDiff", new BoardDiffMessage(0, new[]
        {
            new EntityChange("component", "b", Component("b", 7).Value),
            new EntityChange("component", "a", null),
        }));

        var hostSaw = await Within(atHost.Task, "BoardChanged at host");
        var guestSaw = await Within(atGuest.Task, "BoardChanged at guest");
        Assert.Equal(1, hostSaw.Version);
        Assert.Equal(1, guestSaw.Version);
        // The author gets its own change back, marked as its own.
        Assert.Equal(guest.ConnectionId, guestSaw.Origin);
        Assert.Equal(guest.ConnectionId, hostSaw.Origin);
        Assert.Equal(new[] { "b", "a" }, hostSaw.Changes.Select(c => c.Id));

        var snapshot = await host.InvokeAsync<BoardSnapshotMessage>("RequestBoard");
        Assert.Equal(1, snapshot.Version);
        Assert.Equal(new[] { "b" }, snapshot.Board.Select(e => e.Id));
    }

    [Fact]
    public async Task Unknown_codes_and_wrong_host_links_get_the_same_uninformative_answer()
    {
        var connection = await Connect();

        var byCode = await Assert.ThrowsAsync<HubException>(() =>
            connection.InvokeAsync<RoomJoinedMessage>("JoinByCode", "ZZZZ-ZZZZ"));
        Assert.Contains(RoomRegistry.NoRoomMessage, byCode.Message);

        var garbage = await Assert.ThrowsAsync<HubException>(() =>
            connection.InvokeAsync<RoomJoinedMessage>("JoinByCode", "not a code at all"));
        Assert.Contains(RoomRegistry.NoRoomMessage, garbage.Message);

        var asHost = await Assert.ThrowsAsync<HubException>(() =>
            connection.InvokeAsync<RoomJoinedMessage>("JoinAsHost", "not-a-secret"));
        Assert.Contains(RoomRegistry.NoHostRoomMessage, asHost.Message);
    }

    [Fact]
    public async Task The_host_link_returns_the_host_role_from_another_connection()
    {
        var first = await Connect();
        var created = await first.InvokeAsync<RoomCreatedMessage>("CreateRoom", Request(Component("a")));

        var second = await Connect();
        var joined = await second.InvokeAsync<RoomJoinedMessage>("JoinAsHost", created.HostSecret);

        Assert.Equal(RoomRole.Host, joined.Role);
        Assert.Equal(created.JoinCode, joined.JoinCode);
        Assert.Equal(2, joined.Participants.Count);
        Assert.All(joined.Participants, p => Assert.Equal(RoomRole.Host, p.Role));
    }

    [Fact]
    public async Task Rotating_the_join_code_keeps_participants_and_retires_the_old_code()
    {
        var host = await Connect();
        var created = await host.InvokeAsync<RoomCreatedMessage>("CreateRoom", Request());
        var guest = await Connect();
        await guest.InvokeAsync<RoomJoinedMessage>("JoinByCode", created.JoinCode);

        var newCode = await host.InvokeAsync<string>("RotateJoinCode");
        Assert.NotEqual(created.JoinCode, newCode);

        var late = await Connect();
        await Assert.ThrowsAsync<HubException>(() => late.InvokeAsync<RoomJoinedMessage>("JoinByCode", created.JoinCode));
        var joined = await late.InvokeAsync<RoomJoinedMessage>("JoinByCode", newCode);
        Assert.Equal(3, joined.Participants.Count);

        // Participants cannot rotate anything.
        var denied = await Assert.ThrowsAsync<HubException>(() => guest.InvokeAsync<string>("RotateJoinCode"));
        Assert.Contains(RoomHub.HostOnlyMessage, denied.Message);
    }

    [Fact]
    public async Task Rotating_the_host_link_disconnects_the_other_host_tab()
    {
        var tabA = await Connect();
        var created = await tabA.InvokeAsync<RoomCreatedMessage>("CreateRoom", Request());
        var tabB = await Connect();
        await tabB.InvokeAsync<RoomJoinedMessage>("JoinAsHost", created.HostSecret);
        var endedAtB = Expect<RoomEndedMessage>(tabB, "RoomEnded");
        var closedAtB = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        tabB.Closed += _ => { closedAtB.TrySetResult(true); return Task.CompletedTask; };

        var newSecret = await tabA.InvokeAsync<string>("RotateHostLink");

        Assert.Equal("host-link-rotated", (await Within(endedAtB.Task, "RoomEnded at tab B")).Reason);
        await Within(closedAtB.Task, "tab B to be closed");
        var tabC = await Connect();
        await Assert.ThrowsAsync<HubException>(() => tabC.InvokeAsync<RoomJoinedMessage>("JoinAsHost", created.HostSecret));
        var rejoined = await tabC.InvokeAsync<RoomJoinedMessage>("JoinAsHost", newSecret);
        Assert.Equal(RoomRole.Host, rejoined.Role);
    }

    [Fact]
    public async Task Leaving_updates_presence_for_the_others()
    {
        var host = await Connect();
        var created = await host.InvokeAsync<RoomCreatedMessage>("CreateRoom", Request());
        var guest = await Connect();
        await guest.InvokeAsync<RoomJoinedMessage>("JoinByCode", created.JoinCode);

        var seen = new ConcurrentQueue<int>();
        var alone = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        host.On<PresenceMessage>("PresenceChanged", m =>
        {
            seen.Enqueue(m.Participants.Count);
            if (m.Participants.Count == 1) alone.TrySetResult(true);
        });

        await guest.StopAsync();

        await Within(alone.Task, "presence to drop to one");
    }

    [Fact]
    public async Task Board_changes_need_a_room_and_a_sane_shape()
    {
        var loner = await Connect();
        var notInRoom = await Assert.ThrowsAsync<HubException>(() =>
            loner.InvokeAsync("ApplyBoardDiff", new BoardDiffMessage(0, new[] { new EntityChange("component", "a", Component("a").Value) })));
        Assert.Contains(RoomHub.NotInRoomMessage, notInRoom.Message);

        await loner.InvokeAsync<RoomCreatedMessage>("CreateRoom", Request());
        var badKind = await Assert.ThrowsAsync<HubException>(() =>
            loner.InvokeAsync("ApplyBoardDiff", new BoardDiffMessage(0, new[] { new EntityChange("person", "a", Json("{}")) })));
        Assert.Contains("not a board change", badKind.Message);
    }

    [Fact]
    public async Task Repeated_failed_joins_are_cut_off()
    {
        // All in-process clients share one IP, and the factory is shared by
        // the class, so this test deliberately runs last in effect: it
        // exhausts the per-IP budget. Each attempt uses a fresh code so the
        // registry is never consulted for a real room.
        var connection = await Connect();
        string? lastMessage = null;
        for (var i = 0; i < RoomLimits.FailedJoinsPer10MinutesPerIp + 5; i++)
        {
            var error = await Assert.ThrowsAsync<HubException>(() =>
                connection.InvokeAsync<RoomJoinedMessage>("JoinByCode", "ZZZZ-ZZZ" + JoinCodes.Alphabet[i % 32]));
            lastMessage = error.Message;
        }
        Assert.Contains(RoomGuards.TooManyAttemptsMessage, lastMessage);
    }

    [Fact]
    public async Task Logs_never_contain_board_content_join_codes_or_host_secrets()
    {
        const string marker = "REDACTION-MARKER-7f3a9c";
        var host = await Connect();
        var created = await host.InvokeAsync<RoomCreatedMessage>("CreateRoom", new CreateRoomRequest(
            "url-shortener",
            Json($$"""{"requestTypes":{"read":1},"note":"{{marker}}-scenario"}"""),
            new[] { new BoardEntity("text", "t1", Json($$"""{"id":"t1","content":"{{marker}}-annotation"}""")) }));
        var guest = await Connect();
        await guest.InvokeAsync<RoomJoinedMessage>("JoinByCode", created.JoinCode);
        await guest.InvokeAsync("ApplyBoardDiff", new BoardDiffMessage(0, new[]
        {
            new EntityChange("text", "t2", Json($$"""{"id":"t2","content":"{{marker}}-diff"}""")),
        }));
        await guest.InvokeAsync("MoveCursor", 1.5, 2.5);
        // A failure path too: error handling is where payloads leak.
        await Assert.ThrowsAsync<HubException>(() => guest.InvokeAsync<RoomJoinedMessage>("JoinByCode", marker));
        await Task.Delay(200);

        var logs = _factory.Logs.ToArray();
        Assert.NotEmpty(logs);
        var canonicalCode = created.JoinCode.Replace("-", "");
        foreach (var line in logs)
        {
            Assert.DoesNotContain(marker, line);
            Assert.DoesNotContain(created.JoinCode, line);
            Assert.DoesNotContain(canonicalCode, line);
            Assert.DoesNotContain(created.HostSecret, line);
        }
    }
}
