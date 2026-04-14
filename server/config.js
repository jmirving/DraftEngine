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

function readOptionalString(env, key, fallback = "") {
  const value = env[key];
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }
  return value.trim();
}

function deriveExchangeUrl(baseUrl) {
  if (!baseUrl) {
    return "";
  }

  try {
    return new URL("/api/auth/exchange", baseUrl).toString();
  } catch {
    return "";
  }
}

export function loadConfig(env = process.env) {
  const nexusPortalBaseUrl = readOptionalString(
    env,
    "NEXUS_PORTAL_BASE_URL",
    readOptionalString(env, "NEXUS_PUBLIC_BASE_URL", "http://127.0.0.1:3000")
  );

  return {
    databaseUrl: readRequiredString(env, "DATABASE_URL"),
    jwtSecret: readRequiredString(env, "JWT_SECRET"),
    nexusAppSigningSecret: readOptionalString(
      env,
      "NEXUS_APP_SIGNING_SECRET",
      readOptionalString(env, "NEXUS_JWT_SECRET")
    ),
    nexusAuthIssuer: readOptionalString(env, "NEXUS_AUTH_ISSUER", "nexus"),
    nexusAuthAudience: readOptionalString(env, "NEXUS_AUTH_AUDIENCE", "draftengine"),
    nexusExchangeUrl: readOptionalString(
      env,
      "NEXUS_EXCHANGE_URL",
      deriveExchangeUrl(nexusPortalBaseUrl)
    ),
    nexusExchangeSecret: readOptionalString(
      env,
      "NEXUS_DRAFTENGINE_EXCHANGE_SECRET",
      readOptionalString(
        env,
        "DRAFTENGINE_EXCHANGE_SECRET",
        readOptionalString(
          env,
          "NEXUS_EXCHANGE_SECRET",
          readOptionalString(env, "NEXUS_APP_EXCHANGE_SECRET")
        )
      )
    ),
    nexusPortalBaseUrl,
    port: readOptionalPort(env, "PORT", 3000),
    corsOrigin: typeof env.CORS_ORIGIN === "string" && env.CORS_ORIGIN.trim() !== ""
      ? env.CORS_ORIGIN.trim()
      : "*",
    nodeEnv: typeof env.NODE_ENV === "string" && env.NODE_ENV.trim() !== ""
      ? env.NODE_ENV.trim()
      : "development"
  };
}
