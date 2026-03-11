import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../../server/app.js";
import { signAccessToken } from "../../server/auth/tokens.js";
import { OWNER_ADMIN_EMAILS } from "../../server/user-roles.js";

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
        email: "jirving0311@gmail.com",
        role: "admin",
        password_hash: "seeded",
        game_name: "LeadPlayer",
        tagline: "NA1",
        primary_role: "Mid",
        secondary_roles: ["Top"],
        default_team_id: null,
        active_team_id: null,
        riot_id_correction_count: 0,
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
        riot_id_correction_count: 0,
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
        riot_id_correction_count: 0,
        created_at: "2026-01-01T00:00:00.000Z"
      },
      {
        id: 4,
        email: "norole@example.com",
        role: "member",
        password_hash: "seeded",
        game_name: "NoRole",
        tagline: "NA1",
        primary_role: null,
        secondary_roles: [],
        default_team_id: null,
        active_team_id: null,
        riot_id_correction_count: 0,
        created_at: "2026-01-01T00:00:00.000Z"
      },
      {
        id: 5,
        email: "global@example.com",
        role: "global",
        password_hash: "seeded",
        game_name: "GlobalEditor",
        tagline: "NA1",
        primary_role: "Jungle",
        secondary_roles: ["Top"],
        default_team_id: null,
        active_team_id: null,
        riot_id_correction_count: 0,
        created_at: "2026-01-01T00:00:00.000Z"
      }
    ],
    requirementDefinitions: [
      {
        id: 1,
        name: "Frontline Anchor",
        definition: "Team must include at least one frontline tag.",
        rules: [
          {
            expr: { tag: "Frontline" },
            minCount: 1
          }
        ],
        created_by_user_id: 1,
        updated_by_user_id: 1,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z"
      }
    ],
    compositions: [
      {
        id: 1,
        name: "Standard Comp",
        description: "Baseline composition profile",
        requirement_ids: [1],
        is_active: true,
        created_by_user_id: 1,
        updated_by_user_id: 1,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z"
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
      { id: 1, name: "engage", definition: "Helps a team start fights decisively." },
      { id: 2, name: "frontline", definition: "Provides durable front-to-back pressure." }
    ],
    userChampionTagIds: new Map([
      ["self:2:1", new Set([2])]
    ]),
    teamChampionTagIds: new Map([
      ["team:1:1", new Set([1])]
    ]),
    userChampionMetadata: new Map([
      [
        "self:2:1",
        {
          roles: ["Support"],
          roleProfiles: {
            Support: {
              primaryDamageType: "utility",
              effectiveness: { early: "neutral", mid: "strong", late: "weak" }
            }
          },
          damageType: "Utility",
          scaling: "Mid"
        }
      ]
    ]),
    teamChampionMetadata: new Map([
      [
        "team:1:1",
        {
          roles: ["Top"],
          roleProfiles: {
            Top: {
              primaryDamageType: "ad",
              effectiveness: { early: "strong", mid: "neutral", late: "weak" }
            }
          },
          damageType: "AD",
          scaling: "Early"
        }
      ]
    ]),
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
    joinRequests: [],
    memberInvitations: []
  };

  let nextUserId = 6;
  let nextPoolId = 3;
  let nextTeamId = 2;
  let nextJoinRequestId = 1;
  let nextMemberInvitationId = 1;
  let nextTagId = 3;
  let nextRequirementDefinitionId = 2;
  let nextCompositionId = 2;

  const usersRepository = {
    async createUser({ email, passwordHash, gameName, tagline, role = "member" }) {
      const existing = state.users.find((candidate) => candidate.email === email);
      if (existing) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }

      const user = {
        id: nextUserId,
        email,
        role: OWNER_ADMIN_EMAILS.has(String(email).trim().toLowerCase()) ? "admin" : role,
        password_hash: passwordHash,
        game_name: gameName,
        tagline,
        primary_role: "Mid",
        secondary_roles: [],
        default_team_id: null,
        active_team_id: null,
        riot_id_correction_count: 0,
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
        riot_id_correction_count: user.riot_id_correction_count,
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
      return state.users.filter((candidate) => OWNER_ADMIN_EMAILS.has(String(candidate.email ?? "").trim().toLowerCase())).length;
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

    async listUsersForAdmin() {
      return [...state.users];
    },

    async updateUserRole(userId, role) {
      const user = state.users.find((candidate) => candidate.id === userId) ?? null;
      if (!user) {
        return null;
      }
      user.role = role;
      return user;
    },

    async updateUserRiotIdOneTime(userId, { gameName, tagline }) {
      const user = state.users.find((candidate) => candidate.id === userId) ?? null;
      if (!user) {
        return null;
      }
      const correctionCount = Number.parseInt(String(user.riot_id_correction_count ?? 0), 10);
      if (Number.isInteger(correctionCount) && correctionCount >= 1) {
        return null;
      }
      user.game_name = gameName;
      user.tagline = tagline;
      user.riot_id_correction_count = (Number.isInteger(correctionCount) ? correctionCount : 0) + 1;
      return user;
    },

    async deleteUser(userId) {
      const index = state.users.findIndex((candidate) => candidate.id === userId);
      if (index < 0) {
        return false;
      }
      state.users.splice(index, 1);
      return true;
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
        active_team_id: user.active_team_id ?? null
      };
    },

    async updateTeamContext(userId, { activeTeamId }) {
      const user = state.users.find((candidate) => candidate.id === userId) ?? null;
      if (!user) {
        return null;
      }
      user.active_team_id = activeTeamId;
      return {
        id: user.id,
        active_team_id: user.active_team_id
      };
    }
  };

  function scopedKey(scope, ownerId, championId) {
    return `${scope}:${ownerId}:${championId}`;
  }

  function cloneChampionMetadata(metadata) {
    const source = metadata && typeof metadata === "object" ? metadata : {};
    const roleProfiles = source.roleProfiles && typeof source.roleProfiles === "object"
      ? Object.fromEntries(
          Object.entries(source.roleProfiles).map(([role, profile]) => [
            role,
            {
              primaryDamageType: profile?.primaryDamageType ?? "mixed",
              effectiveness: {
                early: profile?.effectiveness?.early ?? "neutral",
                mid: profile?.effectiveness?.mid ?? "neutral",
                late: profile?.effectiveness?.late ?? "neutral"
              }
            }
          ])
        )
      : {};
    return {
      ...source,
      roles: Array.isArray(source.roles) ? [...source.roles] : [],
      roleProfiles
    };
  }

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
    async listMetadataScopeFlagsByChampionIds({ championIds, userId = null, teamId = null }) {
      return Object.fromEntries(
        championIds.map((championId) => [
          championId,
          {
            self: Number.isInteger(userId) ? state.userChampionMetadata.has(scopedKey("self", userId, championId)) : false,
            team: Number.isInteger(teamId) ? state.teamChampionMetadata.has(scopedKey("team", teamId, championId)) : false,
            all: true
          }
        ])
      );
    },
    async getResolvedChampionMetadataForScope({ championId, scope = "all", userId = null, teamId = null }) {
      const champion = state.champions.find((item) => item.id === championId) ?? null;
      if (!champion) {
        return null;
      }
      if (scope === "all") {
        return {
          champion,
          metadata: cloneChampionMetadata(champion.metadata),
          hasCustomMetadata: true,
          resolvedScope: "all"
        };
      }

      const ownerId = scope === "self" ? userId : teamId;
      const scopedStore = scope === "self" ? state.userChampionMetadata : state.teamChampionMetadata;
      const scopedMetadata = Number.isInteger(ownerId)
        ? scopedStore.get(scopedKey(scope, ownerId, championId))
        : null;
      return {
        champion,
        metadata: cloneChampionMetadata(scopedMetadata ?? champion.metadata),
        hasCustomMetadata: Boolean(scopedMetadata),
        resolvedScope: scopedMetadata ? scope : "all"
      };
    },
    async updateChampionMetadataForScope({ championId, scope = "all", userId = null, teamId = null, roles, roleProfiles }) {
      const champion = state.champions.find((item) => item.id === championId);
      if (!champion) {
        return null;
      }
      const firstRole = roles[0];
      const firstRoleProfile = roleProfiles[firstRole] ?? null;
      const primaryDamageType = String(firstRoleProfile?.primaryDamageType ?? "").toLowerCase();
      const nextMetadata = {
        roles: [...roles],
        roleProfiles: cloneChampionMetadata({ roleProfiles }).roleProfiles,
        damageType: primaryDamageType === "ad"
          ? "AD"
          : primaryDamageType === "ap"
            ? "AP"
            : primaryDamageType === "utility"
              ? "Utility"
              : "Mixed",
        scaling: "Mid"
      };

      if (scope === "all") {
        champion.role = roles[0];
        champion.metadata = {
          ...(champion.metadata && typeof champion.metadata === "object" ? champion.metadata : {}),
          ...nextMetadata
        };
      } else {
        const ownerId = scope === "self" ? userId : teamId;
        const store = scope === "self" ? state.userChampionMetadata : state.teamChampionMetadata;
        store.set(scopedKey(scope, ownerId, championId), nextMetadata);
      }

      return this.getResolvedChampionMetadataForScope({ championId, scope, userId, teamId });
    },
    async updateChampionReviewState(championId, { reviewed, reviewedByUserId = null }) {
      const champion = state.champions.find((item) => item.id === championId);
      if (!champion) {
        return null;
      }
      champion.metadata = {
        ...(champion.metadata && typeof champion.metadata === "object" ? champion.metadata : {}),
        reviewed: reviewed === true,
        reviewedByUserId: reviewed === true ? reviewedByUserId : null,
        reviewedAt: reviewed === true ? "2026-01-01T00:00:00.000Z" : null
      };
      champion.reviewed = reviewed === true;
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

    async createTag({ name, definition }) {
      const duplicate = state.tags.some((tag) => tag.name === name);
      if (duplicate) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }
      const created = {
        id: nextTagId,
        name,
        definition
      };
      nextTagId += 1;
      state.tags.push(created);
      return created;
    },

    async updateTag(tagId, { name, definition }) {
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
      existing.definition = definition;
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

  const compositionsCatalogRepository = {
    async listRequirements() {
      return state.requirementDefinitions.map((requirement) => ({
        ...requirement,
        rules: Array.isArray(requirement.rules) ? requirement.rules.map((rule) => ({ ...rule })) : []
      }));
    },
    async getRequirementById(requirementId) {
      const requirement = state.requirementDefinitions.find((candidate) => candidate.id === requirementId) ?? null;
      if (!requirement) {
        return null;
      }
      return {
        ...requirement,
        rules: Array.isArray(requirement.rules) ? requirement.rules.map((rule) => ({ ...rule })) : []
      };
    },
    async listMissingRequirementIds(requirementIds = []) {
      const existingIds = new Set(state.requirementDefinitions.map((requirement) => requirement.id));
      const deduped = [...new Set(requirementIds.map((value) => Number.parseInt(String(value), 10)))].filter(
        (value) => Number.isInteger(value) && value > 0
      );
      return deduped.filter((id) => !existingIds.has(id));
    },
    async createRequirement({ name, definition, rules, actorUserId }) {
      if (state.requirementDefinitions.some((requirement) => requirement.name.toLowerCase() === name.toLowerCase())) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }
      const created = {
        id: nextRequirementDefinitionId,
        name,
        definition,
        rules: Array.isArray(rules) ? rules.map((rule) => ({ ...rule })) : [],
        created_by_user_id: actorUserId ?? null,
        updated_by_user_id: actorUserId ?? null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z"
      };
      nextRequirementDefinitionId += 1;
      state.requirementDefinitions.push(created);
      return { ...created, rules: created.rules.map((rule) => ({ ...rule })) };
    },
    async updateRequirement(requirementId, { name, definition, rules, actorUserId }) {
      const requirement = state.requirementDefinitions.find((candidate) => candidate.id === requirementId) ?? null;
      if (!requirement) {
        return null;
      }
      if (
        name &&
        state.requirementDefinitions.some(
          (candidate) => candidate.id !== requirementId && candidate.name.toLowerCase() === name.toLowerCase()
        )
      ) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }
      if (typeof name === "string" && name.trim() !== "") {
        requirement.name = name.trim();
      }
      if (typeof definition === "string") {
        requirement.definition = definition;
      }
      if (Array.isArray(rules)) {
        requirement.rules = rules.map((rule) => ({ ...rule }));
      }
      requirement.updated_by_user_id = actorUserId ?? null;
      requirement.updated_at = "2026-01-01T00:00:00.000Z";
      return { ...requirement, rules: requirement.rules.map((rule) => ({ ...rule })) };
    },
    async deleteRequirement(requirementId) {
      const index = state.requirementDefinitions.findIndex((candidate) => candidate.id === requirementId);
      if (index < 0) {
        return null;
      }
      const [deleted] = state.requirementDefinitions.splice(index, 1);
      return { ...deleted, rules: deleted.rules.map((rule) => ({ ...rule })) };
    },
    async removeRequirementFromCompositions(requirementId, actorUserId) {
      for (const composition of state.compositions) {
        if (!composition.requirement_ids.includes(requirementId)) {
          continue;
        }
        composition.requirement_ids = composition.requirement_ids.filter((id) => id !== requirementId);
        composition.updated_by_user_id = actorUserId ?? null;
        composition.updated_at = "2026-01-01T00:00:00.000Z";
      }
    },
    async listCompositions() {
      return state.compositions.map((composition) => ({
        ...composition,
        requirement_ids: [...composition.requirement_ids]
      }));
    },
    async getCompositionById(compositionId) {
      const composition = state.compositions.find((candidate) => candidate.id === compositionId) ?? null;
      if (!composition) {
        return null;
      }
      return {
        ...composition,
        requirement_ids: [...composition.requirement_ids]
      };
    },
    async getActiveComposition() {
      const composition = state.compositions.find((candidate) => candidate.is_active) ?? null;
      if (!composition) {
        return null;
      }
      return {
        ...composition,
        requirement_ids: [...composition.requirement_ids]
      };
    },
    async createComposition({ name, description, requirementIds, isActive, actorUserId }) {
      if (state.compositions.some((composition) => composition.name.toLowerCase() === name.toLowerCase())) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }
      if (isActive) {
        for (const composition of state.compositions) {
          composition.is_active = false;
        }
      }
      const created = {
        id: nextCompositionId,
        name,
        description,
        requirement_ids: [...new Set(requirementIds)].sort((left, right) => left - right),
        is_active: isActive === true,
        created_by_user_id: actorUserId ?? null,
        updated_by_user_id: actorUserId ?? null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z"
      };
      nextCompositionId += 1;
      state.compositions.push(created);
      return { ...created, requirement_ids: [...created.requirement_ids] };
    },
    async updateComposition(compositionId, { name, description, requirementIds, isActive, actorUserId }) {
      const composition = state.compositions.find((candidate) => candidate.id === compositionId) ?? null;
      if (!composition) {
        return null;
      }
      if (
        name &&
        state.compositions.some(
          (candidate) => candidate.id !== compositionId && candidate.name.toLowerCase() === name.toLowerCase()
        )
      ) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }
      if (typeof isActive === "boolean" && isActive) {
        for (const candidate of state.compositions) {
          if (candidate.id !== compositionId) {
            candidate.is_active = false;
          }
        }
      }
      if (typeof name === "string" && name.trim() !== "") {
        composition.name = name.trim();
      }
      if (typeof description === "string") {
        composition.description = description;
      }
      if (Array.isArray(requirementIds)) {
        composition.requirement_ids = [...new Set(requirementIds)].sort((left, right) => left - right);
      }
      if (typeof isActive === "boolean") {
        composition.is_active = isActive;
      }
      composition.updated_by_user_id = actorUserId ?? null;
      composition.updated_at = "2026-01-01T00:00:00.000Z";
      return { ...composition, requirement_ids: [...composition.requirement_ids] };
    },
    async deleteComposition(compositionId) {
      const index = state.compositions.findIndex((candidate) => candidate.id === compositionId);
      if (index < 0) {
        return null;
      }
      const [deleted] = state.compositions.splice(index, 1);
      return { ...deleted, requirement_ids: [...deleted.requirement_ids] };
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
    },
    async countChampionTagPromotionsByRequester(requestedBy) {
      const counts = {
        pending: 0,
        approved: 0,
        rejected: 0
      };
      for (const requestRecord of state.promotionRequests) {
        if (
          requestRecord.requested_by === requestedBy &&
          requestRecord.entity_type === "champion_tags"
        ) {
          const status = typeof requestRecord.status === "string" ? requestRecord.status.trim().toLowerCase() : "";
          if (status && Object.prototype.hasOwnProperty.call(counts, status)) {
            counts[status] += 1;
          }
        }
      }
      return counts;
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
    },
    async listPoolSummariesByUser(userId) {
      return state.pools
        .filter((pool) => pool.user_id === userId)
        .map((pool) => ({
          id: pool.id,
          name: pool.name ?? "",
          champion_count: state.poolChampionIds.get(pool.id)?.size ?? 0
        }));
    }
  };

  function mapInvitation(invitation) {
    const targetUser = state.users.find((candidate) => candidate.id === invitation.target_user_id) ?? null;
    const targetDisplayName = targetUser?.game_name && targetUser?.tagline
      ? `${targetUser.game_name}#${targetUser.tagline}`
      : (targetUser?.game_name ?? targetUser?.email ?? `User ${invitation.target_user_id}`);
    const team = state.teams.find((candidate) => candidate.id === invitation.team_id) ?? null;
    return {
      ...invitation,
      target: {
        user_id: invitation.target_user_id,
        email: targetUser?.email ?? null,
        game_name: targetUser?.game_name ?? "",
        tagline: targetUser?.tagline ?? "",
        primary_role: targetUser?.primary_role ?? null,
        display_name: targetDisplayName
      },
      team: {
        name: team?.name ?? null,
        tag: team?.tag ?? null
      }
    };
  }

  const teamsRepository = {
    async teamExists(teamId) {
      return state.teams.some((team) => team.id === teamId);
    },
    async createTeam({ name, tag, logoBlob, logoMimeType, creatorUserId }) {
      const duplicateName = state.teams.find(
        (candidate) => candidate.name.trim().toLowerCase() === String(name).trim().toLowerCase()
      );
      if (duplicateName) {
        const error = new Error("duplicate");
        error.code = "23505";
        error.constraint = "teams_name_lower_unique_idx";
        throw error;
      }
      const duplicateTag = state.teams.find(
        (candidate) => candidate.tag.trim().toLowerCase() === String(tag).trim().toLowerCase()
      );
      if (duplicateTag) {
        const error = new Error("duplicate");
        error.code = "23505";
        error.constraint = "teams_tag_lower_unique_idx";
        throw error;
      }

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
      const duplicateName = state.teams.find(
        (candidate) =>
          candidate.id !== teamId && candidate.name.trim().toLowerCase() === String(name).trim().toLowerCase()
      );
      if (duplicateName) {
        const error = new Error("duplicate");
        error.code = "23505";
        error.constraint = "teams_name_lower_unique_idx";
        throw error;
      }
      const duplicateTag = state.teams.find(
        (candidate) =>
          candidate.id !== teamId && candidate.tag.trim().toLowerCase() === String(tag).trim().toLowerCase()
      );
      if (duplicateTag) {
        const error = new Error("duplicate");
        error.code = "23505";
        error.constraint = "teams_tag_lower_unique_idx";
        throw error;
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
    async createMemberInvitation({
      teamId,
      targetUserId,
      invitedByUserId,
      requestedLane,
      note = "",
      role = "member",
      teamRole = "primary"
    }) {
      const existing = state.memberInvitations.find(
        (candidate) =>
          candidate.team_id === teamId && candidate.target_user_id === targetUserId && candidate.status === "pending"
      );
      if (existing) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }
      const invitation = {
        id: nextMemberInvitationId,
        team_id: teamId,
        target_user_id: targetUserId,
        requested_lane: requestedLane,
        note,
        status: "pending",
        role,
        team_role: teamRole,
        invited_by_user_id: invitedByUserId,
        reviewed_by_user_id: null,
        reviewed_at: null,
        created_at: "2026-01-01T00:00:00.000Z"
      };
      nextMemberInvitationId += 1;
      state.memberInvitations.push(invitation);
      return mapInvitation(invitation);
    },
    async listMemberInvitationsForTeam(teamId, { status = null } = {}) {
      return state.memberInvitations
        .filter(
          (candidate) => candidate.team_id === teamId && (status === null || candidate.status === status)
        )
        .map(mapInvitation);
    },
    async listMemberInvitationsForUser(targetUserId, { status = null } = {}) {
      return state.memberInvitations
        .filter(
          (candidate) => candidate.target_user_id === targetUserId && (status === null || candidate.status === status)
        )
        .map(mapInvitation);
    },
    async getMemberInvitation(teamId, invitationId) {
      const invitation = state.memberInvitations.find(
        (candidate) => candidate.team_id === teamId && candidate.id === invitationId
      );
      return invitation ? mapInvitation(invitation) : null;
    },
    async setMemberInvitationStatus(teamId, invitationId, { status, reviewedByUserId }) {
      const invitation = state.memberInvitations.find(
        (candidate) => candidate.team_id === teamId && candidate.id === invitationId && candidate.status === "pending"
      );
      if (!invitation) {
        return null;
      }
      invitation.status = status;
      invitation.reviewed_by_user_id = reviewedByUserId;
      invitation.reviewed_at = "2026-01-01T00:00:00.000Z";
      return mapInvitation(invitation);
    },
    async acceptMemberInvitation(teamId, invitationId, { reviewedByUserId }) {
      const invitation = state.memberInvitations.find(
        (candidate) => candidate.team_id === teamId && candidate.id === invitationId && candidate.status === "pending"
      );
      if (!invitation) {
        return null;
      }
      const existingMembership = state.teamMembers.find(
        (candidate) => candidate.team_id === teamId && candidate.user_id === invitation.target_user_id
      );
      if (existingMembership) {
        const error = new Error("duplicate membership");
        error.code = "23505";
        throw error;
      }
      invitation.status = "accepted";
      invitation.reviewed_by_user_id = reviewedByUserId;
      invitation.reviewed_at = "2026-01-01T00:00:00.000Z";
      state.teamMembers.push({
        team_id: teamId,
        user_id: invitation.target_user_id,
        role: invitation.role,
        team_role: invitation.team_role,
        created_at: "2026-01-01T00:00:00.000Z"
      });
      return mapInvitation(invitation);
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
    compositionsCatalogRepository,
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
    expect(state.users).toHaveLength(6);
    expect(state.users[5].password_hash).not.toBe("strong-pass-123");

    const loginResponse = await request(app)
      .post("/auth/login")
      .send({ email: "test@example.com", password: "strong-pass-123" });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user.id).toBe(6);
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

  it("reads and updates active team-context with membership validation", async () => {
    const { app, config, state } = createMockContext();
    const leadAuth = buildAuthHeader(1, config);

    const initial = await request(app).get("/me/team-context").set("Authorization", leadAuth);
    expect(initial.status).toBe(200);
    expect(initial.body.teamContext).toEqual({
      activeTeamId: null
    });

    const updated = await request(app)
      .put("/me/team-context")
      .set("Authorization", leadAuth)
      .send({ activeTeamId: 1 });
    expect(updated.status).toBe(200);
    expect(updated.body.teamContext).toEqual({
      activeTeamId: 1
    });

    const persisted = await request(app).get("/me/team-context").set("Authorization", leadAuth);
    expect(persisted.status).toBe(200);
    expect(persisted.body.teamContext).toEqual({
      activeTeamId: 1
    });

    const invalidMembership = await request(app)
      .put("/me/team-context")
      .set("Authorization", leadAuth)
      .send({ activeTeamId: 999 });
    expect(invalidMembership.status).toBe(400);
    expect(invalidMembership.body.error.code).toBe("BAD_REQUEST");

    const leadUser = state.users.find((candidate) => candidate.id === 1);
    leadUser.active_team_id = 999;

    const normalized = await request(app).get("/me/team-context").set("Authorization", leadAuth);
    expect(normalized.status).toBe(200);
    expect(normalized.body.teamContext).toEqual({
      activeTeamId: null
    });
    expect(leadUser.active_team_id).toBe(null);
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

    const globalEditorCanWriteGlobal = await request(app)
      .put("/champions/1/tags")
      .set("Authorization", buildAuthHeader(5, config))
      .send({ tag_ids: [2], reviewed: true });
    expect(globalEditorCanWriteGlobal.status).toBe(200);
    expect(globalEditorCanWriteGlobal.body.reviewed).toBe(true);

    const selfScopeResponse = await request(app)
      .put("/champions/1/tags")
      .set("Authorization", buildAuthHeader(2, config))
      .send({ scope: "self", tag_ids: [2] });
    expect(selfScopeResponse.status).toBe(200);
    expect(selfScopeResponse.body.scope).toBe("self");
    expect(selfScopeResponse.body.tag_ids).toEqual([2]);

    const globalReadDefaultScope = await request(app)
      .get("/champions/1/tags")
      .set("Authorization", buildAuthHeader(2, config));
    expect(globalReadDefaultScope.status).toBe(200);
    expect(globalReadDefaultScope.body.scope).toBe("all");
    expect(globalReadDefaultScope.body.team_id).toBeNull();
    expect(globalReadDefaultScope.body.tag_ids).toEqual([2]);

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
    expect(globalRead.body.reviewed).toBe(true);

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
    state.users[0].email = "legacy-admin@example.com";
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

  it("updates champion metadata with global or admin global permissions", async () => {
    const { app, config } = createMockContext();
    const roleProfilesPayload = {
      Top: {
        primary_damage_type: "ad",
        effectiveness: { early: "strong", mid: "neutral", late: "weak" }
      }
    };

    const unauthorizedWrite = await request(app).put("/champions/1/metadata").send({
      roles: ["Top"],
      role_profiles: roleProfilesPayload
    });
    expect(unauthorizedWrite.status).toBe(401);

    const memberForbiddenWrite = await request(app)
      .put("/champions/1/metadata")
      .set("Authorization", buildAuthHeader(2, config))
      .send({
        roles: ["Top"],
        role_profiles: roleProfilesPayload
      });
    expect(memberForbiddenWrite.status).toBe(403);

    const globalWrite = await request(app)
      .put("/champions/1/metadata")
      .set("Authorization", buildAuthHeader(5, config))
      .send({
        roles: ["Top"],
        role_profiles: roleProfilesPayload
      });
    expect(globalWrite.status).toBe(200);
    expect(globalWrite.body.champion.metadata.roleProfiles.Top.primaryDamageType).toBe("ad");

    const invalidPayload = await request(app)
      .put("/champions/1/metadata")
      .set("Authorization", buildAuthHeader(1, config))
      .send({
        roles: ["InvalidRole"],
        role_profiles: roleProfilesPayload
      });
    expect(invalidPayload.status).toBe(400);

    const adminWrite = await request(app)
      .put("/champions/1/metadata")
      .set("Authorization", buildAuthHeader(1, config))
      .send({
        roles: ["Top", "Jungle"],
        role_profiles: {
          Top: {
            primary_damage_type: "ad",
            effectiveness: { early: "strong", mid: "neutral", late: "weak" }
          },
          Jungle: {
            primary_damage_type: "utility",
            effectiveness: { early: "neutral", mid: "strong", late: "weak" }
          }
        }
      });
    expect(adminWrite.status).toBe(200);
    expect(adminWrite.body.champion.role).toBe("Top");
    expect(adminWrite.body.champion.metadata.roles).toEqual(["Top", "Jungle"]);
    expect(adminWrite.body.champion.metadata.roleProfiles.Top.primaryDamageType).toBe("ad");
    expect(adminWrite.body.champion.metadata.roleProfiles.Jungle.primaryDamageType).toBe("utility");
  });

  it("reads personalized metadata scope indicators on champion list", async () => {
    const { app, config, state } = createMockContext();
    state.users[1].active_team_id = 1;

    const response = await request(app)
      .get("/champions")
      .set("Authorization", buildAuthHeader(2, config));

    expect(response.status).toBe(200);
    const ahri = response.body.champions.find((champion) => champion.id === 1);
    expect(ahri.metadata_scopes).toEqual({
      self: true,
      team: true,
      all: true
    });
  });

  it("reads and writes self-scoped champion metadata without mutating global metadata", async () => {
    const { app, config, state } = createMockContext();

    const readExisting = await request(app)
      .get("/champions/1/metadata?scope=self")
      .set("Authorization", buildAuthHeader(2, config));
    expect(readExisting.status).toBe(200);
    expect(readExisting.body.has_custom_metadata).toBe(true);
    expect(readExisting.body.resolved_scope).toBe("self");
    expect(readExisting.body.metadata.roles).toEqual(["Support"]);

    const writeSelf = await request(app)
      .put("/champions/1/metadata")
      .set("Authorization", buildAuthHeader(2, config))
      .send({
        scope: "self",
        roles: ["ADC"],
        role_profiles: {
          ADC: {
            primary_damage_type: "ad",
            effectiveness: { early: "weak", mid: "strong", late: "strong" }
          }
        }
      });
    expect(writeSelf.status).toBe(200);
    expect(writeSelf.body.scope).toBe("self");
    expect(writeSelf.body.metadata.roles).toEqual(["ADC"]);
    expect(writeSelf.body.has_custom_metadata).toBe(true);
    expect(state.champions[0].metadata.roles).toEqual(["MID"]);

    const readBack = await request(app)
      .get("/champions/1/metadata?scope=self")
      .set("Authorization", buildAuthHeader(2, config));
    expect(readBack.status).toBe(200);
    expect(readBack.body.metadata.roles).toEqual(["ADC"]);
    expect(readBack.body.metadata.roleProfiles.ADC.primaryDamageType).toBe("ad");
  });

  it("enforces team membership rules for team-scoped champion metadata", async () => {
    const { app, config } = createMockContext();

    const memberForbiddenWrite = await request(app)
      .put("/champions/1/metadata")
      .set("Authorization", buildAuthHeader(2, config))
      .send({
        scope: "team",
        team_id: 1,
        roles: ["Support"],
        role_profiles: {
          Support: {
            primary_damage_type: "utility",
            effectiveness: { early: "neutral", mid: "strong", late: "weak" }
          }
        }
      });
    expect(memberForbiddenWrite.status).toBe(403);

    const leadWrite = await request(app)
      .put("/champions/1/metadata")
      .set("Authorization", buildAuthHeader(1, config))
      .send({
        scope: "team",
        team_id: 1,
        roles: ["Top"],
        role_profiles: {
          Top: {
            primary_damage_type: "ad",
            effectiveness: { early: "strong", mid: "neutral", late: "weak" }
          }
        }
      });
    expect(leadWrite.status).toBe(200);
    expect(leadWrite.body.scope).toBe("team");
    expect(leadWrite.body.team_id).toBe(1);
    expect(leadWrite.body.metadata.roles).toEqual(["Top"]);
  });

  it("allows member global metadata edits when no admins exist", async () => {
    const { app, config, state } = createMockContext();
    state.users[0].email = "legacy-admin@example.com";
    state.users[0].role = "member";

    const memberWrite = await request(app)
      .put("/champions/1/metadata")
      .set("Authorization", buildAuthHeader(2, config))
      .send({
        roles: ["Top", "Jungle"],
        role_profiles: {
          Top: {
            primary_damage_type: "ad",
            effectiveness: { early: "strong", mid: "neutral", late: "weak" }
          },
          Jungle: {
            primary_damage_type: "mixed",
            effectiveness: { early: "weak", mid: "strong", late: "strong" }
          }
        }
      });
    expect(memberWrite.status).toBe(200);
    expect(memberWrite.body.champion.role).toBe("Top");
    expect(memberWrite.body.champion.metadata.roles).toEqual(["Top", "Jungle"]);
    expect(memberWrite.body.champion.metadata.roleProfiles.Top.primaryDamageType).toBe("ad");
    expect(memberWrite.body.champion.metadata.roleProfiles.Jungle.primaryDamageType).toBe("mixed");
  });

  it("supports admin-only tag catalog CRUD", async () => {
    const { app, config } = createMockContext();

    const unauthorizedCreate = await request(app)
      .post("/tags")
      .send({ name: "pick", definition: "Creates pick threat around fog and setups." });
    expect(unauthorizedCreate.status).toBe(401);

    const memberForbiddenCreate = await request(app)
      .post("/tags")
      .set("Authorization", buildAuthHeader(2, config))
      .send({ name: "pick", definition: "Creates pick threat around fog and setups." });
    expect(memberForbiddenCreate.status).toBe(403);

    const adminCreate = await request(app)
      .post("/tags")
      .set("Authorization", buildAuthHeader(1, config))
      .send({ name: "pick", definition: "Creates pick threat around fog and setups." });
    expect(adminCreate.status).toBe(201);
    expect(adminCreate.body.tag.name).toBe("pick");
    expect(adminCreate.body.tag.definition).toContain("pick threat");

    const duplicateCreate = await request(app)
      .post("/tags")
      .set("Authorization", buildAuthHeader(1, config))
      .send({ name: "pick", definition: "Creates pick threat around fog and setups." });
    expect(duplicateCreate.status).toBe(409);

    const memberForbiddenUpdate = await request(app)
      .put(`/tags/${adminCreate.body.tag.id}`)
      .set("Authorization", buildAuthHeader(2, config))
      .send({ name: "pick-priority", definition: "Prioritized pick pressure." });
    expect(memberForbiddenUpdate.status).toBe(403);

    const duplicateUpdate = await request(app)
      .put(`/tags/${adminCreate.body.tag.id}`)
      .set("Authorization", buildAuthHeader(1, config))
      .send({ name: "engage", definition: "Duplicate name should fail." });
    expect(duplicateUpdate.status).toBe(409);

    const adminUpdate = await request(app)
      .put(`/tags/${adminCreate.body.tag.id}`)
      .set("Authorization", buildAuthHeader(1, config))
      .send({ name: "pick-priority", definition: "Improves map pressure and picks." });
    expect(adminUpdate.status).toBe(200);
    expect(adminUpdate.body.tag.name).toBe("pick-priority");
    expect(adminUpdate.body.tag.definition).toContain("map pressure");

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
    state.users[0].email = "legacy-admin@example.com";
    state.users[0].role = "member";

    const memberCreate = await request(app)
      .post("/tags")
      .set("Authorization", buildAuthHeader(2, config))
      .send({ name: "pick", definition: "Creates pick threat around fog and setups." });
    expect(memberCreate.status).toBe(201);
    expect(memberCreate.body.tag.name).toBe("pick");
    expect(memberCreate.body.tag.definition).toContain("pick threat");

    const memberUpdate = await request(app)
      .put(`/tags/${memberCreate.body.tag.id}`)
      .set("Authorization", buildAuthHeader(2, config))
      .send({ name: "pick-priority", definition: "Prioritized pick pressure." });
    expect(memberUpdate.status).toBe(200);
    expect(memberUpdate.body.tag.name).toBe("pick-priority");

    const memberDelete = await request(app)
      .delete(`/tags/${memberCreate.body.tag.id}`)
      .set("Authorization", buildAuthHeader(2, config));
    expect(memberDelete.status).toBe(204);
  });

  it("supports admin users listing and permission updates", async () => {
    const { app, config } = createMockContext();

    const memberDenied = await request(app)
      .get("/admin/users")
      .set("Authorization", buildAuthHeader(2, config));
    expect(memberDenied.status).toBe(403);

    const memberDeniedAuthorizationMatrix = await request(app)
      .get("/admin/authorization")
      .set("Authorization", buildAuthHeader(2, config));
    expect(memberDeniedAuthorizationMatrix.status).toBe(403);

    const memberDeniedRiotIdUpdate = await request(app)
      .put("/admin/users/2/riot-id")
      .set("Authorization", buildAuthHeader(2, config))
      .send({ gameName: "CorrectedName", tagline: "NA1" });
    expect(memberDeniedRiotIdUpdate.status).toBe(403);

    const memberDeniedDelete = await request(app)
      .delete("/admin/users/2")
      .set("Authorization", buildAuthHeader(2, config));
    expect(memberDeniedDelete.status).toBe(403);

    const adminList = await request(app)
      .get("/admin/users")
      .set("Authorization", buildAuthHeader(1, config));
    expect(adminList.status).toBe(200);
    expect(adminList.body.users).toHaveLength(5);
    const listedOwner = adminList.body.users.find((user) => Number(user.id) === 1);
    expect(listedOwner?.is_owner_admin).toBe(true);
    expect(listedOwner?.stored_role).toBe("admin");

    const adminAuthorizationMatrix = await request(app)
      .get("/admin/authorization")
      .set("Authorization", buildAuthHeader(1, config));
    expect(adminAuthorizationMatrix.status).toBe(200);
    expect(Array.isArray(adminAuthorizationMatrix.body.authorization.global_roles)).toBe(true);
    expect(Array.isArray(adminAuthorizationMatrix.body.authorization.permissions)).toBe(true);
    expect(adminAuthorizationMatrix.body.authorization.assignments.global_roles.admin).toContain("admin.users.read");
    const permissionsWithGlobal = adminAuthorizationMatrix.body.authorization.permissions
      .map((permission) => permission.id)
      .filter((permissionId) => String(permissionId).includes(".global"));
    const globalAssignments = adminAuthorizationMatrix.body.authorization.assignments.global_roles.global;
    expect(Array.isArray(globalAssignments)).toBe(true);
    for (const permissionId of permissionsWithGlobal) {
      expect(globalAssignments).toContain(permissionId);
    }

    const memberDetailDenied = await request(app)
      .get("/admin/users/3/details")
      .set("Authorization", buildAuthHeader(2, config));
    expect(memberDetailDenied.status).toBe(403);

    const adminDetail = await request(app)
      .get("/admin/users/2/details")
      .set("Authorization", buildAuthHeader(1, config));
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.details.user_id).toBe(2);
    expect(adminDetail.body.details.primary_role).toBe("Support");
    expect(Array.isArray(adminDetail.body.details.champion_pools)).toBe(true);
    expect(adminDetail.body.details.champion_pools).toHaveLength(1);
    expect(Array.isArray(adminDetail.body.details.team_memberships)).toBe(true);
    expect(adminDetail.body.details.champion_tag_promotions).toEqual({
      pending: 0,
      approved: 0,
      rejected: 0
    });

    const promoteGlobal = await request(app)
      .put("/admin/users/2/role")
      .set("Authorization", buildAuthHeader(1, config))
      .send({ role: "global" });
    expect(promoteGlobal.status).toBe(200);
    expect(promoteGlobal.body.user.role).toBe("global");

    const adminCorrectRiotId = await request(app)
      .put("/admin/users/2/riot-id")
      .set("Authorization", buildAuthHeader(1, config))
      .send({ gameName: "MemberRenamed", tagline: "NA9" });
    expect(adminCorrectRiotId.status).toBe(200);
    expect(adminCorrectRiotId.body.user.riot_id).toBe("MemberRenamed#NA9");
    expect(adminCorrectRiotId.body.user.can_update_riot_id).toBe(false);

    const secondCorrectionRejected = await request(app)
      .put("/admin/users/2/riot-id")
      .set("Authorization", buildAuthHeader(1, config))
      .send({ gameName: "SecondRename", tagline: "NA1" });
    expect(secondCorrectionRejected.status).toBe(400);
    expect(secondCorrectionRejected.body.error.code).toBe("BAD_REQUEST");

    const globalCanCreateTag = await request(app)
      .post("/tags")
      .set("Authorization", buildAuthHeader(2, config))
      .send({ name: "tempo-tag", definition: "Supports tempo-focused map rotations." });
    expect(globalCanCreateTag.status).toBe(201);

    const globalCanWriteTags = await request(app)
      .put("/champions/1/tags")
      .set("Authorization", buildAuthHeader(2, config))
      .send({ tag_ids: [1, 2], reviewed: false });
    expect(globalCanWriteTags.status).toBe(200);

    const nonOwnerAdminRejected = await request(app)
      .put("/admin/users/2/role")
      .set("Authorization", buildAuthHeader(1, config))
      .send({ role: "admin" });
    expect(nonOwnerAdminRejected.status).toBe(400);

    const ownerDemotionRejected = await request(app)
      .put("/admin/users/1/role")
      .set("Authorization", buildAuthHeader(1, config))
      .send({ role: "member" });
    expect(ownerDemotionRejected.status).toBe(400);

    const ownerDeleteRejected = await request(app)
      .delete("/admin/users/1")
      .set("Authorization", buildAuthHeader(1, config));
    expect(ownerDeleteRejected.status).toBe(400);

    const deleteMember = await request(app)
      .delete("/admin/users/2")
      .set("Authorization", buildAuthHeader(1, config));
    expect(deleteMember.status).toBe(200);
    expect(deleteMember.body.ok).toBe(true);

    const adminListAfterDelete = await request(app)
      .get("/admin/users")
      .set("Authorization", buildAuthHeader(1, config));
    expect(adminListAfterDelete.status).toBe(200);
    expect(adminListAfterDelete.body.users).toHaveLength(4);
    expect(adminListAfterDelete.body.users.some((user) => Number(user.id) === 2)).toBe(false);
  });

  it("treats owner allowlisted email as admin even when stored role is member", async () => {
    const { app, config, state } = createMockContext();
    state.users[0].role = "member";

    const adminList = await request(app)
      .get("/admin/users")
      .set("Authorization", buildAuthHeader(1, config));
    expect(adminList.status).toBe(200);

    const ownerUser = adminList.body.users.find((user) => Number(user.id) === 1);
    expect(ownerUser).toBeTruthy();
    expect(ownerUser.role).toBe("admin");
    expect(ownerUser.stored_role).toBe("member");
    expect(ownerUser.is_owner_admin).toBe(true);
  });

  it("supports requirement definition and composition CRUD", async () => {
    const { app, config } = createMockContext();

    const listRequirements = await request(app)
      .get("/requirements")
      .set("Authorization", buildAuthHeader(2, config));
    expect(listRequirements.status).toBe(200);
    expect(listRequirements.body.requirements).toHaveLength(1);

    const memberCreateDenied = await request(app)
      .post("/requirements")
      .set("Authorization", buildAuthHeader(2, config))
      .send({
        name: "Disengage Clause",
        definition: "Needs at least one disengage tool.",
        rules: [
          {
            expr: { tag: "Disengage" },
            minCount: 1
          }
        ]
      });
    expect(memberCreateDenied.status).toBe(403);

    const globalCreateRequirement = await request(app)
      .post("/requirements")
      .set("Authorization", buildAuthHeader(5, config))
      .send({
        name: "Global Editor Requirement",
        definition: "Created by global editor.",
        rules: [
          {
            id: "global-editor-clause",
            expr: { tag: "Frontline" },
            minCount: 1
          }
        ]
      });
    expect(globalCreateRequirement.status).toBe(201);

    const invalidSeparation = await request(app)
      .post("/requirements")
      .set("Authorization", buildAuthHeader(1, config))
      .send({
        name: "Invalid Separation",
        definition: "References a missing clause id.",
        rules: [
          {
            id: "clause-one",
            expr: { tag: "Disengage" },
            minCount: 1,
            separateFrom: ["missing-clause"]
          }
        ]
      });
    expect(invalidSeparation.status).toBe(400);
    expect(invalidSeparation.body.error.code).toBe("BAD_REQUEST");

    const adminCreateRequirement = await request(app)
      .post("/requirements")
      .set("Authorization", buildAuthHeader(1, config))
      .send({
        name: "Disengage Clause",
        definition: "Needs at least one disengage tool.",
        rules: [
          {
            id: "clause-disengage-pair",
            expr: {
              and: [{ tag: "Disengage" }, { tag: "ZoneControl" }]
            },
            minCount: 1
          },
          {
            id: "clause-followup",
            expr: { tag: "FollowUpEngage" },
            minCount: 1,
            separateFrom: ["clause-disengage-pair"]
          },
          {
            id: "clause-top-threat",
            expr: { tag: "PickThreat" },
            minCount: 1
          }
        ]
      });
    expect(adminCreateRequirement.status).toBe(201);
    expect(adminCreateRequirement.body.requirement.name).toBe("Disengage Clause");
    expect(adminCreateRequirement.body.requirement.rules).toHaveLength(3);
    expect(adminCreateRequirement.body.requirement.rules[1].clauseJoiner).toBe("and");
    expect(adminCreateRequirement.body.requirement.rules[1].separateFrom).toEqual(["clause-disengage-pair"]);

    const adminUpdateRequirement = await request(app)
      .put(`/requirements/${adminCreateRequirement.body.requirement.id}`)
      .set("Authorization", buildAuthHeader(1, config))
      .send({
        definition: "Needs at least one disengage or peel tool."
      });
    expect(adminUpdateRequirement.status).toBe(200);
    expect(adminUpdateRequirement.body.requirement.definition).toContain("peel");

    const listCompositions = await request(app)
      .get("/compositions")
      .set("Authorization", buildAuthHeader(2, config));
    expect(listCompositions.status).toBe(200);
    expect(listCompositions.body.compositions).toHaveLength(1);

    const adminCreateComposition = await request(app)
      .post("/compositions")
      .set("Authorization", buildAuthHeader(1, config))
      .send({
        name: "Siege Setup",
        description: "Frontline plus disengage fallback",
        requirement_ids: [1, adminCreateRequirement.body.requirement.id],
        is_active: true
      });
    expect(adminCreateComposition.status).toBe(201);
    expect(adminCreateComposition.body.composition.requirement_ids).toContain(1);
    expect(adminCreateComposition.body.composition.requirement_ids).toContain(
      adminCreateRequirement.body.requirement.id
    );
    expect(adminCreateComposition.body.composition.is_active).toBe(true);

    const globalCreateComposition = await request(app)
      .post("/compositions")
      .set("Authorization", buildAuthHeader(5, config))
      .send({
        name: "Global Editor Composition",
        description: "Created by global editor.",
        requirement_ids: [1, globalCreateRequirement.body.requirement.id],
        is_active: false
      });
    expect(globalCreateComposition.status).toBe(201);

    const activeComposition = await request(app)
      .get("/compositions/active")
      .set("Authorization", buildAuthHeader(2, config));
    expect(activeComposition.status).toBe(200);
    expect(activeComposition.body.composition.name).toBe("Siege Setup");
    expect(activeComposition.body.requirements).toHaveLength(2);

    const adminDeleteRequirement = await request(app)
      .delete(`/requirements/${adminCreateRequirement.body.requirement.id}`)
      .set("Authorization", buildAuthHeader(1, config));
    expect(adminDeleteRequirement.status).toBe(204);

    const listCompositionsAfterDelete = await request(app)
      .get("/compositions")
      .set("Authorization", buildAuthHeader(1, config));
    expect(listCompositionsAfterDelete.status).toBe(200);
    const siege = listCompositionsAfterDelete.body.compositions.find(
      (composition) => composition.name === "Siege Setup"
    );
    expect(siege.requirement_ids).toEqual([1]);
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
      .send({ champion_id: 2, familiarity: 2 });
    expect(addOnce.status).toBe(200);
    expect(addOnce.body.pool.champion_ids).toEqual([2]);
    expect(addOnce.body.pool.champion_familiarity).toEqual({ 2: 2 });

    const addTwice = await request(app)
      .post(`/me/pools/${newPoolId}/champions`)
      .set("Authorization", user1Auth)
      .send({ champion_id: 2 });
    expect(addTwice.status).toBe(200);
    expect(addTwice.body.pool.champion_ids).toEqual([2]);
    expect(addTwice.body.pool.champion_familiarity).toEqual({ 2: 2 });

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

  it("rejects duplicate team names and tags on create and update", async () => {
    const { app, config } = createMockContext();
    const leadAuth = buildAuthHeader(1, config);

    const duplicateCreateByName = await request(app)
      .post("/teams")
      .set("Authorization", leadAuth)
      .send({ name: "team alpha", tag: "UNIQA" });
    expect(duplicateCreateByName.status).toBe(409);
    expect(duplicateCreateByName.body.error.message).toContain("Team name already exists");

    const duplicateCreateByTag = await request(app)
      .post("/teams")
      .set("Authorization", leadAuth)
      .send({ name: "Unique Team", tag: "alpha" });
    expect(duplicateCreateByTag.status).toBe(409);
    expect(duplicateCreateByTag.body.error.message).toContain("Team tag already exists");

    const createSecond = await request(app)
      .post("/teams")
      .set("Authorization", leadAuth)
      .send({ name: "Team Bravo", tag: "BRV" });
    expect(createSecond.status).toBe(201);

    const duplicateUpdateByName = await request(app)
      .patch(`/teams/${createSecond.body.team.id}`)
      .set("Authorization", leadAuth)
      .send({ name: "TEAM ALPHA", tag: "BRV2" });
    expect(duplicateUpdateByName.status).toBe(409);
    expect(duplicateUpdateByName.body.error.message).toContain("Team name already exists");

    const duplicateUpdateByTag = await request(app)
      .patch(`/teams/${createSecond.body.team.id}`)
      .set("Authorization", leadAuth)
      .send({ name: "Team Bravo v2", tag: "alpha" });
    expect(duplicateUpdateByTag.status).toBe(409);
    expect(duplicateUpdateByTag.body.error.message).toContain("Team tag already exists");
  });

  it("enforces team authorization with owner-admin overrides and lead invariants", async () => {
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

    const adminCanRemoveMember = await request(app)
      .delete("/teams/1/members/3")
      .set("Authorization", leadAuth);
    expect(adminCanRemoveMember.status).toBe(200);
    expect(adminCanRemoveMember.body.ok).toBe(true);

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

  it("allows team leads to send and cancel member invitations", async () => {
    const { app, config } = createMockContext();
    const leadAuth = buildAuthHeader(1, config);

    const createInvite = await request(app)
      .post("/teams/1/member-invitations")
      .set("Authorization", leadAuth)
      .send({ user_id: 3, role: "member", team_role: "primary" });
    expect(createInvite.status).toBe(201);
    expect(createInvite.body.invitation.status).toBe("pending");
    expect(createInvite.body.invitation.target.display_name).toBe("Outsider#NA1");

    const duplicateInvite = await request(app)
      .post("/teams/1/member-invitations")
      .set("Authorization", leadAuth)
      .send({ user_id: 3 });
    expect(duplicateInvite.status).toBe(409);

    const pendingInvites = await request(app)
      .get("/teams/1/member-invitations?status=pending")
      .set("Authorization", leadAuth);
    expect(pendingInvites.status).toBe(200);
    expect(pendingInvites.body.invitations).toHaveLength(1);

    const cancelInvite = await request(app)
      .put(`/teams/1/member-invitations/${createInvite.body.invitation.id}`)
      .set("Authorization", leadAuth)
      .send({ status: "canceled" });
    expect(cancelInvite.status).toBe(200);
    expect(cancelInvite.body.invitation.status).toBe("canceled");

    const pendingAfterCancel = await request(app)
      .get("/teams/1/member-invitations?status=pending")
      .set("Authorization", leadAuth);
    expect(pendingAfterCancel.body.invitations).toHaveLength(0);
  });

  it("lets invited users accept and reject invitations", async () => {
    const { app, config } = createMockContext();
    const leadAuth = buildAuthHeader(1, config);
    const outsiderAuth = buildAuthHeader(3, config);
    const globalAuth = buildAuthHeader(5, config);

    const invitation = await request(app)
      .post("/teams/1/member-invitations")
      .set("Authorization", leadAuth)
      .send({ user_id: 3 });
    expect(invitation.status).toBe(201);

    const myInvites = await request(app)
      .get("/me/member-invitations")
      .set("Authorization", outsiderAuth);
    expect(myInvites.status).toBe(200);
    expect(myInvites.body.invitations).toHaveLength(1);
    expect(myInvites.body.invitations[0].status).toBe("pending");

    const acceptInvite = await request(app)
      .put(`/teams/1/member-invitations/${invitation.body.invitation.id}`)
      .set("Authorization", outsiderAuth)
      .send({ status: "accepted" });
    expect(acceptInvite.status).toBe(200);
    expect(acceptInvite.body.invitation.status).toBe("accepted");

    const members = await request(app)
      .get("/teams/1/members")
      .set("Authorization", leadAuth);
    expect(members.body.members.some((member) => member.user_id === 3)).toBe(true);

    const acceptedInvites = await request(app)
      .get("/me/member-invitations?status=accepted")
      .set("Authorization", outsiderAuth);
    expect(acceptedInvites.body.invitations).toHaveLength(1);

    const newTeam = await request(app)
      .post("/teams")
      .set("Authorization", leadAuth)
      .send({ name: "Team Echo", tag: "ECHO" });
    expect(newTeam.status).toBe(201);

    const secondInvite = await request(app)
      .post(`/teams/${newTeam.body.team.id}/member-invitations`)
      .set("Authorization", leadAuth)
      .send({ user_id: 5, role: "member" });
    expect(secondInvite.status).toBe(201);

    const rejectInvite = await request(app)
      .put(`/teams/${newTeam.body.team.id}/member-invitations/${secondInvite.body.invitation.id}`)
      .set("Authorization", globalAuth)
      .send({ status: "rejected" });
    expect(rejectInvite.status).toBe(200);
    expect(rejectInvite.body.invitation.status).toBe("rejected");

    const rejectedInvites = await request(app)
      .get("/me/member-invitations?status=rejected")
      .set("Authorization", globalAuth);
    expect(rejectedInvites.body.invitations).toHaveLength(1);
    expect(rejectedInvites.body.invitations[0].team.name).toBe("Team Echo");
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
