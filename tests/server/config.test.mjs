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
      jwtSecret: "test-secret",
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
    expect(config.nodeEnv).toBe("production");
  });
});

