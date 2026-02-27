import { Router } from "express";

import { badRequest, forbidden, notFound } from "../errors.js";
import {
  parsePositiveInteger,
  requireArrayOfPositiveIntegers,
  requireObject
} from "../http/validation.js";

const CHAMPION_TAG_SCOPE_SET = new Set(["self", "team", "all"]);
const MAX_CHAMPION_TAGS_PER_SCOPE = 64;

function parseChampionTagScope(value, { defaultScope = "self" } = {}) {
  const raw = value === undefined || value === null ? defaultScope : value;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw badRequest("Expected 'scope' to be one of: self, team, all.");
  }

  const normalized = raw.trim().toLowerCase();
  if (!CHAMPION_TAG_SCOPE_SET.has(normalized)) {
    throw badRequest("Expected 'scope' to be one of: self, team, all.");
  }
  return normalized;
}

function normalizeTagIds(tagIds) {
  const deduplicated = Array.from(new Set(tagIds));
  if (deduplicated.length > MAX_CHAMPION_TAGS_PER_SCOPE) {
    throw badRequest(`Expected 'tag_ids' to contain at most ${MAX_CHAMPION_TAGS_PER_SCOPE} entries.`);
  }
  return deduplicated.sort((left, right) => left - right);
}

async function resolveScopedTeamId({
  scope,
  rawTeamId,
  userId,
  usersRepository
}) {
  if (scope !== "team") {
    return null;
  }

  if (rawTeamId !== undefined && rawTeamId !== null && rawTeamId !== "") {
    return parsePositiveInteger(rawTeamId, "team_id");
  }

  const teamContext = await usersRepository.findTeamContextById(userId);
  const activeTeamId = teamContext?.active_team_id;
  if (activeTeamId === undefined || activeTeamId === null) {
    throw badRequest("Expected 'team_id' or an active team context when scope is 'team'.");
  }

  return parsePositiveInteger(activeTeamId, "active_team_id");
}

async function assertReadScopeAuthorization({
  scope,
  userId,
  teamId,
  teamsRepository
}) {
  if (scope !== "team") {
    return;
  }

  const membership = await teamsRepository.getMembership(teamId, userId);
  if (!membership) {
    throw forbidden("You must be on the selected team to read team tag edits.");
  }
}

async function assertWriteScopeAuthorization({
  scope,
  userId,
  teamId,
  teamsRepository
}) {
  if (scope === "self") {
    return;
  }

  if (scope === "team") {
    const membership = await teamsRepository.getMembership(teamId, userId);
    if (!membership) {
      throw forbidden("You must be on the selected team to edit team tags.");
    }
    return;
  }

  const teams = await teamsRepository.listTeamsByUser(userId);
  const canEditAll = teams.some((team) => team.membership_role === "lead");
  if (!canEditAll) {
    throw forbidden("Only team leads can edit global champion tags.");
  }
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
    const scope = parseChampionTagScope(request.query.scope, { defaultScope: "self" });
    const userId = request.user.userId;
    const teamId = await resolveScopedTeamId({
      scope,
      rawTeamId: request.query.team_id,
      userId,
      usersRepository
    });

    const championExists = await championsRepository.championExists(championId);
    if (!championExists) {
      throw notFound("Champion not found.");
    }

    await assertReadScopeAuthorization({
      scope,
      userId,
      teamId,
      teamsRepository
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
      tag_ids: tagIds
    });
  });

  router.put("/champions/:id/tags", requireAuth, async (request, response) => {
    const championId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const scope = parseChampionTagScope(body.scope, { defaultScope: "self" });
    const userId = request.user.userId;
    const teamId = await resolveScopedTeamId({
      scope,
      rawTeamId: body.team_id,
      userId,
      usersRepository
    });
    const tagIds = normalizeTagIds(requireArrayOfPositiveIntegers(body.tag_ids, "tag_ids"));

    const championExists = await championsRepository.championExists(championId);
    if (!championExists) {
      throw notFound("Champion not found.");
    }

    await assertWriteScopeAuthorization({
      scope,
      userId,
      teamId,
      teamsRepository
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
    const champion = await championsRepository.getChampionById(championId);
    response.json({
      champion,
      scope,
      team_id: teamId,
      tag_ids: tagIds
    });
  });

  return router;
}
