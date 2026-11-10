using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using SystemDesignSimulator.Api.Rooms;

namespace SystemDesignSimulator.Api.Tests;

/// <summary>
/// Interview mode (docs/specs/interview-platform.md §6): the server projects
/// the scenario by role. Participants in interview mode never receive flows,
/// objectives, scoring weights or the scenario slug outside the opaque
/// run-time flow bundle (§6.2), and the lint toggle is what sends flows
/// (§6.3). These are guard tests in the spirit of §2.5: they fail when a
/// payload starts leaking.
/// </summary>
public class RoomInterviewTests : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly List<HubConnection> _connections = new();

    public RoomInterviewTests(ApiFactory factory) => _factory = factory;
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

    private static BoardEntity Component(string id) =>
        new("component", id, Json($$"""{"id":"{{id}}","type":"redis","x":0,"y":0}"""));

    /// <summary>An authored override with every field a scenario document can carry.</summary>
    private static JsonElement FullOverride() => Json("""
        {
          "requestTypes": { "read": 0.5, "create": 0.5 },
          "tags": [{ "id": "write-service", "label": "Write service" }],
          "flows": [{ "kind": "read", "steps": [{ "id": "s", "require": { "capability": "compute" } }] }],
          "objectives": { "maxViolationRate": 0 },
          "failureScenarios": [{ "id": "db", "label": "Database outage", "atSeconds": 3, "target": { "capability": "durable-store" }, "type": "shutdown", "durationSeconds": 10 }],
          "trafficPhases": [{ "atSeconds": 0, "baseRps": 40 }, { "atSeconds": 30, "baseRps": 600 }]
        }
        """);

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

    private async Task<(HubConnection host, RoomCreatedMessage created)> HostedRoom(JsonElement? scenarioOverride = null)
    {
        var host = await Connect();
        var created = await host.InvokeAsync<RoomCreatedMessage>(
            "CreateRoom",
            new CreateRoomRequest("url-shortener", scenarioOverride, new[] { Component("a") }));
        return (host, created);
    }

    private static bool Has(JsonElement? doc, string property) =>
        doc is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(property, out var v)
        && v.ValueKind is not JsonValueKind.Null;

    [Fact]
    public async Task Open_mode_participants_get_the_full_scenario()
    {
        var (_, created) = await HostedRoom(FullOverride());
        var guest = await Connect();
        var joined = await guest.InvokeAsync<RoomJoinedMessage>("JoinByCode", created.JoinCode);

        Assert.Equal("url-shortener", joined.ScenarioSlug);
        Assert.Null(joined.Challenge);
        Assert.True(Has(joined.ScenarioOverride, "flows"));
        Assert.True(Has(joined.ScenarioOverride, "objectives"));
    }

    [Fact]
    public async Task Interview_participants_get_the_whitelist_and_nothing_that_identifies_or_scores()
    {
        var (host, created) = await HostedRoom(FullOverride());
        await host.InvokeAsync("UpdateSettings", new RoomSettings(Mode: "interview"));
        var guest = await Connect();
        var joined = await guest.InvokeAsync<RoomJoinedMessage>("JoinByCode", created.JoinCode);

        Assert.Null(joined.ScenarioSlug);

        // The stripped catalog entry keeps what §6.1 lists…
        var challenge = joined.Challenge;
        Assert.True(Has(challenge, "name"));
        Assert.True(Has(challenge, "description"));
        Assert.True(Has(challenge, "allowedComponents"));
        var scenario = challenge!.Value.GetProperty("scenario");
        Assert.True(scenario.GetProperty("durationSeconds").GetInt32() > 0);
        var config = scenario.GetProperty("scenarioConfig");
        Assert.True(Has(config, "requirements"));
        Assert.True(Has(config, "requestTypes"));
        // …and nothing else: no identity, no flows, no objectives, no weights.
        Assert.Equal("", challenge.Value.GetProperty("slug").GetString());
        Assert.Equal("", challenge.Value.GetProperty("id").GetString());
        Assert.False(challenge.Value.TryGetProperty("overviewContent", out _));
        Assert.False(Has(config, "flows"));
        Assert.False(Has(config, "objectives"));
        Assert.False(challenge.Value.TryGetProperty("videoUrl", out _));
        Assert.False(scenario.TryGetProperty("scoringWeights", out _));

        // The override keeps request mix, tags and the public depth data
        // (scripted phases, traffic timeline — product-directions §3.3),
        // loses flows and objectives.
        Assert.True(Has(joined.ScenarioOverride, "requestTypes"));
        Assert.True(Has(joined.ScenarioOverride, "tags"));
        Assert.True(Has(joined.ScenarioOverride, "failureScenarios"));
        Assert.True(Has(joined.ScenarioOverride, "trafficPhases"));
        Assert.False(Has(joined.ScenarioOverride, "flows"));
        Assert.False(Has(joined.ScenarioOverride, "objectives"));

        // The host still sees everything: its own ScenarioChanged carries the
        // slug and the unstripped override.
        var hostScenario = Expect<ScenarioChangedMessage>(host, "ScenarioChanged");
        await host.InvokeAsync("SetScenarioOverride", (JsonElement?)FullOverride());
        var hostView = await Within(hostScenario.Task, "host ScenarioChanged");
        Assert.Equal("url-shortener", hostView.ScenarioSlug);
        Assert.True(Has(hostView.ScenarioOverride, "flows"));
        Assert.True(Has(hostView.ScenarioOverride, "objectives"));
    }

    [Fact]
    public async Task Applying_an_override_in_interview_mode_sends_each_role_its_projection()
    {
        var (host, created) = await HostedRoom();
        await host.InvokeAsync("UpdateSettings", new RoomSettings(Mode: "interview"));
        var guest = await Connect();
        await guest.InvokeAsync<RoomJoinedMessage>("JoinByCode", created.JoinCode);

        var atGuest = Expect<ScenarioChangedMessage>(guest, "ScenarioChanged");
        var atHost = Expect<ScenarioChangedMessage>(host, "ScenarioChanged");
        await host.InvokeAsync("SetScenarioOverride", (JsonElement?)FullOverride());

        var guestView = await Within(atGuest.Task, "guest ScenarioChanged");
        Assert.Null(guestView.ScenarioSlug);
        Assert.True(Has(guestView.ScenarioOverride, "requestTypes"));
        Assert.False(Has(guestView.ScenarioOverride, "flows"));
        Assert.False(Has(guestView.ScenarioOverride, "objectives"));

        var hostView = await Within(atHost.Task, "host ScenarioChanged");
        Assert.Equal("url-shortener", hostView.ScenarioSlug);
        Assert.True(Has(hostView.ScenarioOverride, "flows"));
    }

    [Fact]
    public async Task Mode_switches_reproject_participants_both_ways()
    {
        var (host, created) = await HostedRoom(FullOverride());
        var guest = await Connect();
        await guest.InvokeAsync<RoomJoinedMessage>("JoinByCode", created.JoinCode);

        var stripped = Expect<ScenarioChangedMessage>(guest, "ScenarioChanged");
        await host.InvokeAsync("UpdateSettings", new RoomSettings(Mode: "interview"));
        var strippedView = await Within(stripped.Task, "stripped re-projection");
        Assert.Null(strippedView.ScenarioSlug);
        Assert.False(Has(strippedView.ScenarioOverride, "flows"));
        Assert.True(Has(strippedView.Challenge, "name"));

        var revealed = Expect<ScenarioChangedMessage>(guest, "ScenarioChanged");
        await host.InvokeAsync("UpdateSettings", new RoomSettings(Mode: "open"));
        var revealedView = await Within(revealed.Task, "revealing re-projection");
        Assert.Equal("url-shortener", revealedView.ScenarioSlug);
        Assert.Null(revealedView.Challenge);
        Assert.True(Has(revealedView.ScenarioOverride, "flows"));
        Assert.True(Has(revealedView.ScenarioOverride, "objectives"));
    }

    [Fact]
    public async Task Turning_the_lint_on_sends_participants_the_flows_but_never_the_objectives()
    {
        var (host, created) = await HostedRoom();
        await host.InvokeAsync("UpdateSettings", new RoomSettings(Mode: "interview"));
        var guest = await Connect();
        var joined = await guest.InvokeAsync<RoomJoinedMessage>("JoinByCode", created.JoinCode);
        Assert.False(Has(joined.Challenge!.Value.GetProperty("scenario").GetProperty("scenarioConfig"), "flows"));

        var reprojected = Expect<ScenarioChangedMessage>(guest, "ScenarioChanged");
        await host.InvokeAsync("UpdateSettings", new RoomSettings(Mode: "interview", LintVisible: true));
        var view = await Within(reprojected.Task, "lint-on re-projection");
        var config = view.Challenge!.Value.GetProperty("scenario").GetProperty("scenarioConfig");
        Assert.True(Has(config, "flows"));
        Assert.False(Has(config, "objectives"));
    }

    [Fact]
    public async Task Runs_carry_the_opaque_flow_bundle_to_interview_participants_only()
    {
        var (host, created) = await HostedRoom();
        var guest = await Connect();
        await guest.InvokeAsync<RoomJoinedMessage>("JoinByCode", created.JoinCode);

        // Open mode: nobody needs a bundle.
        var openAtGuest = Expect<RunStartedMessage>(guest, "RunStarted");
        await host.InvokeAsync("StartRun", (int?)1);
        Assert.Null((await Within(openAtGuest.Task, "open RunStarted")).Flows);
        await host.InvokeAsync("EndRun", "stopped");

        await host.InvokeAsync("UpdateSettings", new RoomSettings(Mode: "interview"));
        var atGuest = Expect<RunStartedMessage>(guest, "RunStarted");
        var atHost = Expect<RunStartedMessage>(host, "RunStarted");
        await host.InvokeAsync("StartRun", (int?)2);

        var guestStart = await Within(atGuest.Task, "interview RunStarted at guest");
        Assert.NotNull(guestStart.Flows);
        Assert.Equal(JsonValueKind.Array, guestStart.Flows!.Value.ValueKind);
        Assert.True(guestStart.Flows.Value.GetArrayLength() > 0);
        Assert.Null((await Within(atHost.Task, "interview RunStarted at host")).Flows);

        // A participant joining mid-run gets the bundle with the run state.
        var code = await host.InvokeAsync<string>("RotateJoinCode");
        var late = await Connect();
        var lateJoin = await late.InvokeAsync<RoomJoinedMessage>("JoinByCode", code);
        Assert.NotNull(lateJoin.Run);
        Assert.NotNull(lateJoin.Run!.Flows);
        Assert.Null(lateJoin.ScenarioSlug);
    }

    [Fact]
    public async Task The_bundle_prefers_the_override_flows_over_the_catalog()
    {
        var (host, created) = await HostedRoom(FullOverride());
        await host.InvokeAsync("UpdateSettings", new RoomSettings(Mode: "interview"));
        var guest = await Connect();
        await guest.InvokeAsync<RoomJoinedMessage>("JoinByCode", created.JoinCode);

        var atGuest = Expect<RunStartedMessage>(guest, "RunStarted");
        await host.InvokeAsync("StartRun", (int?)3);
        var flows = (await Within(atGuest.Task, "RunStarted")).Flows;
        Assert.NotNull(flows);
        // FullOverride defines exactly one flow; the catalog has two.
        Assert.Equal(1, flows!.Value.GetArrayLength());
    }
}
