import type { Request, Response } from "express";
import { env } from "../../config/env";
import { UnauthorizedError } from "../../utils/errors";
import { login, logout, refresh, register } from "./auth.services";

const refreshCookieName = "refresh_token";
const refreshCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.NODE_ENV === "production",
  path: "/api/auth",
};

export async function registerController(
  req: Request,
  res: Response,
): Promise<void> {
  const user = await register(req.body);
  res.status(201).json({ user });
}

export async function loginController(
  req: Request,
  res: Response,
): Promise<void> {
  const result = await login(req.body, {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });

  res.cookie(refreshCookieName, result.refreshToken, refreshCookieOptions);
  res.json({ accessToken: result.accessToken, user: result.user });
}

export function refreshController(req: Request, res: Response): void {
  const refreshToken = req.cookies?.[refreshCookieName];
  if (!refreshToken) throw new UnauthorizedError("Refresh token is required");

  const result = refresh(refreshToken);
  res.cookie(refreshCookieName, result.refreshToken, refreshCookieOptions);
  res.json({ accessToken: result.accessToken });
}

export function logoutController(req: Request, res: Response): void {
  const refreshToken = req.cookies?.[refreshCookieName];
  if (!refreshToken) throw new UnauthorizedError("Refresh token is required");

  logout(refreshToken);
  res.clearCookie(refreshCookieName, refreshCookieOptions).status(204).end();
}
