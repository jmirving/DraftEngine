import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { assertInvitationSchema, createDbPool } from "./db/pool.js";
import { createGitHubIssueReporter } from "./github/issues.js";
import { createRepositories } from "./repositories/index.js";
import { createRiotChampionStatsService } from "./riot/champion-stats.js";
import { createRiotApiClient } from "./riot/client.js";

export function resolveRiotApiKey(env = process.env) {
  const nexusApiKey = typeof env.NEXUS_API_KEY === "string" ? env.NEXUS_API_KEY.trim() : "";
  if (nexusApiKey) {
    return nexusApiKey;
  }
  return typeof env.RIOT_API_KEY === "string" ? env.RIOT_API_KEY.trim() : "";
}

export function createRiotChampionStatsServiceForRuntime({
  env = process.env,
  championCoreRepository,
  championsRepository
} = {}) {
  const riotApiKey = resolveRiotApiKey(env);
  const riotApiClient = createRiotApiClient({
    apiKey: riotApiKey,
    defaultPlatformRouting: env.RIOT_PLATFORM_ROUTING,
    defaultAccountRouting: env.RIOT_ACCOUNT_ROUTING,
    requestTimeoutMs: env.RIOT_API_TIMEOUT_MS
  });

  return createRiotChampionStatsService({
    riotApiClient,
    lookupChampionById:
      championCoreRepository?.getChampionCoreByRiotChampionId?.bind(championCoreRepository) ??
      championsRepository?.getChampionById?.bind(championsRepository)
  });
}

export function startServer(env = process.env) {
  const config = loadConfig(env);
  const pool = createDbPool(config);
  const repositories = createRepositories(pool);
  const issueReporter = createGitHubIssueReporter({
    token: env.GITHUB_ISSUES_TOKEN,
    owner: env.GITHUB_ISSUES_OWNER,
    repo: env.GITHUB_ISSUES_REPO,
    fallbackUrl: env.GITHUB_ISSUES_FALLBACK_URL
  });
  const riotChampionStatsService = createRiotChampionStatsServiceForRuntime({
    env,
    championCoreRepository: repositories.championCore,
    championsRepository: repositories.champions
  });
  const app = createApp({
    config,
    usersRepository: repositories.users,
    championCoreRepository: repositories.championCore,
    championsRepository: repositories.champions,
    tagsRepository: repositories.tags,
    compositionsCatalogRepository: repositories.compositionsCatalog,
    draftSetupsRepository: repositories.draftSetups,
    promotionRequestsRepository: repositories.promotionRequests,
    poolsRepository: repositories.pools,
    teamsRepository: repositories.teams,
    riotChampionStatsService,
    issueReporter
  });

  const server = app.listen(config.port, () => {
    console.log(`DraftEngine API listening on port ${config.port} (${config.nodeEnv})`);
  });

  void assertInvitationSchema(pool).catch(async (error) => {
    console.error(error.message);
    server.close();
    process.exitCode = 1;
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
