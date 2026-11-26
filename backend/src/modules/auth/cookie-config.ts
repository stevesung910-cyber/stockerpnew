import type { CookieOptions } from "express";
import { appEnvironment } from "../../config/env";

export function sessionCookieOptionsFor(environment = appEnvironment(), nodeEnvironment = process.env.NODE_ENV): CookieOptions {
  const localHttp = (environment === "development" && nodeEnvironment === "development") || (environment === "test" && nodeEnvironment === "test");
  return { httpOnly: true, secure: !localHttp, sameSite: "lax", path: "/api/v1", maxAge: 8 * 60 * 60 * 1000 };
}

export const sessionCookieOptions = sessionCookieOptionsFor();
