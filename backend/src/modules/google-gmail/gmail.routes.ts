import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware";
import { gmailConfiguration, GMAIL_SETTINGS_PATH, isGmailOwner } from "./gmail-config";
import { GmailIntegration } from "./gmail-service";
import { GmailFailure } from "./google-client";

export function createGmailRouter() {
  const router = Router();
  router.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    if (req.method === "HEAD") { res.sendStatus(405); return; }
    if ((process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") && !req.secure) {
      res.status(400).json({ error: { code: "HTTPS_REQUIRED", message: "Gmail settings require HTTPS." } });
      return;
    }
    next();
  }, requireAuth, (req, res, next) => {
    if (!isGmailOwner(req.auth)) {
      res.status(403).json({ error: { code: "SOFTWARE_OWNER_REQUIRED", message: "Software owner access is required." } });
      return;
    }
    next();
  });

  router.get("/status", async (_req, res, next) => {
    try {
      const config = gmailConfiguration();
      const status = config ? await new GmailIntegration(config).status()
        : { enabled: false, senderEmail: null, status: "DISABLED", lastSuccessfulSendAt: null, lastError: null };
      res.json({ data: status });
    } catch (error) { next(error); }
  });

  router.post("/connect", async (req, res, next) => {
    if (req.get("sec-fetch-site") === "cross-site") {
      res.status(403).json({ error: { code: "ORIGIN_REJECTED", message: "Start Gmail authorization from StockERP settings." } });
      return;
    }
    try {
      const config = gmailConfiguration();
      if (!config) {
        res.status(503).json({ error: { code: "GMAIL_DISABLED", message: "Gmail integration is disabled." } });
        return;
      }
      const authorizationUrl = await new GmailIntegration(config).connect(req.auth!.sessionId);
      res.json({ data: { authorizationUrl } });
    } catch (failure) {
      if (failure instanceof GmailFailure) {
        res.status(409).json({ error: { code: failure.code, message: "Disconnect the current Gmail connection before connecting." } });
      } else next(failure);
    }
  });

  router.get("/callback", async (req, res, next) => {
    try {
      const config = gmailConfiguration();
      if (!config) { res.sendStatus(503); return; }
      const target = new URL(GMAIL_SETTINGS_PATH, config.frontendOrigin);
      try {
        await new GmailIntegration(config).callback(req.auth!.sessionId, req.query);
        target.searchParams.set("result", "connected");
      } catch (failure) {
        const result = failure instanceof GmailFailure ? failure.code : "CALLBACK_FAILED";
        target.searchParams.set("result", result);
      }
      res.redirect(303, target.toString());
    } catch (failure) { next(failure); }
  });

  router.post("/disconnect", async (_req, res, next) => {
    try {
      const config = gmailConfiguration();
      if (!config) { res.sendStatus(503); return; }
      await new GmailIntegration(config).disconnect();
      res.status(204).end();
    } catch (failure) {
      if (failure instanceof GmailFailure) {
        if (failure.code === "DISCONNECT_IN_PROGRESS" || failure.code === "CONNECTION_CHANGED") {
          res.status(409).json({ error: { code: failure.code, message: "The Gmail connection is changing. Check its status before retrying." } });
          return;
        }
        res.status(502).json({ error: { code: failure.code, message: "Sending is disabled. Retry disconnect to finish Google revocation." } });
      } else next(failure);
    }
  });
  return router;
}
