import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { verifyAccessToken } from "../../server/auth/tokens.js";
import { formatErrorResponse } from "../../server/errors.js";
import { createAuthRouter } from "../../server/routes/auth.js";

function createTestConfig(overrides = {}) {
  return {
    jwtSecret: "draftengine-local-secret",
    nexusAppSigningSecret: "nexus-app-secret",
    nexusAuthIssuer: "nexus-local",
    nexusAuthAudience: "draftengine",
    nexusExchangeUrl: "http://127.0.0.1:3000/api/auth/exchange",
    nexusExchangeSecret: "draftengine-exchange-secret",
    nexusPortalBaseUrl: "http://127.0.0.1:3000",
    ...overrides
  };
}

function signHostedToken(claims, config) {
  return jwt.sign(claims, config.nexusAppSigningSecret, {
    algorithm: "HS256"
  });
}

function createHostedAuthApp({ config = createTestConfig(), usersRepository, redeemLaunchGrant }) {
  const app = express();
  app.use("/auth", createAuthRouter({ config, usersRepository, redeemLaunchGrant }));
  app.use((error, _request, response, _next) => {
    const formatted = formatErrorResponse(error);
    response.status(formatted.status).json(formatted.body);
  });
  return app;
}

function extractBootstrapPayload(html) {
  const match = html.match(
    /<script id="draftengine-hosted-auth-payload" type="application\/json">([\s\S]*?)<\/script>/
  );
  expect(match).not.toBeNull();
  return JSON.parse(match[1]);
}

describe("DraftEngine hosted auth callback", () => {
  it("provisions a local user, stores a DraftEngine session payload, and normalizes hash return paths", async () => {
    const config = createTestConfig();
    const createdUsers = [];
    const usersRepository = {
      findByEmail: vi.fn().mockResolvedValue(null),
      createUser: vi.fn().mockImplementation(async ({ email, gameName, tagline, firstName, lastName, role }) => {
        const createdUser = {
          id: 41,
          email,
          role,
          game_name: gameName,
          tagline,
          first_name: firstName,
          last_name: lastName,
          primary_role: "Mid",
          secondary_roles: [],
          default_team_id: null,
          avatar_champion_id: null
        };
        createdUsers.push(createdUser);
        return createdUser;
      })
    };
    const redeemLaunchGrant = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      payload: {
        accessToken: signHostedToken(
          {
            iss: config.nexusAuthIssuer,
            sub: "usr_local_dev",
            aud: config.nexusAuthAudience,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
            email: "local.dev@example.com",
            displayName: "Local Dev"
          },
          config
        ),
        user: {
          userId: "usr_local_dev"
        },
        returnTo: "#profile"
      }
    });
    const app = createHostedAuthApp({ config, usersRepository, redeemLaunchGrant });

    const response = await request(app).get("/auth/nexus/callback?grant=grant_local_123");

    expect(response.status).toBe(200);
    expect(response.text).toContain("draftflow.authSession.v1");
    expect(redeemLaunchGrant).toHaveBeenCalledWith({
      config,
      grantId: "grant_local_123"
    });
    expect(usersRepository.findByEmail).toHaveBeenCalledWith("local.dev@example.com");
    expect(usersRepository.createUser).toHaveBeenCalledTimes(1);
    expect(createdUsers[0]).toMatchObject({
      email: "local.dev@example.com",
      game_name: "Local Dev",
      tagline: "Nexus",
      first_name: "Local",
      last_name: "Dev",
      role: "member"
    });

    const payload = extractBootstrapPayload(response.text);
    expect(payload.returnTo).toBe("/#profile");
    expect(payload.session.user).toMatchObject({
      id: 41,
      email: "local.dev@example.com",
      gameName: "Local Dev",
      tagline: "Nexus"
    });
    expect(verifyAccessToken(payload.session.token, config).sub).toBe("41");
  });

  it("reuses an existing DraftEngine user instead of provisioning a new one", async () => {
    const config = createTestConfig();
    const existingUser = {
      id: 7,
      email: "member@example.com",
      role: "member",
      game_name: "ExistingPlayer",
      tagline: "NA1",
      first_name: "Existing",
      last_name: "Member",
      primary_role: "Support",
      secondary_roles: ["ADC"],
      default_team_id: null,
      avatar_champion_id: null
    };
    const usersRepository = {
      findByEmail: vi.fn().mockResolvedValue(existingUser),
      createUser: vi.fn()
    };
    const redeemLaunchGrant = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      payload: {
        accessToken: signHostedToken(
          {
            iss: config.nexusAuthIssuer,
            sub: "usr_existing",
            aud: config.nexusAuthAudience,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
            email: "member@example.com",
            displayName: "Existing Member"
          },
          config
        ),
        user: {
          userId: "usr_existing"
        },
        returnTo: "/#workflow"
      }
    });
    const app = createHostedAuthApp({ config, usersRepository, redeemLaunchGrant });

    const response = await request(app).get("/auth/nexus/callback?grant=grant_existing");

    expect(response.status).toBe(200);
    expect(usersRepository.createUser).not.toHaveBeenCalled();

    const payload = extractBootstrapPayload(response.text);
    expect(payload.session.user).toMatchObject({
      id: 7,
      email: "member@example.com",
      gameName: "ExistingPlayer",
      tagline: "NA1"
    });
    expect(verifyAccessToken(payload.session.token, config).sub).toBe("7");
  });

  it("renders an intentional HTML failure when the callback is missing a grant", async () => {
    const app = createHostedAuthApp({
      usersRepository: {
        findByEmail: vi.fn(),
        createUser: vi.fn()
      },
      redeemLaunchGrant: vi.fn()
    });

    const response = await request(app).get("/auth/nexus/callback");

    expect(response.status).toBe(400);
    expect(response.text).toContain("The callback is missing a launch grant.");
  });

  it("renders the exchange failure response without mutating local users", async () => {
    const usersRepository = {
      findByEmail: vi.fn(),
      createUser: vi.fn()
    };
    const redeemLaunchGrant = vi.fn().mockResolvedValue({
      ok: false,
      status: 410,
      payload: {
        message: "Launch grant was already redeemed."
      }
    });
    const app = createHostedAuthApp({
      usersRepository,
      redeemLaunchGrant
    });

    const response = await request(app).get("/auth/nexus/callback?grant=grant_replayed");

    expect(response.status).toBe(410);
    expect(response.text).toContain("Launch grant was already redeemed.");
    expect(usersRepository.findByEmail).not.toHaveBeenCalled();
    expect(usersRepository.createUser).not.toHaveBeenCalled();
  });
});
