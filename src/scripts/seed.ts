import { closeDatabase } from "../config/database";

try {
  console.info("No seed data is defined yet.");
} finally {
  closeDatabase();
}
