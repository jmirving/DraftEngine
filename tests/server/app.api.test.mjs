import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../../server/app.js";
import { signAccessToken } from "../../server/auth/tokens.js";
import { DEFAULT_REQUIREMENT_TOGGLES } from "../../src/domain/model.js";

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
        role: "admin",
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
        role: "member",
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
        role: "member",
        password_hash: "seeded",
        game_name: "Outsider",
        tagline: "NA1",
        primary_role: "Top",
        secondary_roles: [],
        default_team_id: null,
        active_team_id: null,
        created_at: "2026-01-01T00:00:00.000Z"
      },
      {
        id: 4,
        email: "norole@example.com",
        password_hash: "seeded",
        game_name: "NoRole",
        tagline: "NA1",
        primary_role: null,
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
    userCheckSettings: new Map(),
    teamCheckSettings: new Map([
      [1, { ...DEFAULT_REQUIREMENT_TOGGLES, requireDisengage: true }]
    ]),
    globalCheckSettings: { ...DEFAULT_REQUIREMENT_TOGGLES, requireFrontline: false },
    promotionRequests: [],
    pools: [
      { id: 1, user_id: 1, name: "Main", created_at: "2026-01-01T00:00:00.000Z" },
      { id: 2, user_id: 2, name: "Alt", created_at: "2026-01-01T00:00:00.000Z" }
    ],
    poolChampionIds: new Map([
      [1, new Set([1])],
      [2, new Set([2])]
    ]),
    poolChampionFamiliarity: new Map([
      ["1:1", 3],
      ["2:2", 3]
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
    ],
    joinRequests: []
  };

  let nextUserId = 5;
  let nextPoolId = 3;
  let nextTeamId = 2;
  let nextJoinRequestId = 1;
  let nextTagId = 3;

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
        role: "member",
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
        role: user.role,
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

    async countAdmins() {
      return state.users.filter((candidate) => String(candidate.role ?? "").trim().toLowerCase() === "admin").length;
    },

    async findByRiotId(gameName, tagline) {
      const normalizedGameName = String(gameName ?? "").trim().toLowerCase();
      const normalizedTagline = String(tagline ?? "").trim().toLowerCase();
      return state.users.find((candidate) => {
        const candidateGameName = String(candidate.game_name ?? "").trim().toLowerCase();
        const candidateTagline = String(candidate.tagline ?? "").trim().toLowerCase();
        return candidateGameName === normalizedGameName && candidateTagline === normalizedTagline;
      }) ?? null;
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
    },
    async updateChampionMetadata(championId, { roles, damageType, scaling }) {
      const champion = state.champions.find((item) => item.id === championId);
      if (!champion) {
        return null;
      }
      champion.role = roles[0];
      champion.metadata = {
        ...(champion.metadata && typeof champion.metadata === "object" ? champion.metadata : {}),
        roles: [...roles],
        damageType,
        scaling
      };
      return champion;
    }
  };

  const tagsRepository = {
    scopedKey(scope, ownerId, championId) {
      return `${scope}:${ownerId}:${championId}`;
    },

    async listTags() {
      return [...state.tags];
    },

    async createTag({ name, category }) {
      const duplicate = state.tags.some((tag) => tag.name === name);
      if (duplicate) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }
      const created = {
        id: nextTagId,
        name,
        category
      };
      nextTagId += 1;
      state.tags.push(created);
      return created;
    },

    async updateTag(tagId, { name, category }) {
      const existing = state.tags.find((tag) => tag.id === tagId) ?? null;
      if (!existing) {
        return null;
      }
      const duplicate = state.tags.some((tag) => tag.id !== tagId && tag.name === name);
      if (duplicate) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }
      existing.name = name;
      existing.category = category;
      return existing;
    },

    async countTagAssignments(tagId) {
      let assignments = 0;
      for (const champion of state.champions) {
        assignments += champion.tagIds.filter((candidate) => candidate === tagId).length;
      }
      for (const scopedTags of state.userChampionTagIds.values()) {
        if (scopedTags.has(tagId)) {
          assignments += 1;
        }
      }
      for (const scopedTags of state.teamChampionTagIds.values()) {
        if (scopedTags.has(tagId)) {
          assignments += 1;
        }
      }
      return assignments;
    },

    async deleteTag(tagId) {
      const index = state.tags.findIndex((tag) => tag.id === tagId);
      if (index < 0) {
        return null;
      }
      const [deleted] = state.tags.splice(index, 1);
      return deleted;
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

  const checksRepository = {
    async listRequirementSettingsForScope({ scope, userId, teamId }) {
      if (scope === "all") {
        return state.globalCheckSettings ? { ...state.globalCheckSettings } : null;
      }
      if (scope === "self") {
        const settings = state.userCheckSettings.get(userId);
        return settings ? { ...settings } : null;
      }
      if (scope === "team") {
        const settings = state.teamCheckSettings.get(teamId);
        return settings ? { ...settings } : null;
      }
      return null;
    },
    async replaceRequirementSettingsForScope({ scope, userId, teamId, toggles }) {
      const next = { ...toggles };
      if (scope === "all") {
        state.globalCheckSettings = next;
        return next;
      }
      if (scope === "self") {
        state.userCheckSettings.set(userId, next);
        return next;
      }
      if (scope === "team") {
        state.teamCheckSettings.set(teamId, next);
        return next;
      }
      return next;
    }
  };

  const promotionRequestsRepository = {
    async createPromotionRequest({
      entityType,
      resourceId,
      sourceScope,
      sourceUserId,
      sourceTeamId,
      targetScope,
      targetTeamId,
      requestedBy,
      payload
    }) {
      const requestRecord = {
        id: state.promotionRequests.length + 1,
        entity_type: entityType,
        resource_id: resourceId ?? null,
        source_scope: sourceScope,
        source_user_id: sourceUserId ?? null,
        source_team_id: sourceTeamId ?? null,
        target_scope: targetScope,
        target_team_id: targetTeamId ?? null,
        requested_by: requestedBy,
        status: "pending",
        payload_json: payload ?? {},
        created_at: "2026-01-01T00:00:00.000Z"
      };
      state.promotionRequests.push(requestRecord);
      return requestRecord;
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
      const champions = state.poolChampionIds.get(poolId);
      if (!champions) {
        return;
      }
      champions.add(championId);
      const key = `${poolId}:${championId}`;
      if (!state.poolChampionFamiliarity.has(key)) {
        state.poolChampionFamiliarity.set(key, 3);
      }
    },
    async setChampionFamiliarity(poolId, championId, familiarity) {
      const champions = state.poolChampionIds.get(poolId);
      if (!champions || !champions.has(championId)) {
        return false;
      }
      state.poolChampionFamiliarity.set(`${poolId}:${championId}`, familiarity);
      return true;
    },
    async removeChampionFromPool(poolId, championId) {
      state.poolChampionIds.get(poolId)?.delete(championId);
      state.poolChampionFamiliarity.delete(`${poolId}:${championId}`);
    },
    async listPoolChampions(poolId) {
      const set = state.poolChampionIds.get(poolId);
      if (!set) {
        return [];
      }
      return [...set]
        .sort((left, right) => left - right)
        .map((championId) => ({
          champion_id: championId,
          familiarity: state.poolChampionFamiliarity.get(`${poolId}:${championId}`) ?? 3
        }));
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
          const user = state.users.find((candidate) => candidate.id === userId) ?? null;
          return {
            ...team,
            membership_role: membership.role,
            membership_team_role: membership.team_role,
            membership_lane: user?.primary_role ?? null
          };
        })
        .filter(Boolean);
    },
    async listDiscoverableTeams(userId) {
      return state.teams
        .map((team) => {
          const membership = state.teamMembers.find(
            (candidate) => candidate.team_id === team.id && candidate.user_id === userId
          );
          const pendingRequest = state.joinRequests.find(
            (candidate) =>
              candidate.team_id === team.id &&
              candidate.requester_user_id === userId &&
              candidate.status === "pending"
          );
          const user = state.users.find((candidate) => candidate.id === userId) ?? null;
          return {
            ...team,
            membership_role: membership?.role ?? null,
            membership_team_role: membership?.team_role ?? null,
            membership_lane: membership ? user?.primary_role ?? null : null,
            pending_join_request_id: pendingRequest?.id ?? null,
            pending_join_request_status: pendingRequest?.status ?? null
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name));
    },
    async getMembership(teamId, userId) {
      const membership = state.teamMembers.find(
        (candidate) => candidate.team_id === teamId && candidate.user_id === userId
      );
      if (!membership) {
        return null;
      }
      const user = state.users.find((candidate) => candidate.id === userId);
      const gameName = user?.game_name ?? "";
      const tagline = user?.tagline ?? "";
      const email = user?.email ?? null;
      const displayName = gameName && tagline ? `${gameName}#${tagline}` : (gameName || email || `User ${userId}`);
      return {
        ...membership,
        email,
        game_name: gameName,
        tagline,
        primary_role: user?.primary_role ?? null,
        display_name: displayName
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
          const gameName = user?.game_name ?? "";
          const tagline = user?.tagline ?? "";
          const email = user?.email ?? null;
          const displayName = gameName && tagline
            ? `${gameName}#${tagline}`
            : (gameName || email || `User ${membership.user_id}`);
          return {
            ...membership,
            email,
            game_name: gameName,
            tagline,
            primary_role: user?.primary_role ?? null,
            display_name: displayName
          };
        })
        .sort((left, right) => {
          const laneOrder = { Top: 0, Jungle: 1, Mid: 2, ADC: 3, Support: 4 };
          const leftLane = laneOrder[left.primary_role] ?? 99;
          const rightLane = laneOrder[right.primary_role] ?? 99;
          if (leftLane !== rightLane) {
            return leftLane - rightLane;
          }
          if (left.role !== right.role) {
            return left.role === "lead" ? -1 : 1;
          }
          return (left.display_name ?? "").localeCompare(right.display_name ?? "");
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
    async createJoinRequest({ teamId, requesterUserId, requestedLane, note = "" }) {
      const existing = state.joinRequests.find(
        (candidate) =>
          candidate.team_id === teamId &&
          candidate.requester_user_id === requesterUserId &&
          candidate.status === "pending"
      );
      if (existing) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }

      const requestRecord = {
        id: nextJoinRequestId,
        team_id: teamId,
        requester_user_id: requesterUserId,
        requested_lane: requestedLane,
        status: "pending",
        note,
        reviewed_by_user_id: null,
        reviewed_at: null,
        created_at: "2026-01-01T00:00:00.000Z"
      };
      nextJoinRequestId += 1;
      state.joinRequests.push(requestRecord);
      return requestRecord;
    },
    async listJoinRequests(teamId, { status = null } = {}) {
      return state.joinRequests
        .filter((candidate) => candidate.team_id === teamId && (!status || candidate.status === status))
        .map((requestRecord) => {
          const requester = state.users.find((candidate) => candidate.id === requestRecord.requester_user_id) ?? null;
          const gameName = requester?.game_name ?? "";
          const tagline = requester?.tagline ?? "";
          const email = requester?.email ?? null;
          return {
            ...requestRecord,
            requester: {
              user_id: requestRecord.requester_user_id,
              email,
              game_name: gameName,
              tagline,
              primary_role: requester?.primary_role ?? null,
              display_name: gameName && tagline ? `${gameName}#${tagline}` : (gameName || email || "Unknown Player")
            }
          };
        });
    },
    async getJoinRequestById(teamId, requestId) {
      const requestRecord = state.joinRequests.find(
        (candidate) => candidate.team_id === teamId && candidate.id === requestId
      );
      if (!requestRecord) {
        return null;
      }
      const requester = state.users.find((candidate) => candidate.id === requestRecord.requester_user_id) ?? null;
      const gameName = requester?.game_name ?? "";
      const tagline = requester?.tagline ?? "";
      const email = requester?.email ?? null;
      return {
        ...requestRecord,
        requester: {
          user_id: requestRecord.requester_user_id,
          email,
          game_name: gameName,
          tagline,
          primary_role: requester?.primary_role ?? null,
          display_name: gameName && tagline ? `${gameName}#${tagline}` : (gameName || email || "Unknown Player")
        }
      };
    },
    async setJoinRequestStatus(teamId, requestId, { status, reviewedByUserId }) {
      const requestRecord = state.joinRequests.find(
        (candidate) => candidate.team_id === teamId && candidate.id === requestId && candidate.status === "pending"
      );
      if (!requestRecord) {
        return null;
      }
      requestRecord.status = status;
      requestRecord.reviewed_by_user_id = reviewedByUserId;
      requestRecord.reviewed_at = "2026-01-01T00:00:00.000Z";
      return requestRecord;
    },
    async deletePendingJoinRequest(teamId, requestId, requesterUserId) {
      const index = state.joinRequests.findIndex(
        (candidate) =>
          candidate.team_id === teamId &&
          candidate.id === requestId &&
          candidate.requester_user_id === requesterUserId &&
          candidate.status === "pending"
      );
      if (index < 0) {
        return false;
      }
      state.joinRequests.splice(index, 1);
      return true;
    },
    async clearPendingJoinRequestsForUser(teamId, requesterUserId) {
      state.joinRequests = state.joinRequests.filter(
        (candidate) =>
          !(candidate.team_id === teamId && candidate.requester_user_id === requesterUserId && candidate.status === "pending")
      );
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
    checksRepository,
    promotionRequestsRepository,
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
    expect(registerResponse.body.user.role).toBe("member");
    expect(registerResponse.body.user.primaryRole).toBe("Mid");
    expect(registerResponse.body.user.secondaryRoles).toEqual([]);
    expect(registerResponse.body.token).toBeTypeOf("string");
    expect(state.users).toHaveLength(5);
    expect(state.users[4].password_hash).not.toBe("strong-pass-123");

    const loginResponse = await request(app)
      .post("/auth/login")
      .send({ email: "test@example.com", password: "strong-pass-123" });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user.id).toBe(5);
    expect(loginResponse.body.user.gameName).toBe("TestPlayer");
    expect(loginResponse.body.user.tagline).toBe("NA1");
    expect(loginResponse.body.user.role).toBe("member");
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

  it("serves champion tags and enforces global-only MVP tag auth", async () => {
    const { app, config, state } = createMockContext();

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
      .send({ tag_ids: [2] });
    expect(memberCannotWriteGlobal.status).toBe(403);

    const invalidScopeResponse = await request(app)
      .put("/champions/1/tags")
      .set("Authorization", buildAuthHeader(2, config))
      .send({ scope: "self", tag_ids: [2] });
    expect(invalidScopeResponse.status).toBe(400);

    const globalReadDefaultScope = await request(app)
      .get("/champions/1/tags")
      .set("Authorization", buildAuthHeader(2, config));
    expect(globalReadDefaultScope.status).toBe(200);
    expect(globalReadDefaultScope.body.scope).toBe("all");
    expect(globalReadDefaultScope.body.team_id).toBeNull();
    expect(globalReadDefaultScope.body.tag_ids).toEqual([1]);

    const adminCanWriteGlobal = await request(app)
      .put("/champions/1/tags")
      .set("Authorization", buildAuthHeader(1, config))
      .send({ tag_ids: [2, 1, 2] });
    expect(adminCanWriteGlobal.status).toBe(200);
    expect(adminCanWriteGlobal.body.champion.tagIds).toEqual([1, 2]);

    const globalRead = await request(app)
      .get("/champions/1/tags?scope=all")
      .set("Authorization", buildAuthHeader(2, config));
    expect(globalRead.status).toBe(200);
    expect(globalRead.body.tag_ids).toEqual([1, 2]);

    const listAfterGlobalSave = await request(app).get("/champions");
    expect(listAfterGlobalSave.status).toBe(200);
    const savedChampion = listAfterGlobalSave.body.champions.find((champion) => champion.id === 1);
    expect(savedChampion.tagIds).toEqual([1, 2]);

    const promotionNotSupported = await request(app)
      .post("/champions/1/tags/promotion-requests")
      .set("Authorization", buildAuthHeader(1, config))
      .send({
        source_scope: "self",
        target_scope: "team",
        target_team_id: 1
      });
    expect(promotionNotSupported.status).toBe(400);
    expect(state.promotionRequests).toHaveLength(0);
  });

  it("allows member global champion tag edits when no admins exist", async () => {
    const { app, config, state } = createMockContext();
    state.users[0].role = "member";

    const memberCanWriteGlobal = await request(app)
      .put("/champions/1/tags")
      .set("Authorization", buildAuthHeader(2, config))
      .send({ tag_ids: [2] });
    expect(memberCanWriteGlobal.status).toBe(200);
    expect(memberCanWriteGlobal.body.tag_ids).toEqual([2]);

    const globalRead = await request(app)
      .get("/champions/1/tags")
      .set("Authorization", buildAuthHeader(3, config));
    expect(globalRead.status).toBe(200);
    expect(globalRead.body.tag_ids).toEqual([2]);
  });

  it("updates champion metadata with admin-only global permissions", async () => {
    const { app, config } = createMockContext();

    const unauthorizedWrite = await request(app).put("/champions/1/metadata").send({
      roles: ["Top"],
      damage_type: "AD",
      scaling: "Early"
    });
    expect(unauthorizedWrite.status).toBe(401);

    const memberForbiddenWrite = await request(app)
      .put("/champions/1/metadata")
      .set("Authorization", buildAuthHeader(2, config))
      .send({
        roles: ["Top"],
        damage_type: "AD",
        scaling: "Early"
      });
    expect(memberForbiddenWrite.status).toBe(403);

    const invalidPayload = await request(app)
      .put("/champions/1/metadata")
      .set("Authorization", buildAuthHeader(1, config))
      .send({
        roles: ["InvalidRole"],
        damage_type: "AD",
        scaling: "Early"
      });
    expect(invalidPayload.status).toBe(400);

    const adminWrite = await request(app)
      .put("/champions/1/metadata")
      .set("Authorization", buildAuthHeader(1, config))
      .send({
        roles: ["Top", "Jungle"],
        damage_type: "AD",
        scaling: "Late"
      });
    expect(adminWrite.status).toBe(200);
    expect(adminWrite.body.champion.role).toBe("Top");
    expect(adminWrite.body.champion.metadata.roles).toEqual(["Top", "Jungle"]);
    expect(adminWrite.body.champion.metadata.damageType).toBe("AD");
    expect(adminWrite.body.champion.metadata.scaling).toBe("Late");
  });

  it("supports admin-only tag catalog CRUD", async () => {
    const { app, config } = createMockContext();

    const unauthorizedCreate = await request(app)
      .post("/tags")
      .send({ name: "pick", category: "tempo" });
    expect(unauthorizedCreate.status).toBe(401);

    const memberForbiddenCreate = await request(app)
      .post("/tags")
      .set("Authorization", buildAuthHeader(2, config))
      .send({ name: "pick", category: "tempo" });
    expect(memberForbiddenCreate.status).toBe(403);

    const adminCreate = await request(app)
      .post("/tags")
      .set("Authorization", buildAuthHeader(1, config))
      .send({ name: "pick", category: "Tempo" });
    expect(adminCreate.status).toBe(201);
    expect(adminCreate.body.tag.name).toBe("pick");
    expect(adminCreate.body.tag.category).toBe("tempo");

    const duplicateCreate = await request(app)
      .post("/tags")
      .set("Authorization", buildAuthHeader(1, config))
      .send({ name: "pick", category: "tempo" });
    expect(duplicateCreate.status).toBe(409);

    const memberForbiddenUpdate = await request(app)
      .put(`/tags/${adminCreate.body.tag.id}`)
      .set("Authorization", buildAuthHeader(2, config))
      .send({ name: "pick-priority", category: "tempo" });
    expect(memberForbiddenUpdate.status).toBe(403);

    const duplicateUpdate = await request(app)
      .put(`/tags/${adminCreate.body.tag.id}`)
      .set("Authorization", buildAuthHeader(1, config))
      .send({ name: "engage", category: "utility" });
    expect(duplicateUpdate.status).toBe(409);

    const adminUpdate = await request(app)
      .put(`/tags/${adminCreate.body.tag.id}`)
      .set("Authorization", buildAuthHeader(1, config))
      .send({ name: "pick-priority", category: "macro" });
    expect(adminUpdate.status).toBe(200);
    expect(adminUpdate.body.tag.name).toBe("pick-priority");
    expect(adminUpdate.body.tag.category).toBe("macro");

    const inUseDeleteConflict = await request(app)
      .delete("/tags/1")
      .set("Authorization", buildAuthHeader(1, config));
    expect(inUseDeleteConflict.status).toBe(409);

    const adminDelete = await request(app)
      .delete(`/tags/${adminCreate.body.tag.id}`)
      .set("Authorization", buildAuthHeader(1, config));
    expect(adminDelete.status).toBe(204);

    const listAfterDelete = await request(app).get("/tags");
    expect(listAfterDelete.status).toBe(200);
    expect(listAfterDelete.body.tags.some((tag) => tag.name === "pick-priority")).toBe(false);
  });

  it("allows member tag catalog CRUD when no admins exist", async () => {
    const { app, config, state } = createMockContext();
    state.users[0].role = "member";

    const memberCreate = await request(app)
      .post("/tags")
      .set("Authorization", buildAuthHeader(2, config))
      .send({ name: "pick", category: "Tempo" });
    expect(memberCreate.status).toBe(201);
    expect(memberCreate.body.tag.name).toBe("pick");
    expect(memberCreate.body.tag.category).toBe("tempo");

    const memberUpdate = await request(app)
      .put(`/tags/${memberCreate.body.tag.id}`)
      .set("Authorization", buildAuthHeader(2, config))
      .send({ name: "pick-priority", category: "macro" });
    expect(memberUpdate.status).toBe(200);
    expect(memberUpdate.body.tag.name).toBe("pick-priority");

    const memberDelete = await request(app)
      .delete(`/tags/${memberCreate.body.tag.id}`)
      .set("Authorization", buildAuthHeader(2, config));
    expect(memberDelete.status).toBe(204);
  });

  it("enforces scoped required-check settings auth and promotion requests", async () => {
    const { app, config, state } = createMockContext();

    const readGlobalDefault = await request(app)
      .get("/checks/settings?scope=all")
      .set("Authorization", buildAuthHeader(2, config));
    expect(readGlobalDefault.status).toBe(200);
    expect(readGlobalDefault.body.toggles.requireFrontline).toBe(false);

    const readTeamAsMember = await request(app)
      .get("/checks/settings?scope=team&team_id=1")
      .set("Authorization", buildAuthHeader(2, config));
    expect(readTeamAsMember.status).toBe(200);
    expect(readTeamAsMember.body.toggles.requireDisengage).toBe(true);

    const outsiderCannotReadTeam = await request(app)
      .get("/checks/settings?scope=team&team_id=1")
      .set("Authorization", buildAuthHeader(3, config));
    expect(outsiderCannotReadTeam.status).toBe(403);

    const memberCanWriteSelf = await request(app)
      .put("/checks/settings")
      .set("Authorization", buildAuthHeader(2, config))
      .send({
        scope: "self",
        toggles: {
          requireFrontline: true,
          requireAntiTank: true
        }
      });
    expect(memberCanWriteSelf.status).toBe(200);
    expect(memberCanWriteSelf.body.toggles.requireAntiTank).toBe(true);

    const memberCannotWriteTeam = await request(app)
      .put("/checks/settings")
      .set("Authorization", buildAuthHeader(2, config))
      .send({
        scope: "team",
        team_id: 1,
        toggles: {
          requireFrontline: true
        }
      });
    expect(memberCannotWriteTeam.status).toBe(403);

    const leadCanWriteTeam = await request(app)
      .put("/checks/settings")
      .set("Authorization", buildAuthHeader(1, config))
      .send({
        scope: "team",
        team_id: 1,
        toggles: {
          requireFrontline: true,
          requireDisengage: false
        }
      });
    expect(leadCanWriteTeam.status).toBe(200);
    expect(leadCanWriteTeam.body.toggles.requireFrontline).toBe(true);
    expect(leadCanWriteTeam.body.toggles.requireDisengage).toBe(false);

    const memberCannotWriteGlobal = await request(app)
      .put("/checks/settings")
      .set("Authorization", buildAuthHeader(2, config))
      .send({
        scope: "all",
        toggles: {
          requireFrontline: true
        }
      });
    expect(memberCannotWriteGlobal.status).toBe(403);

    const adminCanWriteGlobal = await request(app)
      .put("/checks/settings")
      .set("Authorization", buildAuthHeader(1, config))
      .send({
        scope: "all",
        toggles: {
          requireFrontline: true,
          topMustBeThreat: false
        }
      });
    expect(adminCanWriteGlobal.status).toBe(200);
    expect(adminCanWriteGlobal.body.toggles.topMustBeThreat).toBe(false);

    const selfToTeamPromotion = await request(app)
      .post("/checks/promotion-requests")
      .set("Authorization", buildAuthHeader(2, config))
      .send({
        source_scope: "self",
        target_scope: "team",
        target_team_id: 1
      });
    expect(selfToTeamPromotion.status).toBe(201);
    expect(selfToTeamPromotion.body.promotion_request.entity_type).toBe("checks");
    expect(selfToTeamPromotion.body.promotion_request.target_scope).toBe("team");

    const outsiderSelfToTeamDenied = await request(app)
      .post("/checks/promotion-requests")
      .set("Authorization", buildAuthHeader(3, config))
      .send({
        source_scope: "self",
        target_scope: "team",
        target_team_id: 1
      });
    expect(outsiderSelfToTeamDenied.status).toBe(403);

    const memberTeamToGlobalDenied = await request(app)
      .post("/checks/promotion-requests")
      .set("Authorization", buildAuthHeader(2, config))
      .send({
        source_scope: "team",
        team_id: 1,
        target_scope: "all"
      });
    expect(memberTeamToGlobalDenied.status).toBe(403);

    const leadTeamToGlobal = await request(app)
      .post("/checks/promotion-requests")
      .set("Authorization", buildAuthHeader(1, config))
      .send({
        source_scope: "team",
        team_id: 1,
        target_scope: "all"
      });
    expect(leadTeamToGlobal.status).toBe(201);
    expect(leadTeamToGlobal.body.promotion_request.target_scope).toBe("all");

    expect(state.promotionRequests).toHaveLength(2);
  });

  it("enforces per-user pool isolation and idempotent membership updates", async () => {
    const { app, config } = createMockContext();
    const user1Auth = buildAuthHeader(1, config);
    const user2Auth = buildAuthHeader(2, config);

    const listUser1 = await request(app).get("/me/pools").set("Authorization", user1Auth);
    expect(listUser1.status).toBe(200);
    expect(listUser1.body.pools).toHaveLength(1);
    expect(listUser1.body.pools[0].id).toBe(1);
    expect(listUser1.body.pools[0].champion_familiarity).toEqual({ 1: 3 });

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
      .send({ champion_id: 2, familiarity: 5 });
    expect(addOnce.status).toBe(200);
    expect(addOnce.body.pool.champion_ids).toEqual([2]);
    expect(addOnce.body.pool.champion_familiarity).toEqual({ 2: 5 });

    const addTwice = await request(app)
      .post(`/me/pools/${newPoolId}/champions`)
      .set("Authorization", user1Auth)
      .send({ champion_id: 2 });
    expect(addTwice.status).toBe(200);
    expect(addTwice.body.pool.champion_ids).toEqual([2]);
    expect(addTwice.body.pool.champion_familiarity).toEqual({ 2: 5 });

    const updateFamiliarity = await request(app)
      .put(`/me/pools/${newPoolId}/champions/2/familiarity`)
      .set("Authorization", user1Auth)
      .send({ familiarity: 1 });
    expect(updateFamiliarity.status).toBe(200);
    expect(updateFamiliarity.body.pool.champion_familiarity).toEqual({ 2: 1 });

    const removeMissing = await request(app)
      .delete(`/me/pools/${newPoolId}/champions/999`)
      .set("Authorization", user1Auth);
    expect(removeMissing.status).toBe(200);
    expect(removeMissing.body.pool.champion_ids).toEqual([2]);
    expect(removeMissing.body.pool.champion_familiarity).toEqual({ 2: 1 });

    const invalidFamiliarity = await request(app)
      .put(`/me/pools/${newPoolId}/champions/2/familiarity`)
      .set("Authorization", user1Auth)
      .send({ familiarity: 9 });
    expect(invalidFamiliarity.status).toBe(400);
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
      .send({ riot_id: "Outsider#NA1", role: "member" });
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

    const soloTeam = await request(app)
      .post("/teams")
      .set("Authorization", leadAuth)
      .send({ name: "Solo Team", tag: "SOLO" });
    expect(soloTeam.status).toBe(201);

    const removeLastMemberBlocked = await request(app)
      .delete(`/teams/${soloTeam.body.team.id}/members/1`)
      .set("Authorization", leadAuth);
    expect(removeLastMemberBlocked.status).toBe(400);
    expect(removeLastMemberBlocked.body.error.message).toContain("last team member");
  });

  it("supports join request lifecycle with pending, approval, and cancellation", async () => {
    const { app, config } = createMockContext();
    const leadAuth = buildAuthHeader(1, config);
    const outsiderAuth = buildAuthHeader(3, config);

    const createRequest = await request(app)
      .post("/teams/1/join-requests")
      .set("Authorization", outsiderAuth)
      .send({ note: "Interested in joining." });
    expect(createRequest.status).toBe(201);
    expect(createRequest.body.request.status).toBe("pending");
    expect(createRequest.body.request.requested_lane).toBe("Top");
    expect(createRequest.body.request.requester.display_name).toBe("Outsider#NA1");

    const duplicate = await request(app)
      .post("/teams/1/join-requests")
      .set("Authorization", outsiderAuth)
      .send({ note: "Interested in joining." });
    expect(duplicate.status).toBe(409);

    const pendingForLead = await request(app)
      .get("/teams/1/join-requests?status=pending")
      .set("Authorization", leadAuth);
    expect(pendingForLead.status).toBe(200);
    expect(pendingForLead.body.requests).toHaveLength(1);

    const approve = await request(app)
      .put(`/teams/1/join-requests/${createRequest.body.request.id}`)
      .set("Authorization", leadAuth)
      .send({ status: "approved" });
    expect(approve.status).toBe(200);
    expect(approve.body.request.status).toBe("approved");

    const membersAfterApprove = await request(app)
      .get("/teams/1/members")
      .set("Authorization", leadAuth);
    expect(membersAfterApprove.status).toBe(200);
    expect(
      membersAfterApprove.body.members.some(
        (member) => member.user_id === 3 && member.lane === "Top" && member.display_name === "Outsider#NA1"
      )
    ).toBe(true);

    const teamCreate = await request(app)
      .post("/teams")
      .set("Authorization", leadAuth)
      .send({ name: "Team Bravo", tag: "BRV" });
    expect(teamCreate.status).toBe(201);

    const requestToCancel = await request(app)
      .post(`/teams/${teamCreate.body.team.id}/join-requests`)
      .set("Authorization", outsiderAuth)
      .send({ note: "Please review." });
    expect(requestToCancel.status).toBe(201);

    const cancel = await request(app)
      .delete(`/teams/${teamCreate.body.team.id}/join-requests/${requestToCancel.body.request.id}`)
      .set("Authorization", outsiderAuth);
    expect(cancel.status).toBe(200);
    expect(cancel.body.ok).toBe(true);
  });

  it("blocks join flows when user has no primary role set", async () => {
    const { app, config, state } = createMockContext();
    const leadAuth = buildAuthHeader(1, config);
    const noRoleAuth = buildAuthHeader(4, config);
    const outsiderAuth = buildAuthHeader(3, config);

    const noRoleRequest = await request(app)
      .post("/teams/1/join-requests")
      .set("Authorization", noRoleAuth)
      .send({ note: "Can I join?" });
    expect(noRoleRequest.status).toBe(400);
    expect(noRoleRequest.body.error.message).toContain("primary role");

    const noRoleInvite = await request(app)
      .post("/teams/1/members")
      .set("Authorization", leadAuth)
      .send({ user_id: 4, role: "member", team_role: "substitute" });
    expect(noRoleInvite.status).toBe(400);
    expect(noRoleInvite.body.error.message).toContain("primary role");

    const joinRequest = await request(app)
      .post("/teams/1/join-requests")
      .set("Authorization", outsiderAuth)
      .send({ note: "I can fill top lane." });
    expect(joinRequest.status).toBe(201);

    const outsider = state.users.find((candidate) => candidate.id === 3);
    outsider.primary_role = null;

    const approve = await request(app)
      .put(`/teams/1/join-requests/${joinRequest.body.request.id}`)
      .set("Authorization", leadAuth)
      .send({ status: "approved" });
    expect(approve.status).toBe(400);
    expect(approve.body.error.message).toContain("primary role");
  });
});
