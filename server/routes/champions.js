import { Router } from "express";

import { badRequest, notFound } from "../errors.js";
import {
  parsePositiveInteger,
  requireArrayOfPositiveIntegers,
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
      globalWriteMessage: "Only admins can edit global champion tags."
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
