using SystemDesignSimulator.Api.Rooms;

namespace SystemDesignSimulator.Api.Tests;

/// <summary>Room credentials (docs/specs/interview-platform.md §3.2).</summary>
public class JoinCodeTests
{
    [Fact]
    public void Codes_are_eight_Crockford_characters_shown_with_a_dash()
    {
        for (var i = 0; i < 200; i++)
        {
            var code = JoinCodes.NewJoinCode();
            Assert.Equal(8, code.Length);
            Assert.All(code, c => Assert.Contains(c, JoinCodes.Alphabet));
            Assert.DoesNotContain(code, c => "ILOU".Contains(c));
            Assert.Matches("^[0-9A-Z]{4}-[0-9A-Z]{4}$", JoinCodes.Format(code));
        }
    }

    [Theory]
    [InlineData("K7QM-2XRD", "K7QM2XRD")]
    [InlineData("k7qm2xrd", "K7QM2XRD")]
    [InlineData("  k7qm 2xrd ", "K7QM2XRD")]
    [InlineData("K7QM-2XRD\n", "K7QM2XRD")]
    // Read aloud over a call: O for 0, I or L for 1.
    [InlineData("O1IL-ABCD", "0111ABCD")]
    [InlineData("o1il-abcd", "0111ABCD")]
    public void Normalize_is_forgiving_about_case_spacing_and_lookalikes(string input, string expected)
    {
        Assert.Equal(expected, JoinCodes.Normalize(input));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("K7QM-2XR")]       // too short
    [InlineData("K7QM-2XRDA")]     // too long
    [InlineData("K7QM-2XRU")]      // U is not in the alphabet
    [InlineData("K7QM_2XRD")]      // underscore is not a separator
    [InlineData("<script>")]
    public void Normalize_rejects_anything_that_is_not_a_code(string? input)
    {
        Assert.Null(JoinCodes.Normalize(input));
    }

    [Fact]
    public void Host_secrets_are_128_bit_base64url_and_only_their_hash_is_comparable()
    {
        var secret = JoinCodes.NewHostSecret();
        Assert.Equal(22, secret.Length);
        Assert.Matches("^[A-Za-z0-9_-]+$", secret);
        Assert.NotEqual(secret, JoinCodes.NewHostSecret());

        var hash = JoinCodes.HashHostSecret(secret);
        Assert.Equal(64, hash.Length);
        Assert.Equal(hash, JoinCodes.HashHostSecret(secret));
        Assert.DoesNotContain(secret, hash);
    }
}
