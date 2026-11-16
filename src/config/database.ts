import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { env } from "./env";

const dbPath = path.resolve(process.cwd(), env.DB_PATH);
mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON"); // Enable foreign keys
db.pragma("busy_timeout = 5000");
db.pragma("synchronous = NORMAL");

export function closeDatabase(): void {
  if (db.open) db.close();
}
