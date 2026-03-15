import { Router } from "express";

import { badRequest, conflict, forbidden, notFound, unauthorized } from "../errors.js";
import {
  parsePositiveInteger,
  requireArrayOfPositiveIntegers,
  requireNonEmptyString,
  requireObject
} from "../http/validation.js";
import {
  normalizeRequirementDefinitionText,
  normalizeRequirementRules
} from "../requirements-validation.js";
import {
  assertScopeReadAuthorization,
  assertPromotionAuthorization,
  assertScopeWriteAuthorization,
  parseScope,
  resolveScopedTeamId
} from "../scope-authorization.js";
import { SLOTS } from "../../src/domain/model.js";
import { USER_ROLE_ADMIN, USER_ROLE_GLOBAL, resolveAuthorizationRole } from "../user-roles.js";

const CHAMPION_SCOPE_SET = new Set(["self", "team", "all"]);
const MAX_CHAMPION_TAGS_PER_SCOPE = 64;
const SLOT_SET = new Set(SLOTS);
const PRIMARY_DAMAGE_TYPE_VALUES = Object.freeze(["ad", "ap", "mixed", "utility"]);
const PRIMARY_DAMAGE_TYPE_SET = new Set(PRIMARY_DAMAGE_TYPE_VALUES);
const EFFECTIVENESS_LEVEL_VALUES = Object.freeze(["weak", "neutral", "strong"]);
const EFFECTIVENESS_LEVEL_SET = new Set(EFFECTIVENESS_LEVEL_VALUES);
const POWER_SPIKE_MIN_LEVEL = 1;
const POWER_SPIKE_MAX_LEVEL = 18;
const POWER_SPIKE_MAX_RANGES = 2;
const MAX_TAG_NAME_LENGTH = 64;
const MAX_TAG_DEFINITION_LENGTH = 280;
const MAX_PROMOTION_COMMENT_LENGTH = 500;
const DEFAULT_COMPOSITION_SYNERGY_BONUS_WEIGHT = 1;

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

function normalizeOptionalBoolean(rawValue, fieldName, fallback = false) {
  if (rawValue === undefined) {
    return fallback;
  }
  if (typeof rawValue !== "boolean") {
    throw badRequest(`Expected '${fieldName}' to be a boolean.`);
  }
  return rawValue;
}

function normalizePositiveBonusWeight(rawValue, fieldName) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return DEFAULT_COMPOSITION_SYNERGY_BONUS_WEIGHT;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`Expected '${fieldName}' to be a positive number.`);
  }
  return parsed;
}

function normalizeOptionalComment(rawValue, fieldName) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return "";
  }
  if (typeof rawValue !== "string") {
    throw badRequest(`Expected '${fieldName}' to be a string.`);
  }
  const normalized = rawValue.trim();
  if (normalized.length > MAX_PROMOTION_COMMENT_LENGTH) {
    throw badRequest(`Expected '${fieldName}' to be ${MAX_PROMOTION_COMMENT_LENGTH} characters or fewer.`);
  }
  return normalized;
}

function normalizePromotionStatus(rawValue) {
  if (typeof rawValue !== "string") {
    throw badRequest("Expected 'decision' to be 'approved' or 'rejected'.");
  }
  const normalized = rawValue.trim().toLowerCase();
  if (normalized !== "approved" && normalized !== "rejected") {
    throw badRequest("Expected 'decision' to be 'approved' or 'rejected'.");
  }
  return normalized;
}

async function canReviewGlobalTagPromotion(userId, usersRepository) {
  const user = await usersRepository.findById(userId);
  const role = resolveAuthorizationRole(user);
  return role === USER_ROLE_ADMIN || role === USER_ROLE_GLOBAL;
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

function normalizeMetadataPowerSpikes(rawValue, fieldPrefix) {
  if (!Array.isArray(rawValue)) {
    return [];
  }
  if (rawValue.length > POWER_SPIKE_MAX_RANGES) {
    throw badRequest(`Expected '${fieldPrefix}' to contain at most ${POWER_SPIKE_MAX_RANGES} ranges.`);
  }
  const ranges = [];
  for (let i = 0; i < rawValue.length; i++) {
    const item = rawValue[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw badRequest(`Expected '${fieldPrefix}[${i}]' to be an object with start and end.`);
    }
    const start = Number(item.start);
    const end = Number(item.end);
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      throw badRequest(`Expected '${fieldPrefix}[${i}].start' and '${fieldPrefix}[${i}].end' to be integers.`);
    }
    if (start < POWER_SPIKE_MIN_LEVEL || start > POWER_SPIKE_MAX_LEVEL ||
        end < POWER_SPIKE_MIN_LEVEL || end > POWER_SPIKE_MAX_LEVEL) {
      throw badRequest(`Expected '${fieldPrefix}[${i}]' levels to be between ${POWER_SPIKE_MIN_LEVEL} and ${POWER_SPIKE_MAX_LEVEL}.`);
    }
    ranges.push({ start: Math.min(start, end), end: Math.max(start, end) });
  }
  return ranges;
}

