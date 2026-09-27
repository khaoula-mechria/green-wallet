import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors.js";

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: `No route: ${req.method} ${req.path}` } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
    return;
  }
  // Client errors raised by express.json() (malformed JSON, oversized body).
  const status = (err as { status?: number; type?: string }).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    const code = status === 413 ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR";
    const message = status === 413 ? "request body too large" : "malformed request body";
    res.status(status).json({ success: false, error: { code, message } });
    return;
  }
  console.error("[unhandled error]", err);
  res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
}

/** Wraps an async route handler so rejected promises reach errorHandler. */
export function asyncRoute<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
