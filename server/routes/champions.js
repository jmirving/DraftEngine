import { Router } from "express";

import { badRequest, conflict, notFound } from "../errors.js";
import {
  parsePositiveInteger,
  requireArrayOfPositiveIntegers,
  requireNonEmptyString,
  requireObject
} from "../http/validation.js";
import {
  assertScopeWriteAuthorization,
  parseScope
} from "../scope-authorization.js";
import { DAMAGE_TYPES, SCALING_VALUES, SLOTS } from "../../src/domain/model.js";

const CHAMPION_TAG_SCOPE_SET = new Set(["all"]);
const MAX_CHAMPION_TAGS_PER_SCOPE = 64;
const SLOT_SET = new Set(SLOTS);
const DAMAGE_TYPE_SET = new Set(DAMAGE_TYPES);
const SCALING_SET = new Set(SCALING_VALUES);
const MAX_TAG_NAME_LENGTH = 64;
const MAX_TAG_CATEGORY_LENGTH = 48;

function normalizeTagIds(tagIds) {
  const deduplicated = Array.from(new Set(tagIds));
  if (deduplicated.length > MAX_CHAMPION_TAGS_PER_SCOPE) {
    throw badRequest(`Expected 'tag_ids' to contain at most ${MAX_CHAMPION_TAGS_PER_SCOPE} entries.`);
  }
  return deduplicated.sort((left, right) => left - right);
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

function normalizeMetadataDamageType(rawValue) {
  if (typeof rawValue !== "string") {
    throw badRequest("Expected 'damage_type' to be a string.");
  }
  const normalized = rawValue.trim();
  if (!DAMAGE_TYPE_SET.has(normalized)) {
    throw badRequest(`Expected 'damage_type' to be one of: ${DAMAGE_TYPES.join(", ")}.`);
  }
  return normalized;
}

function normalizeMetadataScaling(rawValue) {
  if (typeof rawValue !== "string") {
    throw badRequest("Expected 'scaling' to be a string.");
  }
  const normalized = rawValue.trim();
  if (!SCALING_SET.has(normalized)) {
    throw badRequest(`Expected 'scaling' to be one of: ${SCALING_VALUES.join(", ")}.`);
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

function normalizeTagCategory(rawValue) {
  const normalized = requireNonEmptyString(rawValue, "category").toLowerCase();
  if (normalized.length > MAX_TAG_CATEGORY_LENGTH) {
    throw badRequest(`Expected 'category' to be ${MAX_TAG_CATEGORY_LENGTH} characters or fewer.`);
  }
  return normalized;
}

function isUniqueViolation(error) {
  return Boolean(error && typeof error === "object" && error.code === "23505");
}

export function createChampionsRouter({
  championsRepository,
  tagsRepository,
  usersRepository,
  teamsRepository,
  requireAuth
}) {
  const router = Router();

  router.get("/champions", async (_request, response) => {
    const champions = await championsRepository.listChampions();
    response.json({ champions });
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
    const category = normalizeTagCategory(body.category);

    await assertScopeWriteAuthorization({
      scope: "all",
      userId,
      teamId: null,
      teamsRepository,
      usersRepository,
      teamWriteMessage: "You must be on the selected team to manage tags.",
      teamLeadMessage: "Only team leads can manage tags.",
      globalWriteMessage: "Only admins can manage tag catalog.",
      allowGlobalWriteWhenNoAdmins: true
    });

    try {
      const tag = await tagsRepository.createTag({ name, category });
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
    const category = normalizeTagCategory(body.category);

    await assertScopeWriteAuthorization({
      scope: "all",
      userId,
      teamId: null,
      teamsRepository,
      usersRepository,
      teamWriteMessage: "You must be on the selected team to manage tags.",
      teamLeadMessage: "Only team leads can manage tags.",
      globalWriteMessage: "Only admins can manage tag catalog.",
      allowGlobalWriteWhenNoAdmins: true
    });

    try {
      const tag = await tagsRepository.updateTag(tagId, { name, category });
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
      globalWriteMessage: "Only admins can manage tag catalog.",
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
    const scope = parseScope(request.query.scope, {
      defaultScope: "all",
      fieldName: "scope",
      allowedScopes: CHAMPION_TAG_SCOPE_SET
    });
    if (request.query.team_id !== undefined) {
      throw badRequest("Expected 'team_id' to be omitted for global champion tag reads.");
    }

    const championExists = await championsRepository.championExists(championId);
    if (!championExists) {
      throw notFound("Champion not found.");
    }

    const tagIds = await tagsRepository.listChampionTagIdsForScope({
      championId,
      scope: "all"
    });

    response.json({
      scope: "all",
      team_id: null,
      tag_ids: tagIds
    });
  });

  router.put("/champions/:id/tags", requireAuth, async (request, response) => {
    const championId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const scope = parseScope(body.scope, {
      defaultScope: "all",
      fieldName: "scope",
      allowedScopes: CHAMPION_TAG_SCOPE_SET
    });
    if (body.team_id !== undefined) {
      throw badRequest("Expected 'team_id' to be omitted for global champion tag edits.");
    }
    const userId = request.user.userId;
    const tagIds = normalizeTagIds(requireArrayOfPositiveIntegers(body.tag_ids, "tag_ids"));

    const championExists = await championsRepository.championExists(championId);
    if (!championExists) {
      throw notFound("Champion not found.");
    }

    await assertScopeWriteAuthorization({
      scope,
      userId,
      teamId: null,
      teamsRepository,
      usersRepository,
      teamWriteMessage: "You must be on the selected team to edit team tags.",
      teamLeadMessage: "Only team leads can edit team tags.",
      globalWriteMessage: "Only admins can edit global champion tags.",
      allowGlobalWriteWhenNoAdmins: true
    });

    const allTagsExist = await tagsRepository.allTagIdsExist(tagIds);
    if (!allTagsExist) {
      throw badRequest("One or more tag IDs do not exist.");
    }

    await tagsRepository.replaceChampionTagsForScope({
      championId,
      tagIds,
      scope: "all"
    });
    const champion = await championsRepository.getChampionById(championId);
    response.json({
      champion,
      scope: "all",
      team_id: null,
      tag_ids: tagIds
    });
  });

  router.put("/champions/:id/metadata", requireAuth, async (request, response) => {
    const championId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const userId = request.user.userId;

    const roles = normalizeMetadataRoles(body.roles);
    const damageType = normalizeMetadataDamageType(body.damage_type ?? body.damageType);
    const scaling = normalizeMetadataScaling(body.scaling);

    const championExists = await championsRepository.championExists(championId);
    if (!championExists) {
      throw notFound("Champion not found.");
    }

    await assertScopeWriteAuthorization({
      scope: "all",
      userId,
      teamId: null,
      teamsRepository,
      usersRepository,
      teamWriteMessage: "You must be on the selected team to edit team champion metadata.",
      teamLeadMessage: "Only team leads can edit team champion metadata.",
      globalWriteMessage: "Only admins can edit global champion metadata."
    });

    const champion = await championsRepository.updateChampionMetadata(championId, {
      roles,
      damageType,
      scaling
    });
    if (!champion) {
      throw notFound("Champion not found.");
    }
    response.json({ champion });
  });

  router.post("/champions/:id/tags/promotion-requests", requireAuth, async (request, response) => {
    requireObject(request.body);
    throw badRequest("Champion tag promotion requests are not supported in MVP. Edit global tags directly.");
  });

  return router;
}