function powerSpikesFromLegacyEffectiveness(eff) {
  if (!eff || typeof eff !== "object" || Array.isArray(eff)) return [];
  const ranges = [];
  const isStrong = (v) => typeof v === "string" && v.trim().toLowerCase() === "strong";
  if (isStrong(eff.early)) ranges.push({ start: 1, end: 6 });
  if (isStrong(eff.mid)) ranges.push({ start: 7, end: 12 });
  if (isStrong(eff.late)) ranges.push({ start: 13, end: 18 });
  return ranges.slice(0, POWER_SPIKE_MAX_RANGES);
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

function buildIdentityDisplayName(identity) {
  const gameName = typeof identity?.game_name === "string" ? identity.game_name.trim() : "";
  const tagline = typeof identity?.tagline === "string" ? identity.tagline.trim() : "";
  const email = typeof identity?.email === "string" ? identity.email.trim() : "";
  if (gameName && tagline) {
    return `${gameName}#${tagline}`;
  }
  if (gameName) {
    return gameName;
  }
  if (email) {
    return email;
  }
  return "";
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

    const rawPowerSpikes = rawRoleProfile.power_spikes ?? rawRoleProfile.powerSpikes;
    const rawEffectiveness = rawRoleProfile.effectiveness;

    let powerSpikes;
    if (Array.isArray(rawPowerSpikes)) {
      powerSpikes = normalizeMetadataPowerSpikes(rawPowerSpikes, `role_profiles.${role}.power_spikes`);
    } else if (rawEffectiveness && typeof rawEffectiveness === "object" && !Array.isArray(rawEffectiveness)) {
      powerSpikes = powerSpikesFromLegacyEffectiveness(rawEffectiveness);
    } else {
      powerSpikes = [];
    }

    nextProfiles[role] = {
      primaryDamageType,
      powerSpikes
    };
  }

  return nextProfiles;
}

function normalizeCompositionSynergies(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return {
      definition: "",
      optional: false,
      bonusWeight: DEFAULT_COMPOSITION_SYNERGY_BONUS_WEIGHT,
      rules: []
    };
  }
  if (typeof rawValue !== "object" || Array.isArray(rawValue)) {
    throw badRequest("Expected 'composition_synergies' to be an object.");
  }

  const definition = normalizeRequirementDefinitionText(
    rawValue.definition,
    "composition_synergies.definition"
  );
  const optional = normalizeOptionalBoolean(rawValue.optional, "composition_synergies.optional", false);
  const bonusWeight = normalizePositiveBonusWeight(
    rawValue.bonus_weight ?? rawValue.bonusWeight,
    "composition_synergies.bonus_weight"
  );
  const rawRules = rawValue.rules ?? [];
  if (!Array.isArray(rawRules) || rawRules.length < 1) {
    if (definition === "") {
      return {
        definition: "",
        optional: false,
        bonusWeight: DEFAULT_COMPOSITION_SYNERGY_BONUS_WEIGHT,
        rules: []
      };
    }
    throw badRequest("Expected 'composition_synergies.rules' to include at least one clause.");
  }

  return {
    definition,
    optional,
    bonusWeight,
    rules: normalizeRequirementRules(rawRules, "composition_synergies.rules")
  };
}

function isUniqueViolation(error) {
  return Boolean(error && typeof error === "object" && error.code === "23505");
}

