import bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";

import { db } from "../../config/database";
import { env } from "../../config/env";
import { AppError, UnauthorizedError } from "../../utils/errors";

import type { LoginInput, RegisterInput } from "./auth.schema";

const BCRYPT_ROUNDS = 10;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

type UserRole = "user" | "admin" | "organizador";
type UserStatus = "active" | "banned";

type UserRecord = {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
};

type LoginMeta = {
  ip?: string;
  userAgent?: string;
  deviceName?: string;
};

type RefreshSession = {
  id: number;
  user_id: number;
  role: UserRole;
};

// Keep one bcrypt comparison for unknown email addresses too.
const dummyPasswordHash = bcrypt.hash(
  "not-a-real-user-password",
  BCRYPT_ROUNDS,
);

function now(): string {
  return new Date().toISOString();
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createRefreshToken(): string {
  return randomBytes(48).toString("hex");
}

// Limit the length of text fields to prevent database errors and potential abuse.
function limitText(
  value: string | undefined,
  maxLength: number,
): string | null {
  return value?.slice(0, maxLength) ?? null;
}

export function createAccessToken(
  user: Pick<UserRecord, "id" | "role">,
  sessionId: number,
): string {
  return jwt.sign(
    {
      role: user.role,
      sessionId,
    },
    env.JWT_ACCESS_SECRET,
    {
      subject: String(user.id),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    },
  );
}

export async function register(input: RegisterInput) {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  try {
    const result = db
      .prepare(
        `
        INSERT INTO users (name, email, password_hash, phone)
        VALUES (?, ?, ?, ?)
      `,
      )
      .run(input.name, input.email, passwordHash, input.phone ?? null);

    return {
      id: Number(result.lastInsertRowid),
      name: input.name,
      email: input.email,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "SQLITE_CONSTRAINT_UNIQUE" &&
      error.message.includes("users.email")
    ) {
      throw new AppError(409, "An account with this email already exists");
    }

    throw error;
  }
}

export async function login(input: LoginInput, meta: LoginMeta = {}) {
  const user = db
    .prepare(
      `
      SELECT id, name, email, password_hash, role, status
      FROM users
      WHERE email COLLATE NOCASE = ?
        AND deleted_at IS NULL
    `,
    )
    .get(input.email) as UserRecord | undefined;

  const passwordHash = user ? user.password_hash : await dummyPasswordHash;

  const passwordMatches = await bcrypt.compare(input.password, passwordHash);

  if (!user || !passwordMatches) {
    throw new UnauthorizedError("Invalid email or password");
  }

  if (user.status === "banned") {
    throw new AppError(403, "Account is banned");
  }

  const refreshToken = createRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);

  const createdAt = now();

  const expiresAt = new Date(
    Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Keep session creation and last-login update atomic.
  const createSession = db.transaction(() => {
    const result = db
      .prepare(
        `
        INSERT INTO user_sessions (
          user_id,
          refresh_token_hash,
          ip_address,
          user_agent,
          device_name,
          expires_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        user.id,
        refreshTokenHash,
        limitText(meta.ip, 45),
        limitText(meta.userAgent, 500),
        limitText(meta.deviceName, 100),
        expiresAt,
      );

    db.prepare(
      `
      UPDATE users
      SET last_login_at = ?, updated_at = ?
      WHERE id = ?
    `,
    ).run(createdAt, createdAt, user.id);

    return Number(result.lastInsertRowid);
  });

  const sessionId = createSession.immediate();

  return {
    accessToken: createAccessToken(user, sessionId),
    refreshToken,
    user: {
      name: user.name,
      email: user.email,
    },
  };
}

export function refresh(refreshToken: string | undefined) {
  if (!refreshToken) {
    throw new UnauthorizedError("Invalid refresh token");
  }

  const oldTokenHash = hashRefreshToken(refreshToken);
  const checkedAt = now();

  // A transaction prevents concurrent requests from rotating one token twice.
  const rotateSession = db.transaction(() => {
    const session = db
      .prepare(
        `
        SELECT s.id, s.user_id, u.role
        FROM user_sessions AS s
        INNER JOIN users AS u ON u.id = s.user_id
        WHERE s.refresh_token_hash = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > ?
          AND u.status = 'active'
          AND u.deleted_at IS NULL
      `,
      )
      .get(oldTokenHash, checkedAt) as RefreshSession | undefined;

    if (!session) {
      throw new UnauthorizedError("Invalid refresh token");
    }

    const nextRefreshToken = createRefreshToken();
    const nextTokenHash = hashRefreshToken(nextRefreshToken);

    const result = db
      .prepare(
        `
        UPDATE user_sessions
        SET refresh_token_hash = ?, last_used_at = ?
        WHERE id = ?
          AND refresh_token_hash = ?
          AND revoked_at IS NULL
          AND expires_at > ?
      `,
      )
      .run(nextTokenHash, checkedAt, session.id, oldTokenHash, checkedAt);

    if (result.changes !== 1) {
      throw new UnauthorizedError("Invalid refresh token");
    }

    return {
      userId: session.user_id,
      role: session.role,
      sessionId: session.id,
      refreshToken: nextRefreshToken,
    };
  });

  const rotated = rotateSession.immediate();

  return {
    accessToken: createAccessToken(
      { id: rotated.userId, role: rotated.role },
      rotated.sessionId,
    ),
    refreshToken: rotated.refreshToken,
  };
}

export function logout(refreshToken: string | undefined): void {
  if (!refreshToken) return;

  db.prepare(
    `
    UPDATE user_sessions
    SET revoked_at = ?
    WHERE refresh_token_hash = ?
      AND revoked_at IS NULL
  `,
  ).run(now(), hashRefreshToken(refreshToken));
}
