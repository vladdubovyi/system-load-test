using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using SystemDesignSimulator.Api.Rooms;

namespace SystemDesignSimulator.Api.Tests;

/// <summary>Room settings (docs/specs/interview-platform.md §4): pen, who can run, seed, report release.</summary>
public class RoomSettingsTests : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly List<HubConnection> _connections = new();

    public RoomSettingsTests(ApiFactory factory) => _factory = factory;
    public Task InitializeAsync() => Task.CompletedTask;
    public async Task DisposeAsync() { foreach (var c in _connections) await c.DisposeAsync(); }

    private async Task<HubConnection> Connect()
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(_factory.Server.BaseAddress, "hubs/room"), o =>
            {
                o.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                o.Transports = HttpTransportType.LongPolling;
            })
            .Build();
        await connection.StartAsync();
        _connections.Add(connection);
        return connection;
    }

    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private static BoardEntity Component(string id) => new("component", id, Json($$"""{"id":"{{id}}","type":"redis","x":0,"y":0}"""));
    private static BoardDiffMessage Add(string id) => new(0, new[] { new EntityChange("component", id, Component(id).Value) });

    private static async Task<T> Within<T>(Task<T> task, string what)
    {
        var done = await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(10)));
        Assert.True(done == task, $"Timed out waiting for {what}");
        return await task;
    }

    private static TaskCompletionSource<T> Expect<T>(HubConnection c, string method)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        c.On<T>(method, m => tcs.TrySetResult(m));
        return tcs;
    }

    private async Task<(HubConnection host, HubConnection guest, RoomCreatedMessage created, RoomJoinedMessage joined)> RoomWithGuest()
    {
        var host = await Connect();
        var created = await host.InvokeAsync<RoomCreatedMessage>("CreateRoom", new CreateRoomRequest("url-shortener", null, new[] { Component("a") }));
        var guest = await Connect();
        var joined = await guest.InvokeAsync<RoomJoinedMessage>("JoinByCode", created.JoinCode);
        return (host, guest, created, joined);
    }

    [Fact]
    public async Task Defaults_are_open_shared_anyone()
    {
        var (_, _, _, joined) = await RoomWithGuest();
        Assert.Equal(new RoomSettings(), joined.Settings);
        Assert.Null(joined.PenHolder);
        Assert.False(joined.ReportReleased);
        Assert.True(joined.Settings.EffectiveLintVisible);
        Assert.Equal("everyone", joined.Settings.EffectiveReportVisibility);
    }

    [Fact]
    public async Task Interview_mode_flips_the_lint_and_report_defaults()
    {
        var s = new RoomSettings(Mode: "interview");
        Assert.False(s.EffectiveLintVisible);
        Assert.Equal("hostOnly", s.EffectiveReportVisibility);
        Assert.True((s with { LintVisible = true }).EffectiveLintVisible);
    }

    [Fact]
    public async Task Single_pen_lets_only_the_holder_edit_and_the_host_hands_it_over()
    {
        var (host, guest, _, _) = await RoomWithGuest();
        var changedAtGuest = Expect<SettingsChangedMessage>(guest, "SettingsChanged");

        await host.InvokeAsync("UpdateSettings", new RoomSettings(Pen: "single"));
        var changed = await Within(changedAtGuest.Task, "SettingsChanged");
        Assert.Equal("single", changed.Settings.Pen);
        Assert.Equal(host.ConnectionId, changed.PenHolder);

        var denied = await Assert.ThrowsAsync<HubException>(() => guest.InvokeAsync("ApplyBoardDiff", Add("b")));
        Assert.Contains("holds the pen", denied.Message);
        await host.InvokeAsync("ApplyBoardDiff", Add("c"));

        // Participants can ask; the host sees who.
        var requested = Expect<PenRequestedMessage>(host, "PenRequested");
        await guest.InvokeAsync("RequestPen");
        Assert.Equal(guest.ConnectionId, (await Within(requested.Task, "PenRequested")).ConnectionId);

        var penAtGuest = Expect<PenChangedMessage>(guest, "PenChanged");
        await host.InvokeAsync("AssignPen", guest.ConnectionId);
        Assert.Equal(guest.ConnectionId, (await Within(penAtGuest.Task, "PenChanged")).PenHolder);
        await guest.InvokeAsync("ApplyBoardDiff", Add("d"));
        var hostDenied = await Assert.ThrowsAsync<HubException>(() => host.InvokeAsync("ApplyBoardDiff", Add("e")));
        Assert.Contains("holds the pen", hostDenied.Message);

        var notHost = await Assert.ThrowsAsync<HubException>(() => guest.InvokeAsync("AssignPen", guest.ConnectionId));
        Assert.Contains(RoomHub.HostOnlyMessage, notHost.Message);
    }

    [Fact]
    public async Task The_pen_returns_to_the_host_when_its_holder_disconnects()
    {
        var (host, guest, _, _) = await RoomWithGuest();
        await host.InvokeAsync("UpdateSettings", new RoomSettings(Pen: "single"));
        await host.InvokeAsync("AssignPen", guest.ConnectionId);
        var back = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        host.On<PenChangedMessage>("PenChanged", m => { if (m.PenHolder == host.ConnectionId) back.TrySetResult(m.PenHolder); });

        await guest.StopAsync();

        Assert.Equal(host.ConnectionId, await Within(back.Task, "pen back at host"));
    }

    [Fact]
    public async Task Host_only_runs_block_participants_from_starting_steering_and_traffic()
    {
        var (host, guest, _, _) = await RoomWithGuest();
        await host.InvokeAsync("UpdateSettings", new RoomSettings(WhoCanRun: "hostOnly"));

        var start = await Assert.ThrowsAsync<HubException>(() => guest.InvokeAsync("StartRun", (int?)null));
        Assert.Contains(RoomRegistry.HostRunsMessage, start.Message);
        var traffic = await Assert.ThrowsAsync<HubException>(() => guest.InvokeAsync("SetTrafficOverride", Json("""{"baseRps":1}""")));
        Assert.Contains(RoomRegistry.HostRunsMessage, traffic.Message);

        await host.InvokeAsync("StartRun", (int?)null);
        var evt = await Assert.ThrowsAsync<HubException>(() => guest.InvokeAsync("SendRunEvent", "pause", (JsonElement?)null));
        Assert.Contains(RoomRegistry.HostRunsMessage, evt.Message);
        await host.InvokeAsync("SendRunEvent", "pause", (JsonElement?)null);
    }

    [Fact]
    public async Task A_pinned_seed_wins_over_whatever_the_requester_asks_for()
    {
        var (host, guest, _, _) = await RoomWithGuest();
        await host.InvokeAsync("UpdateSettings", new RoomSettings(Seed: 99));
        var started = Expect<RunStartedMessage>(guest, "RunStarted");
        await guest.InvokeAsync("StartRun", (int?)12345);
        Assert.Equal(99, (await Within(started.Task, "RunStarted")).Seed);
    }

    [Fact]
    public async Task Report_release_is_per_run_and_host_only()
    {
        var (host, guest, _, _) = await RoomWithGuest();
        await host.InvokeAsync("UpdateSettings", new RoomSettings(ReportVisibility: "hostOnly"));
        await host.InvokeAsync("StartRun", (int?)1);
        await host.InvokeAsync("EndRun", "finished");

        var denied = await Assert.ThrowsAsync<HubException>(() => guest.InvokeAsync("ReleaseReport"));
        Assert.Contains(RoomHub.HostOnlyMessage, denied.Message);

        var released = Expect<JsonElement>(guest, "ReportReleased");
        await host.InvokeAsync("ReleaseReport");
        await Within(released.Task, "ReportReleased");

        var late = await Connect();
        var code = await host.InvokeAsync<string>("RotateJoinCode");
        Assert.True((await late.InvokeAsync<RoomJoinedMessage>("JoinByCode", code)).ReportReleased);

        await host.InvokeAsync("StartRun", (int?)2);
        var code2 = await host.InvokeAsync<string>("RotateJoinCode");
        var later = await Connect();
        Assert.False((await later.InvokeAsync<RoomJoinedMessage>("JoinByCode", code2)).ReportReleased);
    }

    [Fact]
    public async Task Invalid_settings_are_refused()
    {
        var (host, _, _, _) = await RoomWithGuest();
        var e = await Assert.ThrowsAsync<HubException>(() => host.InvokeAsync("UpdateSettings", new RoomSettings(Mode: "exam")));
        Assert.Contains(RoomRegistry.BadSettingsMessage, e.Message);
    }
}
