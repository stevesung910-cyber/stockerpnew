import "./config/env";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { healthRouter } from "./modules/health/health.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { companiesRouter } from "./modules/companies/companies.routes";
import { inventoryRouter } from "./modules/inventory/inventory.routes";
import { errorHandler } from "./middleware/error-handler";
import { configureRateLimitStore } from "./modules/auth/rate-limit";
import { PostgresRateLimitStore } from "./modules/auth/postgres-rate-limit";
import { csrfGuard } from "./middleware/csrf";
import { gmailConfiguration } from "./modules/google-gmail/gmail-config";
import { createGmailRouter } from "./modules/google-gmail/gmail.routes";
import { gmailApi } from "./modules/google-gmail/google-client";

if (gmailConfiguration()) gmailApi();

configureRateLimitStore(new PostgresRateLimitStore());

export const app = express();
app.disable("x-powered-by");
const trustedProxies = process.env.TRUSTED_PROXY_NETWORKS?.split(",").map(value => value.trim()).filter(Boolean);
if (trustedProxies?.length) app.set("trust proxy", trustedProxies);
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173", credentials: true }));
app.use((req, _res, next) => { req.requestId = randomUUID(); next(); });
app.use(express.json({ limit: "1mb" }));
app.use(csrfGuard);
app.get("/api/v1", (_req, res) => res.json({ data: { service: "StockERP API", version: "v1" } }));
app.use("/api/v1/health", healthRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/companies", companiesRouter);
app.use("/api/v1/integrations/google-gmail", createGmailRouter());
app.use("/api/v1", inventoryRouter);
app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "The requested endpoint was not found." } }));
app.use(errorHandler);
