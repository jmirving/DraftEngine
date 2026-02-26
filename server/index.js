import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";

export function startServer(env = process.env) {
  const config = loadConfig(env);
  const app = createApp();

  const server = app.listen(config.port, () => {
    console.log(`DraftEngine API listening on port ${config.port} (${config.nodeEnv})`);
  });

  return { app, server, config };
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

