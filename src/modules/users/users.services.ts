import { db } from "../../config/database";
import { NotFoundError } from "../../utils/errors";
import type { UpdateProfileInput } from "./users.schema";

type Profile = {
  name: string;
  email: string;
  phone: string | null;
  createdAt: string;
};

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  bannedAt: string | null;
  banReason: string | null;
};

function findAdminUser(userId: string): AdminUser | undefined {
  const row = db
    .prepare(
      `
    SELECT id, name, email, role, status, banned_at, ban_reason
    FROM users
    WHERE id = ? AND deleted_at IS NULL
  `,
    )
    .get(userId) as
    | {
        id: string;
        name: string;
        email: string;
        role: string;
        status: string;
        banned_at: string | null;
        ban_reason: string | null;
      }
    | undefined;
  return (
    row && {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      status: row.status,
      bannedAt: row.banned_at,
      banReason: row.ban_reason,
    }
  );
}

export function banUser(userId: string, reason?: string): AdminUser {
  const ban = db.transaction(() => {
    const exists = db
      .prepare("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL")
      .get(userId);
    if (!exists) throw new NotFoundError("User not found");
    const bannedAt = new Date().toISOString();
    db.prepare(
      "UPDATE users SET status = 'banned', banned_at = ?, ban_reason = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    ).run(bannedAt, reason ?? null, bannedAt, userId);
    db.prepare(
      "UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
    ).run(bannedAt, userId);
  });
  ban();
  const user = findAdminUser(userId);
  if (!user) throw new NotFoundError("User not found");
  return user;
}

export function unbanUser(userId: string): AdminUser {
  const result = db
    .prepare(
      `
    UPDATE users SET status = 'active', banned_at = NULL, ban_reason = NULL, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
  `,
    )
    .run(new Date().toISOString(), userId);
  if (!result.changes) throw new NotFoundError("User not found");
  const user = findAdminUser(userId);
  if (!user) throw new NotFoundError("User not found");
  return user;
}

function findProfile(userId: string): Profile | undefined {
  const row = db
    .prepare(
      `
      SELECT name, email, phone, created_at
      FROM users
      WHERE id = ?
        AND deleted_at IS NULL
    `,
    )
    .get(userId) as
    | { name: string; email: string; phone: string | null; created_at: string }
    | undefined;

  if (!row) return undefined;
  return {
    name: row.name,
    email: row.email,
    phone: row.phone,
    createdAt: row.created_at,
  };
}

export function getProfile(userId: string): Profile {
  const profile = findProfile(userId);
  if (!profile) throw new NotFoundError("User not found");
  return profile;
}

export function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Profile {
  const assignments: string[] = [];
  const values: (string | null)[] = [];

  if (input.name !== undefined) {
    assignments.push("name = ?");
    values.push(input.name);
  }
  if (input.phone !== undefined) {
    assignments.push("phone = ?");
    values.push(input.phone);
  }

  assignments.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(userId);

  const result = db
    .prepare(
      `UPDATE users SET ${assignments.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(...values);

  if (result.changes === 0) throw new NotFoundError("User not found");
  return getProfile(userId);
}
