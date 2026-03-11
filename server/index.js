import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { createDbPool } from "./db/pool.js";
import { createRepositories } from "./repositories/index.js";
import { createRiotChampionStatsService } from "./riot/champion-stats.js";
import { createRiotApiClient } from "./riot/client.js";

function createRiotChampionStatsServiceForRuntime({ env = process.env, championsRepository } = {}) {
  const riotApiKey = typeof env.RIOT_API_KEY === "string" ? env.RIOT_API_KEY.trim() : "";
  const riotApiClient = createRiotApiClient({
    apiKey: riotApiKey,
    defaultPlatformRouting: env.RIOT_PLATFORM_ROUTING,
    defaultAccountRouting: env.RIOT_ACCOUNT_ROUTING,
    requestTimeoutMs: env.RIOT_API_TIMEOUT_MS
  });

  return createRiotChampionStatsService({
    riotApiClient,
    topChampionCount: env.RIOT_PROFILE_CHAMPION_STATS_LIMIT,
    lookupChampionById: championsRepository?.getChampionById?.bind(championsRepository)
  });
}

export function startServer(env = process.env) {
  const config = loadConfig(env);
  const pool = createDbPool(config);
  const repositories = createRepositories(pool);
  const riotChampionStatsService = createRiotChampionStatsServiceForRuntime({
    env,
    championsRepository: repositories.champions
  });
  const app = createApp({
    config,
    usersRepository: repositories.users,
    championsRepository: repositories.champions,
    tagsRepository: repositories.tags,
    compositionsCatalogRepository: repositories.compositionsCatalog,
    promotionRequestsRepository: repositories.promotionRequests,
    poolsRepository: repositories.pools,
    teamsRepository: repositories.teams,
    riotChampionStatsService
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
