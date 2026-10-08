import type { ZodType, ZodTypeDef } from "zod";
import { ValidationError } from "../utils/errors.js";

/** Parses an untrusted request body against a schema, turning zod issues into
 * a single 400 ValidationError. Use `.strict()` schemas so unexpected fields
 * (e.g. a client-chosen balance) are rejected rather than silently passed on. */
export function parseBody<T>(schema: ZodType<T, ZodTypeDef, unknown>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const message = result.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    throw new ValidationError(message);
  }
  return result.data;
}

/** `?limit=` as an integer in [1, max]; missing or malformed values fall back to `fallback`. */
export function parseLimit(raw: unknown, fallback: number, max = 1000): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback;
}
