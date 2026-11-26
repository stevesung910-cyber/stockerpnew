import type { RequestHandler } from "express";
import { readCookie, SESSION_COOKIE } from "../modules/auth/session";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
export const csrfGuard: RequestHandler = (req, res, next) => {
  if (safeMethods.has(req.method) || !readCookie(req.headers.cookie, SESSION_COOKIE)) { next(); return; }
  const origin = req.get("origin");
  if (!origin || origin !== (process.env.FRONTEND_ORIGIN ?? "http://localhost:5173")) {
    res.status(403).json({ error: { code: "ORIGIN_REJECTED", message: "Request origin is not allowed." }, meta: { requestId: req.requestId } }); return;
  }
  next();
};
