import { db } from "../../../config/database";
import { NotFoundError } from "../../../utils/errors";

type UserSessionRow = {
  id: number;
  ip_address: string | null;
  user_agent: string | null;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
};

export type UserSession = {
  id: number;
  ipAddress: string | null;
  userAgent: string | null;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  isCurrentDevice: boolean;
};

export function getActiveSessions(
  userId: number,
  currentSessionId: number,
): UserSession[] {
  const rows = db
    .prepare(
      `
      SELECT id, ip_address, user_agent, device_name, created_at,
             last_used_at, expires_at
      FROM user_sessions
      WHERE user_id = ?
        AND revoked_at IS NULL
        AND expires_at > ?
      ORDER BY created_at DESC, id DESC
    `,
    )
    .all(userId, new Date().toISOString()) as UserSessionRow[];

  return rows.map((row) => ({
    id: row.id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    deviceName: row.device_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    isCurrentDevice: row.id === currentSessionId,
  }));
}

export function revokeSession(userId: number, sessionId: number): void {
  const result = db
    .prepare(
      `
      UPDATE user_sessions
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND user_id = ?
        AND revoked_at IS NULL
    `,
    )
    .run(sessionId, userId);

  if (result.changes === 0) throw new NotFoundError("Session not found");
}

export function revokeAllSessions(userId: number): void {
  db.prepare(
    `
    UPDATE user_sessions
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
      AND revoked_at IS NULL
  `,
  ).run(userId);
}
