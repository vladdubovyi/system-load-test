using System.Collections.Concurrent;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.SignalR;

namespace SystemDesignSimulator.Api.Rooms;

/// <summary>
/// Abuse limits for the hub (docs/specs/interview-platform.md §7), built on
/// the framework's <see cref="System.Threading.RateLimiting"/> primitives.
/// Hub invocations are not HTTP requests, so the rate-limiting middleware
/// cannot see them; the hub asks here instead. Also keeps the caller context
/// per connection so the server can disconnect a stale host (§3.2).
/// </summary>
public sealed class RoomGuards : IDisposable
{
    public const string TooManyAttemptsMessage = "Too many attempts. Wait a few minutes and try again.";

    private readonly PartitionedRateLimiter<string> _creationsPerIp;
    private readonly PartitionedRateLimiter<string> _failedJoinsPerIp;
    private readonly SlidingWindowRateLimiter _failedJoinsProcessWide;
    private readonly ConcurrentDictionary<string, ConnectionGuard> _connections = new();

    public RoomGuards()
    {
        _creationsPerIp = PartitionedRateLimiter.Create<string, string>(ip =>
            RateLimitPartition.GetSlidingWindowLimiter(ip, _ => new SlidingWindowRateLimiterOptions
            {
                PermitLimit = RoomLimits.RoomCreationsPerHourPerIp,
                Window = TimeSpan.FromHours(1),
                SegmentsPerWindow = 6,
                QueueLimit = 0,
                AutoReplenishment = true,
            }));
        _failedJoinsPerIp = PartitionedRateLimiter.Create<string, string>(ip =>
            RateLimitPartition.GetSlidingWindowLimiter(ip, _ => new SlidingWindowRateLimiterOptions
            {
                PermitLimit = RoomLimits.FailedJoinsPer10MinutesPerIp,
                Window = TimeSpan.FromMinutes(10),
                SegmentsPerWindow = 10,
                QueueLimit = 0,
                AutoReplenishment = true,
            }));
        _failedJoinsProcessWide = new SlidingWindowRateLimiter(new SlidingWindowRateLimiterOptions
        {
            PermitLimit = RoomLimits.FailedJoinsPerMinuteProcessWide,
            Window = TimeSpan.FromMinutes(1),
            SegmentsPerWindow = 6,
            QueueLimit = 0,
            AutoReplenishment = true,
        });
    }

    public bool AllowRoomCreation(string ip)
    {
        using var lease = _creationsPerIp.AttemptAcquire(ip);
        return lease.IsAcquired;
    }

    /// <summary>True while this IP (and the process as a whole) may still attempt joins.</summary>
    public bool JoinAttemptsAllowed(string ip)
    {
        var perIp = _failedJoinsPerIp.GetStatistics(ip)?.CurrentAvailablePermits ?? 1;
        var global = _failedJoinsProcessWide.GetStatistics()?.CurrentAvailablePermits ?? 1;
        return perIp > 0 && global > 0;
    }

    public void RecordFailedJoin(string ip)
    {
        _failedJoinsPerIp.AttemptAcquire(ip).Dispose();
        _failedJoinsProcessWide.AttemptAcquire().Dispose();
    }

    public void Track(HubCallerContext context)
    {
        _connections[context.ConnectionId] = new ConnectionGuard(context);
    }

    public void Forget(string connectionId)
    {
        if (_connections.TryRemove(connectionId, out var guard)) guard.Dispose();
    }

    public bool AllowDiff(string connectionId) => _connections.GetValueOrDefault(connectionId)?.AllowDiff() ?? false;

    public bool AllowCursor(string connectionId) => _connections.GetValueOrDefault(connectionId)?.AllowCursor() ?? false;

    public void Abort(string connectionId) => _connections.GetValueOrDefault(connectionId)?.Context.Abort();

    public void Dispose()
    {
        _creationsPerIp.Dispose();
        _failedJoinsPerIp.Dispose();
        _failedJoinsProcessWide.Dispose();
        foreach (var guard in _connections.Values) guard.Dispose();
    }

    private sealed class ConnectionGuard : IDisposable
    {
        public HubCallerContext Context { get; }
        private readonly TokenBucketRateLimiter _diffs;
        private readonly TokenBucketRateLimiter _cursors;

        public ConnectionGuard(HubCallerContext context)
        {
            Context = context;
            _diffs = Bucket(RoomLimits.DiffsPerSecondPerConnection);
            _cursors = Bucket(RoomLimits.CursorsPerSecondPerConnection);
        }

        public bool AllowDiff()
        {
            using var lease = _diffs.AttemptAcquire();
            return lease.IsAcquired;
        }

        public bool AllowCursor()
        {
            using var lease = _cursors.AttemptAcquire();
            return lease.IsAcquired;
        }

        private static TokenBucketRateLimiter Bucket(int perSecond) => new(new TokenBucketRateLimiterOptions
        {
            TokenLimit = perSecond * 2,
            TokensPerPeriod = perSecond,
            ReplenishmentPeriod = TimeSpan.FromSeconds(1),
            QueueLimit = 0,
            AutoReplenishment = true,
        });

        public void Dispose()
        {
            _diffs.Dispose();
            _cursors.Dispose();
        }
    }
}
