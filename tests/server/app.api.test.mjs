import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../../server/app.js";
import { signAccessToken } from "../../server/auth/tokens.js";

function createMockContext() {
  const state = {
    users: [],
    champions: [
      {
        id: 1,
        name: "Ahri",
        role: "MID",
        metadata: { roles: ["MID"] },
        tagIds: [1]
      },
      {
        id: 2,
        name: "Braum",
        role: "SUP",
        metadata: { roles: ["SUP"] },
        tagIds: []
      }
    ],
    tags: [
      { id: 1, name: "engage", category: "utility" },
      { id: 2, name: "frontline", category: "utility" }
    ],
    pools: [
      { id: 1, user_id: 1, name: "Main", created_at: "2026-01-01T00:00:00.000Z" },
      { id: 2, user_id: 2, name: "Alt", created_at: "2026-01-01T00:00:00.000Z" }
    ],
    poolChampionIds: new Map([
      [1, new Set([1])],
      [2, new Set([2])]
    ])
  };

  let nextUserId = 1;
  let nextPoolId = 3;

  const usersRepository = {
    async createUser({ email, passwordHash }) {
      const existing = state.users.find((candidate) => candidate.email === email);
      if (existing) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }

      const user = {
        id: nextUserId,
        email,
        password_hash: passwordHash,
        created_at: "2026-01-01T00:00:00.000Z"
      };
      nextUserId += 1;
      state.users.push(user);
      return {
        id: user.id,
        email: user.email,
        created_at: user.created_at
      };
    },

    async findByEmail(email) {
      return state.users.find((candidate) => candidate.email === email) ?? null;
    }
  };

  const championsRepository = {
    async listChampions() {
      return [...state.champions].sort((left, right) => left.name.localeCompare(right.name));
    },
    async getChampionById(championId) {
      return state.champions.find((champion) => champion.id === championId) ?? null;
    },
    async championExists(championId) {
      return state.champions.some((champion) => champion.id === championId);
    }
  };

  const tagsRepository = {
    async listTags() {
      return [...state.tags];
    },
    async allTagIdsExist(tagIds) {
      const tagSet = new Set(state.tags.map((tag) => tag.id));
      return tagIds.every((id) => tagSet.has(id));
    },
    async replaceChampionTags(championId, tagIds) {
      const champion = state.champions.find((item) => item.id === championId);
      champion.tagIds = [...new Set(tagIds)];
    }
  };

  const poolsRepository = {
    async listPoolsByUser(userId) {
      return state.pools.filter((pool) => pool.user_id === userId);
    },
    async getPoolOwner(poolId) {
      return state.pools.find((pool) => pool.id === poolId)?.user_id ?? null;
    },
    async createPool(userId, name) {
      const pool = {
        id: nextPoolId,
        user_id: userId,
        name,
        created_at: "2026-01-01T00:00:00.000Z"
      };
      state.pools.push(pool);
      state.poolChampionIds.set(pool.id, new Set());
      nextPoolId += 1;
      return pool;
    },
    async renamePool(poolId, userId, name) {
      const pool = state.pools.find((candidate) => candidate.id === poolId && candidate.user_id === userId) ?? null;
      if (!pool) {
        return null;
      }
      pool.name = name;
      return pool;
    },
    async deletePool(poolId, userId) {
      const index = state.pools.findIndex((candidate) => candidate.id === poolId && candidate.user_id === userId);
      if (index < 0) {
        return false;
      }
      state.pools.splice(index, 1);
      state.poolChampionIds.delete(poolId);
      return true;
    },
    async addChampionToPool(poolId, championId) {
      state.poolChampionIds.get(poolId)?.add(championId);
    },
    async removeChampionFromPool(poolId, championId) {
      state.poolChampionIds.get(poolId)?.delete(championId);
    },
    async listPoolChampionIds(poolId) {
      const set = state.poolChampionIds.get(poolId);
      if (!set) {
        return [];
      }
      return [...set].sort((left, right) => left - right);
    }
  };

  const config = {
    jwtSecret: "test-secret",
    corsOrigin: "*"
  };

  const app = createApp({
    config,
    usersRepository,
    championsRepository,
    tagsRepository,
    poolsRepository
  });

  return { app, config, state };
}

function buildAuthHeader(userId, config) {
  return `Bearer ${signAccessToken(userId, config)}`;
}

