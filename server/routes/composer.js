import { Router } from "express";

import { badRequest, notFound } from "../errors.js";
import { parsePositiveInteger, requireObject } from "../http/validation.js";
import { assertScopeReadAuthorization } from "../scope-authorization.js";

const SCOPE_RESOURCES = Object.freeze([
  "champion_metadata",
  "champion_tags",
  "tag_definitions",
  "requirements",
  "compositions"
]);
const SCOPE_RESOURCE_SET = new Set(SCOPE_RESOURCES);
const PRECEDENCE_MODES = new Map([
  ["user_team_global", ["self", "team", "all"]],
  ["team_user_global", ["team", "self", "all"]],
  ["user_global", ["self", "all"]],
  ["team_global", ["team", "all"]],
  ["global_only", ["all"]]
]);
const MAX_DRAFT_SETUP_NAME_LENGTH = 80;

function normalizeOptionalPositiveInteger(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizePrecedenceMode(rawValue, fallback = "user_team_global") {
  const normalized = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
  return PRECEDENCE_MODES.has(normalized) ? normalized : fallback;
}

function normalizeDraftSetupName(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    throw badRequest("Expected 'name' to be a non-empty string.");
  }
  const normalized = rawValue.trim();
  if (normalized.length > MAX_DRAFT_SETUP_NAME_LENGTH) {
    throw badRequest(`Expected 'name' to be ${MAX_DRAFT_SETUP_NAME_LENGTH} characters or fewer.`);
  }
  return normalized;
}

function normalizeScopeResourceSettings(rawValue = {}) {
  const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  return Object.fromEntries(
    SCOPE_RESOURCES.map((resource) => {
      const config = source[resource] && typeof source[resource] === "object" && !Array.isArray(source[resource])
        ? source[resource]
        : {};
      return [
        resource,
        {
          enabled: config.enabled !== false,
          precedence: normalizePrecedenceMode(config.precedence, "user_team_global")
        }
      ];
    })
  );
}

async function resolveComposerTeamId({ rawTeamId, userId, usersRepository, teamsRepository }) {
  const explicitTeamId = normalizeOptionalPositiveInteger(rawTeamId);
  if (explicitTeamId === null) {
    return null;
  }
  await assertScopeReadAuthorization({
    scope: "team",
    userId,
    teamId: explicitTeamId,
    teamsRepository,
    teamReadMessage: "You must be on the selected team to use team-scoped Composer data."
  });
  return explicitTeamId;
}

