import type { Request, Response, NextFunction } from "express";
import { ForbiddenError } from "../utils/errors";

type UserRole = "user" | "admin" | "organizador";

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ForbiddenError(
        "You don't have enough permission to perfom this action",
      );
    }

    next();
  };
}
