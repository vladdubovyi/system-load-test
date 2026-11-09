using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using SystemDesignSimulator.Api.Rooms;

namespace SystemDesignSimulator.Api.Tests;

/// <summary>
/// Runs in rooms (docs/specs/interview-platform.md §4.4): the server fixes
/// seed and board version, names a controller, relays the controller's clock
/// and the control events, locks the board, and hands the clock to a host
/// when the controller drops.
/// </summary>
public class RoomRunTests : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly List<HubConnection> _connections = new();

    public RoomRunTests(ApiFactory factory) => _factory = factory;

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

    private static BoardEntity Component(string id) =>
        new("component", id, Json($$"""{"id":"{{id}}","type":"redis","x":0,"y":0}"""));

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

    private async Task<(HubConnection host, HubConnection guest, RoomCreatedMessage created)> RoomWithGuest()
    {
        var host = await Connect();
        var created = await host.InvokeAsync<RoomCreatedMessage>("CreateRoom", new CreateRoomRequest("url-shortener", null, new[] { Component("a") }));
        var guest = await Connect();
        await guest.InvokeAsync<RoomJoinedMessage>("JoinByCode", created.JoinCode);
        return (host, guest, created);
    }

    [Fact]
    public async Task Starting_a_run_fixes_seed_and_version_names_the_controller_and_locks_the_board()
    {
        var (host, guest, _) = await RoomWithGuest();
        var atHost = Expect<RunStartedMessage>(host, "RunStarted");
        var atGuest = Expect<RunStartedMessage>(guest, "RunStarted");

        await guest.InvokeAsync("StartRun", (int?)4242);

        var h = await Within(atHost.Task, "RunStarted at host");
        var g = await Within(atGuest.Task, "RunStarted at guest");
        Assert.Equal(4242, h.Seed);
        Assert.Equal(h, g);
        Assert.Equal(guest.ConnectionId, h.ControllerConnectionId);
        Assert.Equal(0, h.BoardVersion);

        var locked = await Assert.ThrowsAsync<HubException>(() =>
            host.InvokeAsync("ApplyBoardDiff", new BoardDiffMessage(0, new[] { new EntityChange("component", "b", Component("b").Value) })));
        Assert.Contains(RoomRegistry.BoardLockedMessage, locked.Message);

        var again = await Assert.ThrowsAsync<HubException>(() => host.InvokeAsync("StartRun", (int?)null));
        Assert.Contains(RoomRegistry.RunInProgressMessage, again.Message);

        // Only the controller ends it; afterwards the board is editable again.
        var notController = await Assert.ThrowsAsync<HubException>(() => host.InvokeAsync("EndRun", "finished"));
        Assert.Contains(RoomRegistry.NotControllerMessage, notController.Message);
        var ended = Expect<RunEndedMessage>(host, "RunEnded");
        await guest.InvokeAsync("EndRun", "finished");
        Assert.Equal("finished", (await Within(ended.Task, "RunEnded")).Reason);
        await host.InvokeAsync("ApplyBoardDiff", new BoardDiffMessage(0, new[] { new EntityChange("component", "b", Component("b").Value) }));
    }

    [Fact]
    public async Task A_fresh_seed_is_drawn_when_none_is_given()
    {
        var (host, _, _) = await RoomWithGuest();
        var started = Expect<RunStartedMessage>(host, "RunStarted");
        await host.InvokeAsync("StartRun", (int?)null);
        Assert.True((await Within(started.Task, "RunStarted")).Seed > 0);
    }

    [Fact]
    public async Task The_controllers_ticks_reach_the_others_and_events_are_relayed_for_stamping()
    {
        var (host, guest, _) = await RoomWithGuest();
        await host.InvokeAsync("StartRun", (int?)7);

        var tickAtGuest = Expect<RunTickMessage>(guest, "RunTick");
        var eventAtHost = Expect<RunEventMessage>(host, "RunEvent");
        var eventAtGuest = Expect<RunEventMessage>(guest, "RunEvent");

        // The guest asks to pause; the server relays it unstamped to everyone.
        await guest.InvokeAsync("SendRunEvent", "pause", (JsonElement?)null);
        var e1 = await Within(eventAtHost.Task, "RunEvent at host");
        var e2 = await Within(eventAtGuest.Task, "RunEvent at guest");
        Assert.Equal(1, e1.Seq);
        Assert.Equal("pause", e1.Kind);
        Assert.Null(e1.ApplyAtTick);
        Assert.Equal(guest.ConnectionId, e1.From);
        Assert.Equal(e1, e2);

        // Only the controller reports the clock.
        var denied = await Assert.ThrowsAsync<HubException>(() =>
            guest.InvokeAsync("ReportTick", new RunTickMessage(10, Array.Empty<TickStamp>())));
        Assert.Contains(RoomRegistry.NotControllerMessage, denied.Message);

        await host.InvokeAsync("ReportTick", new RunTickMessage(120, new[] { new TickStamp(1, 135) }));
        var tick = await Within(tickAtGuest.Task, "RunTick at guest");
        Assert.Equal(120, tick.Tick);
        Assert.Equal(135, Assert.Single(tick.Stamps).ApplyAtTick);

        // A late joiner receives the run with the stamped event and the last tick.
        var late = await Connect();
        var created = await host.InvokeAsync<string>("RotateJoinCode"); // just to get a code the test knows
        var joined = await late.InvokeAsync<RoomJoinedMessage>("JoinByCode", created);
        Assert.NotNull(joined.Run);
        Assert.Equal(7, joined.Run!.Seed);
        Assert.Equal(120, joined.Run.LastTick);
        Assert.Equal(host.ConnectionId, joined.Run.ControllerConnectionId);
        var evt = Assert.Single(joined.Run.Events);
        Assert.Equal(135, evt.ApplyAtTick);

        var bogus = await Assert.ThrowsAsync<HubException>(() => guest.InvokeAsync("SendRunEvent", "format-disk", (JsonElement?)null));
        Assert.Contains("not a run event", bogus.Message);
    }

    [Fact]
    public async Task When_the_controller_leaves_a_host_takes_over_the_clock()
    {
        var (host, guest, _) = await RoomWithGuest();
        await guest.InvokeAsync("StartRun", (int?)1);
        await guest.InvokeAsync("ReportTick", new RunTickMessage(300, Array.Empty<TickStamp>()));
        var changed = Expect<RunControllerChangedMessage>(host, "RunControllerChanged");

        await guest.StopAsync();

        var msg = await Within(changed.Task, "RunControllerChanged");
        Assert.Equal(host.ConnectionId, msg.ControllerConnectionId);
        Assert.Equal(300, msg.LastTick);
        // The host is now allowed to report and to end the run.
        await host.InvokeAsync("ReportTick", new RunTickMessage(330, Array.Empty<TickStamp>()));
        await host.InvokeAsync("EndRun", "finished");
    }

    [Fact]
    public async Task When_the_controller_leaves_and_no_host_is_connected_the_run_is_interrupted()
    {
        var host = await Connect();
        var created = await host.InvokeAsync<RoomCreatedMessage>("CreateRoom", new CreateRoomRequest("url-shortener", null, new[] { Component("a") }));
        var guestA = await Connect();
        await guestA.InvokeAsync<RoomJoinedMessage>("JoinByCode", created.JoinCode);
        var guestB = await Connect();
        await guestB.InvokeAsync<RoomJoinedMessage>("JoinByCode", created.JoinCode);
        await host.InvokeAsync("LeaveRoom");

        await guestA.InvokeAsync("StartRun", (int?)3);
        var ended = Expect<RunEndedMessage>(guestB, "RunEnded");

        await guestA.StopAsync();

        Assert.Equal("interrupted", (await Within(ended.Task, "RunEnded")).Reason);
        // The board is unlocked again.
        await guestB.InvokeAsync("ApplyBoardDiff", new BoardDiffMessage(0, new[] { new EntityChange("component", "b", Component("b").Value) }));
    }

    [Fact]
    public async Task Traffic_profiles_are_shared_between_runs_and_frozen_during_one()
    {
        var (host, guest, _) = await RoomWithGuest();
        var atHost = Expect<JsonElement>(host, "TrafficChanged");

        await guest.InvokeAsync("SetTrafficOverride", Json("""{"baseRps":500,"pattern":"constant"}"""));
        var msg = await Within(atHost.Task, "TrafficChanged");
        Assert.Equal(500, msg.GetProperty("trafficOverride").GetProperty("baseRps").GetInt32());

        var late = await Connect();
        var code = await host.InvokeAsync<string>("RotateJoinCode");
        var joined = await late.InvokeAsync<RoomJoinedMessage>("JoinByCode", code);
        Assert.Equal(500, joined.TrafficOverride!.Value.GetProperty("baseRps").GetInt32());

        await host.InvokeAsync("StartRun", (int?)1);
        var locked = await Assert.ThrowsAsync<HubException>(() => guest.InvokeAsync("SetTrafficOverride", (JsonElement?)null));
        Assert.Contains(RoomRegistry.BoardLockedMessage, locked.Message);
    }
}
