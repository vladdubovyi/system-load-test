using System.ComponentModel.DataAnnotations;

namespace SystemDesignSimulator.Api.DTOs;

public record RegisterRequest(
    [Required, EmailAddress] string Email,
    [Required, MinLength(8)] string Password,
    string? DisplayName);

public record LoginRequest(
    [Required, EmailAddress] string Email,
    [Required] string Password);

public record GoogleAuthRequest(
    [Required] string IdToken);

public record AuthResponse(
    string Token,
    DateTime ExpiresAt,
    UserResponse User);

public record UserResponse(
    string Id,
    string Email,
    string? DisplayName,
    string? AvatarUrl);
