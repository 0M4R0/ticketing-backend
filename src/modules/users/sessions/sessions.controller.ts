import type { Request, Response } from "express";
import { UnauthorizedError } from "../../../utils/errors";
import {
  getActiveSessions,
  revokeAllSessions,
  revokeSession,
} from "./sessions.services";

function authenticatedUserId(req: Request): number {
  if (!req.user) throw new UnauthorizedError("Authentication is required");
  return req.user.id;
}

export function getCurrentUserSessionsController(
  req: Request,
  res: Response,
): void {
  if (!req.user) throw new UnauthorizedError("Authentication is required");
  res.json({ sessions: getActiveSessions(req.user.id, req.user.sessionId) });
}

export function revokeCurrentUserSessionController(
  req: Request,
  res: Response,
): void {
  revokeSession(authenticatedUserId(req), Number(req.params.sessionId));
  res.status(204).end();
}

export function revokeAllCurrentUserSessionsController(
  req: Request,
  res: Response,
): void {
  revokeAllSessions(authenticatedUserId(req));
  res.status(204).end();
}
