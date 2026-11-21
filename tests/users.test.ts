import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const testDirectory = mkdtempSync(path.join(os.tmpdir(), "ticketing-users-"));

let db: typeof import("../src/config/database").db;
let closeDatabase: typeof import("../src/config/database").closeDatabase;
let createApp: typeof import("../src/app").createApp;
let createAccessToken: typeof import("../src/modules/auth/auth.services").createAccessToken;
let server: import("node:http").Server;
let baseUrl: string;
let sessionsUrl: string;

function createAuthenticatedSession(email: string, role: "user" | "admin" = "user") {
  const userId = randomUUID();
  const inserted = db
    .prepare(
      `INSERT INTO users (id, name, email, password_hash, role, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
    )
    .run(userId, "Session Test", email, "test-password-hash", role);
  const sessionId = randomUUID();
  const refreshTokenHash = `refresh-hash-${email}`;
  const session = db
    .prepare(
      `INSERT INTO user_sessions (
         id, user_id, refresh_token_hash, ip_address, user_agent, device_name, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      userId,
      refreshTokenHash,
      "127.0.0.1",
      "Test Agent",
      "Test Device",
      new Date(Date.now() + 60 * 60_000).toISOString(),
    );
  const token = createAccessToken({ id: userId, role }, sessionId);
  return {
    userId,
    sessionId,
    refreshTokenHash,
    token,
    headers: { authorization: `Bearer ${token}` },
  };
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.PORT = "10000";
  process.env.CLIENT_URL = "http://localhost:3000";
  process.env.DB_PATH = path.join(testDirectory, "users.test.db");
  process.env.JWT_ACCESS_SECRET = "users-module-test-secret-at-least-32-chars";
  process.env.ACCESS_TOKEN_TTL = "15m";
  process.env.REFRESH_TOKEN_TTL_DAYS = "30";
  process.env.ORDER_TTL_MINUTES = "15";

  ({ db, closeDatabase } = await import("../src/config/database"));
  ({ createApp } = await import("../src/app"));
  ({ createAccessToken } = await import("../src/modules/auth/auth.services"));
  const migration = readFileSync(
    path.join(process.cwd(), "migrations", "001_init.sql"),
    "utf8",
  );
  db.exec(migration);
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}/api/v1/users/me`;
  sessionsUrl = `${baseUrl}/sessions`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  closeDatabase();
  rmSync(testDirectory, { recursive: true, force: true });
});

test("authenticated users can read and update only their own profile", async () => {
  const userId = randomUUID();
  const inserted = db
    .prepare(
      `INSERT INTO users (id, name, email, password_hash, phone, role, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, "Before Name", "profile@example.com", "secret-hash", "111", "user", "active");
  const sessionId = randomUUID();
  const session = db
    .prepare(
      `INSERT INTO user_sessions (id, user_id, refresh_token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(sessionId, userId, "test-refresh-hash", new Date(Date.now() + 60_000).toISOString());
  const token = createAccessToken(
    { id: userId, role: "user" },
    sessionId,
  );
  const headers = { authorization: `Bearer ${token}` };

  const profileResponse = await fetch(baseUrl, { headers });
  assert.equal(profileResponse.status, 200);
  const profilePayload = (await profileResponse.json()) as {
    user: Record<string, unknown>;
  };
  assert.match(String(profilePayload.user.createdAt), /^\d{4}-\d\d-/);
  assert.deepEqual(profilePayload.user, {
    name: "Before Name",
    email: "profile@example.com",
    phone: "111",
    createdAt: profilePayload.user.createdAt,
  });
  assert.equal("id" in profilePayload.user, false);
  assert.equal("role" in profilePayload.user, false);
  assert.equal("status" in profilePayload.user, false);
  assert.equal("password_hash" in profilePayload.user, false);
  assert.equal(JSON.stringify(profilePayload).includes("password_hash"), false);

  const updateResponse = await fetch(baseUrl, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      name: "After Name",
      phone: "222",
      email: "attacker@example.com",
      role: "admin",
      status: "banned",
    }),
  });
  assert.equal(updateResponse.status, 200);
  const updatedPayload = (await updateResponse.json()) as {
    user: Record<string, unknown>;
  };
  assert.equal(updatedPayload.user.name, "After Name");
  assert.equal(updatedPayload.user.phone, "222");
  assert.equal(updatedPayload.user.email, "profile@example.com");
  assert.equal("id" in updatedPayload.user, false);
  assert.equal("role" in updatedPayload.user, false);
  assert.equal("status" in updatedPayload.user, false);
  assert.equal("password_hash" in updatedPayload.user, false);
  assert.equal(
    JSON.stringify(updatedPayload).includes("password_hash"),
    false,
  );

  const persisted = db
    .prepare("SELECT name, email, role, status, phone FROM users WHERE id = ?")
    .get(userId) as Record<string, string>;
  assert.deepEqual(persisted, {
    name: "After Name",
    email: "profile@example.com",
    role: "user",
    status: "active",
    phone: "222",
  });

  const unauthenticatedResponse = await fetch(baseUrl);
  assert.equal(unauthenticatedResponse.status, 401);
});

test("users can list only their active sessions with safe metadata", async () => {
  const current = createAuthenticatedSession("sessions-list@example.com");
  const otherOwnSessionId = randomUUID();
  const otherOwnSession = db
    .prepare(
      `INSERT INTO user_sessions (id, user_id, refresh_token_hash, device_name, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      otherOwnSessionId,
      current.userId,
      "second-private-refresh-hash",
      "Other Device",
      new Date(Date.now() + 60 * 60_000).toISOString(),
    );
  const other = createAuthenticatedSession("sessions-other@example.com");
  const revokedId = randomUUID();
  const revoked = db
    .prepare(
      `INSERT INTO user_sessions (id, user_id, refresh_token_hash, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .run(
      revokedId,
      current.userId,
      "revoked-private-refresh-hash",
      new Date(Date.now() + 60 * 60_000).toISOString(),
    );
  const expiredId = randomUUID();
  const expired = db
    .prepare(
      `INSERT INTO user_sessions (id, user_id, refresh_token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(expiredId, current.userId, "expired-private-refresh-hash", "2000-01-01T00:00:00.000Z");

  const response = await fetch(sessionsUrl, { headers: current.headers });
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    sessions: Array<Record<string, unknown>>;
  };
  assert.equal(payload.sessions.length, 2);
  const currentSession = payload.sessions.find((item) => item.id === current.sessionId);
  const otherSession = payload.sessions.find(
    (item) => item.id === otherOwnSessionId,
  );
  assert.equal(currentSession?.isCurrentDevice, true);
  assert.match(String(currentSession?.id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(otherSession?.isCurrentDevice, false);
  assert.equal(payload.sessions.some((item) => item.id === other.sessionId), false);
  assert.equal(payload.sessions.some((item) => item.id === revokedId), false);
  assert.equal(payload.sessions.some((item) => item.id === expiredId), false);
  assert.equal(JSON.stringify(payload).includes("refreshToken"), false);
  assert.equal(JSON.stringify(payload).includes("refresh_token_hash"), false);
  assert.equal(JSON.stringify(payload).includes(current.refreshTokenHash), false);
  assert.equal(JSON.stringify(payload).includes("second-private-refresh-hash"), false);
  assert.equal(Object.keys(currentSession ?? {}).includes("ipAddress"), true);
  assert.equal(Object.keys(currentSession ?? {}).includes("deviceName"), true);
});

test("users can revoke their own session and revoked access tokens are rejected", async () => {
  const current = createAuthenticatedSession("sessions-revoke@example.com");
  const targetId = randomUUID();
  const target = db
    .prepare(
      `INSERT INTO user_sessions (id, user_id, refresh_token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      targetId,
      current.userId,
      "revoke-target-refresh-hash",
      new Date(Date.now() + 60 * 60_000).toISOString(),
    );
  const targetToken = createAccessToken({ id: current.userId, role: "user" }, targetId);

  const response = await fetch(`${sessionsUrl}/${targetId}`, {
    method: "DELETE",
    headers: current.headers,
  });
  assert.equal(response.status, 204);
  const rejected = await fetch(baseUrl, {
    headers: { authorization: `Bearer ${targetToken}` },
  });
  assert.equal(rejected.status, 401);
  const currentStillValid = await fetch(baseUrl, { headers: current.headers });
  assert.equal(currentStillValid.status, 200);
});

test("users cannot revoke another user's session by guessing its ID", async () => {
  const attacker = createAuthenticatedSession("sessions-attacker@example.com");
  const victim = createAuthenticatedSession("sessions-victim@example.com");

  const response = await fetch(`${sessionsUrl}/${victim.sessionId}`, {
    method: "DELETE",
    headers: attacker.headers,
  });
  assert.equal(response.status, 404);
  const victimStillValid = await fetch(baseUrl, { headers: victim.headers });
  assert.equal(victimStillValid.status, 200);
});

test("users can revoke all their sessions including the current one", async () => {
  const current = createAuthenticatedSession("sessions-revoke-all@example.com");
  const secondId = randomUUID();
  const second = db
    .prepare(
      `INSERT INTO user_sessions (id, user_id, refresh_token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      secondId,
      current.userId,
      "revoke-all-second-refresh-hash",
      new Date(Date.now() + 60 * 60_000).toISOString(),
    );
  const secondToken = createAccessToken(
    { id: current.userId, role: "user" },
    secondId,
  );

  const response = await fetch(sessionsUrl, {
    method: "DELETE",
    headers: current.headers,
  });
  assert.equal(response.status, 204);
  assert.equal(
    (
      await fetch(baseUrl, { headers: current.headers })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(baseUrl, { headers: { authorization: `Bearer ${secondToken}` } })
    ).status,
    401,
  );
});

test("administrators can ban users, revoke all sessions, and immediately invalidate access tokens", async () => {
  const admin = createAuthenticatedSession("admin-ban@example.com", "admin");
  const target = createAuthenticatedSession("target-ban@example.com");
  const extraSessionId = randomUUID();
  db.prepare(`INSERT INTO user_sessions (id, user_id, refresh_token_hash, expires_at)
    VALUES (?, ?, ?, ?)`)
    .run(extraSessionId, target.userId, "ban-second-session", new Date(Date.now() + 60_000).toISOString());
  const extraToken = createAccessToken({ id: target.userId, role: "user" }, extraSessionId);

  const response = await fetch(`${baseUrl.replace(/\/me$/, "")}/${target.userId}/ban`, {
    method: "POST",
    headers: { ...admin.headers, "content-type": "application/json" },
    body: JSON.stringify({ reason: "Policy violation" }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json() as { user: Record<string, unknown> };
  assert.equal(payload.user.status, "banned");
  assert.equal(payload.user.banReason, "Policy violation");
  assert.equal("password_hash" in payload.user, false);
  assert.equal(JSON.stringify(payload).includes("password_hash"), false);
  const sessions = db.prepare("SELECT revoked_at FROM user_sessions WHERE user_id = ?").all(target.userId) as Array<{ revoked_at: string | null }>;
  assert.equal(sessions.length, 2);
  assert.ok(sessions.every((session) => session.revoked_at));
  assert.equal((await fetch(baseUrl, { headers: target.headers })).status, 401);
  assert.equal((await fetch(baseUrl, { headers: { authorization: `Bearer ${extraToken}` } })).status, 401);
});

test("administrators can unban users without restoring revoked sessions", async () => {
  const admin = createAuthenticatedSession("admin-unban@example.com", "admin");
  const target = createAuthenticatedSession("target-unban@example.com");
  const banResponse = await fetch(`${baseUrl.replace(/\/me$/, "")}/${target.userId}/ban`, {
    method: "POST", headers: admin.headers,
  });
  assert.equal(banResponse.status, 200);
  const unbanResponse = await fetch(`${baseUrl.replace(/\/me$/, "")}/${target.userId}/unban`, {
    method: "POST", headers: admin.headers,
  });
  assert.equal(unbanResponse.status, 200);
  const payload = await unbanResponse.json() as { user: Record<string, unknown> };
  assert.equal(payload.user.status, "active");
  assert.equal(payload.user.bannedAt, null);
  assert.equal(payload.user.banReason, null);
  const session = db.prepare("SELECT revoked_at FROM user_sessions WHERE id = ?").get(target.sessionId) as { revoked_at: string | null };
  assert.ok(session.revoked_at);
  assert.equal((await fetch(baseUrl, { headers: target.headers })).status, 401);
});

test("normal users cannot ban or unban users", async () => {
  const caller = createAuthenticatedSession("ordinary-ban@example.com");
  const target = createAuthenticatedSession("ordinary-target@example.com");
  const root = baseUrl.replace(/\/me$/, "");
  assert.equal((await fetch(`${root}/${target.userId}/ban`, { method: "POST", headers: caller.headers })).status, 403);
  assert.equal((await fetch(`${root}/${target.userId}/unban`, { method: "POST", headers: caller.headers })).status, 403);
});
