import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../../server/config.js";

describe("loadConfig", () => {
  it("throws when required variables are missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ DATABASE_URL: "postgres://example" })).toThrow("JWT_SECRET");
    expect(() => loadConfig({ JWT_SECRET: "secret" })).toThrow("DATABASE_URL");
  });

  it("returns defaults for optional values", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://user:pass@localhost:5432/draftengine",
      JWT_SECRET: "test-secret"
    });

    expect(config).toEqual({
      databaseUrl: "postgres://user:pass@localhost:5432/draftengine",
      corsOrigin: "*",
      jwtSecret: "test-secret",
      nexusAppSigningSecret: "",
      nexusAuthAudience: "draftengine",
      nexusAuthIssuer: "nexus",
      nexusExchangeSecret: "",
      nexusExchangeUrl: "",
      nexusPortalBaseUrl: "http://127.0.0.1:3000",
      nodeEnv: "development",
      port: 3000
    });
  });

  it("validates PORT and honors NODE_ENV", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgres://user:pass@localhost:5432/draftengine",
        JWT_SECRET: "test-secret",
        PORT: "0"
      })
    ).toThrow("Invalid PORT");

    const config = loadConfig({
      DATABASE_URL: "postgres://user:pass@localhost:5432/draftengine",
      JWT_SECRET: "test-secret",
      PORT: "8080",
      NODE_ENV: "production"
    });

    expect(config.port).toBe(8080);
    expect(config.corsOrigin).toBe("*");
    expect(config.nodeEnv).toBe("production");
  });

  it("honors optional CORS_ORIGIN when provided", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://user:pass@localhost:5432/draftengine",
      JWT_SECRET: "test-secret",
      CORS_ORIGIN: "https://draftengine.app"
    });

    expect(config.corsOrigin).toBe("https://draftengine.app");
  });

  it("loads optional hosted Nexus auth configuration", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://user:pass@localhost:5432/draftengine",
      JWT_SECRET: "local-secret",
      NEXUS_APP_SIGNING_SECRET: "hosted-secret",
      NEXUS_AUTH_ISSUER: "nexus-local",
      NEXUS_AUTH_AUDIENCE: "draftengine",
      NEXUS_EXCHANGE_URL: "http://127.0.0.1:3000/api/auth/exchange",
      DRAFTENGINE_EXCHANGE_SECRET: "draftengine-secret",
      NEXUS_PORTAL_BASE_URL: "http://127.0.0.1:3000"
    });

    expect(config.nexusAppSigningSecret).toBe("hosted-secret");
    expect(config.nexusAuthIssuer).toBe("nexus-local");
    expect(config.nexusAuthAudience).toBe("draftengine");
    expect(config.nexusExchangeUrl).toBe("http://127.0.0.1:3000/api/auth/exchange");
    expect(config.nexusExchangeSecret).toBe("draftengine-secret");
    expect(config.nexusPortalBaseUrl).toBe("http://127.0.0.1:3000");
  });
});
