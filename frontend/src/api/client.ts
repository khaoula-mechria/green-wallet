const TOKEN_KEY = "green-wallet-token";
const HOUSEHOLD_KEY = "green-wallet-household-id";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredHouseholdId(): string | null {
  return localStorage.getItem(HOUSEHOLD_KEY);
}

export function setSession(token: string, householdId: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(HOUSEHOLD_KEY, householdId);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(HOUSEHOLD_KEY);
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
  }
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });
  const body = (await res.json()) as ApiEnvelope<T>;

  if (!res.ok || !body.success) {
    throw new ApiError(body.error?.message ?? "Request failed", res.status, body.error?.code ?? "UNKNOWN");
  }
  return body.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
};
