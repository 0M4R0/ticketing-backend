import type { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { env } from "../config/env";
import { db } from "../config/database";
import { UnauthorizedError } from "../utils/errors";

type UserRole = "user" | "admin" | "organizador";

type AuthRecord = {
  id: number;
  role: UserRole;
  session_id: number;
};

const VALID_ROLES = new Set<UserRole>(["user", "admin", "organizador"]);

export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return next(new UnauthorizedError("Authentication is required"));
  }
  const token = authorization.slice("Bearer ".length);

  let userId: number;
  let sessionId: number;

  // 1. Verify JWT
  try {
    const claims = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;

    // Validate claims
    if (
      typeof claims.sub !== "string" ||
      typeof claims.sessionId !== "number"
    ) {
      throw new Error("Invalid token claims");
    }

    userId = Number(claims.sub);
    sessionId = claims.sessionId;

    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0 ||
      !Number.isSafeInteger(sessionId) ||
      sessionId <= 0
    ) {
      throw new Error("Invalid token claims");
    }
  } catch {
    return next(new UnauthorizedError("Invalid access token"));
  }

  // 2. Verify user and session in database
  try {
    const auth = db
      .prepare(
        `
        SELECT
          u.id,
          u.role,
          u.status,
          s.id AS session_id
        FROM users u
        INNER JOIN user_sessions s
          ON s.user_id = u.id
        WHERE u.id = ?
          AND s.id = ?
          AND u.deleted_at IS NULL
          AND u.status = 'active'
          AND s.revoked_at IS NULL
          AND s.expires_at > ?
      `,
      )
      .get(userId, sessionId, new Date().toISOString()) as
      AuthRecord | undefined;

    if (!auth) {
      return next(new UnauthorizedError("Session is invalid or expired"));
    }

    // Validate db role
    if (!VALID_ROLES.has(auth.role)) {
      return next(new UnauthorizedError("Invalid user role"));
    }

    // 3. Attach fresh database information
    req.user = {
      id: auth.id,
      role: auth.role,
      sessionId: auth.session_id,
    };

    next();
  } catch (error) {
    next(error);
  }
}
