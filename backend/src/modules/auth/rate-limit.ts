import type { RequestHandler } from "express";

type WindowState = { startedAt: number; count: number };
export type RateLimitDecision = { allowed: boolean; retryAfterSeconds: number };

/** Implementations must atomically increment a key within its time window. */
export interface RateLimitStore {
  consume(key: string, max: number, windowMs: number, now?: number): Promise<RateLimitDecision>;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly attempts = new Map<string, WindowState>();
  async consume(key: string, max: number, windowMs: number, now = Date.now()): Promise<RateLimitDecision> {
    const state = this.attempts.get(key);
    if (state && now - state.startedAt < windowMs && state.count >= max) return { allowed: false, retryAfterSeconds: Math.ceil((windowMs - (now - state.startedAt)) / 1000) };
    if (!state || now - state.startedAt >= windowMs) this.attempts.set(key, { startedAt: now, count: 1 });
    else state.count += 1;
    if (this.attempts.size > 10_000) for (const [item, value] of this.attempts) if (now - value.startedAt >= windowMs) this.attempts.delete(item);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

// A shared atomic store can be injected by deployment code without changing route contracts.
let rateLimitStore: RateLimitStore = new InMemoryRateLimitStore();
export function configureRateLimitStore(store: RateLimitStore) { rateLimitStore = store; }

const authWindowMs = 15 * 60 * 1000;
type Limit = { key: string; max: number; windowMs: number };

function limitRequests(limits: (req: Parameters<RequestHandler>[0]) => Limit[]): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      for (const item of limits(req)) {
        const decision = await rateLimitStore.consume(item.key, item.max, item.windowMs);
        if (!decision.allowed) {
          res.setHeader("Retry-After", String(decision.retryAfterSeconds));
          res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." }, meta: { requestId: req.requestId } });
          return;
        }
      }
      next();
    })().catch(next);
  };
}

export const authRateLimit = limitRequests(req => {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const email = typeof req.body?.email === "string" ? req.body.email.slice(0, 254).trim().toLowerCase() : "";
  return [
    { key: `auth:ip:${ip}`, max: 60, windowMs: authWindowMs },
    ...(email ? [{ key: `auth:identity:${ip}:${email}`, max: 12, windowMs: authWindowMs }] : []),
  ];
});

export function registrationRateLimit(operation: "register" | "confirm" | "resend") {
  return limitRequests(req => [{
    key: `registration:${operation}:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`,
    max: operation === "confirm" ? 30 : 10,
    windowMs: authWindowMs,
  }]);
}

export async function allowRegistrationNotification() {
  return (await rateLimitStore.consume("registration:owner-notifications", 120, 60 * 60 * 1000)).allowed;
}

/** Process-local by default; inject a shared RateLimitStore before multi-instance deployment. */
export const companyCreationRateLimit: RequestHandler = (req, res, next) => {
  const key = `company-create:${req.auth?.userId ?? "anonymous"}:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
  void rateLimitStore.consume(key, 5, 60 * 60 * 1000).then(decision => {
    if (!decision.allowed) {
      res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many company creation attempts. Try again later." }, meta: { requestId: req.requestId } }); return;
    }
    next();
  }).catch(next);
};
