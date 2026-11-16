import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { db, closeDatabase } from "../config/database";

const migrationsDirectory = path.join(process.cwd(), "migrations");

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )
`);

const applied = db.prepare(
  "SELECT filename FROM schema_migrations WHERE filename = ?",
);
const markApplied = db.prepare(
  "INSERT INTO schema_migrations (filename) VALUES (?)",
);
const migrations = readdirSync(migrationsDirectory)
  .filter((filename) => /^\d+_[\w-]+\.sql$/.test(filename))
  .sort();

try {
  for (const filename of migrations) {
    if (applied.get(filename)) continue; // Skip migrations that already ran

    const sql = readFileSync(path.join(migrationsDirectory, filename), "utf8");
    db.transaction(() => {
      db.exec(sql);
      markApplied.run(filename);
    }).immediate();
    console.info(`Applied migration ${filename}`);
  }
} finally {
  closeDatabase();
}
