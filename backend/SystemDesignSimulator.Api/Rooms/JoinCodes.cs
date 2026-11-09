using System.Security.Cryptography;
using System.Text;

namespace SystemDesignSimulator.Api.Rooms;

/// <summary>
/// Room credentials (docs/specs/interview-platform.md §3.2).
///
/// A join code is 8 characters of Crockford base-32 (40 bits), shown as
/// <c>K7QM-2XRD</c>. Decoding is forgiving so a code read aloud over a call
/// still works: case-insensitive, spaces and dashes ignored, <c>O→0</c> and
/// <c>I</c>/<c>L→1</c>. A host secret is 128 random bits, base64url; the
/// server keeps only its SHA-256.
/// </summary>
public static class JoinCodes
{
    /// <summary>Crockford's alphabet: digits and letters without I, L, O and U.</summary>
    public const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    public const int CodeLength = 8;

    public static string NewJoinCode()
    {
        Span<byte> bytes = stackalloc byte[CodeLength];
        RandomNumberGenerator.Fill(bytes);
        var chars = new char[CodeLength];
        for (var i = 0; i < CodeLength; i++)
        {
            chars[i] = Alphabet[bytes[i] & 0x1f];
        }
        return new string(chars);
    }

    /// <summary>The canonical 8-character code as people see it: <c>K7QM-2XRD</c>.</summary>
    public static string Format(string canonical) =>
        canonical.Length == CodeLength
            ? $"{canonical[..4]}-{canonical[4..]}"
            : canonical;

    /// <summary>
    /// Normalise user input to the canonical 8-character code, or null when it
    /// cannot be one. Accepts the displayed form, lowercase, stray spaces, and
    /// the look-alike letters Crockford maps.
    /// </summary>
    public static string? Normalize(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;

        var sb = new StringBuilder(CodeLength);
        foreach (var raw in input)
        {
            if (raw == ' ' || raw == '-' || raw == '\t' || raw == '\n' || raw == '\r') continue;
            var c = char.ToUpperInvariant(raw);
            c = c switch
            {
                'O' => '0',
                'I' or 'L' => '1',
                _ => c,
            };
            if (Alphabet.IndexOf(c) < 0) return null;
            if (sb.Length == CodeLength) return null;
            sb.Append(c);
        }
        return sb.Length == CodeLength ? sb.ToString() : null;
    }

    public static string NewHostSecret()
    {
        Span<byte> bytes = stackalloc byte[16];
        RandomNumberGenerator.Fill(bytes);
        return Base64Url(bytes);
    }

    /// <summary>What the server stores and indexes instead of the secret itself.</summary>
    public static string HashHostSecret(string secret)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(secret));
        return Convert.ToHexString(hash);
    }

    private static string Base64Url(ReadOnlySpan<byte> bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
