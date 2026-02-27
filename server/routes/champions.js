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

const CHAMPION_TAG_SCOPE_SET = new Set(["all"]);
const MAX_CHAMPION_TAGS_PER_SCOPE = 64;

function normalizeTagIds(tagIds) {
  const deduplicated = Array.from(new Set(tagIds));
  if (deduplicated.length > MAX_CHAMPION_TAGS_PER_SCOPE) {
    throw badRequest(`Expected 'tag_ids' to contain at most ${MAX_CHAMPION_TAGS_PER_SCOPE} entries.`);
  }
  return deduplicated.sort((left, right) => left - right);
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

  router.post("/champions/:id/tags/promotion-requests", requireAuth, async (request, response) => {
    requireObject(request.body);
    throw badRequest("Champion tag promotion requests are not supported in MVP. Edit global tags directly.");
  });

  return router;
}
