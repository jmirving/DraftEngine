import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRequireAuth } from "./auth/middleware.js";
import { ApiError, badRequest, formatErrorResponse } from "./errors.js";
import { createAuthRouter } from "./routes/auth.js";
import { createChampionsRouter } from "./routes/champions.js";
import { createChecksRouter } from "./routes/checks.js";
import { createProfileRouter } from "./routes/profile.js";
import { createPoolsRouter } from "./routes/pools.js";
import { createTeamsRouter } from "./routes/teams.js";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(serverDir, "..", "public");
const srcDir = path.resolve(serverDir, "..", "src");

function requireDependency(value, name) {
  if (!value) {
    throw new Error(`createApp is missing required dependency: ${name}`);
  }
  return value;
}

export function createApp({
  config,
  usersRepository,
  championsRepository,
  tagsRepository,
  checksRepository,
  promotionRequestsRepository,
  poolsRepository,
  teamsRepository,
  riotChampionStatsService = null
}) {
  requireDependency(config, "config");
  requireDependency(usersRepository, "usersRepository");
  requireDependency(championsRepository, "championsRepository");
  requireDependency(tagsRepository, "tagsRepository");
  requireDependency(checksRepository, "checksRepository");
  requireDependency(promotionRequestsRepository, "promotionRequestsRepository");
  requireDependency(poolsRepository, "poolsRepository");
  requireDependency(teamsRepository, "teamsRepository");

  const app = express();
  const requireAuth = createRequireAuth(config);
  const corsOrigin =
    typeof config.corsOrigin === "string" && config.corsOrigin.trim() !== ""
      ? config.corsOrigin.trim()
      : "*";

  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", corsOrigin);
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
    if (corsOrigin !== "*") {
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json());
  app.use(express.static(publicDir));
  app.use("/public", express.static(publicDir));
  app.use("/src", express.static(srcDir));

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.use("/auth", createAuthRouter({ config, usersRepository }));
  app.use(
    "/",
    createProfileRouter({
      usersRepository,
      teamsRepository,
      requireAuth,
      riotChampionStatsService
    })
  );
  app.use(
    "/",
    createChampionsRouter({
      championsRepository,
      tagsRepository,
      promotionRequestsRepository,
      usersRepository,
      teamsRepository,
      requireAuth
    })
  );
  app.use(
    "/",
    createChecksRouter({
      checksRepository,
      promotionRequestsRepository,
      usersRepository,
      teamsRepository,
      requireAuth
    })
  );
  app.use(
    "/",
    createPoolsRouter({
      poolsRepository,
      championsRepository,
      requireAuth
    })
  );

  app.use(
    "/",
    createTeamsRouter({
      teamsRepository,
      usersRepository,
      requireAuth
    })
  );

  app.use((_request, _response, next) => {
    next(new ApiError(404, "NOT_FOUND", "Route not found."));
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
      const formatted = formatErrorResponse(badRequest("Invalid JSON payload."));
      response.status(formatted.status).json(formatted.body);
      return;
    }

    const formatted = formatErrorResponse(error);
    response.status(formatted.status).json(formatted.body);
  });

  return app;
}
