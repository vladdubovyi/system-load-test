export interface UserResponse {
  id: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: UserResponse;
}
