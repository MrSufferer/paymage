import { NextRequest } from "next/server";
import { unauthorizedResponse } from "./response";

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function validateAuth(
  request: NextRequest,
): Promise<{ valid: boolean; userId?: string }> {
  const authHeader = request.headers.get("authorization");

  if (process.env.NODE_ENV === "development") {
    return { valid: true, userId: "dev-user" };
  }

  if (!authHeader?.startsWith("Bearer ")) {
    return { valid: false };
  }

  const token = authHeader.slice(7);

  return { valid: token.length >= 32, userId: `bearer:${token.slice(0, 8)}` };
}

export function requireAuth(handler: Function) {
  return async (request: NextRequest, context: unknown) => {
    const auth = await validateAuth(request);
    if (!auth.valid) {
      return unauthorizedResponse();
    }
    return handler(request, context, auth);
  };
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const requestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 100; // requests
const WINDOW_MS = 60_000; // per minute

export function checkRateLimit(identifier: string): {
  allowed: boolean;
  remaining: number;
} {
  const now = Date.now();
  const record = requestCounts.get(identifier);

  if (!record || now > record.resetAt) {
    requestCounts.set(identifier, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }

  if (record.count >= RATE_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT - record.count };
}
