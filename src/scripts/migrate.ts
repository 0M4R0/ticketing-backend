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

// The previous 001_init used INTEGER AUTOINCREMENT IDs. Existing databases
// have no data to preserve, so reset that schema once and apply the UUID schema
// from the edited 001_init migration.
const usersTable = db
  .prepare("PRAGMA table_info(users)")
  .all() as Array<{ name: string; type: string }>;
const userIdColumn = usersTable.find((column) => column.name === "id");
if (userIdColumn && userIdColumn.type.toUpperCase() !== "TEXT") {
  console.warn("Resetting legacy integer-ID database; application data is disposable.");
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      DROP TABLE IF EXISTS tickets;
      DROP TABLE IF EXISTS payments;
      DROP TABLE IF EXISTS user_payment_methods;
      DROP TABLE IF EXISTS order_items;
      DROP TABLE IF EXISTS orders;
      DROP TABLE IF EXISTS ticket_type_seats;
      DROP TABLE IF EXISTS ticket_type;
      DROP TABLE IF EXISTS events;
      DROP TABLE IF EXISTS seats;
      DROP TABLE IF EXISTS places;
      DROP TABLE IF EXISTS event_type;
      DROP TABLE IF EXISTS user_sessions;
      DROP TABLE IF EXISTS users;
      DROP TABLE schema_migrations;
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }
  db.exec(`
    CREATE TABLE schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `);
}

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
