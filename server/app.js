import express from "express";

import { createRequireAuth } from "./auth/middleware.js";
import { ApiError, badRequest, formatErrorResponse } from "./errors.js";
import { createAuthRouter } from "./routes/auth.js";
import { createChampionsRouter } from "./routes/champions.js";
import { createPoolsRouter } from "./routes/pools.js";

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
  poolsRepository
}) {
  requireDependency(config, "config");
  requireDependency(usersRepository, "usersRepository");
  requireDependency(championsRepository, "championsRepository");
  requireDependency(tagsRepository, "tagsRepository");
  requireDependency(poolsRepository, "poolsRepository");

  const app = express();
  const requireAuth = createRequireAuth(config);

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.use("/auth", createAuthRouter({ config, usersRepository }));
  app.use(
    "/",
    createChampionsRouter({
      championsRepository,
      tagsRepository,
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

