namespace SystemDesignSimulator.Api.Rooms;

/// <summary>
/// Operational limits (docs/specs/interview-platform.md §3.4, §7). There are
/// no accounts, so everything is per IP, per connection or per process.
/// </summary>
public static class RoomLimits
{
    /// <summary>A room with nobody connected is kept this long (§3.4).</summary>
    public static readonly TimeSpan EmptyRoomGrace = TimeSpan.FromMinutes(30);

    /// <summary>A room with connections but no activity is ended after this (§3.4).</summary>
    public static readonly TimeSpan IdleRoomTimeout = TimeSpan.FromHours(12);

    /// <summary>Room creation above this count returns "try again later" (§7).</summary>
    public const int MaxRoomsPerProcess = 500;

    /// <summary>Per-IP sliding window for room creation.</summary>
    public const int RoomCreationsPerHourPerIp = 20;

    /// <summary>Per-IP sliding window for unknown codes and wrong host secrets.</summary>
    public const int FailedJoinsPer10MinutesPerIp = 20;

    /// <summary>Process-wide cap on failed joins, against a distributed guesser.</summary>
    public const int FailedJoinsPerMinuteProcessWide = 300;

    /// <summary>Largest diff a connection may send, in UTF-8 bytes of its JSON.</summary>
    public const int MaxDiffBytes = 256 * 1024;

    /// <summary>Largest board a room may hold, in UTF-8 bytes of its JSON.</summary>
    public const int MaxBoardBytes = 2 * 1024 * 1024;

    /// <summary>Most entities (components, belts, configs, texts, strokes) in one board.</summary>
    public const int MaxEntitiesPerBoard = 5000;

    /// <summary>Board diffs a single connection may send per second.</summary>
    public const int DiffsPerSecondPerConnection = 30;

    /// <summary>Cursor updates a single connection may send per second.</summary>
    public const int CursorsPerSecondPerConnection = 30;
}
