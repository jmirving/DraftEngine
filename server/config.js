import dotenv from "dotenv";

dotenv.config({ quiet: true });

export class ConfigError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ConfigError";
    this.details = details;
  }
}

function readRequiredString(env, key) {
  const value = env[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`Missing required environment variable: ${key}`, {
      key
    });
  }
  return value.trim();
}

function readOptionalPort(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new ConfigError(`Invalid ${key}: expected an integer between 1 and 65535.`, {
      key,
      value: raw
    });
  }

  return parsed;
}

export function loadConfig(env = process.env) {
  return {
    databaseUrl: readRequiredString(env, "DATABASE_URL"),
    jwtSecret: readRequiredString(env, "JWT_SECRET"),
    port: readOptionalPort(env, "PORT", 3000),
    corsOrigin: typeof env.CORS_ORIGIN === "string" && env.CORS_ORIGIN.trim() !== ""
      ? env.CORS_ORIGIN.trim()
      : "*",
    nodeEnv: typeof env.NODE_ENV === "string" && env.NODE_ENV.trim() !== ""
      ? env.NODE_ENV.trim()
      : "development"
  };
}
