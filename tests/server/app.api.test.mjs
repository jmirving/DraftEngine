import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../../server/app.js";
import { signAccessToken } from "../../server/auth/tokens.js";

function createMockContext({ riotChampionStatsService = null } = {}) {
  function makeLogoDataUrl(logoBlob, logoMimeType) {
    if (!logoBlob || typeof logoMimeType !== "string" || logoMimeType.trim() === "") {
      return null;
    }
    const asBuffer = Buffer.isBuffer(logoBlob) ? logoBlob : Buffer.from(logoBlob);
    return `data:${logoMimeType};base64,${asBuffer.toString("base64")}`;
  }

  const state = {
    users: [
      {
        id: 1,
        email: "lead@example.com",
        password_hash: "seeded",
        game_name: "LeadPlayer",
        tagline: "NA1",
        primary_role: "Mid",
        secondary_roles: ["Top"],
        default_team_id: null,
        active_team_id: null,
        created_at: "2026-01-01T00:00:00.000Z"
      },
      {
        id: 2,
        email: "member@example.com",
        password_hash: "seeded",
        game_name: "MemberPlayer",
        tagline: "NA1",
        primary_role: "Support",
        secondary_roles: ["ADC"],
        default_team_id: null,
        active_team_id: null,
        created_at: "2026-01-01T00:00:00.000Z"
      },
      {
        id: 3,
        email: "outsider@example.com",
        password_hash: "seeded",
        game_name: "Outsider",
        tagline: "NA1",
        primary_role: "Top",
        secondary_roles: [],
        default_team_id: null,
        active_team_id: null,
        created_at: "2026-01-01T00:00:00.000Z"
      }
    ],
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
    userChampionTagIds: new Map([
      ["2:1", new Set([2])]
    ]),
    teamChampionTagIds: new Map([
      ["1:1", new Set([1])]
    ]),
    pools: [
      { id: 1, user_id: 1, name: "Main", created_at: "2026-01-01T00:00:00.000Z" },
      { id: 2, user_id: 2, name: "Alt", created_at: "2026-01-01T00:00:00.000Z" }
    ],
    poolChampionIds: new Map([
      [1, new Set([1])],
      [2, new Set([2])]
    ]),
    teams: [
      {
        id: 1,
        name: "Team Alpha",
        tag: "ALPHA",
        logo_data_url: makeLogoDataUrl(Buffer.from("alpha-logo"), "image/png"),
        created_by: 1,
        created_at: "2026-01-01T00:00:00.000Z"
      }
    ],
    teamMembers: [
      { team_id: 1, user_id: 1, role: "lead", team_role: "primary", created_at: "2026-01-01T00:00:00.000Z" },
      { team_id: 1, user_id: 2, role: "member", team_role: "substitute", created_at: "2026-01-01T00:00:00.000Z" }
    ]
  };

  let nextUserId = 4;
  let nextPoolId = 3;
  let nextTeamId = 2;

  const usersRepository = {
    async createUser({ email, passwordHash, gameName, tagline }) {
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
        game_name: gameName,
        tagline,
        primary_role: "Mid",
        secondary_roles: [],
        default_team_id: null,
        active_team_id: null,
        created_at: "2026-01-01T00:00:00.000Z"
      };
      nextUserId += 1;
      state.users.push(user);
      return {
        id: user.id,
        email: user.email,
        game_name: user.game_name,
        tagline: user.tagline,
        primary_role: user.primary_role,
        secondary_roles: user.secondary_roles,
        created_at: user.created_at
      };
    },

    async findByEmail(email) {
      return state.users.find((candidate) => candidate.email === email) ?? null;
    },

    async findById(userId) {
      return state.users.find((candidate) => candidate.id === userId) ?? null;
    },

    async findProfileById(userId) {
      return state.users.find((candidate) => candidate.id === userId) ?? null;
    },

    async updateProfileRoles(userId, { primaryRole, secondaryRoles }) {
      const user = state.users.find((candidate) => candidate.id === userId) ?? null;
      if (!user) {
        return null;
      }
      user.primary_role = primaryRole;
      user.secondary_roles = [...secondaryRoles];
      return user;
    },

    async findTeamContextById(userId) {
      const user = state.users.find((candidate) => candidate.id === userId) ?? null;
      if (!user) {
        return null;
      }
      return {
        id: user.id,
        default_team_id: user.default_team_id ?? null,
        active_team_id: user.active_team_id ?? null
      };
    },

    async updateTeamContext(userId, { defaultTeamId, activeTeamId }) {
      const user = state.users.find((candidate) => candidate.id === userId) ?? null;
      if (!user) {
        return null;
      }
      user.default_team_id = defaultTeamId;
      user.active_team_id = activeTeamId;
      return {
        id: user.id,
        default_team_id: user.default_team_id,
        active_team_id: user.active_team_id
      };
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
    scopedKey(scope, ownerId, championId) {
      return `${scope}:${ownerId}:${championId}`;
    },

    async listTags() {
      return [...state.tags];
    },

    async listChampionTagIdsForScope({ championId, scope, userId, teamId }) {
      if (scope === "all") {
        return state.champions.find((item) => item.id === championId)?.tagIds ?? [];
      }

      if (scope === "self") {
        const key = this.scopedKey("self", userId, championId);
        return [...(state.userChampionTagIds.get(key) ?? new Set())].sort((left, right) => left - right);
      }

      if (scope === "team") {
        const key = this.scopedKey("team", teamId, championId);
        return [...(state.teamChampionTagIds.get(key) ?? new Set())].sort((left, right) => left - right);
      }

      return [];
    },

    async allTagIdsExist(tagIds) {
      const tagSet = new Set(state.tags.map((tag) => tag.id));
      return tagIds.every((id) => tagSet.has(id));
    },

    async replaceChampionTagsForScope({ championId, tagIds, scope, userId, teamId }) {
      if (scope === "all") {
        const champion = state.champions.find((item) => item.id === championId);
        champion.tagIds = [...new Set(tagIds)];
        return;
      }

      if (scope === "self") {
        const key = this.scopedKey("self", userId, championId);
        state.userChampionTagIds.set(key, new Set(tagIds));
        return;
      }

      if (scope === "team") {
        const key = this.scopedKey("team", teamId, championId);
        state.teamChampionTagIds.set(key, new Set(tagIds));
      }
    },

    async replaceChampionTags(championId, tagIds) {
      await this.replaceChampionTagsForScope({
        championId,
        tagIds,
        scope: "all"
      });
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

  const teamsRepository = {
    async teamExists(teamId) {
      return state.teams.some((team) => team.id === teamId);
    },
    async createTeam({ name, tag, logoBlob, logoMimeType, creatorUserId }) {
      const team = {
        id: nextTeamId,
        name,
        tag,
        logo_data_url: makeLogoDataUrl(logoBlob, logoMimeType),
        created_by: creatorUserId,
        created_at: "2026-01-01T00:00:00.000Z"
      };
      nextTeamId += 1;
      state.teams.push(team);
      state.teamMembers.push({
        team_id: team.id,
        user_id: creatorUserId,
        role: "lead",
        team_role: "primary",
        created_at: "2026-01-01T00:00:00.000Z"
      });
      return team;
    },
    async listTeamsByUser(userId) {
      return state.teams
        .map((team) => {
          const membership = state.teamMembers.find(
            (candidate) => candidate.team_id === team.id && candidate.user_id === userId
          );
          if (!membership) {
            return null;
          }
          return {
            ...team,
            membership_role: membership.role,
            membership_team_role: membership.team_role
          };
        })
        .filter(Boolean);
    },
    async getMembership(teamId, userId) {
      const membership = state.teamMembers.find(
        (candidate) => candidate.team_id === teamId && candidate.user_id === userId
      );
      if (!membership) {
        return null;
      }
      const user = state.users.find((candidate) => candidate.id === userId);
      return {
        ...membership,
        email: user?.email ?? null
      };
    },
    async countLeads(teamId) {
      return state.teamMembers.filter((candidate) => candidate.team_id === teamId && candidate.role === "lead").length;
    },
    async updateTeam(teamId, { name, tag, logoBlob, logoMimeType, removeLogo }) {
      const team = state.teams.find((candidate) => candidate.id === teamId) ?? null;
      if (!team) {
        return null;
      }
      team.name = name;
      team.tag = tag;
      if (removeLogo) {
        team.logo_data_url = null;
      } else if (logoBlob) {
        team.logo_data_url = makeLogoDataUrl(logoBlob, logoMimeType);
      }
      return team;
    },
    async deleteTeam(teamId) {
      const teamIndex = state.teams.findIndex((candidate) => candidate.id === teamId);
      if (teamIndex < 0) {
        return false;
      }
      state.teams.splice(teamIndex, 1);
      state.teamMembers = state.teamMembers.filter((candidate) => candidate.team_id !== teamId);
      return true;
    },
    async listMembers(teamId) {
      return state.teamMembers
        .filter((candidate) => candidate.team_id === teamId)
        .map((membership) => {
          const user = state.users.find((candidate) => candidate.id === membership.user_id);
          return {
            ...membership,
            email: user?.email ?? null
          };
        })
        .sort((left, right) => {
          if (left.role !== right.role) {
            return left.role === "lead" ? -1 : 1;
          }
          return (left.email ?? "").localeCompare(right.email ?? "");
        });
    },
    async addMember(teamId, userId, role, teamRole) {
      const existing = state.teamMembers.find(
        (candidate) => candidate.team_id === teamId && candidate.user_id === userId
      );
      if (existing) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }
      state.teamMembers.push({
        team_id: teamId,
        user_id: userId,
        role,
        team_role: teamRole,
        created_at: "2026-01-01T00:00:00.000Z"
      });
    },
    async removeMember(teamId, userId) {
      const index = state.teamMembers.findIndex(
        (candidate) => candidate.team_id === teamId && candidate.user_id === userId
      );
      if (index < 0) {
        return false;
      }
      state.teamMembers.splice(index, 1);
      return true;
    },
    async setMemberRole(teamId, userId, role) {
      const membership = state.teamMembers.find(
        (candidate) => candidate.team_id === teamId && candidate.user_id === userId
      );
      if (!membership) {
        return null;
      }
      membership.role = role;
      return membership;
    },
    async setMemberTeamRole(teamId, userId, teamRole) {
      const membership = state.teamMembers.find(
        (candidate) => candidate.team_id === teamId && candidate.user_id === userId
      );
      if (!membership) {
        return null;
      }
      membership.team_role = teamRole;
      return membership;
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
    poolsRepository,
    teamsRepository,
    riotChampionStatsService
  });

  return { app, config, state, usersRepository };
}

function buildAuthHeader(userId, config) {
  return `Bearer ${signAccessToken(userId, config)}`;
}

describe("API routes", () => {
  it("serves the frontend UI at root", async () => {
    const { app } = createMockContext();

    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("<title>DraftEngine</title>");
  });

  it("registers, hashes password, and logs in", async () => {
    const { app, state } = createMockContext();

    const registerResponse = await request(app)
      .post("/auth/register")
      .send({
        email: "test@example.com",
        password: "strong-pass-123",
        gameName: "TestPlayer",
        tagline: "NA1"
      });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body.user.email).toBe("test@example.com");
    expect(registerResponse.body.user.gameName).toBe("TestPlayer");
    expect(registerResponse.body.user.tagline).toBe("NA1");
    expect(registerResponse.body.user.primaryRole).toBe("Mid");
    expect(registerResponse.body.user.secondaryRoles).toEqual([]);
    expect(registerResponse.body.token).toBeTypeOf("string");
    expect(state.users).toHaveLength(4);
    expect(state.users[3].password_hash).not.toBe("strong-pass-123");

    const loginResponse = await request(app)
      .post("/auth/login")
      .send({ email: "test@example.com", password: "strong-pass-123" });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user.id).toBe(4);
    expect(loginResponse.body.user.gameName).toBe("TestPlayer");
    expect(loginResponse.body.user.tagline).toBe("NA1");
    expect(loginResponse.body.user.primaryRole).toBe("Mid");
    expect(loginResponse.body.user.secondaryRoles).toEqual([]);

    const missingRiotIdResponse = await request(app)
      .post("/auth/register")
      .send({ email: "missing-fields@example.com", password: "strong-pass-123" });
    expect(missingRiotIdResponse.status).toBe(400);
    expect(missingRiotIdResponse.body.error.code).toBe("BAD_REQUEST");

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

  it("returns a clear error when registration schema is out of date", async () => {
    const { app, usersRepository } = createMockContext();
    usersRepository.createUser = async () => {
      const error = new Error("column missing");
      error.code = "42703";
      throw error;
    };

    const response = await request(app)
      .post("/auth/register")
      .send({
        email: "schema-mismatch@example.com",
        password: "strong-pass-123",
        gameName: "SchemaUser",
        tagline: "NA1"
      });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("SCHEMA_MISMATCH");
    expect(response.body.error.message).toContain("npm run migrate:up");
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

  it("reads and updates profile primary/secondary roles", async () => {
    const { app, config } = createMockContext();
    const leadAuth = buildAuthHeader(1, config);

    const profileResponse = await request(app).get("/me/profile").set("Authorization", leadAuth);
    expect(profileResponse.status).toBe(200);
    expect(profileResponse.body.profile.primaryRole).toBe("Mid");
    expect(profileResponse.body.profile.secondaryRoles).toEqual(["Top"]);

    const invalidResponse = await request(app)
      .put("/me/profile")
      .set("Authorization", leadAuth)
      .send({ primaryRole: "Mid", secondaryRoles: ["Mid"] });
    expect(invalidResponse.status).toBe(400);

    const updateResponse = await request(app)
      .put("/me/profile")
      .set("Authorization", leadAuth)
      .send({ primaryRole: "Support", secondaryRoles: ["Mid", "ADC"] });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.profile.primaryRole).toBe("Support");
    expect(updateResponse.body.profile.secondaryRoles).toEqual(["Mid", "ADC"]);
  });

  it("includes Riot champion stats in the authenticated profile response", async () => {
    const getProfileChampionStats = vi.fn(async () => ({
      provider: "riot",
      status: "ok",
      fetchedAt: "2026-02-26T17:25:00.000Z",
      champions: [
        {
          championId: 99,
          championLevel: 7,
          championPoints: 234567,
          lastPlayedAt: "2026-02-24T10:00:00.000Z"
        }
      ]
    }));
    const { app, config } = createMockContext({
      riotChampionStatsService: {
        getProfileChampionStats
      }
    });
    const leadAuth = buildAuthHeader(1, config);

    const response = await request(app).get("/me/profile").set("Authorization", leadAuth);
    expect(response.status).toBe(200);
    expect(getProfileChampionStats).toHaveBeenCalledWith({
      gameName: "LeadPlayer",
      tagline: "NA1"
    });
    expect(response.body.profile.championStats).toEqual({
      provider: "riot",
      status: "ok",
      fetchedAt: "2026-02-26T17:25:00.000Z",
      champions: [
        {
          championId: 99,
          championLevel: 7,
          championPoints: 234567,
          lastPlayedAt: "2026-02-24T10:00:00.000Z"
        }
      ]
    });
  });

  it("reads and updates team-context preferences with membership validation", async () => {
    const { app, config, state } = createMockContext();
    const leadAuth = buildAuthHeader(1, config);

    const initial = await request(app).get("/me/team-context").set("Authorization", leadAuth);
    expect(initial.status).toBe(200);
    expect(initial.body.teamContext).toEqual({
      defaultTeamId: null,
      activeTeamId: null
    });

    const updated = await request(app)
      .put("/me/team-context")
      .set("Authorization", leadAuth)
      .send({ defaultTeamId: 1, activeTeamId: 1 });
    expect(updated.status).toBe(200);
    expect(updated.body.teamContext).toEqual({
      defaultTeamId: 1,
      activeTeamId: 1
    });

    const persisted = await request(app).get("/me/team-context").set("Authorization", leadAuth);
    expect(persisted.status).toBe(200);
    expect(persisted.body.teamContext).toEqual({
      defaultTeamId: 1,
      activeTeamId: 1
    });

    const invalidMembership = await request(app)
      .put("/me/team-context")
      .set("Authorization", leadAuth)
      .send({ defaultTeamId: 999, activeTeamId: 1 });
    expect(invalidMembership.status).toBe(400);
    expect(invalidMembership.body.error.code).toBe("BAD_REQUEST");

    const leadUser = state.users.find((candidate) => candidate.id === 1);
    leadUser.default_team_id = 999;
    leadUser.active_team_id = 1;

    const normalized = await request(app).get("/me/team-context").set("Authorization", leadAuth);
    expect(normalized.status).toBe(200);
    expect(normalized.body.teamContext).toEqual({
      defaultTeamId: null,
      activeTeamId: 1
    });
    expect(leadUser.default_team_id).toBe(null);
    expect(leadUser.active_team_id).toBe(1);
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

  it("serves champion tags and enforces scoped tag edit authorization", async () => {
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

    const scopedReadUnauthorized = await request(app).get("/champions/1/tags");
    expect(scopedReadUnauthorized.status).toBe(401);

    const writeUnauthorized = await request(app)
      .put("/champions/1/tags")
      .send({ tag_ids: [1, 2] });
    expect(writeUnauthorized.status).toBe(401);

    const invalidTagResponse = await request(app)
      .put("/champions/1/tags")
      .set("Authorization", buildAuthHeader(1, config))
      .send({ tag_ids: [999] });
    expect(invalidTagResponse.status).toBe(400);

    const memberCannotWriteGlobal = await request(app)
      .put("/champions/1/tags")
      .set("Authorization", buildAuthHeader(2, config))
      .send({ scope: "all", tag_ids: [2] });
    expect(memberCannotWriteGlobal.status).toBe(403);

    const memberCanWriteSelf = await request(app)
      .put("/champions/1/tags")
      .set("Authorization", buildAuthHeader(2, config))
      .send({ scope: "self", tag_ids: [2, 1, 2] });
    expect(memberCanWriteSelf.status).toBe(200);
    expect(memberCanWriteSelf.body.tag_ids).toEqual([1, 2]);

    const selfRead = await request(app)
      .get("/champions/1/tags?scope=self")
      .set("Authorization", buildAuthHeader(2, config));
    expect(selfRead.status).toBe(200);
    expect(selfRead.body.tag_ids).toEqual([1, 2]);

    const outsiderCannotWriteTeam = await request(app)
      .put("/champions/1/tags")
      .set("Authorization", buildAuthHeader(3, config))
      .send({ scope: "team", team_id: 1, tag_ids: [2] });
    expect(outsiderCannotWriteTeam.status).toBe(403);

    const memberCanWriteTeam = await request(app)
      .put("/champions/1/tags")
      .set("Authorization", buildAuthHeader(2, config))
      .send({ scope: "team", team_id: 1, tag_ids: [2] });
    expect(memberCanWriteTeam.status).toBe(200);
    expect(memberCanWriteTeam.body.team_id).toBe(1);

    const teamRead = await request(app)
      .get("/champions/1/tags?scope=team&team_id=1")
      .set("Authorization", buildAuthHeader(2, config));
    expect(teamRead.status).toBe(200);
    expect(teamRead.body.tag_ids).toEqual([2]);

    const leadCanWriteGlobal = await request(app)
      .put("/champions/1/tags")
      .set("Authorization", buildAuthHeader(1, config))
      .send({ scope: "all", tag_ids: [2] });
    expect(leadCanWriteGlobal.status).toBe(200);
    expect(leadCanWriteGlobal.body.champion.tagIds).toEqual([2]);

    const globalRead = await request(app)
      .get("/champions/1/tags?scope=all")
      .set("Authorization", buildAuthHeader(2, config));
    expect(globalRead.status).toBe(200);
    expect(globalRead.body.tag_ids).toEqual([2]);
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

  it("supports JSON and multipart team logo contracts", async () => {
    const { app, config } = createMockContext();
    const leadAuth = buildAuthHeader(1, config);

    const jsonCreate = await request(app)
      .post("/teams")
      .set("Authorization", leadAuth)
      .send({ name: "Team Json", tag: "json" });
    expect(jsonCreate.status).toBe(201);
    expect(jsonCreate.body.team.name).toBe("Team Json");
    expect(jsonCreate.body.team.tag).toBe("JSON");
    expect(jsonCreate.body.team.logo_data_url).toBe(null);

    const multipartCreate = await request(app)
      .post("/teams")
      .set("Authorization", leadAuth)
      .field("name", "Team Upload")
      .field("tag", "upl")
      .attach("logo", Buffer.from("fake-png"), { filename: "logo.png", contentType: "image/png" });
    expect(multipartCreate.status).toBe(201);
    expect(multipartCreate.body.team.tag).toBe("UPL");
    expect(multipartCreate.body.team.logo_data_url).toContain("data:image/png;base64,");

    const invalidType = await request(app)
      .post("/teams")
      .set("Authorization", leadAuth)
      .field("name", "Bad Mime")
      .field("tag", "bad")
      .attach("logo", Buffer.from("not-image"), { filename: "logo.txt", contentType: "text/plain" });
    expect(invalidType.status).toBe(400);
    expect(invalidType.body.error.code).toBe("BAD_REQUEST");

    const tooLarge = await request(app)
      .post("/teams")
      .set("Authorization", leadAuth)
      .field("name", "Too Large")
      .field("tag", "large")
      .attach("logo", Buffer.alloc(512 * 1024 + 1, 7), { filename: "logo.png", contentType: "image/png" });
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.error.message).toContain("512KB");

    const uploadUpdate = await request(app)
      .patch(`/teams/${jsonCreate.body.team.id}`)
      .set("Authorization", leadAuth)
      .field("name", "Team Json Updated")
      .field("tag", "jsn")
      .attach("logo", Buffer.from("fake-webp"), { filename: "logo.webp", contentType: "image/webp" });
    expect(uploadUpdate.status).toBe(200);
    expect(uploadUpdate.body.team.tag).toBe("JSN");
    expect(uploadUpdate.body.team.logo_data_url).toContain("data:image/webp;base64,");

    const removeLogo = await request(app)
      .patch(`/teams/${jsonCreate.body.team.id}`)
      .set("Authorization", leadAuth)
      .send({ name: "Team Json Updated", tag: "jsn", remove_logo: true });
    expect(removeLogo.status).toBe(200);
    expect(removeLogo.body.team.logo_data_url).toBe(null);

    const conflictUpdate = await request(app)
      .patch(`/teams/${multipartCreate.body.team.id}`)
      .set("Authorization", leadAuth)
      .field("name", "Team Upload")
      .field("tag", "upl")
      .field("remove_logo", "true")
      .attach("logo", Buffer.from("conflict"), { filename: "logo.png", contentType: "image/png" });
    expect(conflictUpdate.status).toBe(400);
    expect(conflictUpdate.body.error.code).toBe("BAD_REQUEST");
  });

  it("enforces team lead authorization and lead invariants", async () => {
    const { app, config } = createMockContext();
    const leadAuth = buildAuthHeader(1, config);
    const memberAuth = buildAuthHeader(2, config);
    const outsiderAuth = buildAuthHeader(99, config);

    const memberDeniedPatch = await request(app)
      .patch("/teams/1")
      .set("Authorization", memberAuth)
      .send({ name: "Nope", tag: "NOPE" });
    expect(memberDeniedPatch.status).toBe(403);

    const memberDeniedAddMember = await request(app)
      .post("/teams/1/members")
      .set("Authorization", memberAuth)
      .send({ user_id: 3, role: "member", team_role: "substitute" });
    expect(memberDeniedAddMember.status).toBe(403);

    const memberDeniedRoleUpdate = await request(app)
      .put("/teams/1/members/1/role")
      .set("Authorization", memberAuth)
      .send({ role: "member" });
    expect(memberDeniedRoleUpdate.status).toBe(403);

    const memberDeniedTeamRoleUpdate = await request(app)
      .put("/teams/1/members/1/team-role")
      .set("Authorization", memberAuth)
      .send({ team_role: "substitute" });
    expect(memberDeniedTeamRoleUpdate.status).toBe(403);

    const memberDeniedRemove = await request(app)
      .delete("/teams/1/members/2")
      .set("Authorization", memberAuth);
    expect(memberDeniedRemove.status).toBe(403);

    const memberDeniedDeleteTeam = await request(app)
      .delete("/teams/1")
      .set("Authorization", memberAuth);
    expect(memberDeniedDeleteTeam.status).toBe(403);

    const addOutsider = await request(app)
      .post("/teams/1/members")
      .set("Authorization", leadAuth)
      .send({ user_id: 3, role: "member" });
    expect(addOutsider.status).toBe(201);
    expect(addOutsider.body.member.user_id).toBe(3);

    const memberCanList = await request(app)
      .get("/teams/1/members")
      .set("Authorization", memberAuth);
    expect(memberCanList.status).toBe(200);
    expect(memberCanList.body.members.length).toBeGreaterThanOrEqual(2);

    const outsiderCannotList = await request(app)
      .get("/teams/1/members")
      .set("Authorization", outsiderAuth);
    expect(outsiderCannotList.status).toBe(403);

    const promoteMember = await request(app)
      .put("/teams/1/members/2/role")
      .set("Authorization", leadAuth)
      .send({ role: "lead" });
    expect(promoteMember.status).toBe(200);
    expect(promoteMember.body.member.role).toBe("lead");

    const setMemberTeamRole = await request(app)
      .put("/teams/1/members/2/team-role")
      .set("Authorization", leadAuth)
      .send({ team_role: "primary" });
    expect(setMemberTeamRole.status).toBe(200);
    expect(setMemberTeamRole.body.member.team_role).toBe("primary");

    const demoteOriginalLead = await request(app)
      .put("/teams/1/members/1/role")
      .set("Authorization", leadAuth)
      .send({ role: "member" });
    expect(demoteOriginalLead.status).toBe(200);
    expect(demoteOriginalLead.body.member.role).toBe("member");

    const lastLeadDemotionBlocked = await request(app)
      .put("/teams/1/members/2/role")
      .set("Authorization", memberAuth)
      .send({ role: "member" });
    expect(lastLeadDemotionBlocked.status).toBe(400);
    expect(lastLeadDemotionBlocked.body.error.code).toBe("BAD_REQUEST");
  });
});
