import type { Response } from "express";
import { prisma } from "../../database/prisma";
import { accountEligibility } from "./account-eligibility";
import { newOpaqueToken, tokenDigest } from "./password";
import { sessionCookieOptions } from "./cookie-config";
export { sessionCookieOptions, sessionCookieOptionsFor } from "./cookie-config";
export const SESSION_COOKIE = "stockerp_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export async function createSession(userId: string) {
  const token = newOpaqueToken(); const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || !accountEligibility(user)) throw new Error("Account is ineligible for a session.");
    return tx.authSession.create({ data: { tokenHash: tokenDigest(token), userId, expiresAt } });
  });
  return { token, session };
}
export function setSessionCookie(res: Response, token: string) { res.cookie(SESSION_COOKIE, token, sessionCookieOptions); }
export function clearSessionCookie(res: Response) { const { maxAge: _maxAge, ...options } = sessionCookieOptions; res.clearCookie(SESSION_COOKIE, options); }
export function readCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) { const separator = part.indexOf("="); if (separator < 0 || part.slice(0, separator).trim() !== name) continue; try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return undefined; } }
  return undefined;
}
