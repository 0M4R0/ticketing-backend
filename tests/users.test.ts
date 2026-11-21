import assert from "node:assert/strict";
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
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  closeDatabase();
  rmSync(testDirectory, { recursive: true, force: true });
});

test("authenticated users can read and update only their own profile", async () => {
  const inserted = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, phone, role, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run("Before Name", "profile@example.com", "secret-hash", "111", "user", "active");
  const userId = Number(inserted.lastInsertRowid);
  const session = db
    .prepare(
      `INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at)
       VALUES (?, ?, ?)`,
    )
    .run(userId, "test-refresh-hash", new Date(Date.now() + 60_000).toISOString());
  const token = createAccessToken(
    { id: userId, role: "user" },
    Number(session.lastInsertRowid),
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
