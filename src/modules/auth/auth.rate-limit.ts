import { rateLimit } from "express-rate-limit";

export const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,

  standardHeaders: true,
  legacyHeaders: false,

  message: {
    error: "Too many registration attempts, please try again later.",
  },
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,

  standardHeaders: true,
  legacyHeaders: false,

  message: {
    error: "Too many login attempts, please try again later.",
  },
});

export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,

  standardHeaders: true,
  legacyHeaders: false,

  message: {
    error: "Too many refresh attempts, please try again later.",
  },
});

export const logoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,

  standardHeaders: true,
  legacyHeaders: false,

  message: {
    error: "Too many logout attempts, please try again later.",
  },
});
