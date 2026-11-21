import { closeDatabase } from "./config/database";
import { env } from "./config/env";
import { createApp } from "./app";

const server = createApp().listen(env.PORT, () => {
  console.info(`Ticketing API listening on port ${env.PORT}`);
});

function shutdown(): void {
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
