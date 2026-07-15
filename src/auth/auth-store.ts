import type { UserResponse } from './types';

const TOKEN_KEY = 'sds_auth_token';
const USER_KEY = 'sds_auth_user';

type AuthListener = () => void;

let currentUser: UserResponse | null = loadStoredUser();
const listeners = new Set<AuthListener>();

function loadStoredUser(): UserResponse | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserResponse;
  } catch {
    return null;
  }
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getCurrentUser(): UserResponse | null {
  return currentUser;
}

export function isAuthenticated(): boolean {
  return Boolean(getAuthToken() && currentUser);
}

export function setAuthSession(token: string, user: UserResponse): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  currentUser = user;
  listeners.forEach((listener) => listener());
}

export function clearAuthSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  currentUser = null;
  listeners.forEach((listener) => listener());
}

export function subscribeAuth(listener: AuthListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function restoreAuthSession(fetchMe: () => Promise<UserResponse>): Promise<void> {
  if (!getAuthToken()) return;
  try {
    const user = await fetchMe();
    currentUser = user;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    listeners.forEach((listener) => listener());
  } catch {
    clearAuthSession();
  }
}
