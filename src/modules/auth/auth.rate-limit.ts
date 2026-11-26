import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

const ipKey = (req: Request): string => ipKeyGenerator(req.ip ?? "unknown");

function createLimiter(
  windowMs: number,
  limit: number,
  message: string,
  keyGenerator: (req: Request) => string = ipKey, // default = IP
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

const minute = 60 * 1000;
const quarterHour = 15 * minute;

export const registerLimiter = createLimiter(
  quarterHour,
  5,
  "Too many registration attempts, please try again later.",
);

export const loginLimiter = createLimiter(
  quarterHour,
  5,
  "Too many login attempts, please try again later.",
);

export const refreshLimiter = createLimiter(
  quarterHour,
  30, // or whatever you want
  "Too many refresh attempts, please try again later.",
);

export const logoutLimiter = createLimiter(
  quarterHour,
  10,
  "Too many logout attempts, please try again later.",
);
