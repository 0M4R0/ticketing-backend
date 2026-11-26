import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { Request } from "express";

const minute = 60 * 1000;
const quarterHour = 15 * minute;

/** Pure IP – use before auth */
export const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? "unknown");

/** User ID preferred, IP fallback – use after auth */
export const accountKey = (req: Request): string => {
  const userId = (req as any).user?.id;
  return userId
    ? `user:${userId}`
    : `ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
};

function createLimiter(
  windowMs: number,
  limit: number,
  message: string,
  keyGenerator: (req: Request) => string = accountKey,
) {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });
}

// ---------- Router-level IP protection (before auth) ----------
export const usersIpLimit = createLimiter(
  minute,
  100,
  "Too many requests from this IP.",
  ipKey,
);

// ---------- Per-endpoint (after auth) ----------
export const getCurrentUserLimit = createLimiter(
  minute,
  60,
  "Too many profile requests, please try again shortly.",
);

export const updateCurrentUserLimit = createLimiter(
  minute,
  20,
  "Too many profile update attempts, please try again shortly.",
);

export const getCurrentUserSessionsLimit = createLimiter(
  minute,
  30,
  "Too many session list requests, please try again shortly.",
);

export const revokeAllCurrentUserSessionsLimit = createLimiter(
  quarterHour,
  10,
  "Too many session revocation attempts, please try again later.",
);

export const revokeCurrentUserSessionLimit = createLimiter(
  quarterHour,
  20,
  "Too many session revocation attempts, please try again later.",
);

export const banUserLimit = createLimiter(
  quarterHour,
  10,
  "Too many user ban attempts, please try again later.",
);

export const unbanUserLimit = createLimiter(
  quarterHour,
  10,
  "Too many user unban attempts, please try again later.",
);
