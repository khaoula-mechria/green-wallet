import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { AuthTokenPayload } from "../domain/types.js";
import { UnauthorizedError } from "../utils/errors.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthTokenPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("missing bearer token");
  }
  const token = header.slice("Bearer ".length);
  try {
    req.auth = jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
    next();
  } catch {
    throw new UnauthorizedError("invalid or expired token");
  }
}
