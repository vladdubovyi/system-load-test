using System.Security.Claims;
using Google.Apis.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using SystemDesignSimulator.Api.DTOs;
using SystemDesignSimulator.Api.Models;
using SystemDesignSimulator.Api.Services;

namespace SystemDesignSimulator.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly SignInManager<ApplicationUser> _signInManager;
    private readonly JwtTokenService _jwtTokenService;
    private readonly IConfiguration _configuration;
    private readonly ILogger<AuthController> _logger;

    public AuthController(
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager,
        JwtTokenService jwtTokenService,
        IConfiguration configuration,
        ILogger<AuthController> logger)
    {
        _userManager = userManager;
        _signInManager = signInManager;
        _jwtTokenService = jwtTokenService;
        _configuration = configuration;
        _logger = logger;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request)
    {
        var existing = await _userManager.FindByEmailAsync(request.Email);
        if (existing != null)
        {
            return Conflict(new { error = "An account with this email already exists." });
        }

        var user = new ApplicationUser
        {
            UserName = request.Email,
            Email = request.Email,
            DisplayName = string.IsNullOrWhiteSpace(request.DisplayName)
                ? request.Email.Split('@')[0]
                : request.DisplayName.Trim(),
            EmailConfirmed = true,
        };

        var result = await _userManager.CreateAsync(user, request.Password);
        if (!result.Succeeded)
        {
            return BadRequest(new { error = string.Join(" ", result.Errors.Select(e => e.Description)) });
        }

        return Ok(CreateAuthResponse(user));
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        var user = await _userManager.FindByEmailAsync(request.Email);
        if (user == null)
        {
            return Unauthorized(new { error = "Invalid email or password." });
        }

        var result = await _signInManager.CheckPasswordSignInAsync(user, request.Password, lockoutOnFailure: true);
        if (!result.Succeeded)
        {
            return Unauthorized(new { error = "Invalid email or password." });
        }

        return Ok(CreateAuthResponse(user));
    }

    [HttpPost("google")]
    public async Task<IActionResult> GoogleLogin([FromBody] GoogleAuthRequest request)
    {
        var clientId = _configuration["Google:ClientId"] ?? Environment.GetEnvironmentVariable("GOOGLE_CLIENT_ID");
        if (string.IsNullOrWhiteSpace(clientId))
        {
            return StatusCode(503, new { error = "Google sign-in is not configured on the server." });
        }

        GoogleJsonWebSignature.Payload payload;
        try
        {
            payload = await GoogleJsonWebSignature.ValidateAsync(request.IdToken, new GoogleJsonWebSignature.ValidationSettings
            {
                Audience = new[] { clientId },
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Google token validation failed");
            return Unauthorized(new { error = "Invalid Google sign-in token." });
        }

        if (string.IsNullOrWhiteSpace(payload.Email))
        {
            return BadRequest(new { error = "Google account did not provide an email address." });
        }

        var user = await _userManager.FindByEmailAsync(payload.Email);
        if (user == null)
        {
            user = new ApplicationUser
            {
                UserName = payload.Email,
                Email = payload.Email,
                DisplayName = payload.Name ?? payload.GivenName ?? payload.Email.Split('@')[0],
                AvatarUrl = payload.Picture,
                EmailConfirmed = payload.EmailVerified,
            };

            var createResult = await _userManager.CreateAsync(user);
            if (!createResult.Succeeded)
            {
                return BadRequest(new { error = string.Join(" ", createResult.Errors.Select(e => e.Description)) });
            }
        }
        else
        {
            var updated = false;
            if (string.IsNullOrWhiteSpace(user.DisplayName) && !string.IsNullOrWhiteSpace(payload.Name))
            {
                user.DisplayName = payload.Name;
                updated = true;
            }

            if (string.IsNullOrWhiteSpace(user.AvatarUrl) && !string.IsNullOrWhiteSpace(payload.Picture))
            {
                user.AvatarUrl = payload.Picture;
                updated = true;
            }

            if (updated)
            {
                await _userManager.UpdateAsync(user);
            }
        }

        var loginInfo = new UserLoginInfo("Google", payload.Subject, "Google");
        var linkedLogins = await _userManager.GetLoginsAsync(user);
        if (!linkedLogins.Any(l => l.LoginProvider == loginInfo.LoginProvider && l.ProviderKey == loginInfo.ProviderKey))
        {
            await _userManager.AddLoginAsync(user, loginInfo);
        }

        return Ok(CreateAuthResponse(user));
    }

    [Authorize]
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId))
        {
            return Unauthorized();
        }

        var user = await _userManager.FindByIdAsync(userId);
        if (user == null)
        {
            return NotFound();
        }

        return Ok(ToUserResponse(user));
    }

    private AuthResponse CreateAuthResponse(ApplicationUser user)
    {
        var (token, expiresAt) = _jwtTokenService.CreateToken(user);
        return new AuthResponse(token, expiresAt, ToUserResponse(user));
    }

    private static UserResponse ToUserResponse(ApplicationUser user) =>
        new(user.Id, user.Email ?? string.Empty, user.DisplayName, user.AvatarUrl);
}
