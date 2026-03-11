import { Router } from "express";

import { badRequest, conflict, notFound } from "../errors.js";
import {
  parsePositiveInteger,
  requireArrayOfPositiveIntegers,
  requireNonEmptyString,
  requireObject
} from "../http/validation.js";
import {
  assertScopeReadAuthorization,
  assertScopeWriteAuthorization,
  parseScope,
  resolveScopedTeamId
} from "../scope-authorization.js";
import { SLOTS } from "../../src/domain/model.js";

const CHAMPION_SCOPE_SET = new Set(["self", "team", "all"]);
const MAX_CHAMPION_TAGS_PER_SCOPE = 64;
const SLOT_SET = new Set(SLOTS);
const PRIMARY_DAMAGE_TYPE_VALUES = Object.freeze(["ad", "ap", "mixed", "utility"]);
const PRIMARY_DAMAGE_TYPE_SET = new Set(PRIMARY_DAMAGE_TYPE_VALUES);
const EFFECTIVENESS_LEVEL_VALUES = Object.freeze(["weak", "neutral", "strong"]);
const EFFECTIVENESS_LEVEL_SET = new Set(EFFECTIVENESS_LEVEL_VALUES);
const MAX_TAG_NAME_LENGTH = 64;
const MAX_TAG_DEFINITION_LENGTH = 280;

function normalizeTagIds(tagIds) {
  const deduplicated = Array.from(new Set(tagIds));
  if (deduplicated.length > MAX_CHAMPION_TAGS_PER_SCOPE) {
    throw badRequest(`Expected 'tag_ids' to contain at most ${MAX_CHAMPION_TAGS_PER_SCOPE} entries.`);
  }
  return deduplicated.sort((left, right) => left - right);
}

function normalizeReviewedFlag(rawValue) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (typeof rawValue !== "boolean") {
    throw badRequest("Expected 'reviewed' to be a boolean.");
  }
  return rawValue;
}

function normalizeMetadataRoles(rawRoles) {
  if (!Array.isArray(rawRoles) || rawRoles.length === 0) {
    throw badRequest("Expected 'roles' to be a non-empty array.");
  }
  const normalized = rawRoles.map((value) => (typeof value === "string" ? value.trim() : ""));
  if (normalized.some((value) => !SLOT_SET.has(value))) {
    throw badRequest(`Expected 'roles' values to be one of: ${SLOTS.join(", ")}.`);
  }
  return Array.from(new Set(normalized));
}

function normalizeMetadataPrimaryDamageType(rawValue) {
  if (typeof rawValue !== "string") {
    throw badRequest("Expected 'primary_damage_type' to be a string.");
  }
  const normalized = rawValue.trim().toLowerCase();
  if (!PRIMARY_DAMAGE_TYPE_SET.has(normalized)) {
    throw badRequest(`Expected 'primary_damage_type' to be one of: ${PRIMARY_DAMAGE_TYPE_VALUES.join(", ")}.`);
  }
  return normalized;
}

function normalizeMetadataEffectivenessLevel(rawValue, fieldName) {
  if (typeof rawValue !== "string") {
    throw badRequest(`Expected '${fieldName}' to be a string.`);
  }
  const normalized = rawValue.trim().toLowerCase();
  if (!EFFECTIVENESS_LEVEL_SET.has(normalized)) {
    throw badRequest(
      `Expected '${fieldName}' to be one of: ${EFFECTIVENESS_LEVEL_VALUES.join(", ")}.`
    );
  }
  return normalized;
}

function normalizeTagName(rawValue) {
  const normalized = requireNonEmptyString(rawValue, "name");
  if (normalized.length > MAX_TAG_NAME_LENGTH) {
    throw badRequest(`Expected 'name' to be ${MAX_TAG_NAME_LENGTH} characters or fewer.`);
  }
  return normalized;
}

function normalizeTagDefinition(rawValue) {
  const normalized = requireNonEmptyString(rawValue, "definition");
  if (normalized.length > MAX_TAG_DEFINITION_LENGTH) {
    throw badRequest(`Expected 'definition' to be ${MAX_TAG_DEFINITION_LENGTH} characters or fewer.`);
  }
  return normalized;
}

