using Microsoft.AspNetCore.SignalR;

namespace SystemDesignSimulator.Api.Rooms;

/// <summary>
/// Sweeps expired rooms (docs/specs/interview-platform.md §3.4). A room that
/// ends while people are connected gets a <c>RoomEnded</c> message first so
/// the clients can say why.
/// </summary>
public sealed class RoomExpiryService : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    private readonly RoomRegistry _rooms;
    private readonly RoomGuards _guards;
    private readonly IHubContext<RoomHub> _hub;
    private readonly ILogger<RoomExpiryService> _log;

    public RoomExpiryService(RoomRegistry rooms, RoomGuards guards, IHubContext<RoomHub> hub, ILogger<RoomExpiryService> log)
    {
        _rooms = rooms;
        _guards = guards;
        _hub = hub;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                await SweepOnce(stoppingToken);
            }
        }
        catch (OperationCanceledException)
        {
            // Shutting down; rooms go with the process (§3.4).
        }
    }

    public async Task SweepOnce(CancellationToken cancellationToken = default)
    {
        foreach (var expired in _rooms.Sweep())
        {
            if (expired.Reason != "idle") continue;
            // Sweep() already detached the participants; tell their connections.
            await _hub.Clients.Group(expired.Room.Id).SendAsync("RoomEnded", new RoomEndedMessage("idle"), cancellationToken);
            foreach (var connectionId in expired.Connections)
            {
                _guards.Abort(connectionId);
            }
        }
        // Counts only: never a code, a secret or a payload (§7).
        _log.LogDebug("Room sweep complete; {Rooms} rooms live", _rooms.Count);
    }
}
