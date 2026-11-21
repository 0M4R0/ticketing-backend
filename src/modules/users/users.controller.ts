import type { Request, Response } from "express";
import { UnauthorizedError } from "../../utils/errors";
import { getProfile, updateProfile } from "./users.services";

function authenticatedUserId(req: Request): string {
  if (!req.user) throw new UnauthorizedError("Authentication is required");
  return req.user.id;
}

export function getCurrentUserController(req: Request, res: Response): void {
  res.json({ user: getProfile(authenticatedUserId(req)) });
}

export function updateCurrentUserController(req: Request, res: Response): void {
  res.json({ user: updateProfile(authenticatedUserId(req), req.body) });
}
