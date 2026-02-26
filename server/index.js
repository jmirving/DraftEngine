import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { createDbPool } from "./db/pool.js";
import { createRepositories } from "./repositories/index.js";

export function startServer(env = process.env) {
  const config = loadConfig(env);
  const pool = createDbPool(config);
  const repositories = createRepositories(pool);
  const app = createApp({
    config,
    usersRepository: repositories.users,
    championsRepository: repositories.champions,
    tagsRepository: repositories.tags,
    poolsRepository: repositories.pools
  });

  const server = app.listen(config.port, () => {
    console.log(`DraftEngine API listening on port ${config.port} (${config.nodeEnv})`);
  });

  server.on("close", () => {
    void pool.end();
  });

  return { app, server, config, pool };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  try {
    startServer();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