function buildMergedNamedEntries(globalEntries, exactEntriesByScope, precedenceList) {
  const merged = new Map();
  for (const entry of globalEntries) {
    const key = typeof entry?.name === "string" ? entry.name.trim().toLowerCase() : "";
    if (!key) {
      continue;
    }
    merged.set(key, entry);
  }

  const overrideScopes = precedenceList.filter((scope) => scope !== "all").reverse();
  for (const scope of overrideScopes) {
    const exactEntries = exactEntriesByScope[scope] ?? [];
    for (const entry of exactEntries) {
      const key = typeof entry?.name === "string" ? entry.name.trim().toLowerCase() : "";
      if (!key) {
        continue;
      }
      merged.set(key, entry);
    }
  }

  return [...merged.values()].sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

function buildScopedChampionPayload(globalChampions, metadataRowsByScope, tagRowsByScope, resourceSettings, precedenceLists) {
  const metadataOverrideScopes = (resourceSettings.champion_metadata?.enabled !== false
    ? precedenceLists.champion_metadata
    : ["all"]).filter((scope) => scope !== "all").reverse();
  const tagOverrideScopes = (resourceSettings.champion_tags?.enabled !== false
    ? precedenceLists.champion_tags
    : ["all"]).filter((scope) => scope !== "all").reverse();

  const metadataMaps = Object.fromEntries(
    ["self", "team"].map((scope) => [
      scope,
      new Map((metadataRowsByScope[scope] ?? []).map((row) => [row.champion_id, row.metadata]))
    ])
  );
  const tagMaps = Object.fromEntries(
    ["self", "team"].map((scope) => [
      scope,
      new Map((tagRowsByScope[scope] ?? []).map((row) => [row.champion_id, row.tag_ids]))
    ])
  );

  return globalChampions.map((champion) => {
    let metadata = champion.metadata;
    for (const scope of metadataOverrideScopes) {
      if (metadataMaps[scope]?.has(champion.id)) {
        metadata = metadataMaps[scope].get(champion.id);
      }
    }

    let tagIds = Array.isArray(champion.tagIds) ? champion.tagIds : [];
    for (const scope of tagOverrideScopes) {
      if (tagMaps[scope]?.has(champion.id)) {
        tagIds = tagMaps[scope].get(champion.id);
      }
    }

    return {
      id: champion.id,
      name: champion.name,
      role: champion.role,
      metadata,
      tag_ids: tagIds,
      reviewed: champion.reviewed === true,
      reviewed_by_user_id: champion.reviewed_by_user_id ?? null,
      reviewed_at: champion.reviewed_at ?? null
    };
  });
}

function buildVisibleTags(canonicalTags, resolvedTagDefinitions) {
  const byId = new Map(canonicalTags.map((tag) => [tag.id, { ...tag, resolved_scope: "all", has_custom_definition: true }]));
  for (const tag of resolvedTagDefinitions) {
    byId.set(tag.id, {
      id: tag.id,
      name: tag.name,
      definition: tag.definition,
      resolved_scope: tag.resolved_scope,
      has_custom_definition: tag.has_custom_definition === true
    });
  }
  return [...byId.values()].sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

function serializeDraftSetup(setup) {
  return {
    id: Number(setup.id),
    user_id: Number(setup.user_id),
    name: setup.name,
    state_json: setup.state_json ?? {},
    created_at: setup.created_at,
    updated_at: setup.updated_at
  };
}

export function createComposerRouter({
  championsRepository,
  tagsRepository,
  compositionsCatalogRepository,
  draftSetupsRepository,
  usersRepository,
  teamsRepository,
  requireAuth,
  optionalAuth
}) {
  const router = Router();

  router.post("/composer/context", optionalAuth, async (request, response) => {
    const body = requireObject(request.body);
    const userId = request.user?.userId ?? null;
    const teamId = Number.isInteger(userId)
      ? await resolveComposerTeamId({
          rawTeamId: body.team_id,
          userId,
          usersRepository,
          teamsRepository
        })
      : null;

    const useCustomScopes = Number.isInteger(userId) && body.use_custom_scopes !== false;
    const defaultPrecedence = normalizePrecedenceMode(body.default_precedence, "user_team_global");
    const resourceSettings = normalizeScopeResourceSettings(body.resources);
    const precedenceLists = Object.fromEntries(
      SCOPE_RESOURCES.map((resource) => {
        const mode = useCustomScopes && resourceSettings[resource].enabled
          ? resourceSettings[resource].precedence
          : "global_only";
        return [resource, PRECEDENCE_MODES.get(mode) ?? PRECEDENCE_MODES.get("global_only")];
      })
    );

    const globalChampions = await championsRepository.listChampions();
    const canonicalTags = await tagsRepository.listCanonicalTags();
    const globalRequirementDefinitions = await compositionsCatalogRepository.listRequirements({ scope: "all" });
    const globalCompositionBundles = await compositionsCatalogRepository.listCompositions({ scope: "all" });
    const globalTagDefinitions = await tagsRepository.listTags({ scope: "all", includeFallback: false });

    const metadataRowsByScope = { self: [], team: [] };
    const tagRowsByScope = { self: [], team: [] };
    const exactTagDefinitions = { self: [], team: [] };
    const exactRequirements = { self: [], team: [] };
    const exactCompositions = { self: [], team: [] };

    if (Number.isInteger(userId)) {
      metadataRowsByScope.self = await championsRepository.listChampionMetadataForScope({ scope: "self", userId });
      tagRowsByScope.self = await championsRepository.listChampionTagAssignmentsForScope({ scope: "self", userId });
      exactTagDefinitions.self = await tagsRepository.listTags({ scope: "self", userId, includeFallback: false });
      exactRequirements.self = await compositionsCatalogRepository.listRequirements({ scope: "self", userId });
      exactCompositions.self = await compositionsCatalogRepository.listCompositions({ scope: "self", userId });
    }

    if (Number.isInteger(userId) && Number.isInteger(teamId)) {
      metadataRowsByScope.team = await championsRepository.listChampionMetadataForScope({ scope: "team", teamId });
      tagRowsByScope.team = await championsRepository.listChampionTagAssignmentsForScope({ scope: "team", teamId });
      exactTagDefinitions.team = await tagsRepository.listTags({ scope: "team", teamId, includeFallback: false });
      exactRequirements.team = await compositionsCatalogRepository.listRequirements({ scope: "team", teamId });
      exactCompositions.team = await compositionsCatalogRepository.listCompositions({ scope: "team", teamId });
    }

    const champions = buildScopedChampionPayload(
      globalChampions,
      metadataRowsByScope,
      tagRowsByScope,
      resourceSettings,
      precedenceLists
    );
    const resolvedTagDefinitions = buildMergedNamedEntries(
      globalTagDefinitions,
      exactTagDefinitions,
      precedenceLists.tag_definitions
    );
    const tags = buildVisibleTags(canonicalTags, resolvedTagDefinitions);
    const requirements = buildMergedNamedEntries(
      globalRequirementDefinitions,
      exactRequirements,
      precedenceLists.requirements
    );
    const compositions = buildMergedNamedEntries(
      globalCompositionBundles,
      exactCompositions,
      precedenceLists.compositions
    );
    const activeComposition = compositions.find((composition) => composition.is_active) ?? null;

    response.json({
      team_id: teamId,
      default_precedence: defaultPrecedence,
      resources: resourceSettings,
      champions,
      tags,
      requirements,
      compositions,
      active_composition_id: activeComposition?.id ?? null
    });
  });

  router.get("/me/draft-setups", requireAuth, async (request, response) => {
    const setups = await draftSetupsRepository.listDraftSetupsByUser(request.user.userId);
    response.json({
      draft_setups: setups.map(serializeDraftSetup)
    });
  });

  router.post("/me/draft-setups", requireAuth, async (request, response) => {
    const body = requireObject(request.body);
    const name = normalizeDraftSetupName(body.name);
    const stateJson =
      body.state_json && typeof body.state_json === "object" && !Array.isArray(body.state_json)
        ? body.state_json
        : body.stateJson && typeof body.stateJson === "object" && !Array.isArray(body.stateJson)
          ? body.stateJson
          : {};

    const setup = await draftSetupsRepository.createDraftSetup({
      userId: request.user.userId,
      name,
      stateJson
    });
    response.status(201).json({ draft_setup: serializeDraftSetup(setup) });
  });

  router.put("/me/draft-setups/:id", requireAuth, async (request, response) => {
    const setupId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const name = normalizeDraftSetupName(body.name);
    const stateJson =
      body.state_json && typeof body.state_json === "object" && !Array.isArray(body.state_json)
        ? body.state_json
        : body.stateJson && typeof body.stateJson === "object" && !Array.isArray(body.stateJson)
          ? body.stateJson
          : {};

    const setup = await draftSetupsRepository.updateDraftSetup(setupId, {
      userId: request.user.userId,
      name,
      stateJson
    });
    if (!setup) {
      throw notFound("Draft Setup not found.");
    }
    response.json({ draft_setup: serializeDraftSetup(setup) });
  });

  router.delete("/me/draft-setups/:id", requireAuth, async (request, response) => {
    const setupId = parsePositiveInteger(request.params.id, "id");
    const deleted = await draftSetupsRepository.deleteDraftSetup(setupId, request.user.userId);
    if (!deleted) {
      throw notFound("Draft Setup not found.");
    }
    response.status(204).end();
  });

  return router;
}
