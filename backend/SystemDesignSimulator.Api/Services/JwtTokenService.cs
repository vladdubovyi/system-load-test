using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using SystemDesignSimulator.Api.Models;

namespace SystemDesignSimulator.Api.Services;

public class JwtTokenService
{
    private readonly string _issuer;
    private readonly string _audience;
    private readonly SymmetricSecurityKey _signingKey;
    private readonly int _expiryMinutes;

    public JwtTokenService(IConfiguration configuration)
    {
        var secret = configuration["JWT_SECRET"]
            ?? configuration["Jwt:Secret"]
            ?? "dev-only-change-me-in-production-use-32-chars-min";

        _issuer = configuration["Jwt:Issuer"] ?? "SystemDesignSimulator";
        _audience = configuration["Jwt:Audience"] ?? "SystemDesignSimulator";
        _signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        _expiryMinutes = int.TryParse(configuration["Jwt:ExpiryMinutes"], out var mins) ? mins : 10080;
    }

    public (string Token, DateTime ExpiresAt) CreateToken(ApplicationUser user)
    {
        var expiresAt = DateTime.UtcNow.AddMinutes(_expiryMinutes);
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id),
            new(JwtRegisteredClaimNames.Email, user.Email ?? string.Empty),
            new(ClaimTypes.NameIdentifier, user.Id),
        };

        if (!string.IsNullOrWhiteSpace(user.DisplayName))
        {
            claims.Add(new Claim(ClaimTypes.Name, user.DisplayName));
            claims.Add(new Claim(JwtRegisteredClaimNames.Name, user.DisplayName));
        }

        var credentials = new SigningCredentials(_signingKey, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: _issuer,
            audience: _audience,
            claims: claims,
            expires: expiresAt,
            signingCredentials: credentials);

        return (new JwtSecurityTokenHandler().WriteToken(token), expiresAt);
    }
}