function normalizeMetadataRoleProfiles(rawValue, roles) {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    throw badRequest("Expected 'role_profiles' to be an object keyed by role.");
  }

  const nextProfiles = {};
  for (const role of roles) {
    const rawRoleProfile = rawValue[role] ?? rawValue[String(role).toLowerCase()];
    if (!rawRoleProfile || typeof rawRoleProfile !== "object" || Array.isArray(rawRoleProfile)) {
      throw badRequest(`Expected 'role_profiles.${role}' to be an object.`);
    }

    const rawPrimaryDamageType = rawRoleProfile.primary_damage_type ?? rawRoleProfile.primaryDamageType;
    const primaryDamageType = normalizeMetadataPrimaryDamageType(rawPrimaryDamageType);

    const rawEffectiveness = rawRoleProfile.effectiveness;
    if (!rawEffectiveness || typeof rawEffectiveness !== "object" || Array.isArray(rawEffectiveness)) {
      throw badRequest(`Expected 'role_profiles.${role}.effectiveness' to be an object.`);
    }

    nextProfiles[role] = {
      primaryDamageType,
      effectiveness: {
        early: normalizeMetadataEffectivenessLevel(rawEffectiveness.early, `role_profiles.${role}.effectiveness.early`),
        mid: normalizeMetadataEffectivenessLevel(rawEffectiveness.mid, `role_profiles.${role}.effectiveness.mid`),
        late: normalizeMetadataEffectivenessLevel(rawEffectiveness.late, `role_profiles.${role}.effectiveness.late`)
      }
    };
  }

  return nextProfiles;
}

function isUniqueViolation(error) {
  return Boolean(error && typeof error === "object" && error.code === "23505");
}