describe("API routes", () => {
  it("registers, hashes password, and logs in", async () => {
    const { app, state } = createMockContext();

    const registerResponse = await request(app)
      .post("/auth/register")
      .send({ email: "test@example.com", password: "strong-pass-123" });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body.user.email).toBe("test@example.com");
    expect(registerResponse.body.token).toBeTypeOf("string");
    expect(state.users).toHaveLength(1);
    expect(state.users[0].password_hash).not.toBe("strong-pass-123");

    const loginResponse = await request(app)
      .post("/auth/login")
      .send({ email: "test@example.com", password: "strong-pass-123" });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user.id).toBe(1);

    const invalidLoginResponse = await request(app)
      .post("/auth/login")
      .send({ email: "test@example.com", password: "wrong-pass-123" });

    expect(invalidLoginResponse.status).toBe(401);
    expect(invalidLoginResponse.body).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid email or password."
      }
    });
  });

  it("enforces auth and returns consistent JSON errors", async () => {
    const { app } = createMockContext();

    const unauthorizedResponse = await request(app).get("/me/pools");
    expect(unauthorizedResponse.status).toBe(401);
    expect(unauthorizedResponse.body.error.code).toBe("UNAUTHORIZED");

    const invalidJsonResponse = await request(app)
      .post("/auth/register")
      .set("Content-Type", "application/json")
      .send("{\"email\":");
    expect(invalidJsonResponse.status).toBe(400);
    expect(invalidJsonResponse.body.error.code).toBe("BAD_REQUEST");

    const missingRouteResponse = await request(app).get("/missing-route");
    expect(missingRouteResponse.status).toBe(404);
    expect(missingRouteResponse.body.error.code).toBe("NOT_FOUND");
  });

  it("sets CORS headers and handles preflight requests", async () => {
    const { app } = createMockContext();

    const championsResponse = await request(app).get("/champions");
    expect(championsResponse.headers["access-control-allow-origin"]).toBe("*");

    const preflightResponse = await request(app)
      .options("/champions")
      .set("Origin", "https://draftengine.app")
      .set("Access-Control-Request-Method", "GET");

    expect(preflightResponse.status).toBe(204);
    expect(preflightResponse.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("serves champions and tags, and updates champion tags", async () => {
    const { app, config } = createMockContext();

    const listResponse = await request(app).get("/champions");
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.champions).toHaveLength(2);

    const detailResponse = await request(app).get("/champions/1");
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.champion.name).toBe("Ahri");

    const tagsResponse = await request(app).get("/tags");
    expect(tagsResponse.status).toBe(200);
    expect(tagsResponse.body.tags).toHaveLength(2);

    const writeUnauthorized = await request(app)
      .put("/champions/1/tags")
      .send({ tag_ids: [1, 2] });
    expect(writeUnauthorized.status).toBe(401);

    const invalidTagResponse = await request(app)
      .put("/champions/1/tags")
      .set("Authorization", buildAuthHeader(1, config))
      .send({ tag_ids: [999] });
    expect(invalidTagResponse.status).toBe(400);

    const updateResponse = await request(app)
      .put("/champions/1/tags")
      .set("Authorization", buildAuthHeader(1, config))
      .send({ tag_ids: [2] });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.champion.tagIds).toEqual([2]);
  });

  it("enforces per-user pool isolation and idempotent membership updates", async () => {
    const { app, config } = createMockContext();
    const user1Auth = buildAuthHeader(1, config);
    const user2Auth = buildAuthHeader(2, config);

    const listUser1 = await request(app).get("/me/pools").set("Authorization", user1Auth);
    expect(listUser1.status).toBe(200);
    expect(listUser1.body.pools).toHaveLength(1);
    expect(listUser1.body.pools[0].id).toBe(1);

    const crossUserUpdate = await request(app)
      .put("/me/pools/1")
      .set("Authorization", user2Auth)
      .send({ name: "Nope" });
    expect(crossUserUpdate.status).toBe(403);

    const createResponse = await request(app)
      .post("/me/pools")
      .set("Authorization", user1Auth)
      .send({ name: "Pocket Picks" });
    expect(createResponse.status).toBe(201);

    const newPoolId = createResponse.body.pool.id;
    const addOnce = await request(app)
      .post(`/me/pools/${newPoolId}/champions`)
      .set("Authorization", user1Auth)
      .send({ champion_id: 2 });
    expect(addOnce.status).toBe(200);
    expect(addOnce.body.pool.champion_ids).toEqual([2]);

    const addTwice = await request(app)
      .post(`/me/pools/${newPoolId}/champions`)
      .set("Authorization", user1Auth)
      .send({ champion_id: 2 });
    expect(addTwice.status).toBe(200);
    expect(addTwice.body.pool.champion_ids).toEqual([2]);

    const removeMissing = await request(app)
      .delete(`/me/pools/${newPoolId}/champions/999`)
      .set("Authorization", user1Auth);
    expect(removeMissing.status).toBe(200);
    expect(removeMissing.body.pool.champion_ids).toEqual([2]);
  });
});
