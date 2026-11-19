import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { readFileSync } from "node:fs";
import path from "node:path";
import swaggerUi from "swagger-ui-express";
import { parse } from "yaml";
import { API_PREFIX } from "./config/api";
import { closeDatabase } from "./config/database";
import { env } from "./config/env";
import { errorHandler } from "./middleware/error.middleware";
import authRoutes from "./modules/auth/auth.routes";

const app = express();
app.set("trust proxy", 3);

const apiRouter = express.Router();
const openApiYaml = readFileSync(
  path.resolve(process.cwd(), "docs/openapi.yaml"),
  "utf8",
);
const openApiDocument = parse(openApiYaml);

// Middleware
app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

// Routes
apiRouter.get("/health", (_request, response) => {
  response.json({ ok: true });
});
apiRouter.get("/openapi.json", (_request, response) => {
  response.json(openApiDocument);
});
apiRouter.get("/openapi.yaml", (_request, response) => {
  response.type("application/yaml").send(openApiYaml);
});
apiRouter.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
apiRouter.use("/auth", authRoutes);
app.use(API_PREFIX, apiRouter);

app.use(errorHandler);

// Start the server
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
