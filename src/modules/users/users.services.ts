import { db } from "../../config/database";
import { NotFoundError } from "../../utils/errors";
import type { UpdateProfileInput } from "./users.schema";

type Profile = {
  name: string;
  email: string;
  phone: string | null;
  createdAt: string;
};

function findProfile(userId: number): Profile | undefined {
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

export function getProfile(userId: number): Profile {
  const profile = findProfile(userId);
  if (!profile) throw new NotFoundError("User not found");
  return profile;
}

export function updateProfile(
  userId: number,
  input: UpdateProfileInput,
): Profile {
  const assignments: string[] = [];
  const values: (string | null | number)[] = [];

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
