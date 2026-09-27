import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { AuthTokenPayload } from "../domain/types.js";
import { ForbiddenError, UnauthorizedError } from "../utils/errors.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthTokenPayload;
    }
  }
}

/** Verifies a JWT and returns its payload, or null if missing/invalid/expired.
 * Shared by HTTP auth and the WebSocket upgrade handshake. */
export function verifyToken(token: string | null | undefined): AuthTokenPayload | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
    return typeof payload.householdId === "string" ? payload : null;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("missing bearer token");
  }
  const payload = verifyToken(header.slice("Bearer ".length));
  if (!payload) throw new UnauthorizedError("invalid or expired token");
  req.auth = payload;
  next();
}

/** Owner-only access: the authenticated household may only read its own
 * private data (wallet, trade history, meter readings). */
export function assertSelf(req: Request, householdId: string): void {
  if (req.auth?.householdId !== householdId) {
    throw new ForbiddenError("you can only access your own household's data");
  }
}
