import type { ErrorRequestHandler } from "express";
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error?.name === "ZodError") {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Check the submitted fields.", details: error.issues?.map((issue: { path: unknown[]; message: string }) => ({ path: issue.path, message: issue.message })) }, meta: { requestId: req.requestId } });
    return;
  }
  if (error?.code === "P2002") {
    res.status(409).json({ error: { code: "DUPLICATE_RECORD", message: "A record with those details already exists." }, meta: { requestId: req.requestId } });
    return;
  }
  if (error?.code === "P2003") {
    res.status(400).json({ error: { code: "INVALID_RELATIONSHIP", message: "One or more related records are missing or belong to another company." }, meta: { requestId: req.requestId } });
    return;
  }
  if (error?.code === "P2000") {
    res.status(400).json({ error: { code: "VALUE_TOO_LONG", message: "One or more submitted values exceed the allowed size." }, meta: { requestId: req.requestId } });
    return;
  }
  if (error?.code === "P2034") {
    res.status(409).json({ error: { code: "TRANSACTION_CONFLICT", message: "The record changed during this operation. Retry the request." }, meta: { requestId: req.requestId } });
    return;
  }
  if (error?.code === "P2025") {
    res.status(404).json({ error: { code: "RECORD_NOT_FOUND", message: "The requested record was not found." }, meta: { requestId: req.requestId } });
    return;
  }
  const status = typeof error?.status === "number" ? error.status : 500;
  const code = status === 500 ? "INTERNAL_ERROR" : typeof error?.code === "string" ? error.code : "REQUEST_ERROR";
  res.status(status).json({ error: { code, message: status === 500 ? "An unexpected error occurred." : error.message }, meta: { requestId: req.requestId } });
};
