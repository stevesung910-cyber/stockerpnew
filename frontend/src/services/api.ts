export type ApiError = Error & { status: number; code: string };
const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";
export const apiUrl = (path: string) => `${baseUrl}${path}`;
const publicAuthPaths = new Set(["/auth/login", "/auth/register", "/auth/register/confirm", "/auth/register/resend", "/auth/verify-email/legacy-request", "/auth/forgot-password", "/auth/reset-password", "/auth/verify-email/confirm"]);

export function broadcastAuthSignal(type: "logout" | "company-switch") {
  if (typeof window === "undefined") return;
  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel("stockerp-auth");
    channel.postMessage({ type, at: Date.now() });
    channel.close();
  } else {
    const key = "stockerp-auth-signal";
    localStorage.setItem(key, JSON.stringify({ type, at: Date.now() }));
    localStorage.removeItem(key);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), { ...init, credentials: "include", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  if (response.status === 204) return undefined as T;
  const body = await response.json() as { data?: T; error?: { message?: string; code?: string } };
  if (response.status === 401 && !publicAuthPaths.has(path.split("?")[0]) && typeof window !== "undefined") window.dispatchEvent(new Event("stockerp:session-expired"));
  if (!response.ok) { const error = new Error(body.error?.message ?? "The request failed.") as ApiError; error.status = response.status; error.code = body.error?.code ?? "REQUEST_ERROR"; throw error; }
  return body.data as T;
}
export const send = <T>(path: string, payload?: unknown, method = "POST") => api<T>(path, { method, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