export function createChampionsRouter({
  championsRepository,
  tagsRepository,
  promotionRequestsRepository,
  usersRepository,
  teamsRepository,
  requireAuth,
  optionalAuth
}) {
  const router = Router();

  router.get("/champions", optionalAuth, async (request, response) => {
    const champions = await championsRepository.listChampions();
    const reviewerIds = [...new Set(
      champions
        .map((champion) => champion.reviewed_by_user_id)
        .filter((value) => Number.isInteger(value) && value > 0)
    )];
    const reviewers = reviewerIds.length > 0
      ? await usersRepository.listIdentityByIds(reviewerIds)
      : [];
    const reviewerDisplayNameById = new Map(
      reviewers.map((reviewer) => [Number(reviewer.id), buildIdentityDisplayName(reviewer)])
    );
    const userId = request.user?.userId;
    if (!Number.isInteger(userId)) {
      response.json({
        champions: champions.map((champion) => ({
          ...champion,
          reviewed_by_display_name: reviewerDisplayNameById.get(champion.reviewed_by_user_id) ?? null
        }))
      });
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
        reviewed_by_display_name: reviewerDisplayNameById.get(champion.reviewed_by_user_id) ?? null,
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
    response.json({
      champion: {
        ...champion,
        reviewed_by_display_name:
          champion.reviewed_by_user_id
            ? buildIdentityDisplayName(await usersRepository.findById(champion.reviewed_by_user_id))
            : null
      }
    });
  });

  router.get("/tags", optionalAuth, async (request, response) => {
    const scope = parseScope(request.query.scope, {
      defaultScope: "all",
      fieldName: "scope",
      allowedScopes: CHAMPION_SCOPE_SET
    });
    const includeFallback = request.query.include_fallback !== "false";
    const userId = request.user?.userId ?? null;
    if (scope !== "all" && !Number.isInteger(userId)) {
      throw unauthorized("Sign in to read scoped tag definitions.");
    }

    let teamId = null;
    if (scope === "team") {
      teamId = await resolveScopedTeamId({
        scope,
        rawTeamId: request.query.team_id,
        userId,
        usersRepository
      });
      await assertScopeReadAuthorization({
        scope,
        userId,
        teamId,
        teamsRepository,
        teamReadMessage: "You must be on the selected team to view team-scoped tags."
      });
    }

    const tags = await tagsRepository.listTags({
      scope,
      userId,
      teamId,
      includeFallback
    });
    response.json({ scope, team_id: teamId, tags });
  });

  router.post("/tags", requireAuth, async (request, response) => {
    const body = requireObject(request.body);
    const userId = request.user.userId;
    const scope = parseScope(body.scope, {
      defaultScope: "all",
      fieldName: "scope",
      allowedScopes: CHAMPION_SCOPE_SET
    });
    const name = normalizeTagName(body.name);
    const definition = normalizeTagDefinition(body.definition);
    const teamId = await resolveScopedTeamId({
      scope,
      rawTeamId: body.team_id,
      userId,
      usersRepository
    });

    await assertScopeWriteAuthorization({
      scope,
      userId,
      teamId,
      teamsRepository,
      usersRepository,
      teamWriteMessage: "You must be on the selected team to manage tag definitions.",
      teamLeadMessage: "Only team leads can manage team-scoped tag definitions.",
      globalWriteMessage: "Only admins or global editors can manage global tag definitions.",
      allowGlobalRoleWrite: true,
      allowGlobalWriteWhenNoAdmins: true
    });

    try {
      const tag = await tagsRepository.createTag({
        name,
        definition,
        scope,
        userId,
        teamId,
        actorUserId: userId
      });
      response.status(201).json({ scope, team_id: teamId, tag });
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
    const scope = parseScope(body.scope, {
      defaultScope: "all",
      fieldName: "scope",
      allowedScopes: CHAMPION_SCOPE_SET
    });
    const name = normalizeTagName(body.name);
    const definition = normalizeTagDefinition(body.definition);
    const teamId = await resolveScopedTeamId({
      scope,
      rawTeamId: body.team_id,
      userId,
      usersRepository
    });

    await assertScopeWriteAuthorization({
      scope,
      userId,
      teamId,
      teamsRepository,
      usersRepository,
      teamWriteMessage: "You must be on the selected team to manage tag definitions.",
      teamLeadMessage: "Only team leads can manage team-scoped tag definitions.",
      globalWriteMessage: "Only admins or global editors can manage global tag definitions.",
      allowGlobalRoleWrite: true,
      allowGlobalWriteWhenNoAdmins: true
    });

    try {
      const tag = await tagsRepository.updateTag(tagId, {
        name,
        definition,
        scope,
        userId,
        teamId,
        actorUserId: userId
      });
      if (!tag) {
        throw notFound("Tag not found.");
      }
      response.json({ scope, team_id: teamId, tag });
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
    const scope = parseScope(request.query.scope, {
      defaultScope: "all",
      fieldName: "scope",
      allowedScopes: CHAMPION_SCOPE_SET
    });
    const teamId = await resolveScopedTeamId({
      scope,
      rawTeamId: request.query.team_id,
      userId,
      usersRepository
    });

    await assertScopeWriteAuthorization({
      scope,
      userId,
      teamId,
      teamsRepository,
      usersRepository,
      teamWriteMessage: "You must be on the selected team to manage tag definitions.",
      teamLeadMessage: "Only team leads can manage team-scoped tag definitions.",
      globalWriteMessage: "Only admins or global editors can manage global tag definitions.",
      allowGlobalRoleWrite: true,
      allowGlobalWriteWhenNoAdmins: true
    });

    const assignmentCount = await tagsRepository.countTagAssignments(tagId, {
      scope,
      userId,
      teamId
    });
    if (assignmentCount > 0) {
      throw conflict("Cannot delete a tag definition that is assigned to champions in this scope.");
    }

    const deletedTag = await tagsRepository.deleteTag(tagId, {
      scope,
      userId,
      teamId
    });
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
      reviewed: champion.reviewed === true,
      reviewed_by_user_id: champion.reviewed_by_user_id ?? null,
      reviewed_by_display_name:
        champion.reviewed_by_user_id
          ? buildIdentityDisplayName(await usersRepository.findById(champion.reviewed_by_user_id))
          : null,
      reviewed_at: champion.reviewed_at ?? null
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
      reviewed: champion?.reviewed === true,
      reviewed_by_user_id: champion?.reviewed_by_user_id ?? null,
      reviewed_by_display_name:
        champion?.reviewed_by_user_id
          ? buildIdentityDisplayName(await usersRepository.findById(champion.reviewed_by_user_id))
          : null,
      reviewed_at: champion?.reviewed_at ?? null
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
    const compositionSynergies = normalizeCompositionSynergies(
      body.composition_synergies ?? body.compositionSynergies
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
      compositionSynergies,
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

  router.post("/tags/:id/promotion-requests", requireAuth, async (request, response) => {
    const tagId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const userId = request.user.userId;
    const sourceScope = parseScope(body.source_scope, {
      defaultScope: "self",
      fieldName: "source_scope",
      allowedScopes: new Set(["self", "team"])
    });
    const targetScope = parseScope(body.target_scope, {
      defaultScope: sourceScope === "self" ? "team" : "all",
      fieldName: "target_scope",
      allowedScopes: new Set(["team", "all"])
    });
    const sourceTeamId = sourceScope === "team"
      ? await resolveScopedTeamId({
          scope: "team",
          rawTeamId: body.team_id,
          userId,
          usersRepository
        })
      : null;
    const targetTeamId = targetScope === "team"
      ? await resolveScopedTeamId({
          scope: "team",
          rawTeamId: body.target_team_id ?? body.team_id,
          userId,
          usersRepository,
          fieldName: "target_team_id"
        })
      : null;
    await assertPromotionAuthorization({
      sourceScope,
      targetScope,
      sourceTeamId,
      targetTeamId,
      userId,
      teamsRepository
    });

    const sourceTag = await tagsRepository.getExactTagById(tagId, {
      scope: sourceScope,
      userId,
      teamId: sourceTeamId
    });
    if (!sourceTag) {
      throw notFound("Scoped tag definition not found.");
    }

    const requestComment = normalizeOptionalComment(body.request_comment, "request_comment");
    const promotionRequest = await promotionRequestsRepository.createPromotionRequest({
      entityType: "tag_definitions",
      resourceId: tagId,
      sourceScope,
      sourceUserId: sourceScope === "self" ? userId : null,
      sourceTeamId,
      targetScope,
      targetTeamId,
      requestedBy: userId,
      requestComment,
      payload: {
        tag_id: tagId,
        tag_name: sourceTag.name,
        definition: sourceTag.definition
      }
    });

    response.status(201).json({ promotion_request: promotionRequest });
  });

  router.get("/tags/promotion-requests", requireAuth, async (request, response) => {
    const userId = request.user.userId;
    const mode = typeof request.query.mode === "string" ? request.query.mode.trim().toLowerCase() : "requested";
    const status = typeof request.query.status === "string" ? request.query.status.trim().toLowerCase() : "";
    const normalizedStatus = status === "pending" || status === "approved" || status === "rejected" ? status : null;

    if (mode === "review") {
      const scope = parseScope(request.query.scope, {
        defaultScope: "team",
        fieldName: "scope",
        allowedScopes: new Set(["team", "all"])
      });
      const teamId = scope === "team"
        ? await resolveScopedTeamId({
            scope,
            rawTeamId: request.query.team_id,
            userId,
            usersRepository
          })
        : null;

      if (scope === "team") {
        await assertScopeWriteAuthorization({
          scope: "team",
          userId,
          teamId,
          teamsRepository,
          usersRepository,
          teamWriteMessage: "You must be on the selected team to review tag promotions.",
          teamLeadMessage: "Only team leads can review team tag promotions.",
          globalWriteMessage: "Only admins or global editors can review global tag promotions.",
          allowGlobalRoleWrite: true
        });
      } else if (!(await canReviewGlobalTagPromotion(userId, usersRepository))) {
        throw forbidden("Only admins or global editors can review global tag promotions.");
      }

      const promotionRequests = await promotionRequestsRepository.listPromotionRequests({
        entityType: "tag_definitions",
        status: normalizedStatus,
        targetScope: scope,
        targetTeamId: scope === "team" ? teamId : null
      });
      response.json({ promotion_requests: promotionRequests });
      return;
    }

    const promotionRequests = await promotionRequestsRepository.listPromotionRequests({
      entityType: "tag_definitions",
      status: normalizedStatus,
      requestedBy: userId
    });
    response.json({ promotion_requests: promotionRequests });
  });

  router.delete("/tags/promotion-requests/:id", requireAuth, async (request, response) => {
    const promotionRequestId = parsePositiveInteger(request.params.id, "id");
    const userId = request.user.userId;

    const promotionRequest = await promotionRequestsRepository.getPromotionRequestById(promotionRequestId);
    if (!promotionRequest || promotionRequest.entity_type !== "tag_definitions") {
      throw notFound("Promotion request not found.");
    }
    if (promotionRequest.requested_by !== userId) {
      throw forbidden("You can only cancel your own promotion requests.");
    }
    if (promotionRequest.status !== "pending") {
      throw conflict("Only pending promotion requests can be canceled.");
    }

    const canceled = await promotionRequestsRepository.cancelPromotionRequest(promotionRequestId, userId);
    if (!canceled) {
      throw conflict("Promotion request is no longer pending.");
    }

    response.json({ promotion_request: canceled });
  });

  router.post("/tags/promotion-requests/:id/review", requireAuth, async (request, response) => {
    const promotionRequestId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const userId = request.user.userId;
    const decision = normalizePromotionStatus(body.decision);
    const reviewComment = normalizeOptionalComment(body.review_comment, "review_comment");

    const promotionRequest = await promotionRequestsRepository.getPromotionRequestById(promotionRequestId);
    if (!promotionRequest || promotionRequest.entity_type !== "tag_definitions") {
      throw notFound("Promotion request not found.");
    }
    if (promotionRequest.status !== "pending") {
      throw conflict("Promotion request has already been reviewed.");
    }

    if (promotionRequest.target_scope === "team") {
      await assertScopeWriteAuthorization({
        scope: "team",
        userId,
        teamId: promotionRequest.target_team_id,
        teamsRepository,
        usersRepository,
        teamWriteMessage: "You must be on the selected team to review tag promotions.",
        teamLeadMessage: "Only team leads can review team tag promotions.",
        globalWriteMessage: "Only admins or global editors can review global tag promotions.",
        allowGlobalRoleWrite: true
      });
    } else if (!(await canReviewGlobalTagPromotion(userId, usersRepository))) {
      throw forbidden("Only admins or global editors can review global tag promotions.");
    }

    if (decision === "approved") {
      const payload = promotionRequest.payload_json ?? {};
      const tagName = typeof payload.tag_name === "string" ? payload.tag_name.trim() : "";
      const definition = typeof payload.definition === "string" ? payload.definition.trim() : "";
      if (!tagName) {
        throw badRequest("Promotion request payload is missing tag data.");
      }

      const targetOwner = {
        scope: promotionRequest.target_scope,
        userId: null,
        teamId: promotionRequest.target_scope === "team" ? promotionRequest.target_team_id : null
      };
      const targetTags = await tagsRepository.listTags({
        scope: targetOwner.scope,
        userId: targetOwner.userId,
        teamId: targetOwner.teamId,
        includeFallback: false
      });
      const exactTarget = targetTags.find((tag) => tag.name.trim().toLowerCase() === tagName.toLowerCase()) ?? null;

      if (exactTarget) {
        await tagsRepository.updateTag(exactTarget.id, {
          name: tagName,
          definition,
          scope: targetOwner.scope,
          userId: targetOwner.userId,
          teamId: targetOwner.teamId,
          actorUserId: userId
        });
      } else {
        await tagsRepository.createTag({
          name: tagName,
          definition,
          scope: targetOwner.scope,
          userId: targetOwner.userId,
          teamId: targetOwner.teamId,
          actorUserId: userId
        });
      }
    }

    const reviewed = await promotionRequestsRepository.reviewPromotionRequest(promotionRequestId, {
      status: decision,
      reviewedByUserId: userId,
      reviewComment
    });
    response.json({ promotion_request: reviewed });
  });

  return router;
}