export function createChampionsRouter({
  championsRepository,
  tagsRepository,
  usersRepository,
  teamsRepository,
  requireAuth,
  optionalAuth
}) {
  const router = Router();

  router.get("/champions", optionalAuth, async (request, response) => {
    const champions = await championsRepository.listChampions();
    const userId = request.user?.userId;
    if (!Number.isInteger(userId)) {
      response.json({ champions });
      return;
    }

    const activeTeamContext = await usersRepository.findTeamContextById(userId);
    const rawActiveTeamId = activeTeamContext?.active_team_id;
    const activeTeamId = Number.isInteger(rawActiveTeamId)
      ? rawActiveTeamId
      : Number.parseInt(String(rawActiveTeamId ?? ""), 10);
    const metadataScopeFlagsByChampionId = await championsRepository.listMetadataScopeFlagsByChampionIds({
      championIds: champions.map((champion) => champion.id),
      userId,
      teamId: Number.isInteger(activeTeamId) && activeTeamId > 0 ? activeTeamId : null
    });

    response.json({
      champions: champions.map((champion) => ({
        ...champion,
        metadata_scopes: metadataScopeFlagsByChampionId[champion.id] ?? {
          self: false,
          team: false,
          all: true
        }
      }))
    });
  });

  router.get("/champions/:id", async (request, response) => {
    const championId = parsePositiveInteger(request.params.id, "id");
    const champion = await championsRepository.getChampionById(championId);
    if (!champion) {
      throw notFound("Champion not found.");
    }
    response.json({ champion });
  });

  router.get("/tags", async (_request, response) => {
    const tags = await tagsRepository.listTags();
    response.json({ tags });
  });

  router.post("/tags", requireAuth, async (request, response) => {
    const body = requireObject(request.body);
    const userId = request.user.userId;
    const name = normalizeTagName(body.name);
    const definition = normalizeTagDefinition(body.definition);

    await assertScopeWriteAuthorization({
      scope: "all",
      userId,
      teamId: null,
      teamsRepository,
      usersRepository,
      teamWriteMessage: "You must be on the selected team to manage tags.",
      teamLeadMessage: "Only team leads can manage tags.",
      globalWriteMessage: "Only admins or global editors can manage tag catalog.",
      allowGlobalRoleWrite: true,
      allowGlobalWriteWhenNoAdmins: true
    });

    try {
      const tag = await tagsRepository.createTag({ name, definition });
      response.status(201).json({ tag });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("Tag name already exists.");
      }
      throw error;
    }
  });

  router.put("/tags/:id", requireAuth, async (request, response) => {
    const tagId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const userId = request.user.userId;
    const name = normalizeTagName(body.name);
    const definition = normalizeTagDefinition(body.definition);

    await assertScopeWriteAuthorization({
      scope: "all",
      userId,
      teamId: null,
      teamsRepository,
      usersRepository,
      teamWriteMessage: "You must be on the selected team to manage tags.",
      teamLeadMessage: "Only team leads can manage tags.",
      globalWriteMessage: "Only admins or global editors can manage tag catalog.",
      allowGlobalRoleWrite: true,
      allowGlobalWriteWhenNoAdmins: true
    });

    try {
      const tag = await tagsRepository.updateTag(tagId, { name, definition });
      if (!tag) {
        throw notFound("Tag not found.");
      }
      response.json({ tag });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("Tag name already exists.");
      }
      throw error;
    }
  });

  router.delete("/tags/:id", requireAuth, async (request, response) => {
    const tagId = parsePositiveInteger(request.params.id, "id");
    const userId = request.user.userId;

    await assertScopeWriteAuthorization({
      scope: "all",
      userId,
      teamId: null,
      teamsRepository,
      usersRepository,
      teamWriteMessage: "You must be on the selected team to manage tags.",
      teamLeadMessage: "Only team leads can manage tags.",
      globalWriteMessage: "Only admins or global editors can manage tag catalog.",
      allowGlobalRoleWrite: true,
      allowGlobalWriteWhenNoAdmins: true
    });

    const assignmentCount = await tagsRepository.countTagAssignments(tagId);
    if (assignmentCount > 0) {
      throw conflict("Cannot delete a tag that is assigned to champions.");
    }

    const deletedTag = await tagsRepository.deleteTag(tagId);
    if (!deletedTag) {
      throw notFound("Tag not found.");
    }
    response.status(204).end();
  });

  router.get("/champions/:id/tags", requireAuth, async (request, response) => {
    const championId = parsePositiveInteger(request.params.id, "id");
    const userId = request.user.userId;
    const scope = parseScope(request.query.scope, {
      defaultScope: "all",
      fieldName: "scope",
      allowedScopes: CHAMPION_SCOPE_SET
    });

    let teamId = null;
    if (scope === "team") {
      teamId = await resolveScopedTeamId({
        scope,
        rawTeamId: request.query.team_id,
        userId,
        usersRepository
      });
    } else if (request.query.team_id !== undefined) {
      throw badRequest("Expected 'team_id' to be omitted unless scope is 'team'.");
    }

    const champion = await championsRepository.getChampionById(championId);
    if (!champion) {
      throw notFound("Champion not found.");
    }

    await assertScopeReadAuthorization({
      scope,
      userId,
      teamId,
      teamsRepository,
      teamReadMessage: "You must be on the selected team to read team tags."
    });

    const tagIds = await tagsRepository.listChampionTagIdsForScope({
      championId,
      scope,
      userId,
      teamId
    });

    response.json({
      scope,
      team_id: teamId,
      tag_ids: tagIds,
      reviewed: champion.reviewed === true
    });
  });

  router.put("/champions/:id/tags", requireAuth, async (request, response) => {
    const championId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const userId = request.user.userId;
    const scope = parseScope(body.scope, {
      defaultScope: "all",
      fieldName: "scope",
      allowedScopes: CHAMPION_SCOPE_SET
    });

    let teamId = null;
    if (scope === "team") {
      teamId = await resolveScopedTeamId({
        scope,
        rawTeamId: body.team_id,
        userId,
        usersRepository
      });
    } else if (body.team_id !== undefined) {
      throw badRequest("Expected 'team_id' to be omitted unless scope is 'team'.");
    }

    const tagIds = normalizeTagIds(requireArrayOfPositiveIntegers(body.tag_ids, "tag_ids"));
    const reviewed = normalizeReviewedFlag(body.reviewed);

    const championExists = await championsRepository.championExists(championId);
    if (!championExists) {
      throw notFound("Champion not found.");
    }

    await assertScopeWriteAuthorization({
      scope,
      userId,
      teamId,
      teamsRepository,
      usersRepository,
      teamWriteMessage: "You must be on the selected team to edit team tags.",
      teamLeadMessage: "Only team leads can edit team tags.",
      globalWriteMessage: "Only admins or global editors can edit global champion tags.",
      allowGlobalRoleWrite: true,
      allowGlobalWriteWhenNoAdmins: true
    });

    const allTagsExist = await tagsRepository.allTagIdsExist(tagIds);
    if (!allTagsExist) {
      throw badRequest("One or more tag IDs do not exist.");
    }

    await tagsRepository.replaceChampionTagsForScope({
      championId,
      tagIds,
      scope,
      userId,
      teamId
    });
    if (reviewed !== undefined) {
      await championsRepository.updateChampionReviewState(championId, {
        reviewed,
        reviewedByUserId: userId
      });
    }
    const champion = await championsRepository.getChampionById(championId);
    response.json({
      champion,
      scope,
      team_id: teamId,
      tag_ids: tagIds,
      reviewed: champion?.reviewed === true
    });
  });

  router.get("/champions/:id/metadata", requireAuth, async (request, response) => {
    const championId = parsePositiveInteger(request.params.id, "id");
    const userId = request.user.userId;
    const scope = parseScope(request.query.scope, {
      defaultScope: "all",
      fieldName: "scope",
      allowedScopes: CHAMPION_SCOPE_SET
    });

    let teamId = null;
    if (scope === "team") {
      teamId = await resolveScopedTeamId({
        scope,
        rawTeamId: request.query.team_id,
        userId,
        usersRepository
      });
    } else if (request.query.team_id !== undefined) {
      throw badRequest("Expected 'team_id' to be omitted unless scope is 'team'.");
    }

    const championExists = await championsRepository.championExists(championId);
    if (!championExists) {
      throw notFound("Champion not found.");
    }

    await assertScopeReadAuthorization({
      scope,
      userId,
      teamId,
      teamsRepository,
      teamReadMessage: "You must be on the selected team to read team champion metadata."
    });

    const metadataResult = await championsRepository.getResolvedChampionMetadataForScope({
      championId,
      scope,
      userId,
      teamId
    });

    response.json({
      scope,
      team_id: teamId,
      metadata: metadataResult?.metadata ?? {},
      has_custom_metadata: metadataResult?.hasCustomMetadata === true,
      resolved_scope: metadataResult?.resolvedScope ?? "all",
      reviewed: metadataResult?.champion?.reviewed === true
    });
  });

  router.put("/champions/:id/metadata", requireAuth, async (request, response) => {
    const championId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const userId = request.user.userId;
    const scope = parseScope(body.scope, {
      defaultScope: "all",
      fieldName: "scope",
      allowedScopes: CHAMPION_SCOPE_SET
    });

    let teamId = null;
    if (scope === "team") {
      teamId = await resolveScopedTeamId({
        scope,
        rawTeamId: body.team_id,
        userId,
        usersRepository
      });
    } else if (body.team_id !== undefined) {
      throw badRequest("Expected 'team_id' to be omitted unless scope is 'team'.");
    }

    const roles = normalizeMetadataRoles(body.roles);
    const roleProfiles = normalizeMetadataRoleProfiles(
      body.role_profiles ?? body.roleProfiles,
      roles
    );

    const championExists = await championsRepository.championExists(championId);
    if (!championExists) {
      throw notFound("Champion not found.");
    }

    await assertScopeWriteAuthorization({
      scope,
      userId,
      teamId,
      teamsRepository,
      usersRepository,
      teamWriteMessage: "You must be on the selected team to edit team champion metadata.",
      teamLeadMessage: "Only team leads can edit team champion metadata.",
      globalWriteMessage: "Only admins or global editors can edit global champion metadata.",
      allowGlobalRoleWrite: true,
      allowGlobalWriteWhenNoAdmins: true
    });

    const metadataResult = await championsRepository.updateChampionMetadataForScope({
      roles,
      roleProfiles,
      championId,
      scope,
      userId,
      teamId
    });
    if (!metadataResult?.champion) {
      throw notFound("Champion not found.");
    }
    response.json({
      champion: metadataResult.champion,
      scope,
      team_id: teamId,
      metadata: metadataResult.metadata,
      has_custom_metadata: metadataResult.hasCustomMetadata === true,
      resolved_scope: metadataResult.resolvedScope
    });
  });

  router.post("/champions/:id/tags/promotion-requests", requireAuth, async (request, response) => {
    requireObject(request.body);
    throw badRequest("Champion tag promotion requests are not supported in MVP. Edit global tags directly.");
  });

  return router;
}
