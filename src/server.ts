import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { closeDatabase } from "./config/database";
import { env } from "./config/env";
import { errorHandler } from "./middleware/error.middleware";

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.use(errorHandler);

const server = app.listen(env.PORT, () => {
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
