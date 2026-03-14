import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { getAuthorizationMatrix } from "../../server/authorization-matrix.js";
import { BOOLEAN_TAGS } from "../../src/index.js";

const htmlFixture = readFileSync(resolve("public/index.html"), "utf8");
const OWNER_ADMIN_EMAILS = new Set(["jirving0311@gmail.com", "tylerjtriplett@gmail.com"]);

function createStorageStub(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    dump(key) {
      return store.get(key) ?? null;
    }
  };
}

function createMatchMedia() {
  return (query) => ({
    matches: false,
    media: query,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {}
  });
}

function setInputFiles(inputElement, files) {
  Object.defineProperty(inputElement, "files", {
    configurable: true,
    value: files
  });
}

function tagsFalse() {
  return Object.fromEntries(BOOLEAN_TAGS.map((tag) => [tag, false]));
}

function createRoleProfile(primaryDamageType, early = "neutral", mid = "neutral", late = "neutral") {
  const powerSpikes = [];
  if (early === "strong") powerSpikes.push({ start: 1, end: 6 });
  if (mid === "strong") powerSpikes.push({ start: 7, end: 12 });
  if (late === "strong") powerSpikes.push({ start: 13, end: 18 });
  return {
    primaryDamageType,
    powerSpikes
  };
}

function createJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

function createFetchHarness({
  pools = [],
  teams = [],
  membersByTeam = {},
  teamJoinRequestsByTeam = {},
  memberInvitationsByTeam = {},
  failMemberInvitationTeamIds = [],
  userInvitationsSeed = null,
  failCreatePoolWith401 = false,
  championIdsAsStrings = false,
  loginUser = null,
  profile = null,
  teamContext = null,
  adminUsersSeed = null,
  issueReporting = null
} = {}) {
  const calls = [];
  let nextPoolId = pools.length + 1;
  const failedMemberInvitationTeamIds = new Set((failMemberInvitationTeamIds ?? []).map((teamId) => String(teamId)));
  const memberInvitations = new Map(
    Object.entries(memberInvitationsByTeam).map(([teamId, invitations]) => [String(teamId), [...(invitations ?? [])]])
  );
  let userInvitations = Array.isArray(userInvitationsSeed) ? [...userInvitationsSeed] : null;
  const issueReportingState = {
    enabled: issueReporting?.enabled === true,
    repository: typeof issueReporting?.repository === "string" && issueReporting.repository.trim() !== ""
      ? issueReporting.repository.trim()
      : "jmirving/DraftEngine",
    fallbackUrl: typeof issueReporting?.fallbackUrl === "string" && issueReporting.fallbackUrl.trim() !== ""
      ? issueReporting.fallbackUrl.trim()
      : "https://github.com/jmirving/DraftEngine/issues/new/choose"
  };
  const tags = [
    { id: 1, name: "engage", definition: "Helps your comp start fights." },
    { id: 2, name: "frontline", definition: "Adds durable front line presence." },
    { id: 3, name: "burst", definition: "Adds fast pick damage windows." }
  ];
  const tagDefinitions = [
    { tag_id: 1, scope: "all", user_id: null, team_id: null, definition: "Helps your comp start fights." },
    { tag_id: 2, scope: "all", user_id: null, team_id: null, definition: "Adds durable front line presence." },
    { tag_id: 3, scope: "all", user_id: null, team_id: null, definition: "Adds fast pick damage windows." }
  ];
  let nextTagId = 4;
  let nextDraftSetupId = 1;
  let draftSetups = [];
  let nextPromotionRequestId = 1;
  let promotionRequests = [];
  const championMetadataById = new Map([
    [
      1,
      {
        roles: ["Mid"],
        roleProfiles: {
          Mid: createRoleProfile("ap", "neutral", "strong", "neutral")
        },
        damageType: "AP",
        scaling: "Mid",
        tags: tagsFalse()
      }
    ],
    [
      2,
      {
        roles: ["ADC", "Support"],
        roleProfiles: {
          ADC: createRoleProfile("ad", "neutral", "strong", "strong"),
          Support: createRoleProfile("ap", "neutral", "strong", "weak")
        },
        damageType: "AD",
        scaling: "Late",
        tags: tagsFalse()
      }
    ],
    [
      3,
      {
        roles: ["Support"],
        roleProfiles: {
          Support: createRoleProfile("utility", "neutral", "strong", "weak")
        },
        damageType: "Utility",
        scaling: "Mid",
        tags: tagsFalse()
      }
    ]
  ]);
  const userChampionMetadataByScope = new Map();
  const teamChampionMetadataByScope = new Map();
  const championReviewedById = new Map([
    [1, false],
    [2, false],
    [3, false]
  ]);
  const globalChampionTagIds = new Map([
    [1, new Set([1])],
    [2, new Set([])],
    [3, new Set([])]
  ]);
  const userChampionTagIds = new Map();
  const teamChampionTagIds = new Map();
  let persistedTeamContext = {
    activeTeamId: null,
    ...(teamContext && typeof teamContext === "object" ? teamContext : {})
  };
  let requirementDefinitions = [
    {
      id: 1,
      name: "Frontline Anchor",
      definition: "At least one frontline tag.",
      rules: [
        {
          expr: { tag: "Frontline" },
          minCount: 1
        }
      ],
      scope: "all",
      team_id: null,
      user_id: null
    }
  ];
  let nextRequirementDefinitionId = 2;
  let compositions = [
    {
      id: 1,
      name: "Standard Comp",
      description: "Baseline setup",
      requirement_ids: [1],
      is_active: true,
      scope: "all",
      team_id: null,
      user_id: null
    }
  ];
  let nextCompositionId = 2;

  function normalizeCatalogScope(scope) {
    return scope === "self" || scope === "team" ? scope : "all";
  }

  function canWriteGlobalCatalog() {
    const role = String(resolvedLoginUser.role ?? "").trim().toLowerCase();
    return role === "admin" || role === "global" || role === "";
  }

  function canReadCatalogScope(scope, teamId) {
    const normalizedScope = normalizeCatalogScope(scope);
    if (normalizedScope !== "team") {
      return true;
    }
    return teams.some((team) => Number(team.id) === Number(teamId) && team.membership_role);
  }

  function canWriteCatalogScope(scope, teamId) {
    const normalizedScope = normalizeCatalogScope(scope);
    if (normalizedScope === "self") {
      return true;
    }
    if (normalizedScope === "team") {
      return teams.some((team) => Number(team.id) === Number(teamId) && team.membership_role === "lead");
    }
    return canWriteGlobalCatalog();
  }

  function resolveCatalogTeamId(rawValue) {
    const parsed = Number.parseInt(String(rawValue ?? ""), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function matchesCatalogScope(entity, scope, teamId) {
    const normalizedScope = normalizeCatalogScope(scope);
    if ((entity.scope ?? "all") !== normalizedScope) {
      return false;
    }
    if (normalizedScope === "self") {
      return Number(entity.user_id) === Number(resolvedLoginUser.id);
    }
    if (normalizedScope === "team") {
      return Number(entity.team_id) === Number(teamId);
    }
    return true;
  }

  function normalizeTagScope(scope) {
    return scope === "self" || scope === "team" ? scope : "all";
  }

  function normalizeTagOwner(scope, teamId = null) {
    const normalizedScope = normalizeTagScope(scope);
    return {
      scope: normalizedScope,
      userId: normalizedScope === "self" ? Number(resolvedLoginUser.id) : null,
      teamId: normalizedScope === "team" ? Number(teamId) : null
    };
  }

  function matchesTagOwner(definition, owner) {
    if ((definition.scope ?? "all") !== owner.scope) {
      return false;
    }
    if (owner.scope === "self") {
      return Number(definition.user_id) === Number(owner.userId);
    }
    if (owner.scope === "team") {
      return Number(definition.team_id) === Number(owner.teamId);
    }
    return true;
  }

  function getCanonicalTagByName(name) {
    return tags.find((tag) => tag.name.toLowerCase() === String(name).trim().toLowerCase()) ?? null;
  }

  function getExactTagDefinition(tagId, owner) {
    return tagDefinitions.find(
      (definition) => Number(definition.tag_id) === Number(tagId) && matchesTagOwner(definition, owner)
    ) ?? null;
  }

  function buildResolvedTagRecord(tagId, definition) {
    const canonical = tags.find((tag) => tag.id === Number(tagId)) ?? null;
    if (!canonical || !definition) {
      return null;
    }
    return {
      id: canonical.id,
      name: canonical.name,
      definition: definition.definition,
      resolved_scope: definition.scope,
      has_custom_definition: true,
      user_id: definition.user_id,
      team_id: definition.team_id
    };
  }

  function listVisibleTags(scope, teamId = null, includeFallback = true) {
    const owner = normalizeTagOwner(scope, teamId);
    const exactDefinitions = tagDefinitions.filter((definition) => matchesTagOwner(definition, owner));
    if (!includeFallback) {
      return exactDefinitions
        .map((definition) => buildResolvedTagRecord(definition.tag_id, definition))
        .filter(Boolean)
        .sort((left, right) => left.name.localeCompare(right.name));
    }

    const resolved = new Map();
    for (const definition of tagDefinitions.filter((candidate) => candidate.scope === "all")) {
      const tag = buildResolvedTagRecord(definition.tag_id, definition);
      if (tag) {
        resolved.set(tag.id, tag);
      }
    }
    for (const definition of exactDefinitions) {
      const tag = buildResolvedTagRecord(definition.tag_id, definition);
      if (tag) {
        resolved.set(tag.id, tag);
      }
    }
    return [...resolved.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  function moveScopedHarnessAssignments(scope, ownerId, oldTagId, newTagId) {
    if (oldTagId === newTagId) {
      return;
    }
    const store = scope === "self" ? userChampionTagIds : teamChampionTagIds;
    const keyPrefix = `${scope}:${ownerId}:`;
    for (const [key, tagIds] of store.entries()) {
      if (!String(key).startsWith(keyPrefix) || !tagIds.has(oldTagId)) {
        continue;
      }
      tagIds.delete(oldTagId);
      tagIds.add(newTagId);
    }
  }

  function normalizeComposerPrecedence(mode) {
    switch (mode) {
      case "team_user_global":
        return ["team", "self", "all"];
      case "user_global":
        return ["self", "all"];
      case "team_global":
        return ["team", "all"];
      case "global_only":
        return ["all"];
      default:
        return ["self", "team", "all"];
    }
  }

  function getComposerOverrideOrder(mode) {
    return normalizeComposerPrecedence(mode).filter((scope) => scope !== "all").reverse();
  }
  let joinRequestsByTeam = Object.fromEntries(
    Object.entries(teamJoinRequestsByTeam).map(([teamId, requests]) => [String(teamId), [...(requests ?? [])]])
  );
  let resolvedLoginUser = loginUser ?? {
    id: 11,
    email: "user@example.com",
    role: "admin",
    gameName: "LoginUser",
    tagline: "NA1",
    displayTeamId: null,
    avatarChampionId: null,
    primaryRole: "Mid",
    secondaryRoles: ["Top"]
  };
  let resolvedProfile = profile ?? {
    id: 11,
    email: "user@example.com",
    role: "admin",
    gameName: "LoginUser",
    tagline: "NA1",
    displayTeamId: null,
    avatarChampionId: null,
    primaryRole: "Mid",
    secondaryRoles: ["Top"]
  };
  let nextTeamJoinRequestId = Math.max(
    1,
    ...Object.values(joinRequestsByTeam)
      .flat()
      .map((request) => Number.parseInt(String(request?.id ?? 0), 10) + 1)
      .filter((value) => Number.isInteger(value) && value > 0)
  );
  const adminUsers = Array.isArray(adminUsersSeed) && adminUsersSeed.length > 0
    ? adminUsersSeed.map((user) => ({ ...user }))
    : [
        {
          id: 11,
          email: resolvedLoginUser.email,
          role: typeof resolvedLoginUser.role === "string" ? resolvedLoginUser.role : "admin",
          stored_role: typeof resolvedLoginUser.role === "string" ? resolvedLoginUser.role : "admin",
          is_owner_admin: OWNER_ADMIN_EMAILS.has(String(resolvedLoginUser.email ?? "").trim().toLowerCase()),
          game_name: resolvedLoginUser.gameName,
          tagline: resolvedLoginUser.tagline,
          riot_id: `${resolvedLoginUser.gameName}#${resolvedLoginUser.tagline}`,
          riot_id_correction_count: 0,
          can_update_riot_id: true,
          primary_role: resolvedLoginUser.primaryRole,
          secondary_roles: Array.isArray(resolvedLoginUser.secondaryRoles)
            ? [...resolvedLoginUser.secondaryRoles]
            : []
        },
        {
          id: 22,
          email: "member@example.com",
          role: "member",
          stored_role: "member",
          is_owner_admin: false,
          game_name: "Member",
          tagline: "NA1",
          riot_id: "Member#NA1",
          riot_id_correction_count: 0,
          can_update_riot_id: true,
          primary_role: "Support",
          secondary_roles: []
        }
      ];

  function parseRiotId(rawValue) {
    const normalizedValue = typeof rawValue === "string" ? rawValue.trim() : "";
    const segments = normalizedValue.split("#");
    if (segments.length !== 2) {
      return null;
    }
    const gameName = segments[0].trim();
    const tagline = segments[1].trim();
    if (!gameName || !tagline) {
      return null;
    }
    return `${gameName.toLowerCase()}#${tagline.toLowerCase()}`;
  }

  function scopedChampionKey(scope, ownerId, championId) {
    return `${scope}:${ownerId}:${championId}`;
  }

  function normalizeHarnessMetadata(metadata) {
    const source = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
    return {
      ...source,
      roles: Array.isArray(source.roles) ? [...source.roles] : [],
      roleProfiles: Object.fromEntries(
        Object.entries(source.roleProfiles ?? {}).map(([role, profile]) => [
          role,
          {
            primaryDamageType: profile?.primaryDamageType ?? profile?.primary_damage_type ?? "mixed",
            powerSpikes: Array.isArray(profile?.powerSpikes) ? profile.powerSpikes : []
          }
        ])
      )
    };
  }

  function resolveMemberRiotId(member) {
    const gameName = typeof member?.game_name === "string" ? member.game_name.trim() : "";
    const tagline = typeof member?.tagline === "string" ? member.tagline.trim() : "";
    if (gameName && tagline) {
      return `${gameName}#${tagline}`;
    }
    return typeof member?.display_name === "string" ? member.display_name.trim() : "";
  }

  function findUserIdByRiotId(rawRiotId) {
    const candidateKey = parseRiotId(rawRiotId);
    if (!candidateKey) {
      return null;
    }

    for (const roster of Object.values(membersByTeam)) {
      for (const member of roster ?? []) {
        const memberKey = parseRiotId(resolveMemberRiotId(member));
        if (memberKey && memberKey === candidateKey) {
          const memberUserId = Number(member.user_id);
          if (Number.isInteger(memberUserId) && memberUserId > 0) {
            return memberUserId;
          }
        }
      }
    }

    const profileRiotId = `${resolvedProfile.gameName ?? ""}#${resolvedProfile.tagline ?? ""}`;
    if (parseRiotId(profileRiotId) === candidateKey) {
      return Number(resolvedProfile.id);
    }

    const loginRiotId = `${resolvedLoginUser.gameName ?? ""}#${resolvedLoginUser.tagline ?? ""}`;
    if (parseRiotId(loginRiotId) === candidateKey) {
      return Number(resolvedLoginUser.id);
    }

    return null;
  }

  function getCurrentUserId() {
    const userId = Number.parseInt(String(resolvedLoginUser?.id ?? resolvedProfile?.id ?? 0), 10);
    return Number.isInteger(userId) && userId > 0 ? userId : 0;
  }

  function buildRequesterIdentity(userId) {
    if (Number(userId) === Number(resolvedProfile.id)) {
      return {
        user_id: userId,
        lane: resolvedProfile.primaryRole ?? null,
        display_name: `${resolvedProfile.gameName}#${resolvedProfile.tagline}`,
        game_name: resolvedProfile.gameName,
        tagline: resolvedProfile.tagline,
        email: resolvedProfile.email ?? null
      };
    }

    for (const roster of Object.values(membersByTeam)) {
      for (const member of roster ?? []) {
        if (Number(member?.user_id) === Number(userId)) {
          const lane = member?.lane ?? member?.primary_role ?? null;
          return {
            user_id: Number(userId),
            lane,
            display_name: resolveMemberRiotId(member) || `User ${userId}`,
            game_name: typeof member?.game_name === "string" ? member.game_name : "",
            tagline: typeof member?.tagline === "string" ? member.tagline : "",
            email: typeof member?.email === "string" ? member.email : null
          };
        }
      }
    }

    return {
      user_id: Number(userId),
      lane: null,
      display_name: `User ${userId}`,
      game_name: "",
      tagline: "",
      email: null
    };
  }

  function getPendingRequestForUser(teamId, userId) {
    const requests = joinRequestsByTeam[String(teamId)] ?? [];
    return requests.find(
      (request) => Number(request?.requester_user_id) === Number(userId) && String(request?.status) === "pending"
    ) ?? null;
  }

  function buildDiscoverTeamsResponse() {
    const currentUserId = getCurrentUserId();
    return teams
      .map((team) => {
        const teamId = String(team.id);
        const members = membersByTeam[teamId] ?? [];
        const membership = members.find((member) => Number(member?.user_id) === currentUserId) ?? null;
        const pending = getPendingRequestForUser(team.id, currentUserId);
        return {
          ...team,
          membership_role: membership?.role ?? null,
          membership_team_role: membership?.team_role ?? null,
          pending_join_request_id: pending?.id ?? null,
          pending_join_request_status: pending?.status ?? null
        };
      })
      .sort((left, right) => String(left.name ?? "").localeCompare(String(right.name ?? "")));
  }

  function toTeamLogoDataUrl(value) {
    if (!value) {
      return null;
    }
    if (typeof value === "string") {
      return value;
    }
    const type = typeof value.type === "string" && value.type ? value.type : "image/png";
    return `data:${type};base64,bW9ja19sb2dv`;
  }

  const ensurePoolFamiliarity = (pool) => {
    if (!pool || typeof pool !== "object") {
      return {};
    }
    if (!pool.champion_familiarity || typeof pool.champion_familiarity !== "object") {
      pool.champion_familiarity = {};
    }
    for (const championId of pool.champion_ids ?? []) {
      const key = String(championId);
      const existing = Number.parseInt(String(pool.champion_familiarity[key]), 10);
      pool.champion_familiarity[key] = Number.isInteger(existing) && existing >= 1 && existing <= 4 ? existing : 3;
    }
    return pool.champion_familiarity;
  };

  const impl = async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const parsedUrl = new URL(url, "http://api.test");
    const path = parsedUrl.pathname;
    const query = parsedUrl.searchParams;
    const headers = init.headers ?? {};
    const authHeader = headers.Authorization ?? headers.authorization ?? null;
    let body = undefined;
    let isFormData = false;
    if (typeof init.body === "string") {
      body = JSON.parse(init.body);
    } else if (init.body && typeof init.body.entries === "function") {
      isFormData = true;
      body = {};
      for (const [key, value] of init.body.entries()) {
        body[key] = value;
      }
    }

    calls.push({ path, method, headers, body, isFormData, query: parsedUrl.searchParams });

    if (path === "/champions" && method === "GET") {
      const toChampionId = (value) => (championIdsAsStrings ? String(value) : value);
      const activeTeamId = Number.isInteger(Number(persistedTeamContext.activeTeamId))
        ? Number(persistedTeamContext.activeTeamId)
        : null;
      const includeMetadataScopes = typeof headers.Authorization === "string" && headers.Authorization.startsWith("Bearer ");
      const buildMetadataScopes = (championId) => ({
        self: userChampionMetadataByScope.has(scopedChampionKey("self", resolvedLoginUser.id, championId)),
        team: Number.isInteger(activeTeamId)
          ? teamChampionMetadataByScope.has(scopedChampionKey("team", activeTeamId, championId))
          : false,
        all: true
      });
      return createJsonResponse({
        champions: [
          {
            id: toChampionId(1),
            name: "Ahri",
            role: "Mid",
            tagIds: [...(globalChampionTagIds.get(1) ?? [])],
            reviewed: championReviewedById.get(1) === true,
            metadata: championMetadataById.get(1),
            ...(includeMetadataScopes ? { metadata_scopes: buildMetadataScopes(1) } : {})
          },
          {
            id: toChampionId(2),
            name: "Ashe",
            role: "ADC",
            tagIds: [...(globalChampionTagIds.get(2) ?? [])],
            reviewed: championReviewedById.get(2) === true,
            metadata: championMetadataById.get(2),
            ...(includeMetadataScopes ? { metadata_scopes: buildMetadataScopes(2) } : {})
          },
          {
            id: toChampionId(3),
            name: "Braum",
            role: "Support",
            tagIds: [...(globalChampionTagIds.get(3) ?? [])],
            reviewed: championReviewedById.get(3) === true,
            metadata: championMetadataById.get(3),
            ...(includeMetadataScopes ? { metadata_scopes: buildMetadataScopes(3) } : {})
          }
        ]
      });
    }

    if (path === "/tags" && method === "GET") {
      const scope = parsedUrl.searchParams.get("scope") ?? "all";
      const teamId = resolveCatalogTeamId(parsedUrl.searchParams.get("team_id"));
      const includeFallback = parsedUrl.searchParams.get("include_fallback") !== "false";
      return createJsonResponse({
        tags: listVisibleTags(scope, teamId, includeFallback)
      });
    }

    if (path === "/tags" && method === "POST") {
      const scope = normalizeTagScope(body?.scope);
      const teamId = resolveCatalogTeamId(body?.team_id);
      const owner = normalizeTagOwner(scope, teamId);
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const definition = typeof body?.definition === "string" ? body.definition.trim() : "";
      if (!name || !definition) {
        return createJsonResponse({ error: { code: "BAD_REQUEST", message: "Expected name/definition." } }, 400);
      }
      const duplicate = listVisibleTags(scope, teamId, false)
        .some((tag) => tag.name.toLowerCase() === name.toLowerCase());
      if (duplicate) {
        return createJsonResponse({ error: { code: "CONFLICT", message: "Tag name already exists." } }, 409);
      }
      let canonical = getCanonicalTagByName(name);
      if (!canonical) {
        canonical = { id: nextTagId, name, definition: scope === "all" ? definition : "" };
        nextTagId += 1;
        tags.push(canonical);
      } else if (scope === "all") {
        canonical.definition = definition;
      }
      tagDefinitions.push({
        tag_id: canonical.id,
        scope: owner.scope,
        user_id: owner.userId,
        team_id: owner.teamId,
        definition
      });
      const created = buildResolvedTagRecord(canonical.id, getExactTagDefinition(canonical.id, owner));
      return createJsonResponse({ tag: created }, 201);
    }

    const tagMutationMatch = path.match(/^\/tags\/(\d+)$/);
    if (tagMutationMatch && method === "PUT") {
      const tagId = Number(tagMutationMatch[1]);
      const scope = normalizeTagScope(body?.scope);
      const teamId = resolveCatalogTeamId(body?.team_id);
      const owner = normalizeTagOwner(scope, teamId);
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const definition = typeof body?.definition === "string" ? body.definition.trim() : "";
      const existingCanonical = tags.find((tag) => tag.id === tagId) ?? null;
      const existingDefinition = getExactTagDefinition(tagId, owner);
      if (!existingCanonical || !existingDefinition) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Tag not found." } }, 404);
      }
      const duplicate = listVisibleTags(scope, teamId, false)
        .some((tag) => tag.id !== tagId && tag.name.toLowerCase() === name.toLowerCase());
      if (duplicate) {
        return createJsonResponse({ error: { code: "CONFLICT", message: "Tag name already exists." } }, 409);
      }
      let resolvedTagId = tagId;
      if (scope === "all") {
        existingCanonical.name = name;
        existingCanonical.definition = definition;
      } else if (existingCanonical.name.toLowerCase() !== name.toLowerCase()) {
        let targetCanonical = getCanonicalTagByName(name);
        if (!targetCanonical) {
          targetCanonical = { id: nextTagId, name, definition: "" };
          nextTagId += 1;
          tags.push(targetCanonical);
        }
        moveScopedHarnessAssignments(scope, scope === "self" ? owner.userId : owner.teamId, tagId, targetCanonical.id);
        existingDefinition.tag_id = targetCanonical.id;
        resolvedTagId = targetCanonical.id;
      }
      existingDefinition.definition = definition;
      return createJsonResponse({ tag: buildResolvedTagRecord(resolvedTagId, getExactTagDefinition(resolvedTagId, owner)) });
    }

    if (tagMutationMatch && method === "DELETE") {
      const tagId = Number(tagMutationMatch[1]);
      const scope = normalizeTagScope(parsedUrl.searchParams.get("scope"));
      const teamId = resolveCatalogTeamId(parsedUrl.searchParams.get("team_id"));
      const owner = normalizeTagOwner(scope, teamId);
      const hasAssignments = scope === "all"
        ? [...globalChampionTagIds.values()].some((assignedTagIds) => assignedTagIds.has(tagId))
        : [...(scope === "self" ? userChampionTagIds : teamChampionTagIds).entries()]
            .some(([key, assignedTagIds]) => {
              const prefix = `${scope}:${scope === "self" ? owner.userId : owner.teamId}:`;
              return String(key).startsWith(prefix) && assignedTagIds.has(tagId);
            });
      if (hasAssignments) {
        return createJsonResponse(
          { error: { code: "CONFLICT", message: "Cannot delete a tag that is assigned to champions." } },
          409
        );
      }
      const index = tagDefinitions.findIndex(
        (definition) => Number(definition.tag_id) === tagId && matchesTagOwner(definition, owner)
      );
      if (index < 0) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Tag not found." } }, 404);
      }
      tagDefinitions.splice(index, 1);
      return createJsonResponse({}, 204);
    }

    const championTagsMatch = path.match(/^\/champions\/(\d+)\/tags$/);
    if (championTagsMatch && method === "GET") {
      const championId = Number(championTagsMatch[1]);
      const scope = parsedUrl.searchParams.get("scope") ?? "all";
      const teamId = parsedUrl.searchParams.get("team_id");
      const resolvedTeamId = teamId ? Number(teamId) : null;
      const resolvedTagIds = scope === "self"
        ? [...(userChampionTagIds.get(scopedChampionKey("self", resolvedLoginUser.id, championId)) ?? new Set())]
        : scope === "team"
          ? [...(teamChampionTagIds.get(scopedChampionKey("team", resolvedTeamId, championId)) ?? new Set())]
          : [...(globalChampionTagIds.get(championId) ?? [])];
      return createJsonResponse({
        scope,
        team_id: resolvedTeamId,
        tag_ids: resolvedTagIds.sort((left, right) => left - right),
        reviewed: championReviewedById.get(championId) === true
      });
    }

    if (championTagsMatch && method === "PUT") {
      const championId = Number(championTagsMatch[1]);
      const scope = typeof body?.scope === "string" ? body.scope : "all";
      const teamId = Number.isInteger(Number(body?.team_id)) ? Number(body.team_id) : null;
      const nextTagIds = Array.isArray(body?.tag_ids)
        ? [...new Set(body.tag_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
            .sort((left, right) => left - right)
        : [];
      if (typeof body?.reviewed === "boolean") {
        championReviewedById.set(championId, body.reviewed);
      }
      if (scope === "self") {
        userChampionTagIds.set(scopedChampionKey("self", resolvedLoginUser.id, championId), new Set(nextTagIds));
      } else if (scope === "team") {
        teamChampionTagIds.set(scopedChampionKey("team", teamId, championId), new Set(nextTagIds));
      } else {
        globalChampionTagIds.set(championId, new Set(nextTagIds));
      }
      return createJsonResponse({
        scope,
        team_id: scope === "team" ? teamId : null,
        tag_ids: nextTagIds,
        reviewed: championReviewedById.get(championId) === true
      });
    }

    const championMetadataMatch = path.match(/^\/champions\/(\d+)\/metadata$/);
    if (championMetadataMatch && method === "GET") {
      const championId = Number(championMetadataMatch[1]);
      const scope = parsedUrl.searchParams.get("scope") ?? "all";
      const teamId = parsedUrl.searchParams.get("team_id");
      const resolvedTeamId = teamId ? Number(teamId) : null;
      const scopedMetadata = scope === "self"
        ? userChampionMetadataByScope.get(scopedChampionKey("self", resolvedLoginUser.id, championId))
        : scope === "team"
          ? teamChampionMetadataByScope.get(scopedChampionKey("team", resolvedTeamId, championId))
          : championMetadataById.get(championId);
      return createJsonResponse({
        scope,
        team_id: scope === "team" ? resolvedTeamId : null,
        metadata: normalizeHarnessMetadata(scopedMetadata ?? championMetadataById.get(championId)),
        has_custom_metadata: scope === "all" ? true : Boolean(scopedMetadata),
        resolved_scope: scope === "all" || scopedMetadata ? scope : "all",
        reviewed: championReviewedById.get(championId) === true
      });
    }

    if (championMetadataMatch && method === "PUT") {
      const championId = Number(championMetadataMatch[1]);
      const scope = typeof body?.scope === "string" ? body.scope : "all";
      const teamId = Number.isInteger(Number(body?.team_id)) ? Number(body.team_id) : null;
      const existing = championMetadataById.get(championId) ?? {
        roles: ["Mid"],
        roleProfiles: {
          Mid: createRoleProfile("ap", "neutral", "strong", "neutral")
        },
        damageType: "AP",
        scaling: "Mid",
        tags: tagsFalse()
      };
      const nextRoles = Array.isArray(body?.roles) ? [...body.roles] : [...existing.roles];
      const nextRoleProfiles =
        body?.role_profiles && typeof body.role_profiles === "object" && !Array.isArray(body.role_profiles)
          ? body.role_profiles
          : { ...(existing.roleProfiles ?? {}) };
      const firstRole = nextRoles[0];
      const firstRoleProfile = firstRole && nextRoleProfiles[firstRole] ? nextRoleProfiles[firstRole] : null;
      const nextDamageType = String(firstRoleProfile?.primary_damage_type ?? "").toLowerCase() === "ad"
        ? "AD"
        : String(firstRoleProfile?.primary_damage_type ?? "").toLowerCase() === "ap"
          ? "AP"
          : String(firstRoleProfile?.primary_damage_type ?? "").toLowerCase() === "utility"
            ? "Utility"
            : "Mixed";
      const nextMetadata = {
        ...existing,
        roles: nextRoles,
        roleProfiles: Object.fromEntries(
          Object.entries(nextRoleProfiles).map(([role, profile]) => [
            role,
            {
              primaryDamageType: profile?.primaryDamageType ?? profile?.primary_damage_type ?? "mixed",
              powerSpikes: Array.isArray(profile?.powerSpikes) ? profile.powerSpikes : []
            }
          ])
        ),
        damageType: nextDamageType
      };
      if (scope === "self") {
        userChampionMetadataByScope.set(scopedChampionKey("self", resolvedLoginUser.id, championId), nextMetadata);
      } else if (scope === "team") {
        teamChampionMetadataByScope.set(scopedChampionKey("team", teamId, championId), nextMetadata);
      } else {
        championMetadataById.set(championId, nextMetadata);
      }
      return createJsonResponse({
        champion: {
          id: championId,
          metadata: championMetadataById.get(championId),
          tag_ids: [...(globalChampionTagIds.get(championId) ?? [])].sort((left, right) => left - right)
        },
        scope,
        team_id: scope === "team" ? teamId : null,
        metadata: nextMetadata,
        has_custom_metadata: true,
        resolved_scope: scope
      });
    }

    if (path === "/composer/context" && method === "POST") {
      const requestedTeamId = resolveCatalogTeamId(body?.team_id) ?? resolveCatalogTeamId(persistedTeamContext.activeTeamId);
      const useCustomScopes = body?.use_custom_scopes !== false;
      const resources = body?.resources && typeof body.resources === "object" ? body.resources : {};
      const defaultPrecedence = typeof body?.default_precedence === "string" ? body.default_precedence : "user_team_global";

      const globalChampions = [
        { id: 1, name: "Ahri", role: "Mid", metadata: normalizeHarnessMetadata(championMetadataById.get(1)), tag_ids: [...(globalChampionTagIds.get(1) ?? [])], reviewed: championReviewedById.get(1) === true },
        { id: 2, name: "Ashe", role: "ADC", metadata: normalizeHarnessMetadata(championMetadataById.get(2)), tag_ids: [...(globalChampionTagIds.get(2) ?? [])], reviewed: championReviewedById.get(2) === true },
        { id: 3, name: "Braum", role: "Support", metadata: normalizeHarnessMetadata(championMetadataById.get(3)), tag_ids: [...(globalChampionTagIds.get(3) ?? [])], reviewed: championReviewedById.get(3) === true }
      ];

      const buildOverrideOrder = (resource) => {
        const config = resources?.[resource] ?? {};
        if (!useCustomScopes || config.enabled === false) {
          return [];
        }
        return getComposerOverrideOrder(typeof config.precedence === "string" ? config.precedence : defaultPrecedence);
      };

      const metadataOverrides = buildOverrideOrder("champion_metadata");
      const tagOverrides = buildOverrideOrder("champion_tags");
      const requirementOverrides = buildOverrideOrder("requirements");
      const compositionOverrides = buildOverrideOrder("compositions");
      const tagDefinitionOverrides = buildOverrideOrder("tag_definitions");

      const scopedMetadataByScope = {
        self: userChampionMetadataByScope,
        team: teamChampionMetadataByScope
      };
      const scopedTagsByScope = {
        self: userChampionTagIds,
        team: teamChampionTagIds
      };

      const champions = globalChampions.map((champion) => {
        let metadata = champion.metadata;
        for (const scope of metadataOverrides) {
          const ownerId = scope === "self" ? resolvedLoginUser.id : requestedTeamId;
          if (!Number.isInteger(Number(ownerId))) {
            continue;
          }
          const scopedMetadata = scopedMetadataByScope[scope].get(scopedChampionKey(scope, ownerId, champion.id));
          if (scopedMetadata) {
            metadata = normalizeHarnessMetadata(scopedMetadata);
          }
        }

        let tagIds = [...champion.tag_ids];
        for (const scope of tagOverrides) {
          const ownerId = scope === "self" ? resolvedLoginUser.id : requestedTeamId;
          if (!Number.isInteger(Number(ownerId))) {
            continue;
          }
          const scopedTagSet = scopedTagsByScope[scope].get(scopedChampionKey(scope, ownerId, champion.id));
          if (scopedTagSet) {
            tagIds = [...scopedTagSet].sort((left, right) => left - right);
          }
        }

        return {
          ...champion,
          metadata,
          tag_ids: tagIds
        };
      });

      const mergeNamedEntities = (globalItems, overrides, sourceType) => {
        const merged = new Map(globalItems.map((item) => [item.name.toLowerCase(), item]));
        for (const scope of overrides) {
          const sourceItems = sourceType === "requirements"
            ? requirementDefinitions.filter((item) =>
                item.scope === scope &&
                (scope === "self"
                  ? Number(item.user_id) === Number(resolvedLoginUser.id)
                  : Number(item.team_id) === Number(requestedTeamId))
              )
            : compositions.filter((item) =>
                item.scope === scope &&
                (scope === "self"
                  ? Number(item.user_id) === Number(resolvedLoginUser.id)
                  : Number(item.team_id) === Number(requestedTeamId))
              );
          for (const item of sourceItems) {
            merged.set(item.name.toLowerCase(), { ...item });
          }
        }
        return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
      };

      const visibleTagsMap = new Map(listVisibleTags("all", null, true).map((tag) => [tag.id, tag]));
      for (const scope of tagDefinitionOverrides) {
        const teamId = scope === "team" ? requestedTeamId : null;
        for (const tag of listVisibleTags(scope, teamId, false)) {
          visibleTagsMap.set(tag.id, tag);
        }
      }
      const visibleTags = [...visibleTagsMap.values()].sort((left, right) => left.name.localeCompare(right.name));

      const visibleRequirements = mergeNamedEntities(
        requirementDefinitions.filter((item) => item.scope === "all"),
        requirementOverrides,
        "requirements"
      );
      const visibleCompositions = mergeNamedEntities(
        compositions.filter((item) => item.scope === "all"),
        compositionOverrides,
        "compositions"
      );
      const activeComposition = visibleCompositions.find((composition) => composition.is_active) ?? null;

      return createJsonResponse({
        team_id: requestedTeamId,
        default_precedence: defaultPrecedence,
        resources,
        champions,
        tags: visibleTags,
        requirements: visibleRequirements,
        compositions: visibleCompositions,
        active_composition_id: activeComposition?.id ?? null
      });
    }

    if (path === "/me/draft-setups" && method === "GET") {
      return createJsonResponse({
        draft_setups: [...draftSetups].sort((left, right) => left.name.localeCompare(right.name))
      });
    }

    if (path === "/me/draft-setups" && method === "POST") {
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const description = typeof body?.description === "string" ? body.description.trim() : "";
      if (!name) {
        return createJsonResponse({ error: { code: "BAD_REQUEST", message: "Name is required." } }, 400);
      }
      const record = {
        id: nextDraftSetupId,
        user_id: Number(resolvedLoginUser.id),
        name,
        description,
        state_json: body?.state_json ?? {},
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z"
      };
      nextDraftSetupId += 1;
      draftSetups.push(record);
      return createJsonResponse({ draft_setup: record }, 201);
    }

    const draftSetupMatch = path.match(/^\/me\/draft-setups\/(\d+)$/);
    if (draftSetupMatch && method === "PUT") {
      const setupId = Number(draftSetupMatch[1]);
      const setup = draftSetups.find((candidate) => candidate.id === setupId) ?? null;
      if (!setup) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Draft Setup not found." } }, 404);
      }
      setup.name = typeof body?.name === "string" ? body.name.trim() : setup.name;
      setup.description = typeof body?.description === "string" ? body.description.trim() : (setup.description ?? "");
      setup.state_json = body?.state_json ?? setup.state_json;
      setup.updated_at = "2026-01-01T00:00:00.000Z";
      return createJsonResponse({ draft_setup: setup });
    }

    if (draftSetupMatch && method === "DELETE") {
      const setupId = Number(draftSetupMatch[1]);
      draftSetups = draftSetups.filter((candidate) => candidate.id !== setupId);
      return createJsonResponse({}, 204);
    }

    const tagPromotionCreateMatch = path.match(/^\/tags\/(\d+)\/promotion-requests$/);
    if (tagPromotionCreateMatch && method === "POST") {
      const tagId = Number(tagPromotionCreateMatch[1]);
      const sourceScope = normalizeTagScope(body?.source_scope);
      const targetScope = normalizeTagScope(body?.target_scope === "all" ? "all" : body?.target_scope);
      const sourceTeamId = resolveCatalogTeamId(body?.team_id);
      const targetTeamId = resolveCatalogTeamId(body?.target_team_id ?? body?.team_id);
      const owner = normalizeTagOwner(sourceScope, sourceTeamId);
      const sourceTag = buildResolvedTagRecord(tagId, getExactTagDefinition(tagId, owner));
      if (!sourceTag) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Scoped tag definition not found." } }, 404);
      }
      const requestRecord = {
        id: nextPromotionRequestId,
        entity_type: "tag_definitions",
        resource_id: tagId,
        source_scope: sourceScope,
        source_user_id: sourceScope === "self" ? Number(resolvedLoginUser.id) : null,
        source_team_id: sourceScope === "team" ? sourceTeamId : null,
        target_scope: targetScope === "all" ? "all" : "team",
        target_team_id: targetScope === "team" ? targetTeamId : null,
        requested_by: Number(resolvedLoginUser.id),
        status: "pending",
        request_comment: typeof body?.request_comment === "string" ? body.request_comment.trim() : "",
        review_comment: "",
        reviewed_by_user_id: null,
        reviewed_at: null,
        payload_json: {
          tag_id: tagId,
          tag_name: sourceTag.name,
          definition: sourceTag.definition
        },
        created_at: "2026-01-01T00:00:00.000Z"
      };
      nextPromotionRequestId += 1;
      promotionRequests.push(requestRecord);
      return createJsonResponse({ promotion_request: requestRecord }, 201);
    }

    if (path === "/tags/promotion-requests" && method === "GET") {
      const mode = parsedUrl.searchParams.get("mode") ?? "requested";
      const scope = normalizeTagScope(parsedUrl.searchParams.get("scope"));
      const teamId = resolveCatalogTeamId(parsedUrl.searchParams.get("team_id"));
      const results = promotionRequests.filter((requestRecord) => {
        if (mode === "review") {
          if (scope === "team") {
            return requestRecord.target_scope === "team" && Number(requestRecord.target_team_id) === Number(teamId);
          }
          return requestRecord.target_scope === "all";
        }
        return Number(requestRecord.requested_by) === Number(resolvedLoginUser.id);
      });
      return createJsonResponse({ promotion_requests: results });
    }

    const tagPromotionCancelMatch = path.match(/^\/tags\/promotion-requests\/(\d+)$/);
    if (tagPromotionCancelMatch && method === "DELETE") {
      const requestId = Number(tagPromotionCancelMatch[1]);
      const index = promotionRequests.findIndex(
        (candidate) => candidate.id === requestId && candidate.requested_by === Number(resolvedLoginUser.id) && candidate.status === "pending"
      );
      if (index < 0) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Promotion request not found." } }, 404);
      }
      const [requestRecord] = promotionRequests.splice(index, 1);
      return createJsonResponse({ promotion_request: requestRecord });
    }

    const tagPromotionReviewMatch = path.match(/^\/tags\/promotion-requests\/(\d+)\/review$/);
    if (tagPromotionReviewMatch && method === "POST") {
      const requestId = Number(tagPromotionReviewMatch[1]);
      const requestRecord = promotionRequests.find((candidate) => candidate.id === requestId) ?? null;
      if (!requestRecord) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Promotion request not found." } }, 404);
      }
      requestRecord.status = body?.decision === "rejected" ? "rejected" : "approved";
      requestRecord.review_comment = typeof body?.review_comment === "string" ? body.review_comment.trim() : "";
      requestRecord.reviewed_by_user_id = Number(resolvedLoginUser.id);
      requestRecord.reviewed_at = "2026-01-01T00:00:00.000Z";
      if (requestRecord.status === "approved") {
        const payload = requestRecord.payload_json ?? {};
        const targetOwner = normalizeTagOwner(requestRecord.target_scope, requestRecord.target_team_id);
        let canonical = getCanonicalTagByName(payload.tag_name);
        if (!canonical) {
          canonical = { id: nextTagId, name: payload.tag_name, definition: requestRecord.target_scope === "all" ? payload.definition : "" };
          nextTagId += 1;
          tags.push(canonical);
        }
        const exactDefinition = getExactTagDefinition(canonical.id, targetOwner);
        if (exactDefinition) {
          exactDefinition.definition = payload.definition;
        } else {
          tagDefinitions.push({
            tag_id: canonical.id,
            scope: targetOwner.scope,
            user_id: targetOwner.userId,
            team_id: targetOwner.teamId,
            definition: payload.definition
          });
        }
      }
      return createJsonResponse({ promotion_request: requestRecord });
    }

    if (path === "/auth/login" && method === "POST") {
      return createJsonResponse({
        token: "token-123",
        user: {
          ...resolvedLoginUser,
          email: body.email
        }
      });
    }

    if (path === "/auth/register" && method === "POST") {
      if (!body.gameName || !body.tagline) {
        return createJsonResponse(
          {
            error: {
              code: "BAD_REQUEST",
              message: "Expected 'gameName' and 'tagline'."
            }
          },
          400
        );
      }
      return createJsonResponse({
        token: "token-register",
        user: {
          id: 12,
          email: body.email,
          gameName: body.gameName,
          tagline: body.tagline,
          displayTeamId: null,
          avatarChampionId: null,
          primaryRole: "Mid",
          secondaryRoles: []
        }
      }, 201);
    }

    if (path === "/issue-reporting" && method === "GET") {
      return createJsonResponse({
        issueReporting: {
          enabled: issueReportingState.enabled,
          repository: issueReportingState.repository,
          fallback_url: issueReportingState.fallbackUrl
        }
      });
    }

    if (path === "/issue-reporting/issues" && method === "POST") {
      if (!issueReportingState.enabled) {
        return createJsonResponse(
          {
            error: {
              code: "ISSUE_REPORTING_DISABLED",
              message: "In-app issue reporting is not configured.",
              details: {
                fallback_url: issueReportingState.fallbackUrl
              }
            }
          },
          503
        );
      }
      return createJsonResponse(
        {
          issue: {
            number: 17,
            url: "https://github.com/jmirving/DraftEngine/issues/17",
            title: typeof body?.title === "string" ? body.title : "Submitted issue"
          }
        },
        201
      );
    }

    if (path === "/me/profile" && method === "GET") {
      return createJsonResponse({
        profile: resolvedProfile
      });
    }

    if (path === "/me/profile" && method === "PUT") {
      resolvedProfile = {
        ...resolvedProfile,
        primaryRole: body.primaryRole,
        secondaryRoles: Array.isArray(body.secondaryRoles) ? [...body.secondaryRoles] : []
      };
      resolvedLoginUser = {
        ...resolvedLoginUser,
        primaryRole: resolvedProfile.primaryRole,
        secondaryRoles: [...resolvedProfile.secondaryRoles]
      };
      return createJsonResponse({
        profile: {
          id: resolvedProfile.id,
          email: resolvedProfile.email,
          gameName: resolvedProfile.gameName,
          tagline: resolvedProfile.tagline,
          displayTeamId: resolvedProfile.displayTeamId ?? null,
          avatarChampionId: resolvedProfile.avatarChampionId ?? null,
          primaryRole: resolvedProfile.primaryRole,
          secondaryRoles: [...resolvedProfile.secondaryRoles]
        }
      });
    }

    if (path === "/me/profile/display-team" && method === "PUT") {
      resolvedProfile = {
        ...resolvedProfile,
        displayTeamId: body.displayTeamId ?? null
      };
      resolvedLoginUser = {
        ...resolvedLoginUser,
        displayTeamId: resolvedProfile.displayTeamId
      };
      return createJsonResponse({
        profile: {
          id: resolvedProfile.id,
          email: resolvedProfile.email,
          gameName: resolvedProfile.gameName,
          tagline: resolvedProfile.tagline,
          displayTeamId: resolvedProfile.displayTeamId,
          avatarChampionId: resolvedProfile.avatarChampionId ?? null,
          primaryRole: resolvedProfile.primaryRole,
          secondaryRoles: [...resolvedProfile.secondaryRoles]
        }
      });
    }

    if (path === "/me/profile/avatar" && method === "PUT") {
      resolvedProfile = {
        ...resolvedProfile,
        avatarChampionId: body.avatarChampionId ?? null
      };
      resolvedLoginUser = {
        ...resolvedLoginUser,
        avatarChampionId: resolvedProfile.avatarChampionId
      };
      return createJsonResponse({
        profile: {
          id: resolvedProfile.id,
          email: resolvedProfile.email,
          gameName: resolvedProfile.gameName,
          tagline: resolvedProfile.tagline,
          displayTeamId: resolvedProfile.displayTeamId ?? null,
          avatarChampionId: resolvedProfile.avatarChampionId,
          primaryRole: resolvedProfile.primaryRole,
          secondaryRoles: [...resolvedProfile.secondaryRoles]
        }
      });
    }

    if (path === "/me/team-context" && method === "GET") {
      return createJsonResponse({
        teamContext: persistedTeamContext
      });
    }

    if (path === "/me/team-context" && method === "PUT") {
      persistedTeamContext = {
        activeTeamId: body.activeTeamId ?? null
      };
      return createJsonResponse({
        teamContext: persistedTeamContext
      });
    }

    if (path === "/admin/users" && method === "GET") {
      const isAdmin = String(resolvedLoginUser.role ?? "").trim().toLowerCase() === "admin";
      if (!isAdmin) {
        return createJsonResponse({ error: { code: "FORBIDDEN", message: "Only admins can view users." } }, 403);
      }
      return createJsonResponse({ users: [...adminUsers] });
    }

    if (path === "/admin/authorization" && method === "GET") {
      const isAdmin = String(resolvedLoginUser.role ?? "").trim().toLowerCase() === "admin";
      if (!isAdmin) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "Only admins can view authorization configuration." } },
          403
        );
      }
      return createJsonResponse({
        authorization: getAuthorizationMatrix()
      });
    }

    const adminUserRoleMatch = path.match(/^\/admin\/users\/(\d+)\/role$/);
    if (adminUserRoleMatch && method === "PUT") {
      const isAdmin = String(resolvedLoginUser.role ?? "").trim().toLowerCase() === "admin";
      if (!isAdmin) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "Only admins can update user permissions." } },
          403
        );
      }
      const targetUserId = Number(adminUserRoleMatch[1]);
      const user = adminUsers.find((candidate) => candidate.id === targetUserId) ?? null;
      if (!user) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "User not found." } }, 404);
      }
      user.role = typeof body?.role === "string" ? body.role : user.role;
      user.stored_role = typeof body?.role === "string" ? body.role : (user.stored_role ?? user.role);
      return createJsonResponse({ user });
    }

    const adminUserRiotIdMatch = path.match(/^\/admin\/users\/(\d+)\/riot-id$/);
    if (adminUserRiotIdMatch && method === "PUT") {
      const isAdmin = String(resolvedLoginUser.role ?? "").trim().toLowerCase() === "admin";
      if (!isAdmin) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "Only admins can update user Riot ID." } },
          403
        );
      }
      const targetUserId = Number(adminUserRiotIdMatch[1]);
      const user = adminUsers.find((candidate) => candidate.id === targetUserId) ?? null;
      if (!user) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "User not found." } }, 404);
      }
      const correctionCount = Number.parseInt(String(user.riot_id_correction_count ?? 0), 10);
      if (Number.isInteger(correctionCount) && correctionCount >= 1) {
        return createJsonResponse(
          { error: { code: "BAD_REQUEST", message: "This user's one-time Riot ID correction has already been used." } },
          400
        );
      }
      const nextGameName = typeof body?.gameName === "string" ? body.gameName.trim() : "";
      const nextTagline = typeof body?.tagline === "string" ? body.tagline.trim() : "";
      if (!nextGameName || !nextTagline) {
        return createJsonResponse(
          { error: { code: "BAD_REQUEST", message: "Expected 'gameName' and 'tagline'." } },
          400
        );
      }
      user.game_name = nextGameName;
      user.tagline = nextTagline;
      user.riot_id = `${nextGameName}#${nextTagline}`;
      user.riot_id_correction_count = (Number.isInteger(correctionCount) ? correctionCount : 0) + 1;
      user.can_update_riot_id = false;
      return createJsonResponse({ user });
    }

    const adminUserDeleteMatch = path.match(/^\/admin\/users\/(\d+)$/);
    if (adminUserDeleteMatch && method === "DELETE") {
      const isAdmin = String(resolvedLoginUser.role ?? "").trim().toLowerCase() === "admin";
      if (!isAdmin) {
        return createJsonResponse({ error: { code: "FORBIDDEN", message: "Only admins can delete users." } }, 403);
      }
      const targetUserId = Number(adminUserDeleteMatch[1]);
      const userIndex = adminUsers.findIndex((candidate) => candidate.id === targetUserId);
      if (userIndex < 0) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "User not found." } }, 404);
      }
      const targetUser = adminUsers[userIndex];
      if (OWNER_ADMIN_EMAILS.has(String(targetUser.email ?? "").trim().toLowerCase())) {
        return createJsonResponse({ error: { code: "BAD_REQUEST", message: "The owner account cannot be deleted." } }, 400);
      }
      adminUsers.splice(userIndex, 1);
      return createJsonResponse({ ok: true });
    }

    const adminUserDetailsMatch = path.match(/^\/admin\/users\/(\d+)\/details$/);
    if (adminUserDetailsMatch && method === "GET") {
      const isAdmin = String(resolvedLoginUser.role ?? "").trim().toLowerCase() === "admin";
      if (!isAdmin) {
        return createJsonResponse({ error: { code: "FORBIDDEN", message: "Only admins can view user details." } }, 403);
      }
      const targetUserId = Number(adminUserDetailsMatch[1]);
      const user = adminUsers.find((candidate) => candidate.id === targetUserId) ?? null;
      if (!user) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "User not found." } }, 404);
      }
      const poolSummaries = pools
        .filter((pool) => Number(pool.user_id) === targetUserId)
        .map((pool) => ({
          pool_id: pool.id,
          name: pool.name,
          champion_count: Array.isArray(pool.champion_ids) ? pool.champion_ids.length : 0
        }));
      const teamMemberships = [];
      for (const [teamId, roster] of Object.entries(membersByTeam)) {
        const membershipTeam = teams.find((candidate) => candidate.id === Number(teamId)) ?? null;
        for (const membership of roster ?? []) {
          if (Number(membership.user_id) !== targetUserId) {
            continue;
          }
          teamMemberships.push({
            team_id: Number(teamId),
            name: membershipTeam?.name ?? `Team ${teamId}`,
            tag: membershipTeam?.tag ?? null,
            membership_role: membership.role ?? null,
            membership_team_role: membership.team_role ?? null,
            membership_lane: membership.primary_role ?? membership.lane ?? null
          });
        }
      }
      return createJsonResponse({
        details: {
          user_id: targetUserId,
          primary_role: user.primary_role ?? null,
          secondary_roles: Array.isArray(user.secondary_roles) ? [...user.secondary_roles] : [],
          active_team: null,
          champion_pools: poolSummaries,
          team_memberships: teamMemberships,
          champion_tag_promotions: {
            pending: 0,
            approved: 0,
            rejected: 0
          }
        }
      });
    }

    if (path === "/requirements" && method === "GET") {
      const scope = normalizeCatalogScope(parsedUrl.searchParams.get("scope"));
      const teamId = resolveCatalogTeamId(parsedUrl.searchParams.get("team_id"));
      if (!canReadCatalogScope(scope, teamId)) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "You must be on the selected team to read team-scoped requirements." } },
          403
        );
      }
      return createJsonResponse({
        scope,
        team_id: scope === "team" ? teamId : null,
        requirements: requirementDefinitions.filter((requirement) => matchesCatalogScope(requirement, scope, teamId))
      });
    }

    if (path === "/requirements" && method === "POST") {
      const scope = normalizeCatalogScope(body?.scope);
      const teamId = resolveCatalogTeamId(body?.team_id);
      if (!canWriteCatalogScope(scope, teamId)) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "You do not have access to create requirements in this scope." } },
          403
        );
      }
      const created = {
        id: nextRequirementDefinitionId,
        name: body?.name ?? "Untitled Requirement",
        definition: body?.definition ?? "",
        rules: Array.isArray(body?.rules) ? body.rules : [],
        scope,
        team_id: scope === "team" ? teamId : null,
        user_id: scope === "self" ? resolvedLoginUser.id : null
      };
      nextRequirementDefinitionId += 1;
      requirementDefinitions.push(created);
      return createJsonResponse({ requirement: created }, 201);
    }

    const requirementDefinitionMatch = path.match(/^\/requirements\/(\d+)$/);
    if (requirementDefinitionMatch && method === "PUT") {
      const requirementId = Number(requirementDefinitionMatch[1]);
      const requirement = requirementDefinitions.find((candidate) => candidate.id === requirementId) ?? null;
      if (!requirement) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Requirement not found." } }, 404);
      }
      if (!canWriteCatalogScope(requirement.scope, requirement.team_id)) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "You do not have access to update requirements in this scope." } },
          403
        );
      }
      if (typeof body?.name === "string") {
        requirement.name = body.name;
      }
      if (typeof body?.definition === "string") {
        requirement.definition = body.definition;
      }
      if (Array.isArray(body?.rules)) {
        requirement.rules = body.rules;
      }
      return createJsonResponse({ requirement });
    }

    if (requirementDefinitionMatch && method === "DELETE") {
      const requirementId = Number(requirementDefinitionMatch[1]);
      const requirement = requirementDefinitions.find((candidate) => candidate.id === requirementId) ?? null;
      if (!requirement) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Requirement not found." } }, 404);
      }
      if (!canWriteCatalogScope(requirement.scope, requirement.team_id)) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "You do not have access to delete requirements in this scope." } },
          403
        );
      }
      requirementDefinitions = requirementDefinitions.filter((candidate) => candidate.id !== requirementId);
      compositions = compositions.map((composition) => ({
        ...composition,
        requirement_ids: matchesCatalogScope(composition, requirement.scope, requirement.team_id)
          ? composition.requirement_ids.filter((id) => id !== requirementId)
          : composition.requirement_ids
      }));
      return createJsonResponse({}, 204);
    }

    if (path === "/compositions" && method === "GET") {
      const scope = normalizeCatalogScope(parsedUrl.searchParams.get("scope"));
      const teamId = resolveCatalogTeamId(parsedUrl.searchParams.get("team_id"));
      if (!canReadCatalogScope(scope, teamId)) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "You must be on the selected team to read team-scoped compositions." } },
          403
        );
      }
      const scopedCompositions = compositions.filter((composition) => matchesCatalogScope(composition, scope, teamId));
      const active = scopedCompositions.find((composition) => composition.is_active) ?? null;
      return createJsonResponse({
        scope,
        team_id: scope === "team" ? teamId : null,
        compositions: [...scopedCompositions],
        active_composition_id: active ? active.id : null
      });
    }

    if (path === "/compositions" && method === "POST") {
      const scope = normalizeCatalogScope(body?.scope);
      const teamId = resolveCatalogTeamId(body?.team_id);
      if (!canWriteCatalogScope(scope, teamId)) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "You do not have access to create compositions in this scope." } },
          403
        );
      }
      if (body?.is_active === true) {
        compositions = compositions.map((composition) =>
          matchesCatalogScope(composition, scope, teamId) ? { ...composition, is_active: false } : composition
        );
      }
      const created = {
        id: nextCompositionId,
        name: body?.name ?? "Untitled Composition",
        description: body?.description ?? "",
        requirement_ids: Array.isArray(body?.requirement_ids) ? body.requirement_ids : [],
        is_active: body?.is_active === true,
        scope,
        team_id: scope === "team" ? teamId : null,
        user_id: scope === "self" ? resolvedLoginUser.id : null
      };
      nextCompositionId += 1;
      compositions.push(created);
      return createJsonResponse({ composition: created }, 201);
    }

    if (path === "/compositions/active" && method === "GET") {
      const scope = normalizeCatalogScope(parsedUrl.searchParams.get("scope"));
      const teamId = resolveCatalogTeamId(parsedUrl.searchParams.get("team_id"));
      if (!canReadCatalogScope(scope, teamId)) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "You must be on the selected team to read team-scoped compositions." } },
          403
        );
      }
      const active =
        compositions.find((composition) => composition.is_active && matchesCatalogScope(composition, scope, teamId)) ??
        null;
      const requirements = active
        ? active.requirement_ids
            .map(
              (requirementId) =>
                requirementDefinitions.find(
                  (candidate) => candidate.id === requirementId && matchesCatalogScope(candidate, scope, teamId)
                ) ?? null
            )
            .filter(Boolean)
        : [];
      return createJsonResponse({
        scope,
        team_id: scope === "team" ? teamId : null,
        composition: active,
        requirements
      });
    }

    const compositionMatch = path.match(/^\/compositions\/(\d+)$/);
    if (compositionMatch && method === "PUT") {
      const compositionId = Number(compositionMatch[1]);
      const composition = compositions.find((candidate) => candidate.id === compositionId) ?? null;
      if (!composition) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Composition not found." } }, 404);
      }
      if (!canWriteCatalogScope(composition.scope, composition.team_id)) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "You do not have access to update compositions in this scope." } },
          403
        );
      }
      if (body?.is_active === true) {
        compositions = compositions.map((candidate) =>
          candidate.id === compositionId || !matchesCatalogScope(candidate, composition.scope, composition.team_id)
            ? candidate
            : { ...candidate, is_active: false }
        );
      }
      if (typeof body?.name === "string") {
        composition.name = body.name;
      }
      if (typeof body?.description === "string") {
        composition.description = body.description;
      }
      if (Array.isArray(body?.requirement_ids)) {
        composition.requirement_ids = body.requirement_ids;
      }
      if (typeof body?.is_active === "boolean") {
        composition.is_active = body.is_active;
      }
      return createJsonResponse({ composition });
    }

    if (compositionMatch && method === "DELETE") {
      const compositionId = Number(compositionMatch[1]);
      const composition = compositions.find((candidate) => candidate.id === compositionId) ?? null;
      if (!composition) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Composition not found." } }, 404);
      }
      if (!canWriteCatalogScope(composition.scope, composition.team_id)) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "You do not have access to delete compositions in this scope." } },
          403
        );
      }
      compositions = compositions.filter((candidate) => candidate.id !== compositionId);
      return createJsonResponse({}, 204);
    }

    if (path === "/me/pools" && method === "GET") {
      for (const pool of pools) {
        ensurePoolFamiliarity(pool);
      }
      return createJsonResponse({ pools });
    }

    if (path === "/me/pools" && method === "POST") {
      if (failCreatePoolWith401) {
        return createJsonResponse(
          {
            error: {
              code: "UNAUTHORIZED",
              message: "Invalid authentication token."
            }
          },
          401
        );
      }
      const created = {
        id: nextPoolId,
        user_id: 11,
        name: body.name,
        champion_ids: [],
        champion_familiarity: {},
        created_at: "2026-01-01T00:00:00.000Z"
      };
      nextPoolId += 1;
      pools.push(created);
      return createJsonResponse({ pool: created }, 201);
    }

    if (/^\/me\/pools\/\d+$/.test(path) && method === "PUT") {
      const poolId = Number(path.split("/")[3]);
      const pool = pools.find((candidate) => candidate.id === poolId);
      if (!pool) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Pool not found." } }, 404);
      }
      pool.name = body.name;
      return createJsonResponse({ pool });
    }

    if (/^\/me\/pools\/\d+$/.test(path) && method === "DELETE") {
      const poolId = Number(path.split("/")[3]);
      const index = pools.findIndex((candidate) => candidate.id === poolId);
      if (index >= 0) {
        pools.splice(index, 1);
      }
      return createJsonResponse({}, 204);
    }

    if (/^\/me\/pools\/\d+\/champions$/.test(path) && method === "POST") {
      const poolId = Number(path.split("/")[3]);
      const pool = pools.find((candidate) => candidate.id === poolId);
      if (pool) {
        ensurePoolFamiliarity(pool);
      }
      const familiarity = Number.parseInt(String(body?.familiarity), 10);
      const normalizedFamiliarity = Number.isInteger(familiarity) && familiarity >= 1 && familiarity <= 4 ? familiarity : 3;
      if (pool && !pool.champion_ids.includes(body.champion_id)) {
        pool.champion_ids.push(body.champion_id);
        pool.champion_familiarity[String(body.champion_id)] = normalizedFamiliarity;
      } else if (pool && body?.champion_id !== undefined && body?.champion_id !== null) {
        const existingKey = String(body.champion_id);
        if (pool.champion_familiarity[existingKey] === undefined) {
          pool.champion_familiarity[existingKey] = 3;
        }
      }
      return createJsonResponse({ pool });
    }

    if (/^\/me\/pools\/\d+\/champions\/\d+$/.test(path) && method === "DELETE") {
      const [poolIdRaw, championIdRaw] = [path.split("/")[3], path.split("/")[5]];
      const pool = pools.find((candidate) => candidate.id === Number(poolIdRaw));
      if (pool) {
        ensurePoolFamiliarity(pool);
        pool.champion_ids = pool.champion_ids.filter((id) => id !== Number(championIdRaw));
        delete pool.champion_familiarity[String(championIdRaw)];
      }
      return createJsonResponse({ pool });
    }

    if (/^\/me\/pools\/\d+\/champions\/\d+\/familiarity$/.test(path) && method === "PUT") {
      const [poolIdRaw, championIdRaw] = [path.split("/")[3], path.split("/")[5]];
      const pool = pools.find((candidate) => candidate.id === Number(poolIdRaw));
      if (!pool) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Pool not found." } }, 404);
      }
      ensurePoolFamiliarity(pool);
      if (!pool.champion_ids.includes(Number(championIdRaw))) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Champion is not in this pool." } }, 404);
      }
      const familiarity = Number.parseInt(String(body?.familiarity), 10);
      if (!Number.isInteger(familiarity) || familiarity < 1 || familiarity > 4) {
        return createJsonResponse(
          { error: { code: "BAD_REQUEST", message: "Expected 'familiarity' to be between 1 and 4." } },
          400
        );
      }
      pool.champion_familiarity[String(championIdRaw)] = familiarity;
      return createJsonResponse({ pool });
    }

    if (path === "/teams/discover" && method === "GET") {
      return createJsonResponse({ teams: buildDiscoverTeamsResponse() });
    }

    if (path === "/teams" && method === "GET") {
      return createJsonResponse({ teams });
    }

    if (path === "/teams" && method === "POST") {
      if (!body?.name || !body?.tag) {
        return createJsonResponse(
          {
            error: {
              code: "BAD_REQUEST",
              message: "Expected team name and tag."
            }
          },
          400
        );
      }
      const created = {
        id: 99,
        name: body.name,
        tag: body.tag,
        logo_data_url: toTeamLogoDataUrl(body.logo),
        created_by: 11,
        membership_role: "lead",
        membership_team_role: "primary",
        created_at: "2026-01-01T00:00:00.000Z"
      };
      teams.push(created);
      membersByTeam["99"] = [];
      return createJsonResponse({ team: created }, 201);
    }

    const memberSearchMatch = path.match(/^\/teams\/(\d+)\/member-search$/);
    if (memberSearchMatch && method === "GET") {
      const teamId = memberSearchMatch[1];
      const rawQuery = String(query.get("q") ?? "").trim().toLowerCase();
      const rosterUserIds = new Set((membersByTeam[teamId] ?? []).map((member) => Number(member.user_id)));
      const candidateUsers = [...adminUsers]
        .filter((user) => !rosterUserIds.has(Number(user.id)))
        .filter((user) => {
          if (!rawQuery) {
            return false;
          }
          const haystack = [
            user.email,
            user.riot_id,
            user.game_name,
            user.tagline,
            user.primary_role
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(rawQuery);
        })
        .map((user) => ({
          user_id: user.id,
          riot_id: user.riot_id,
          display_name: user.riot_id || user.email,
          game_name: user.game_name ?? "",
          tagline: user.tagline ?? "",
          email: user.email,
          primary_role: user.primary_role ?? null
        }));
      return createJsonResponse({ users: candidateUsers });
    }

    const membersMatch = path.match(/^\/teams\/(\d+)\/members$/);
    if (membersMatch && method === "GET") {
      const teamId = membersMatch[1];
      return createJsonResponse({ members: membersByTeam[teamId] ?? [] });
    }

    const roleMatch = path.match(/^\/teams\/(\d+)\/members\/(\d+)\/role$/);
    if (roleMatch && method === "PUT") {
      return createJsonResponse({
        member: {
          team_id: Number(roleMatch[1]),
          user_id: Number(roleMatch[2]),
          role: body.role,
          team_role: "substitute"
        }
      });
    }

    const teamRoleMatch = path.match(/^\/teams\/(\d+)\/members\/(\d+)\/team-role$/);
    if (teamRoleMatch && method === "PUT") {
      return createJsonResponse({
        member: {
          team_id: Number(teamRoleMatch[1]),
          user_id: Number(teamRoleMatch[2]),
          role: "member",
          team_role: body.team_role
        }
      });
    }

    const removeMatch = path.match(/^\/teams\/(\d+)\/members\/(\d+)$/);
    if (removeMatch && method === "DELETE") {
      return createJsonResponse({ ok: true });
    }

    if (membersMatch && method === "POST") {
      const resolvedUserId = Number.isInteger(Number(body.user_id))
        ? Number(body.user_id)
        : findUserIdByRiotId(body.riot_id);
      if (!Number.isInteger(resolvedUserId) || resolvedUserId <= 0) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "User not found." } }, 404);
      }
      return createJsonResponse(
        {
          member: {
            team_id: Number(membersMatch[1]),
            user_id: resolvedUserId,
            role: body.role,
            team_role: body.team_role ?? "substitute"
          }
        },
        201
      );
    }

    const teamJoinRequestCollectionMatch = path.match(/^\/teams\/(\d+)\/join-requests$/);
    if (teamJoinRequestCollectionMatch && method === "POST") {
      const teamId = teamJoinRequestCollectionMatch[1];
      const requesterUserId = getCurrentUserId();
      const requests = joinRequestsByTeam[teamId] ?? [];
      const hasPending = requests.some(
        (request) => Number(request?.requester_user_id) === requesterUserId && String(request?.status) === "pending"
      );
      if (hasPending) {
        return createJsonResponse(
          { error: { code: "CONFLICT", message: "A pending join request already exists for this team." } },
          409
        );
      }

      const requestRecord = {
        id: nextTeamJoinRequestId,
        team_id: Number(teamId),
        requester_user_id: requesterUserId,
        requested_lane: resolvedProfile.primaryRole ?? "Mid",
        status: "pending",
        note: typeof body?.note === "string" ? body.note : "",
        reviewed_by_user_id: null,
        reviewed_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        requester: buildRequesterIdentity(requesterUserId)
      };
      nextTeamJoinRequestId += 1;
      joinRequestsByTeam[teamId] = [...requests, requestRecord];
      return createJsonResponse({ request: requestRecord }, 201);
    }

    if (teamJoinRequestCollectionMatch && method === "GET") {
      const teamId = teamJoinRequestCollectionMatch[1];
      const status = query.get("status");
      const requests = (joinRequestsByTeam[teamId] ?? []).filter((request) => (
        !status || status === "all" ? true : String(request?.status) === status
      ));
      return createJsonResponse({ requests });
    }

    const teamJoinRequestItemMatch = path.match(/^\/teams\/(\d+)\/join-requests\/(\d+)$/);
    if (teamJoinRequestItemMatch && method === "DELETE") {
      const [teamId, requestId] = [teamJoinRequestItemMatch[1], Number(teamJoinRequestItemMatch[2])];
      const requests = joinRequestsByTeam[teamId] ?? [];
      const requesterUserId = getCurrentUserId();
      const nextRequests = requests.filter(
        (request) =>
          !(Number(request?.id) === requestId &&
            Number(request?.requester_user_id) === requesterUserId &&
            String(request?.status) === "pending")
      );
      joinRequestsByTeam[teamId] = nextRequests;
      return createJsonResponse({ ok: true });
    }

    if (teamJoinRequestItemMatch && method === "PUT") {
      const [teamId, requestId] = [teamJoinRequestItemMatch[1], Number(teamJoinRequestItemMatch[2])];
      const requests = joinRequestsByTeam[teamId] ?? [];
      const target = requests.find((request) => Number(request?.id) === requestId) ?? null;
      if (!target) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Join request not found." } }, 404);
      }
      target.status = typeof body?.status === "string" ? body.status : target.status;
      target.reviewed_by_user_id = getCurrentUserId();
      target.reviewed_at = "2026-01-01T00:00:00.000Z";

      if (target.status === "approved") {
        const roster = membersByTeam[teamId] ?? [];
        const exists = roster.some((member) => Number(member?.user_id) === Number(target.requester_user_id));
        if (!exists) {
          roster.push({
            team_id: Number(teamId),
            user_id: Number(target.requester_user_id),
            role: "member",
            team_role: "primary",
            display_name: target?.requester?.display_name ?? `User ${target.requester_user_id}`,
            game_name: target?.requester?.game_name ?? "",
            tagline: target?.requester?.tagline ?? "",
            email: target?.requester?.email ?? null,
            lane: target?.requester?.lane ?? target?.requested_lane ?? null
          });
          membersByTeam[teamId] = roster;
        }
      }
      return createJsonResponse({ request: target });
    }

    const teamInvitationCollectionMatch = path.match(/^\/teams\/(\d+)\/member-invitations$/);
    if (teamInvitationCollectionMatch && method === "GET") {
      const teamId = teamInvitationCollectionMatch[1];
      if (failedMemberInvitationTeamIds.has(String(teamId))) {
        return createJsonResponse({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } }, 500);
      }
      const invitations = memberInvitations.get(String(teamId)) ?? [];
      const status = query.get("status");
      return createJsonResponse({
        invitations: invitations.filter((invitation) => (!status || status === "all" ? true : invitation.status === status))
      });
    }

    if (path === "/me/member-invitations" && method === "GET") {
      if (userInvitations === null) {
        return createJsonResponse({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } }, 500);
      }
      const status = query.get("status");
      return createJsonResponse({
        invitations: userInvitations.filter((invitation) => (!status || status === "all" ? true : invitation.status === status))
      });
    }

    if (/^\/teams\/\d+$/.test(path) && method === "PATCH") {
      const teamId = Number(path.split("/")[2]);
      const existing = teams.find((team) => team.id === teamId);
      return createJsonResponse({
        team: {
          id: teamId,
          name: body.name,
          tag: body.tag,
          logo_data_url: body.remove_logo ? null : (toTeamLogoDataUrl(body.logo) ?? existing?.logo_data_url ?? null),
          membership_role: "lead",
          membership_team_role: "primary"
        }
      });
    }

    if (/^\/teams\/\d+$/.test(path) && method === "DELETE") {
      return createJsonResponse({}, 204);
    }

    if (!authHeader && path.startsWith("/me/")) {
      return createJsonResponse({ error: { code: "UNAUTHORIZED", message: "Authentication required." } }, 401);
    }

    return createJsonResponse({ error: { code: "NOT_FOUND", message: `${path} not mocked` } }, 404);
  };

  return { impl, calls };
}

async function flush() {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}

async function bootApp({ fetchImpl, storage, apiBaseUrl = "http://api.test" }) {
  vi.resetModules();
  const dom = new JSDOM(htmlFixture, {
    url: "http://localhost/public/index.html",
    pretendToBeVisual: true
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};

  const { initApp } = await import("../../public/app/app.js");
  const app = await initApp({
    document: dom.window.document,
    window: dom.window,
    fetchImpl,
    storage,
    matchMediaImpl: createMatchMedia(),
    apiBaseUrl
  });

  return { dom, ...app };
}

function clickTab(doc, tab) {
  const trigger = doc.querySelector(`[data-tab='${tab}']`);
  expect(trigger).toBeTruthy();
  trigger.click();
}

function openExplorerEditChampions(doc) {
  clickTab(doc, "explorer");
  const trigger = doc.querySelector(".explorer-sub-nav-btn[data-explorer-sub='edit-champions']");
  expect(trigger).toBeTruthy();
  trigger.click();
}

function openMyChampions(doc) {
  clickTab(doc, "explorer");
}

function openProfile(doc) {
  const trigger = doc.querySelector(".nav-avatar-link[data-tab='profile']");
  expect(trigger).toBeTruthy();
  trigger.click();
}

function getChampionCardByName(doc, championName) {
  return Array.from(doc.querySelectorAll("#explorer-results .champ-card"))
    .find((card) => card.querySelector(".champ-name")?.textContent?.trim() === championName) ?? null;
}

describe("auth + pools + team management", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("unauthenticated users only see auth screen and not app screens", async () => {
    const storage = createStorageStub();
    const harness = createFetchHarness();
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    expect(doc.querySelector("#auth-screen").hidden).toBe(false);
    expect(doc.querySelector("#app-shell").hidden).toBe(true);
    expect(doc.querySelector("#auth-login").hidden).toBe(false);
    expect(doc.querySelector("#auth-register").hidden).toBe(true);
    expect(doc.querySelector("#auth-email-group").hidden).toBe(false);
    expect(doc.querySelector("#auth-game-name-group").hidden).toBe(true);
    expect(doc.querySelector("#auth-tagline-group").hidden).toBe(true);

    const reportIssueLink = doc.querySelector("#report-issue-link");
    expect(reportIssueLink).toBeTruthy();
    expect(reportIssueLink.getAttribute("href")).toBe("#");

    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    expect(doc.querySelector("#auth-feedback").textContent).toContain("Login/Registration required");
  });

  test("login stores session and sends Authorization on protected pool fetch", async () => {
    const storage = createStorageStub();
    const harness = createFetchHarness({
      pools: [
        {
          id: 1,
          user_id: 11,
          name: "Main",
          champion_ids: [1],
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      teams: [],
      membersByTeam: {}
    });
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    doc.querySelector("#auth-email").value = "user@example.com";
    doc.querySelector("#auth-password").value = "strong-pass-123";
    doc.querySelector("#auth-login").click();

    await flush();

    const storedAuthRaw = storage.dump("draftflow.authSession.v1");
    expect(storedAuthRaw).toBeTruthy();
    expect(JSON.parse(storedAuthRaw).token).toBe("token-123");
    expect(doc.querySelector("#auth-status").textContent).toContain("user@example.com");
    expect(doc.querySelector("#auth-screen").hidden).toBe(true);
    expect(doc.querySelector("#app-shell").hidden).toBe(false);

    const poolFetch = harness.calls.find((call) => call.path === "/me/pools" && call.method === "GET");
    expect(poolFetch).toBeTruthy();
    expect(poolFetch.headers.Authorization).toBe("Bearer token-123");

    doc.querySelector("#auth-logout").click();
    await flush();
    expect(doc.querySelector("#auth-status").textContent).toContain("Signed out");
  });

  test("registration requires game name and tagline", async () => {
    const storage = createStorageStub();
    const harness = createFetchHarness();
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    doc.querySelector("#auth-signup-link").click();
    expect(doc.querySelector("#auth-game-name-group").hidden).toBe(false);
    expect(doc.querySelector("#auth-tagline-group").hidden).toBe(false);

    doc.querySelector("#auth-email").value = "user@example.com";
    doc.querySelector("#auth-password").value = "strong-pass-123";
    doc.querySelector("#auth-retype-password").value = "strong-pass-123";
    doc.querySelector("#auth-register").click();
    await flush();
    expect(doc.querySelector("#auth-feedback").textContent).toContain("Game Name and Tagline are required");

    doc.querySelector("#auth-game-name").value = "MyRiotName";
    doc.querySelector("#auth-tagline").value = "NA1";
    doc.querySelector("#auth-register").click();
    await flush();

    const registerCall = harness.calls.find((call) => call.path === "/auth/register" && call.method === "POST");
    expect(registerCall).toBeTruthy();
    expect(registerCall.body.gameName).toBe("MyRiotName");
    expect(registerCall.body.tagline).toBe("NA1");
  });

  test("champion explorer loads tag catalog and saves global tag edits", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", role: "admin", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness();
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    openExplorerEditChampions(doc);
    await flush();

    expect(doc.querySelector("#champion-tag-catalog-list").textContent).toContain("engage");

    const editButton = doc.querySelector("#explorer-results .champ-card-edit-btn");
    expect(editButton).toBeTruthy();
    editButton.click();
    await flush();

    expect(doc.querySelector("#champion-tag-editor").hidden).toBe(false);
    expect(doc.querySelector("#ced-tags-selected").textContent).toContain("engage");
    const frontlinePill = Array.from(doc.querySelectorAll("#ced-tags-available .ced-tag-pill"))
      .find((node) => node.textContent.trim() === "frontline");
    expect(frontlinePill).toBeTruthy();
    frontlinePill.click();

    doc.querySelector("#champion-tag-editor-save").click();
    await flush();

    const saveCall = harness.calls.find(
      (call) => /^\/champions\/\d+\/tags$/.test(call.path) && call.method === "PUT"
    );
    expect(saveCall).toBeTruthy();
    expect(saveCall.body.scope).toBe("all");
    expect(saveCall.body.tag_ids).toEqual([1, 2]);
    expect(doc.querySelector("#champion-tag-editor").hidden).toBe(true);
  });

  test("champion explorer saves reviewed state from the composition editor", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", role: "admin", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness();
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    openExplorerEditChampions(doc);
    await flush();

    doc.querySelector("#explorer-results .champ-card-edit-btn").click();
    await flush();

    const reviewedCheckbox = doc.querySelector("#champion-tag-editor-reviewed");
    expect(reviewedCheckbox).toBeTruthy();
    reviewedCheckbox.checked = true;
    reviewedCheckbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    doc.querySelector("#champion-tag-editor-save").click();
    await flush();

    const reviewedSaveCall = harness.calls.find(
      (call) => call.path === "/champions/1/tags" && call.method === "PUT" && call.body.reviewed === true
    );
    expect(reviewedSaveCall).toBeTruthy();
    expect(doc.querySelector("#explorer-results .champ-card").textContent).toContain("Human reviewed");
  });

  test("champion editor preserves existing tags and blocks save while tag load is pending", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness();
    let releaseChampionTagRead = null;
    const championTagReadGate = new Promise((resolvePromise) => {
      releaseChampionTagRead = resolvePromise;
    });
    let holdChampionTagRead = true;
    const delayedFetchImpl = async (url, init = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const parsedUrl = new URL(url, "http://api.test");
      if (holdChampionTagRead && method === "GET" && /^\/champions\/\d+\/tags$/.test(parsedUrl.pathname)) {
        await championTagReadGate;
        holdChampionTagRead = false;
      }
      return harness.impl(url, init);
    };
    const { dom } = await bootApp({ fetchImpl: delayedFetchImpl, storage });
    const doc = dom.window.document;

    openExplorerEditChampions(doc);
    await flush();

    const editButton = doc.querySelector("#explorer-results .champ-card-edit-btn");
    expect(editButton).toBeTruthy();
    editButton.click();
    await flush();

    const saveButton = doc.querySelector("#champion-tag-editor-save");
    expect(saveButton).toBeTruthy();
    expect(saveButton.disabled).toBe(true);

    saveButton.click();
    await flush();
    const prematureSaveCall = harness.calls.find(
      (call) => /^\/champions\/\d+\/tags$/.test(call.path) && call.method === "PUT"
    );
    expect(prematureSaveCall).toBeUndefined();

    releaseChampionTagRead();
    await flush();
    await flush();

    expect(doc.querySelector("#ced-tags-selected").textContent).toContain("engage");
    expect(saveButton.disabled).toBe(false);

    saveButton.click();
    await flush();

    const saveCall = harness.calls.find(
      (call) => /^\/champions\/\d+\/tags$/.test(call.path) && call.method === "PUT"
    );
    expect(saveCall).toBeTruthy();
    expect(saveCall.body.tag_ids).toEqual([1]);
  });

  test("champion editor accepts camelCase tagIds payload and keeps selections", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness();
    const camelCaseFetchImpl = async (url, init = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const parsedUrl = new URL(url, "http://api.test");
      if (method === "GET" && /^\/champions\/\d+\/tags$/.test(parsedUrl.pathname)) {
        await harness.impl(url, init);
        const championId = Number(parsedUrl.pathname.split("/")[2]);
        return createJsonResponse({
          scope: "all",
          team_id: null,
          tagIds: championId === 1 ? [1] : []
        });
      }
      return harness.impl(url, init);
    };
    const { dom } = await bootApp({ fetchImpl: camelCaseFetchImpl, storage });
    const doc = dom.window.document;

    openExplorerEditChampions(doc);
    await flush();

    const editButton = doc.querySelector("#explorer-results .champ-card-edit-btn");
    expect(editButton).toBeTruthy();
    editButton.click();
    await flush();

    expect(doc.querySelector("#ced-tags-selected").textContent).toContain("engage");

    doc.querySelector("#champion-tag-editor-save").click();
    await flush();

    const saveCall = harness.calls.find(
      (call) => /^\/champions\/\d+\/tags$/.test(call.path) && call.method === "PUT"
    );
    expect(saveCall).toBeTruthy();
    expect(saveCall.body.tag_ids).toEqual([1]);
  });

  test("champion editor keeps assigned tags visible even with mixed catalog definitions", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness();
    const compositionFilterFetchImpl = async (url, init = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const parsedUrl = new URL(url, "http://api.test");
      if (method === "GET" && parsedUrl.pathname === "/tags") {
        await harness.impl(url, init);
        return createJsonResponse({
          tags: [
            { id: 1, name: "engage", definition: "Helps your comp start fights." },
            { id: 2, name: "frontline", definition: "Adds durable front line presence." },
            { id: 10, name: "teamfight", definition: "Shines in 5v5 grouped fights." }
          ]
        });
      }
      return harness.impl(url, init);
    };
    const { dom } = await bootApp({ fetchImpl: compositionFilterFetchImpl, storage });
    const doc = dom.window.document;

    openExplorerEditChampions(doc);
    await flush();

    const editButton = doc.querySelector("#explorer-results .champ-card-edit-btn");
    expect(editButton).toBeTruthy();
    editButton.click();
    await flush();

    expect(doc.querySelector("#ced-tags-selected").textContent).toContain("engage");
  });

  test("champion editor tag list stays alphabetical regardless of checked state", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness();
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    openExplorerEditChampions(doc);
    await flush();

    const editButton = doc.querySelector("#explorer-results .champ-card-edit-btn");
    expect(editButton).toBeTruthy();
    editButton.click();
    await flush();

    const availableLabels = [...doc.querySelectorAll("#ced-tags-available .ced-tag-pill")]
      .map((node) => node.textContent.trim());
    const selectedLabels = [...doc.querySelectorAll("#ced-tags-selected .ced-tag-pill")]
      .map((node) => node.textContent.trim());
    expect(availableLabels).toEqual(["burst", "frontline"]);
    expect(selectedLabels).toEqual(["engage"]);
  });

  test("champion explorer metadata editor supports shared role profiles", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness();
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    openExplorerEditChampions(doc);
    await flush();

    const editButton = getChampionCardByName(doc, "Ahri")?.querySelector(".champ-card-edit-btn");
    expect(editButton).toBeTruthy();
    editButton.click();
    await flush();

    const topRoleButton = Array.from(
      doc.querySelectorAll("#champion-metadata-editor-roles button")
    ).find((node) => node.textContent.trim() === "Top");
    expect(topRoleButton).toBeTruthy();
    topRoleButton.click();

    await flush();
    const sharedProfileToggle = doc.querySelector("#champion-metadata-share-role-profile");
    expect(sharedProfileToggle).toBeTruthy();
    sharedProfileToggle.checked = true;
    sharedProfileToggle.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    const mixedDamageButton = Array.from(doc.querySelectorAll("#ced-damage-slot .ced-damage-btn")).find((node) =>
      node.textContent.trim() === "Mixed"
    );
    expect(mixedDamageButton).toBeTruthy();
    mixedDamageButton.click();

    doc.querySelector("#champion-tag-editor-save").click();
    await flush();

    const metadataSaveCall = harness.calls.find(
      (call) => /^\/champions\/\d+\/metadata$/.test(call.path) && call.method === "PUT"
    );
    expect(metadataSaveCall).toBeTruthy();
    expect(metadataSaveCall.body.role_profiles.Top.primary_damage_type).toBe("mixed");
    expect(metadataSaveCall.body.role_profiles.Mid.primary_damage_type).toBe("mixed");
    expect(new Set(metadataSaveCall.body.roles)).toEqual(new Set(["Top", "Mid"]));
    expect(doc.querySelector("#champion-tag-editor").hidden).toBe(true);
  });

  test("champion explorer shows metadata scope indicators and defaults members to self scope", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 22, email: "member@example.com", role: "member", gameName: "Member", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness({
      loginUser: { id: 22, email: "member@example.com", role: "member", gameName: "Member", tagline: "NA1" },
      profile: { id: 22, email: "member@example.com", role: "member", gameName: "Member", tagline: "NA1" }
    });
    const fetchImpl = async (url, init = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const parsedUrl = new URL(url, "http://api.test");
      if (method === "GET" && parsedUrl.pathname === "/champions") {
        return createJsonResponse({
          champions: [
            {
              id: 1,
              name: "Ahri",
              role: "Mid",
              tagIds: [1],
              reviewed: false,
              metadata: {
                roles: ["Support"],
                roleProfiles: {
                  Support: createRoleProfile("utility", "strong", "neutral", "weak")
                }
              },
              metadata_scopes: {
                self: true,
                team: false,
                all: true
              }
            },
            {
              id: 2,
              name: "Ashe",
              role: "ADC",
              tagIds: [],
              reviewed: false,
              metadata: {
                roles: ["ADC"],
                roleProfiles: {
                  ADC: createRoleProfile("ad", "neutral", "strong", "strong")
                }
              },
              metadata_scopes: {
                self: false,
                team: false,
                all: true
              }
            }
          ]
        });
      }
      if (method === "GET" && parsedUrl.pathname === "/champions/1/tags") {
        return createJsonResponse({
          scope: "self",
          tag_ids: [1],
          reviewed: false
        });
      }
      if (method === "GET" && parsedUrl.pathname === "/champions/1/metadata") {
        return createJsonResponse({
          scope: "self",
          metadata: {
            roles: ["Mid"],
            roleProfiles: {
              Mid: createRoleProfile("ap", "neutral", "strong", "neutral")
            }
          },
          has_custom_metadata: true,
          resolved_scope: "self",
          reviewed: false
        });
      }
      return harness.impl(url, init);
    };

    const { dom } = await bootApp({ fetchImpl, storage });
    const doc = dom.window.document;

    doc.querySelector(".side-menu-link[data-tab='explorer']").click();
    doc.querySelector(".explorer-sub-nav-btn[data-explorer-sub='edit-champions']").click();
    await flush();

    const card = doc.querySelector("#explorer-results .champ-card");
    expect(card.textContent).toContain("Support");
    expect(card.textContent).toContain("Utility");

    const scopeTrigger = card.querySelector(".champ-scope-trigger");
    expect(scopeTrigger).toBeTruthy();
    expect(scopeTrigger.textContent.trim()).toBe("Global");

    scopeTrigger.click();
    await flush();

    const scopeOptions = Array.from(card.querySelectorAll(".champ-scope-option"));
    const userScopeButton = scopeOptions.find((button) => button.textContent.trim() === "User");
    const teamScopeButton = scopeOptions.find((button) => button.textContent.trim() === "Team");
    const globalScopeButton = scopeOptions.find((button) => button.textContent.trim() === "Global");

    expect(userScopeButton).toBeTruthy();
    expect(userScopeButton.disabled).toBe(false);
    expect(userScopeButton.getAttribute("aria-selected")).toBe("false");

    expect(teamScopeButton).toBeTruthy();
    expect(teamScopeButton.disabled).toBe(true);
    expect(teamScopeButton.className).toContain("is-unavailable");

    expect(globalScopeButton).toBeTruthy();
    expect(globalScopeButton.getAttribute("aria-selected")).toBe("true");
    expect(globalScopeButton.className).toContain("is-active");

    userScopeButton.click();
    await flush();

    const updatedCard = doc.querySelector("#explorer-results .champ-card");
    const updatedScopeTrigger = updatedCard.querySelector(".champ-scope-trigger");
    expect(updatedScopeTrigger).toBeTruthy();
    expect(updatedScopeTrigger.textContent.trim()).toBe("User");
    expect(updatedCard.textContent).toContain("Mid");
    expect(updatedCard.textContent).toContain("AP");
    expect(updatedCard.textContent).not.toContain("Utility");

    const metadataFilter = doc.querySelector("#explorer-metadata-scope");
    expect(metadataFilter).toBeTruthy();
    metadataFilter.value = "self-present";
    metadataFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await flush();
    expect(doc.querySelector("#explorer-count").textContent).toContain("Results: 1");
    expect(doc.querySelector("#explorer-results").textContent).toContain("Ahri");
    expect(doc.querySelector("#explorer-results").textContent).not.toContain("Ashe");

    const editButton = doc.querySelector("#explorer-results .champ-card-edit-btn");
    expect(editButton).toBeTruthy();
    editButton.click();
    await flush();

    const scopeSelect = doc.querySelector("#champion-tag-editor-scope");
    expect(scopeSelect).toBeTruthy();
    expect(Array.from(scopeSelect.options, (option) => option.value)).toEqual(["self"]);
    expect(scopeSelect.value).toBe("self");
    expect(doc.querySelector("#champion-tag-editor-scope-tip-text").textContent).toContain("Changes will update this user profile");
    expect(doc.querySelector("#champion-tag-editor-meta").textContent).toContain("Editing user metadata");
  });

  test("tags workspace renders flat definition-based catalog", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness();
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    doc.querySelector(".side-menu-link[data-tab='tags']").click();
    await flush();

    expect(doc.querySelector("#hero-title").textContent).toBe("Tags");
    expect(doc.querySelector("#tags-workspace-summary").textContent).toContain("3 tags");

    const tagLabels = Array.from(
      doc.querySelectorAll("#tags-workspace-categories .tags-workspace-item .tags-workspace-name"),
      (node) => node.textContent.trim()
    );
    expect(tagLabels).toEqual(["burst", "engage", "frontline"]);

    const engageRow = Array.from(doc.querySelectorAll("#tags-workspace-categories .tags-workspace-item")).find((node) =>
      node.textContent.includes("engage")
    );
    expect(engageRow).toBeTruthy();
    const engageContentChildren = Array.from(engageRow.querySelector(".tags-workspace-content").children).map((node) =>
      node.className
    );
    expect(engageContentChildren[0]).toContain("tags-workspace-name");
    expect(engageContentChildren[1]).toContain("tags-workspace-definition");
    expect(engageContentChildren[2]).toContain("tags-workspace-usage");
  });

  test("tags workspace supports admin CRUD operations", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", role: "admin", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness();
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    doc.querySelector(".side-menu-link[data-tab='tags']").click();
    await flush();

    doc.querySelector("#tags-manage-name").value = "splitpush";
    doc.querySelector("#tags-manage-definition").value = "Strong side lane and map pressure pick.";
    doc.querySelector("#tags-manage-save").click();
    await flush();
    await flush();

    const createCall = harness.calls.find((call) => call.path === "/tags" && call.method === "POST");
    expect(createCall).toBeTruthy();
    expect(createCall.body.name).toBe("splitpush");
    expect(createCall.body.definition).toContain("map pressure");
    expect(doc.querySelector("#tags-workspace-summary").textContent).toContain("4 tags");

    const createdRow = Array.from(doc.querySelectorAll(".tags-workspace-item")).find((node) =>
      node.textContent.includes("splitpush")
    );
    expect(createdRow).toBeTruthy();
    createdRow.querySelector("button").click();
    await flush();

    doc.querySelector("#tags-manage-name").value = "splitpush-priority";
    doc.querySelector("#tags-manage-definition").value = "Priority split pressure with objective threat.";
    doc.querySelector("#tags-manage-save").click();
    await flush();
    await flush();

    const updateCall = harness.calls.find((call) => /^\/tags\/\d+$/.test(call.path) && call.method === "PUT");
    expect(updateCall).toBeTruthy();
    expect(updateCall.body.name).toBe("splitpush-priority");

    const updatedRow = Array.from(doc.querySelectorAll(".tags-workspace-item")).find((node) =>
      node.textContent.includes("splitpush-priority")
    );
    expect(updatedRow).toBeTruthy();
    updatedRow.querySelectorAll("button")[1].click();
    await flush();
    doc.querySelector("#confirmation-confirm").click();
    await flush();

    const deleteCall = harness.calls.find((call) => /^\/tags\/\d+$/.test(call.path) && call.method === "DELETE");
    expect(deleteCall).toBeTruthy();
    expect(doc.querySelector("#tags-workspace-summary").textContent).toContain("3 tags");
  });

  test("tags workspace opens tag promotions from the non-global editor and cancels pending requests", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", role: "admin", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness({
      loginUser: { id: 11, email: "lead@example.com", role: "admin", gameName: "LeadPlayer", tagline: "NA1" },
      teams: [{ id: 1, name: "Team Echo", tag: "ECHO", membership_role: "lead" }]
    });
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    doc.querySelector(".side-menu-link[data-tab='tags']").click();
    await flush();
    await flush();

    const promoteButton = doc.querySelector("#tags-promotion-open");
    expect(promoteButton.hidden).toBe(true);

    const scopeSelect = doc.querySelector("#tags-scope");
    scopeSelect.value = "team";
    scopeSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await flush();
    await flush();

    const teamSelect = doc.querySelector("#tags-team");
    teamSelect.value = "1";
    teamSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await flush();
    await flush();

    expect(promoteButton.hidden).toBe(false);
    expect(promoteButton.disabled).toBe(true);
    expect(promoteButton.textContent).toBe("Request Global Promotion");

    doc.querySelector("#tags-manage-name").value = "macro";
    doc.querySelector("#tags-manage-definition").value = "Strong map rotations and objective setup.";
    doc.querySelector("#tags-manage-save").click();
    await flush();
    await flush();

    const createCall = harness.calls.find((call) => call.path === "/tags" && call.method === "POST");
    expect(createCall).toBeTruthy();
    expect(createCall.body).toMatchObject({ scope: "team", team_id: 1, name: "macro" });
    expect(promoteButton.disabled).toBe(false);

    promoteButton.click();
    await flush();

    expect(doc.querySelector("#tags-promotion-modal").hidden).toBe(false);
    expect(doc.body.classList.contains("has-modal-open")).toBe(true);
    expect(doc.querySelector("#tags-promotion-modal-context").textContent).toContain("macro");

    const modalComment = doc.querySelector("#tags-promotion-modal-comment");
    modalComment.value = "Share this tag globally.";
    modalComment.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    doc.querySelector("#tags-promotion-modal-submit").click();
    await flush();
    await flush();
    await flush();

    const requestCall = harness.calls.find(
      (call) => /^\/tags\/\d+\/promotion-requests$/.test(call.path) && call.method === "POST"
    );
    expect(requestCall).toBeTruthy();
    expect(requestCall.body).toMatchObject({
      source_scope: "team",
      target_scope: "all",
      team_id: 1,
      request_comment: "Share this tag globally."
    });
    expect(doc.querySelector("#tags-promotion-modal").hidden).toBe(true);
    expect(doc.querySelector("#tags-promotion-request-list").textContent).toContain("macro");

    const cancelButton = [...doc.querySelectorAll("#tags-promotion-request-list button")].find(
      (button) => button.textContent.trim() === "Cancel Request"
    );
    expect(cancelButton).toBeTruthy();
    cancelButton.click();
    await flush();
    doc.querySelector("#confirmation-confirm").click();
    await flush();
    await flush();
    await flush();

    const cancelCall = harness.calls.find(
      (call) => /^\/tags\/promotion-requests\/\d+$/.test(call.path) && call.method === "DELETE"
    );
    expect(cancelCall).toBeTruthy();
    expect(doc.querySelector("#tags-promotion-request-list").textContent).toContain("No submitted tag promotions yet.");
  });

  test("users workspace lists users, updates permissions, and supports one-time Riot ID correction", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", role: "admin", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness({
      loginUser: { id: 11, email: "lead@example.com", role: "admin", gameName: "LeadPlayer", tagline: "NA1" }
    });
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    doc.querySelector(".nav-avatar-link[data-tab='profile']").click();
    await flush();
    doc.querySelector("#profile-admin-link .profile-setting-row").click();
    await flush();

    expect(doc.querySelector("#users-access").textContent).toContain("users shown");
    expect(doc.querySelector("#users-authorization-access").textContent).toContain("roles");
    expect(doc.querySelector("#users-authorization-roles").textContent).toContain("Roles");
    expect(doc.querySelector("#users-authorization-roles").textContent).toContain("global.member");
    expect(doc.querySelector("#users-authorization-roles").textContent).toContain("team_membership.member");
    expect(doc.querySelector("#users-authorization-roles").textContent).not.toContain("Team Roster Roles");
    expect(doc.querySelector("#users-authorization-permissions").hidden).toBe(false);
    expect(doc.querySelector("#users-authorization-permissions").textContent).toContain("Scoped Access");
    expect(doc.querySelector("#users-authorization-permissions").textContent).toContain("Requirements");
    expect(doc.querySelector("#users-authorization-permissions").textContent).toContain("Self: Read by user, global, admin. Write by user, global, admin.");
    expect(doc.querySelector("#users-authorization-permissions").textContent).toContain("Team: Read by team member, team lead. Write by team lead.");
    expect(doc.querySelector("#users-authorization-permissions").textContent).toContain("All: Read by user, global, admin. Write by global, admin.");
    expect(doc.querySelector("#users-authorization-assignments").textContent).toContain("Permission Assignments");
    expect(doc.querySelector("#users-authorization-assignments").textContent).not.toContain("Team Roster Assignments");
    expect(doc.querySelector("#users-authorization-assignments").textContent).toContain("requirements.write.team");
    expect(doc.querySelector("#users-authorization-assignments").textContent).toContain("compositions.write.global");
    const matrixCall = harness.calls.find((call) => call.path === "/admin/authorization" && call.method === "GET");
    expect(matrixCall).toBeTruthy();
    const roleSelects = [...doc.querySelectorAll("#users-list select")];
    const memberRoleSelect = roleSelects.find((select) => select.value === "member");
    expect(memberRoleSelect).toBeTruthy();

    memberRoleSelect.value = "global";
    memberRoleSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await flush();
    doc.querySelector("#confirmation-confirm").click();
    await flush();
    await flush();

    const roleUpdateCall = harness.calls.find(
      (call) => call.path === "/admin/users/22/role" && call.method === "PUT"
    );
    expect(roleUpdateCall).toBeTruthy();
    expect(roleUpdateCall.body.role).toBe("global");

    const memberCard = [...doc.querySelectorAll("#users-list .summary-card")].find((card) =>
      card.textContent.includes("member@example.com")
    );
    const correctionGameNameInput = memberCard?.querySelector("input[placeholder='Game Name']");
    const correctionTaglineInput = memberCard?.querySelector("input[placeholder='Tagline']");
    const correctionSaveButton = [...(memberCard?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent.trim() === "Save Riot ID"
    );
    expect(correctionGameNameInput).toBeTruthy();
    expect(correctionTaglineInput).toBeTruthy();
    expect(correctionSaveButton).toBeTruthy();

    correctionGameNameInput.value = "MemberRenamed";
    correctionTaglineInput.value = "NA9";
    correctionSaveButton.click();
    await flush();
    await flush();

    const riotIdUpdateCall = harness.calls.find(
      (call) => call.path === "/admin/users/22/riot-id" && call.method === "PUT"
    );
    expect(riotIdUpdateCall).toBeTruthy();
    expect(riotIdUpdateCall.body).toEqual({
      gameName: "MemberRenamed",
      tagline: "NA9"
    });
    expect(doc.querySelector("#users-list").textContent).toContain("Riot ID: MemberRenamed#NA9");
    expect(doc.querySelector("#users-list").textContent).toContain("One-time correction already used.");

    const deleteButton = [...(memberCard?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent.trim() === "Delete User"
    );
    expect(deleteButton).toBeTruthy();
    deleteButton.click();
    await flush();
    doc.querySelector("#confirmation-confirm").click();
    await flush();

    const deleteUserCall = harness.calls.find((call) => call.path === "/admin/users/22" && call.method === "DELETE");
    expect(deleteUserCall).toBeTruthy();
    expect(doc.querySelector("#users-list").textContent).not.toContain("member@example.com");
  });

  test("users workspace filters rows and applies bulk role updates", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", role: "admin", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness({
      loginUser: { id: 11, email: "lead@example.com", role: "admin", gameName: "LeadPlayer", tagline: "NA1" },
      adminUsersSeed: [
        {
          id: 11,
          email: "lead@example.com",
          role: "admin",
          stored_role: "admin",
          is_owner_admin: false,
          game_name: "LeadPlayer",
          tagline: "NA1",
          riot_id: "LeadPlayer#NA1",
          riot_id_correction_count: 0,
          can_update_riot_id: true
        },
        {
          id: 22,
          email: "member@example.com",
          role: "member",
          stored_role: "member",
          is_owner_admin: false,
          game_name: "Member",
          tagline: "NA1",
          riot_id: "Member#NA1",
          riot_id_correction_count: 0,
          can_update_riot_id: true
        },
        {
          id: 33,
          email: "coach@example.com",
          role: "member",
          stored_role: "member",
          is_owner_admin: false,
          game_name: "Coach",
          tagline: "NA1",
          riot_id: "Coach#NA1",
          riot_id_correction_count: 0,
          can_update_riot_id: true
        }
      ]
    });
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    doc.querySelector(".nav-avatar-link[data-tab='profile']").click();
    await flush();
    doc.querySelector("#profile-admin-link .profile-setting-row").click();
    await flush();

    const search = doc.querySelector("#users-search");
    search.value = "coach";
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    expect(doc.querySelector("#users-list").textContent).toContain("coach@example.com");
    expect(doc.querySelector("#users-list").textContent).not.toContain("member@example.com");

    search.value = "";
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    const roleFilter = doc.querySelector("#users-role-filter");
    roleFilter.value = "member";
    roleFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(doc.querySelector("#users-list").textContent).toContain("member@example.com");
    expect(doc.querySelector("#users-list").textContent).toContain("coach@example.com");
    expect(doc.querySelector("#users-list").textContent).not.toContain("lead@example.com");

    roleFilter.value = "";
    roleFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    for (const userId of ["22", "33"]) {
      const checkbox = doc.querySelector(`#users-list input[type='checkbox'][data-user-id='${userId}']`);
      expect(checkbox).toBeTruthy();
      checkbox.click();
      await flush();
    }

    const bulkRole = doc.querySelector("#users-bulk-role");
    bulkRole.value = "global";
    bulkRole.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    doc.querySelector("#users-bulk-apply").click();
    await flush();
    doc.querySelector("#confirmation-confirm").click();
    await flush();
    await flush();

    const bulkCalls = harness.calls.filter((call) =>
      /^\/admin\/users\/(22|33)\/role$/.test(call.path) && call.method === "PUT"
    );
    expect(bulkCalls).toHaveLength(2);

    const memberCard = doc.querySelector("#users-list .summary-card[data-user-id='22']");
    const coachCard = doc.querySelector("#users-list .summary-card[data-user-id='33']");
    expect(memberCard?.querySelector("select")?.value).toBe("global");
    expect(coachCard?.querySelector("select")?.value).toBe("global");
    expect(doc.querySelector("#users-selection-meta").textContent).toContain("Select users");
  });

  test("users workspace can reapply owner admin to sync stored DB role", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "tylerjtriplett@gmail.com", role: "admin", gameName: "Tripinmixes", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness({
      loginUser: { id: 11, email: "tylerjtriplett@gmail.com", role: "admin", gameName: "Tripinmixes", tagline: "NA1" },
      adminUsersSeed: [
        {
          id: 11,
          email: "tylerjtriplett@gmail.com",
          role: "admin",
          stored_role: "member",
          is_owner_admin: true,
          game_name: "Tripinmixes",
          tagline: "NA1",
          riot_id: "Tripinmixes#NA1",
          riot_id_correction_count: 0,
          can_update_riot_id: true,
          primary_role: "Mid",
          secondary_roles: []
        },
        {
          id: 22,
          email: "member@example.com",
          role: "member",
          stored_role: "member",
          is_owner_admin: false,
          game_name: "Member",
          tagline: "NA1",
          riot_id: "Member#NA1",
          riot_id_correction_count: 0,
          can_update_riot_id: true,
          primary_role: "Support",
          secondary_roles: []
        }
      ]
    });
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    doc.querySelector(".nav-avatar-link[data-tab='profile']").click();
    await flush();
    doc.querySelector("#profile-admin-link .profile-setting-row").click();
    await flush();

    let ownerCard = [...doc.querySelectorAll("#users-list .summary-card")].find((card) =>
      card.textContent.includes("tylerjtriplett@gmail.com")
    );
    expect(ownerCard).toBeTruthy();
    expect(ownerCard.textContent).toContain("Stored DB role is 'member'.");

    const applyButton = [...ownerCard.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Apply Admin to DB"
    );
    expect(applyButton).toBeTruthy();
    applyButton.click();
    await flush();
    doc.querySelector("#confirmation-confirm").click();
    await flush();

    const roleUpdateCall = harness.calls.find(
      (call) => call.path === "/admin/users/11/role" && call.method === "PUT"
    );
    expect(roleUpdateCall).toBeTruthy();
    expect(roleUpdateCall.body.role).toBe("admin");

    ownerCard = [...doc.querySelectorAll("#users-list .summary-card")].find((card) =>
      card.textContent.includes("tylerjtriplett@gmail.com")
    );
    expect(ownerCard.textContent).toContain("Owner admin DB role is synced.");
  });

  test("report issue link opens a blocking modal and submits source context", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", role: "admin", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness({
      loginUser: { id: 11, email: "lead@example.com", role: "admin", gameName: "LeadPlayer", tagline: "NA1" },
      issueReporting: { enabled: true }
    });
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();
    doc.querySelector("#team-workspace-tab-manage").click();
    await flush();

    doc.querySelector("#report-issue-link").click();
    await flush();

    expect(doc.querySelector("#tab-team-config").classList.contains("is-active")).toBe(true);
    expect(doc.querySelector("#issue-report-modal").hidden).toBe(false);
    expect(doc.body.classList.contains("has-modal-open")).toBe(true);
    expect(doc.querySelector("#issue-report-email").value).toBe("lead@example.com");
    expect(doc.querySelector("#issue-report-game-name").value).toBe("LeadPlayer#NA1");
    expect(doc.querySelector("#issue-report-source").textContent).toContain("Teams");
    expect(doc.querySelector("#issue-report-source").textContent).toContain("Manage");
    expect([...doc.querySelector("#issue-report-type").options].map((option) => ({
      value: option.value,
      label: option.textContent.trim()
    }))).toEqual([
      { value: "bug", label: "Bug" },
      { value: "feature_request", label: "Feature Request" }
    ]);

    doc.querySelector("#issue-report-cancel").click();
    await flush();
    expect(doc.querySelector("#issue-report-modal").hidden).toBe(true);
    expect(doc.body.classList.contains("has-modal-open")).toBe(false);

    doc.querySelector("#report-issue-link").click();
    await flush();

    doc.querySelector("#issue-report-subject").value = "Invite list is stale";
    doc.querySelector("#issue-report-description").value = "The invite list needed a manual refresh.";
    doc.querySelector("#issue-report-submit").click();
    await flush();
    await flush();

    const reportCall = harness.calls.find((call) => call.path === "/issue-reporting/issues" && call.method === "POST");
    expect(reportCall).toBeTruthy();
    expect(reportCall.body).toEqual({
      title: "Invite list is stale",
      description: "The invite list needed a manual refresh.",
      type: "bug",
      reporterEmail: "lead@example.com",
      reporterGameName: "LeadPlayer#NA1",
      sourceContext: {
        page: "team-config",
        pageLabel: "Teams",
        tab: "manage",
        tabLabel: "Manage",
        routeHash: "#team-config"
      }
    });
    expect(doc.querySelector("#issue-report-feedback").textContent).toContain("Issue submitted successfully");
  });

  test("compositions workspace creates requirement definitions and compositions", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", role: "admin", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness({
      loginUser: { id: 11, email: "lead@example.com", role: "admin", gameName: "LeadPlayer", tagline: "NA1" }
    });
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    doc.querySelector(".side-menu-link[data-tab='requirements']").click();
    await flush();

    doc.querySelector("#requirements-cancel").click();
    await flush();
    expect(doc.querySelector("#requirements-editor").hidden).toBe(true);

    doc.querySelector("#requirements-open-editor").click();
    await flush();

    const requirementName = doc.querySelector("#requirements-name");
    requirementName.value = "Aggressive";
    requirementName.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    const definitionInput = doc.querySelector("#requirements-definition");
    definitionInput.value = "Must have engage and frontline";
    definitionInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    const firstClauseHardEngage = doc.querySelector(
      "#requirements-clauses [data-field='term-option'][data-clause-index='0'][data-kind='tag'][data-value='engage']"
    );
    expect(firstClauseHardEngage).toBeTruthy();
    expect(firstClauseHardEngage.getAttribute("title")).toContain("start fights");
    firstClauseHardEngage.click();

    const firstClauseAddTag = doc.querySelector(
      "#requirements-clauses button[data-field='add-term'][data-clause-index='0']"
    );
    expect(firstClauseAddTag).toBeTruthy();
    firstClauseAddTag.click();
    await flush();

    const firstClauseFrontline = doc.querySelector(
      "#requirements-clauses [data-field='term-option'][data-clause-index='0'][data-kind='tag'][data-value='frontline']"
    );
    expect(firstClauseFrontline).toBeTruthy();
    firstClauseFrontline.click();

    doc.querySelector("#requirements-add-clause").click();
    await flush();

    const secondClauseTag = doc.querySelector(
      "#requirements-clauses [data-field='term-option'][data-clause-index='1'][data-kind='damage_type'][data-value='ad']"
    );
    expect(secondClauseTag).toBeTruthy();
    secondClauseTag.click();

    const secondClauseSeparateFromFirst = doc.querySelector(
      "#requirements-clauses input[data-field='separate-from'][data-clause-index='1'][data-target-clause-index='0']"
    );
    expect(secondClauseSeparateFromFirst).toBeTruthy();
    secondClauseSeparateFromFirst.checked = true;
    secondClauseSeparateFromFirst.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    doc.querySelector("#requirements-save").click();
    await flush();

    const createRequirementCall = harness.calls.find((call) => call.path === "/requirements" && call.method === "POST");
    expect(createRequirementCall).toBeTruthy();
    expect(createRequirementCall.body.name).toBe("Aggressive");
    expect(new Set(createRequirementCall.body.rules[0].expr.and.map((entry) => entry.tag))).toEqual(
      new Set(["engage", "frontline"])
    );
    expect(createRequirementCall.body.rules[1].expr.damageType).toBe("ad");
    expect(createRequirementCall.body.rules[1].clauseJoiner).toBe("and");
    expect(createRequirementCall.body.rules[1].separateFrom).toEqual([createRequirementCall.body.rules[0].id]);
    expect(doc.querySelector("#requirements-editor").hidden).toBe(true);

    doc.querySelector(".side-menu-link[data-tab='compositions']").click();
    await flush();

    doc.querySelector("#compositions-cancel").click();
    await flush();

    const compositionName = doc.querySelector("#compositions-name");
    compositionName.value = "Aggro Bundle";
    compositionName.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    const activeCheckbox = doc.querySelector("#compositions-is-active");
    activeCheckbox.checked = true;
    activeCheckbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    const requirementOption = [...doc.querySelectorAll("#compositions-requirement-options input[type='checkbox']")].find(
      (input) => input.parentElement?.textContent?.includes("Aggressive")
    );
    expect(requirementOption).toBeTruthy();
    requirementOption.checked = true;
    requirementOption.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    doc.querySelector("#compositions-save").click();
    await flush();

    const createCompositionCall = harness.calls.find((call) => call.path === "/compositions" && call.method === "POST");
    expect(createCompositionCall).toBeTruthy();
    expect(createCompositionCall.body.name).toBe("Aggro Bundle");
    expect(createCompositionCall.body.is_active).toBe(true);
  });

  test("compositions workspace supports team-scoped requirement and composition saves", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", role: "member", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness({
      loginUser: { id: 11, email: "lead@example.com", role: "member", gameName: "LeadPlayer", tagline: "NA1" },
      teams: [
        {
          id: 1,
          name: "Macro Squad",
          tag: "MCR",
          membership_role: "lead",
          member_count: 5
        }
      ],
      teamContext: {
        activeTeamId: 1
      }
    });
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    doc.querySelector(".side-menu-link[data-tab='requirements']").click();
    await flush();

    const requirementsScope = doc.querySelector("#requirements-scope");
    expect(Array.from(requirementsScope.options, (option) => option.value)).toEqual(["self", "team"]);
    expect(requirementsScope.value).toBe("self");

    requirementsScope.value = "team";
    requirementsScope.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await flush();
    await flush();

    const requirementsTeam = doc.querySelector("#requirements-team");
    expect(requirementsTeam.value).toBe("1");
    expect(doc.querySelector("#requirements-open-editor").disabled).toBe(false);

    doc.querySelector("#requirements-open-editor").click();
    await flush();
    expect(doc.querySelector("#requirements-save").disabled).toBe(false);

    const requirementName = doc.querySelector("#requirements-name");
    requirementName.value = "Team Anchor";
    requirementName.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    const definitionInput = doc.querySelector("#requirements-definition");
    definitionInput.value = "Team-only engage coverage";
    definitionInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    const firstClause = doc.querySelector(
      "#requirements-clauses [data-field='term-option'][data-clause-index='0'][data-kind='tag'][data-value='engage']"
    );
    expect(firstClause).toBeTruthy();
    firstClause.click();

    doc.querySelector("#requirements-save").click();
    await flush();
    await flush();
    await flush();
    await flush();

    const teamRequirementCall = harness.calls.find((call) => call.path === "/requirements" && call.method === "POST");
    expect(teamRequirementCall).toBeTruthy();
    expect(teamRequirementCall.body.scope).toBe("team");
    expect(teamRequirementCall.body.team_id).toBe(1);

    doc.querySelector(".side-menu-link[data-tab='compositions']").click();
    await flush();

    const compositionsScope = doc.querySelector("#compositions-scope");
    expect(compositionsScope.value).toBe("team");

    const compositionName = doc.querySelector("#compositions-name");
    compositionName.value = "Team Bundle";
    compositionName.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    const requirementOption = [...doc.querySelectorAll("#compositions-requirement-options input[type='checkbox']")].find(
      (input) => input.parentElement?.textContent?.includes("Team Anchor")
    );
    expect(requirementOption).toBeTruthy();
    requirementOption.checked = true;
    requirementOption.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    doc.querySelector("#compositions-save").click();
    await flush();
    await flush();
    await flush();
    await flush();

    const teamCompositionCall = harness.calls.find((call) => call.path === "/compositions" && call.method === "POST");
    expect(teamCompositionCall).toBeTruthy();
    expect(teamCompositionCall.body.scope).toBe("team");
    expect(teamCompositionCall.body.team_id).toBe(1);
  });

  test("login routes users without defined roles to My Profile tab", async () => {
    const storage = createStorageStub();
    const harness = createFetchHarness({
      loginUser: {
        id: 11,
        email: "user@example.com",
        gameName: "LoginUser",
        tagline: "NA1"
      },
      profile: {
        id: 11,
        email: "user@example.com",
        gameName: "LoginUser",
        tagline: "NA1",
        primaryRole: "Mid",
        secondaryRoles: []
      }
    });
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    doc.querySelector("#auth-email").value = "user@example.com";
    doc.querySelector("#auth-password").value = "strong-pass-123";
    doc.querySelector("#auth-login").click();

    await flush();

    expect(doc.querySelector("#tab-profile").classList.contains("is-active")).toBe(true);
    expect(doc.querySelector(".nav-avatar-link[data-tab='profile']").classList.contains("is-active")).toBe(true);
  });

  test("role pool provisioning handles 401 by clearing session", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "expired-token",
        user: { id: 11, email: "user@example.com" }
      })
    });
    const harness = createFetchHarness({
      pools: [],
      teams: [],
      membersByTeam: {},
      failCreatePoolWith401: true
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    await flush();
    await flush();

    const createCall = harness.calls.find((call) => call.path === "/me/pools" && call.method === "POST");
    expect(createCall).toBeTruthy();
    expect(createCall.headers.Authorization).toBe("Bearer expired-token");
    expect(doc.querySelector("#auth-status").textContent).toContain("Signed out");
    expect(doc.querySelector("#auth-feedback").textContent).toContain("Session expired");
  });

  test("teams workspace shows teams I am on with membership roles", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      pools: [],
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          logo_data_url: "data:image/png;base64,bW9jazE=",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        },
        {
          id: 2,
          name: "Team Beta",
          tag: "BETA",
          logo_data_url: "data:image/png;base64,bW9jazI=",
          created_by: 33,
          membership_role: "member",
          membership_team_role: "substitute",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [{ team_id: 1, user_id: 11, role: "lead", team_role: "primary", email: "lead@example.com" }],
        "2": [{ team_id: 2, user_id: 11, role: "member", team_role: "substitute", email: "lead@example.com" }]
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    clickTab(doc, "team-config");
    await flush();

    const memberListText = doc.querySelector("#team-activity-teams-list").textContent;
    expect(memberListText).toContain("Team Alpha");
    expect(memberListText).toContain("Team Beta");
    expect(memberListText).toContain("Team Lead");
    expect(memberListText).toContain("Substitute");

    const firstLogoButton = doc.querySelector("#team-activity-teams-list .summary-card-logo-button");
    expect(firstLogoButton).toBeTruthy();
    firstLogoButton.click();
    expect(doc.querySelector("#logo-lightbox").hidden).toBe(false);
    expect(doc.querySelector("#logo-lightbox-caption").textContent).toContain("Team");
    doc.querySelector("#logo-lightbox-close").click();
    expect(doc.querySelector("#logo-lightbox").hidden).toBe(true);
  });

  test("profile page renders a featured Riot top champion from the profile payload", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      profile: {
        id: 11,
        email: "lead@example.com",
        gameName: "LeadPlayer",
        tagline: "NA1",
        primaryRole: "Mid",
        secondaryRoles: ["Top"],
        championStats: {
          provider: "riot",
          status: "ok",
          fetchedAt: "2026-02-26T17:25:00.000Z",
          topChampion: {
            championId: 99,
            championName: "Lux",
            championLevel: 7,
            championPoints: 234567,
            lastPlayedAt: "2026-02-24T10:00:00.000Z"
          },
          champions: [
            {
              championId: 99,
              championName: "Lux",
              championLevel: 7,
              championPoints: 234567,
              lastPlayedAt: "2026-02-24T10:00:00.000Z"
            },
            {
              championId: 266,
              championName: "Aatrox",
              championLevel: 6,
              championPoints: 123456,
              lastPlayedAt: "2026-02-20T10:00:00.000Z"
            }
          ]
        }
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    doc.querySelector(".nav-avatar-link[data-tab='profile']").click();
    await flush();

    expect(doc.querySelector("#profile-riot-stats-summary").textContent).toBe("");
    expect(doc.querySelector("#profile-riot-top-champion").textContent).toContain("Most Played Champions");
    expect(doc.querySelector("#profile-riot-top-champion").textContent).toContain("Lux");
    expect(doc.querySelector("#profile-riot-top-champion").textContent).toContain("Aatrox");
    expect(doc.querySelector("#profile-riot-top-champion").textContent).toContain("Mastery 7");
    expect(doc.querySelector("#profile-riot-stats-list").textContent).toBe("");
  });

  test("profile page shows an unavailable message when Riot stats are idle", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      profile: {
        id: 11,
        email: "lead@example.com",
        gameName: "LeadPlayer",
        tagline: "NA1",
        primaryRole: "Mid",
        secondaryRoles: ["Top"]
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    doc.querySelector(".nav-avatar-link[data-tab='profile']").click();
    await flush();

    expect(doc.querySelector("#profile-riot-stats-summary").textContent).toContain("not available yet");
    expect(doc.querySelector("#profile-riot-top-champion").textContent.trim()).toBe("");
    expect(doc.querySelector("#profile-riot-stats-list").textContent.trim()).toBe("");
  });

  test("my champions page shows one-click add notifications for strong recent Riot signals", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      profile: {
        id: 11,
        email: "lead@example.com",
        gameName: "LeadPlayer",
        tagline: "NA1",
        primaryRole: "Support",
        secondaryRoles: [],
        championStats: {
          provider: "riot",
          status: "ok",
          fetchedAt: "2026-02-26T17:25:00.000Z",
          topChampion: {
            championId: 201,
            championName: "Braum",
            championLevel: 7,
            championPoints: 234567,
            lastPlayedAt: "2026-02-24T10:00:00.000Z"
          },
          champions: [
            {
              championId: 201,
              championName: "Braum",
              championLevel: 7,
              championPoints: 234567,
              lastPlayedAt: "2026-02-24T10:00:00.000Z"
            }
          ]
        }
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='explorer']").click();
    await flush();

    const suggestionNotice = doc.querySelector("#my-champions-suggestions-panel");
    expect(suggestionNotice.hidden).toBe(false);
    expect(suggestionNotice.open).toBe(false);
    expect(doc.querySelector("#my-champions-suggestions-summary").textContent).toContain("outside your current list");

    suggestionNotice.open = true;
    suggestionNotice.dispatchEvent(new dom.window.Event("toggle"));
    await flush();

    expect(doc.querySelector("#my-champions-suggestions-list").textContent).toContain("Braum");
    const addButton = Array.from(doc.querySelectorAll("#my-champions-suggestions-list button"))
      .find((button) => button.textContent.trim() === "Add to Support");
    expect(addButton).toBeTruthy();

    addButton.click();
    await flush();
    await flush();

    expect(doc.querySelector("#my-champions-card-grid").textContent).toContain("Braum");
    expect(suggestionNotice.hidden).toBe(true);
  });

  test("creating a team from team context sends name and tag", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      pools: [],
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          logo_data_url: "data:image/png;base64,bW9jazE=",
          created_by: 33,
          membership_role: "member",
          membership_team_role: "substitute",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [{ team_id: 1, user_id: 11, role: "member", team_role: "substitute", email: "lead@example.com" }]
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    doc.querySelector("#team-workspace-tab-create").click();
    doc.querySelector("#team-admin-create-name").value = "My New Team";
    doc.querySelector("#team-admin-create-tag").value = "MNT";
    doc.querySelector("#team-admin-create").click();
    await flush();
    await flush();

    const createTeamCall = harness.calls.find((call) => call.path === "/teams" && call.method === "POST");
    expect(createTeamCall).toBeTruthy();
    expect(createTeamCall.body.name).toBe("My New Team");
    expect(createTeamCall.body.tag).toBe("MNT");
    expect(createTeamCall.body.logo).toBeUndefined();
    expect(doc.querySelector("#team-admin-feedback").textContent).toContain("Created team 'My New Team'.");
  });

  test("creating a team with logo upload sends multipart contract", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      pools: [],
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          logo_data_url: "data:image/png;base64,bW9jazE=",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [{ team_id: 1, user_id: 11, role: "lead", team_role: "primary", email: "lead@example.com" }]
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    doc.querySelector("#team-workspace-tab-create").click();
    doc.querySelector("#team-admin-create-name").value = "Logo Team";
    doc.querySelector("#team-admin-create-tag").value = "lgo";

    const logoFile = new dom.window.File([Buffer.from("fake-png")], "logo.png", { type: "image/png" });
    setInputFiles(doc.querySelector("#team-admin-create-logo-url"), [logoFile]);

    doc.querySelector("#team-admin-create").click();
    await flush();
    await flush();

    const createTeamCall = harness.calls.find((call) => call.path === "/teams" && call.method === "POST");
    expect(createTeamCall).toBeTruthy();
    expect(createTeamCall.isFormData).toBe(true);
    expect(createTeamCall.body.name).toBe("Logo Team");
    expect(createTeamCall.body.tag).toBe("LGO");
    expect(createTeamCall.body.logo).toBe(logoFile);
  });

  test("team context uses real teams and manage forms are action-driven", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      pools: [],
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          logo_data_url: "data:image/png;base64,bW9jazE=",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [{ team_id: 1, user_id: 11, role: "lead", team_role: "primary", email: "lead@example.com" }]
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();

    const memberPanel = doc.querySelector("#team-workspace-member");
    const managePanel = doc.querySelector("#team-workspace-manage");
    const createPanel = doc.querySelector("#team-workspace-create");
    const memberTab = doc.querySelector("#team-workspace-tab-member");
    const manageTab = doc.querySelector("#team-workspace-tab-manage");
    const createTab = doc.querySelector("#team-workspace-tab-create");
    const composerActiveTeamSelect = doc.querySelector("#builder-active-team");
    const activeTeamOptions = Array.from(composerActiveTeamSelect.options, (option) => option.textContent);
    const editAction = doc.querySelector("#team-admin-open-edit");
    const editPanel = doc.querySelector("[data-team-manage-panel='team-settings']");
    const addPanel = doc.querySelector("[data-team-manage-panel='add-member']");
    const inlineAddAction = doc.querySelector("button[data-roster-quick-action='open-add-member']");
    const currentLogoHelp = doc.querySelector("#team-admin-current-logo-help");
    const currentLogoOpen = doc.querySelector("#team-admin-current-logo-open");

    expect(memberPanel.hidden).toBe(false);
    expect(managePanel.hidden).toBe(true);
    expect(createPanel.hidden).toBe(true);
    expect(memberTab.getAttribute("aria-selected")).toBe("true");
    expect(manageTab.getAttribute("aria-selected")).toBe("false");
    expect(createTab.getAttribute("aria-selected")).toBe("false");

    manageTab.click();
    await flush();
    expect(memberPanel.hidden).toBe(true);
    expect(managePanel.hidden).toBe(false);
    expect(manageTab.getAttribute("aria-selected")).toBe("true");
    expect(activeTeamOptions.some((option) => option.includes("Team Alpha"))).toBe(true);
    expect(activeTeamOptions.some((option) => option === "Mid")).toBe(false);
    expect(editAction).toBeTruthy();
    expect(inlineAddAction).toBeTruthy();
    expect(editPanel.hidden).toBe(true);
    expect(addPanel.hidden).toBe(true);

    editAction.click();
    expect(editPanel.hidden).toBe(false);
    expect(addPanel.hidden).toBe(true);
    expect(currentLogoHelp.textContent).toContain("Current logo shown");
    expect(currentLogoOpen.hidden).toBe(false);

    currentLogoOpen.click();
    expect(doc.querySelector("#logo-lightbox").hidden).toBe(false);
    doc.querySelector("#logo-lightbox-close").click();
    expect(doc.querySelector("#logo-lightbox").hidden).toBe(true);

    composerActiveTeamSelect.value = "1";
    composerActiveTeamSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await flush();
    const saveTeamContextCall = harness.calls.find(
      (call) => call.path === "/me/team-context" && call.method === "PUT"
    );
    expect(saveTeamContextCall).toBeTruthy();
    expect(saveTeamContextCall.body.activeTeamId).toBe(1);

    const refreshedInlineAddAction = doc.querySelector("button[data-roster-quick-action='open-add-member']");
    refreshedInlineAddAction.click();
    expect(editPanel.hidden).toBe(true);
    expect(addPanel.hidden).toBe(false);

    createTab.click();
    expect(managePanel.hidden).toBe(true);
    expect(createPanel.hidden).toBe(false);
    expect(manageTab.getAttribute("aria-selected")).toBe("false");
    expect(createTab.getAttribute("aria-selected")).toBe("true");
  });

  test("team manage row actions open role-scoped panes and send updates on confirm", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      pools: [],
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          logo_data_url: "data:image/png;base64,bW9jazE=",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [
          {
            team_id: 1,
            user_id: 11,
            role: "lead",
            team_role: "primary",
            email: "lead@example.com",
            display_name: "Lead#NA1",
            lane: "Top"
          },
          {
            team_id: 1,
            user_id: 22,
            role: "member",
            team_role: "substitute",
            email: "member@example.com",
            display_name: "Member#NA1",
            lane: "ADC"
          }
        ]
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();

    doc.querySelector("button[data-roster-quick-action='open-add-member'][data-lane='Jungle']").click();
    const addPanel = doc.querySelector("[data-team-manage-panel='add-member']");
    expect(addPanel.hidden).toBe(false);
    expect(doc.querySelector("#team-admin-add-title").textContent).toBe("Jungle: Add Member");
    doc.querySelector("#team-admin-add-cancel").click();
    expect(addPanel.hidden).toBe(true);

    doc.querySelector("button[data-roster-quick-action='promote-lead'][data-user-id='22']").click();
    expect(doc.querySelector("[data-team-manage-panel='update-member-role']").hidden).toBe(false);
    expect(doc.querySelector("#team-admin-update-role-title").textContent).toBe("ADC: Update Member Role");
    expect(doc.querySelector("#team-admin-role-riot-id").value).toBe("Member#NA1");
    doc.querySelector("#team-admin-update-role").click();
    await flush();
    await flush();

    const updateRoleCall = harness.calls.find(
      (call) => call.path === "/teams/1/members/22/role" && call.method === "PUT"
    );
    expect(updateRoleCall).toBeTruthy();
    expect(updateRoleCall.body).toEqual({ role: "lead" });

    doc.querySelector("button[data-roster-quick-action='move-team-role'][data-user-id='22']").click();
    expect(doc.querySelector("[data-team-manage-panel='update-team-role']").hidden).toBe(false);
    expect(doc.querySelector("#team-admin-update-team-role-title").textContent).toBe("ADC: Update Member Team Role");
    expect(doc.querySelector("#team-admin-team-role-riot-id").value).toBe("Member#NA1");
    doc.querySelector("#team-admin-update-team-role").click();
    await flush();
    await flush();

    const updateTeamRoleCall = harness.calls.find(
      (call) => call.path === "/teams/1/members/22/team-role" && call.method === "PUT"
    );
    expect(updateTeamRoleCall).toBeTruthy();
    expect(updateTeamRoleCall.body).toEqual({ team_role: "primary" });
  });

  test("add member posts riot_id payload", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", gameName: "Lead", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness({
      pools: [],
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [
          {
            team_id: 1,
            user_id: 11,
            role: "lead",
            team_role: "primary",
            display_name: "Lead#NA1",
            lane: "Top"
          }
        ]
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();

    doc.querySelector("button[data-roster-quick-action='open-add-member'][data-lane='Jungle']").click();
    doc.querySelector("#team-admin-add-riot-id").value = "Lead#NA1";
    doc.querySelector("#team-admin-add-member").click();
    await flush();
    await flush();

    const addMemberCall = harness.calls.find((call) => call.path === "/teams/1/members" && call.method === "POST");
    expect(addMemberCall).toBeTruthy();
    expect(addMemberCall.body.riot_id).toBe("Lead#NA1");
    expect(addMemberCall.body.user_id).toBeUndefined();
  });

  test("add member search populates Riot ID suggestions", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", gameName: "Lead", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness({
      adminUsersSeed: [
        {
          id: 11,
          email: "lead@example.com",
          role: "admin",
          stored_role: "admin",
          is_owner_admin: false,
          game_name: "Lead",
          tagline: "NA1",
          riot_id: "Lead#NA1"
        },
        {
          id: 44,
          email: "jungler@example.com",
          role: "member",
          stored_role: "member",
          is_owner_admin: false,
          game_name: "JungleKing",
          tagline: "NA1",
          riot_id: "JungleKing#NA1",
          primary_role: "Jungle"
        }
      ],
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [
          {
            team_id: 1,
            user_id: 11,
            role: "lead",
            team_role: "primary",
            display_name: "Lead#NA1",
            game_name: "Lead",
            tagline: "NA1",
            lane: "Top"
          }
        ]
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();

    doc.querySelector("button[data-roster-quick-action='open-add-member'][data-lane='Jungle']").click();
    const searchInput = doc.querySelector("#team-admin-add-riot-id");
    searchInput.value = "jung";
    searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await flush();
    await flush();

    const searchCall = harness.calls.find((call) => call.path === "/teams/1/member-search" && call.method === "GET");
    expect(searchCall).toBeTruthy();
    expect(searchCall.query?.get("q")).toBe("jung");
    const optionValues = [...doc.querySelectorAll("#team-admin-add-riot-id-options option")].map((option) => option.value);
    expect(optionValues).toContain("JungleKing#NA1");
  });

  test("member can request and cancel join request from teams workspace", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 33, email: "outsider@example.com", role: "member", gameName: "Outsider", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness({
      loginUser: { id: 33, email: "outsider@example.com", role: "member", gameName: "Outsider", tagline: "NA1" },
      profile: {
        id: 33,
        email: "outsider@example.com",
        role: "member",
        gameName: "Outsider",
        tagline: "NA1",
        primaryRole: "Top",
        secondaryRoles: []
      },
      pools: [],
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          created_by: 11,
          membership_role: null,
          membership_team_role: null,
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [{ team_id: 1, user_id: 11, role: "lead", team_role: "primary", display_name: "Lead#NA1", lane: "Mid" }]
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();

    doc.querySelector("#team-join-discover-refresh").click();
    await flush();
    doc.querySelector("#team-join-note").value = "Interested in scrims.";
    doc.querySelector("#team-join-request").click();
    await flush();
    await flush();

    const requestCall = harness.calls.find((call) => call.path === "/teams/1/join-requests" && call.method === "POST");
    expect(requestCall).toBeTruthy();
    expect(requestCall.body.note).toBe("Interested in scrims.");

    doc.querySelector("#team-join-cancel").click();
    await flush();
    await flush();

    const cancelCall = harness.calls.find((call) => call.path === "/teams/1/join-requests/1" && call.method === "DELETE");
    expect(cancelCall).toBeTruthy();
  });

  test("team lead can load and approve incoming join requests", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", role: "member", gameName: "Lead", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness({
      loginUser: { id: 11, email: "lead@example.com", role: "member", gameName: "Lead", tagline: "NA1" },
      profile: {
        id: 11,
        email: "lead@example.com",
        role: "member",
        gameName: "Lead",
        tagline: "NA1",
        primaryRole: "Mid",
        secondaryRoles: []
      },
      pools: [],
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [{ team_id: 1, user_id: 11, role: "lead", team_role: "primary", display_name: "Lead#NA1", lane: "Mid" }]
      },
      teamJoinRequestsByTeam: {
        "1": [
          {
            id: 7,
            team_id: 1,
            requester_user_id: 33,
            requested_lane: "Top",
            status: "pending",
            note: "Can play weakside top.",
            reviewed_by_user_id: null,
            reviewed_at: null,
            created_at: "2026-01-01T00:00:00.000Z",
            requester: {
              user_id: 33,
              lane: "Top",
              display_name: "Outsider#NA1",
              game_name: "Outsider",
              tagline: "NA1",
              email: "outsider@example.com"
            }
          }
        ]
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();
    await flush();
    expect(doc.querySelector("#team-join-review-list").textContent).toContain("Outsider#NA1");

    const approveButton = doc.querySelector("#team-join-review-list button[data-team-join-review-action='approve']");
    expect(approveButton).toBeTruthy();
    approveButton.click();
    await flush();
    await flush();

    const approveCall = harness.calls.find(
      (call) => call.path === "/teams/1/join-requests/7" && call.method === "PUT"
    );
    expect(approveCall).toBeTruthy();
    expect(approveCall.body).toEqual({ status: "approved" });
  });

  test("team invite and review sections use refresh icons instead of load buttons", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", role: "member", gameName: "Lead", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness({
      loginUser: { id: 11, email: "lead@example.com", role: "member", gameName: "Lead", tagline: "NA1" },
      profile: {
        id: 11,
        email: "lead@example.com",
        role: "member",
        gameName: "Lead",
        tagline: "NA1",
        primaryRole: "Mid",
        secondaryRoles: []
      },
      pools: [],
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      memberInvitationsByTeam: {
        "1": [
          {
            id: 41,
            team_id: 1,
            target_user_id: 22,
            requested_lane: "ADC",
            note: "",
            status: "pending",
            role: "member",
            team_role: "primary",
            invited_by_user_id: 11,
            reviewed_by_user_id: null,
            reviewed_at: null,
            created_at: "2026-01-01T00:00:00.000Z",
            target: {
              user_id: 22,
              display_name: "ADCMain#NA1"
            }
          }
        ]
      },
      userInvitationsSeed: [
        {
          id: 52,
          team_id: 7,
          requested_lane: "Support",
          note: "",
          status: "pending",
          role: "member",
          team_role: "primary",
          invited_by_user_id: 11,
          reviewed_by_user_id: null,
          reviewed_at: null,
          created_at: "2026-01-02T00:00:00.000Z",
          team: {
            name: "Team Beta",
            tag: "BETA"
          }
        }
      ],
      membersByTeam: {
        "1": [{ team_id: 1, user_id: 11, role: "lead", team_role: "primary", display_name: "Lead#NA1", lane: "Mid" }]
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();

    expect(doc.querySelector("#team-join-load-discover")).toBeNull();
    expect(doc.querySelector("#team-join-load-review")).toBeNull();
    expect(doc.querySelector("#team-invite-load")).toBeNull();
    expect(doc.querySelector("#team-invite-user-load")).toBeNull();
    expect(doc.querySelector("#team-join-discover-refresh")).toBeTruthy();
    expect(doc.querySelector("#team-join-review-refresh")).toBeTruthy();
    expect(doc.querySelector("#team-invite-refresh")).toBeTruthy();
    expect(doc.querySelector("#team-invite-user-refresh")).toBeTruthy();
    expect(doc.querySelector("#team-invite-list-meta").textContent).toContain("Last refreshed");
    expect(doc.querySelector("#team-invite-user-meta").textContent).toContain("Last refreshed");
    expect(doc.querySelector("#team-invite-list-meta").textContent).not.toContain("Auto-refresh");
    expect(doc.querySelector("#team-invite-user-meta").textContent).not.toContain("Auto-refresh");
    expect(doc.querySelector("#team-join-discover-meta").textContent).not.toContain("Load discover teams");
    expect(doc.querySelector("#team-invite-user-feedback").textContent).toBe("");
    expect(doc.querySelector("#team-workspace-member").textContent).toContain("Sent Invites");
    expect(doc.querySelector("#team-workspace-member").textContent).toContain("Invites for You");
    expect(doc.querySelector("#team-workspace-manage").textContent).toContain("Teams I Manage");
  });

  test("opening Teams after login auto-refreshes invite sections", async () => {
    const storage = createStorageStub();
    const harness = createFetchHarness({
      loginUser: { id: 11, email: "lead@example.com", role: "member", gameName: "Lead", tagline: "NA1" },
      profile: {
        id: 11,
        email: "lead@example.com",
        role: "member",
        gameName: "Lead",
        tagline: "NA1",
        primaryRole: "Mid",
        secondaryRoles: ["Top"]
      },
      pools: [],
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      memberInvitationsByTeam: {
        "1": []
      },
      userInvitationsSeed: [],
      membersByTeam: {
        "1": [{ team_id: 1, user_id: 11, role: "lead", team_role: "primary", display_name: "Lead#NA1", lane: "Mid" }]
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    doc.querySelector("#auth-email").value = "lead@example.com";
    doc.querySelector("#auth-password").value = "strong-pass-123";
    doc.querySelector("#auth-login").click();
    await flush();

    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();

    expect(doc.querySelector("#team-invite-list-meta").textContent).toContain("Last refreshed");
    expect(doc.querySelector("#team-invite-user-meta").textContent).toContain("Last refreshed");

    const discoverCalls = harness.calls.filter((call) => call.path === "/teams/discover" && call.method === "GET");
    const userInviteCalls = harness.calls.filter((call) => call.path === "/me/member-invitations" && call.method === "GET");
    const sentInviteCalls = harness.calls.filter((call) => call.path === "/teams/1/member-invitations" && call.method === "GET");

    expect(discoverCalls.length).toBeGreaterThan(0);
    expect(userInviteCalls.length).toBeGreaterThan(0);
    expect(sentInviteCalls.length).toBeGreaterThan(0);
  });

  test("teams member workspace shows refresh failures instead of stale not-refreshed copy", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", role: "member", gameName: "Lead", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness({
      loginUser: { id: 11, email: "lead@example.com", role: "member", gameName: "Lead", tagline: "NA1" },
      profile: {
        id: 11,
        email: "lead@example.com",
        role: "member",
        gameName: "Lead",
        tagline: "NA1",
        primaryRole: "Mid",
        secondaryRoles: []
      },
      pools: [],
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      failMemberInvitationTeamIds: [1],
      membersByTeam: {
        "1": [{ team_id: 1, user_id: 11, role: "lead", team_role: "primary", display_name: "Lead#NA1", lane: "Mid" }]
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();

    expect(doc.querySelector("#team-invite-list-meta").textContent).toBe("Refresh failed.");
    expect(doc.querySelector("#team-invite-list-feedback").textContent).toBe("Couldn't refresh sent invites. Try again.");
    expect(doc.querySelector("#team-invite-list-meta").textContent).not.toContain("Not refreshed yet");
    expect(doc.querySelector("#team-invite-user-meta").textContent).toBe("Refresh failed.");
    expect(doc.querySelector("#team-invite-user-feedback").textContent).toBe("Couldn't refresh invites. Try again.");
    expect(doc.querySelector("#team-invite-user-feedback").textContent).not.toContain("An unexpected error occurred");
  });

  test("team update remove-logo action sends JSON remove_logo contract", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      pools: [],
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          logo_data_url: "data:image/png;base64,bW9jazE=",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [{ team_id: 1, user_id: 11, role: "lead", team_role: "primary", email: "lead@example.com" }]
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();

    doc.querySelector("#team-admin-open-edit").click();
    doc.querySelector("#team-admin-rename-remove-logo").checked = true;
    doc.querySelector("#team-admin-rename-remove-logo").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    doc.querySelector("#team-admin-rename").click();
    await flush();
    await flush();

    const renameCall = harness.calls.find((call) => call.path === "/teams/1" && call.method === "PATCH");
    expect(renameCall).toBeTruthy();
    expect(renameCall.isFormData).toBe(false);
    expect(renameCall.body.remove_logo).toBe(true);
    expect(renameCall.body.logo).toBeUndefined();
  });

  test("team-context active team persists across reload via API", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      pools: [],
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          logo_data_url: "data:image/png;base64,bW9jazE=",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [{ team_id: 1, user_id: 11, role: "lead", team_role: "primary", email: "lead@example.com" }]
      },
      teamContext: {
        activeTeamId: null
      }
    });

    const firstBoot = await bootApp({ fetchImpl: harness.impl, storage });
    const firstDoc = firstBoot.dom.window.document;
    firstDoc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();
    firstDoc.querySelector("#builder-active-team").value = "1";
    firstDoc.querySelector("#builder-active-team").dispatchEvent(
      new firstBoot.dom.window.Event("change", { bubbles: true })
    );
    await flush();
    await flush();

    const saveCall = harness.calls.find((call) => call.path === "/me/team-context" && call.method === "PUT");
    expect(saveCall).toBeTruthy();
    expect(saveCall.body.activeTeamId).toBe(1);

    const secondStorage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const secondBoot = await bootApp({ fetchImpl: harness.impl, storage: secondStorage });
    const secondDoc = secondBoot.dom.window.document;
    await flush();

    expect(secondDoc.querySelector("#builder-active-team").value).toBe("1");
  });

  test("composer can save and reload a Draft Setup", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          logo_data_url: "data:image/png;base64,bW9jazE=",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [{ team_id: 1, user_id: 11, role: "lead", team_role: "primary", email: "lead@example.com" }]
      }
    });

    const { dom, state } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    doc.querySelector("#builder-active-team").value = "1";
    doc.querySelector("#builder-active-team").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await flush();
    await flush();

    expect(doc.querySelector("#builder-custom-scopes-enabled").checked).toBe(false);
    expect(doc.querySelector("#builder-scope-controls").hidden).toBe(true);
    expect(doc.querySelector("#builder-draft-setup-save").textContent).toBe("Save Draft");
    expect(doc.querySelector("#builder-draft-setup-load").textContent).toBe("Load Draft");
    expect(doc.querySelector("#builder-clear-sticky").textContent).toBe("Clear Draft");

    doc.querySelector("#builder-draft-setup-save").click();
    await flush();
    await flush();
    expect(doc.querySelector("#builder-save-draft-modal").hidden).toBe(false);
    doc.querySelector("#builder-save-draft-name").value = "Pocket Setup";
    doc.querySelector("#builder-save-draft-name").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    doc.querySelector("#builder-save-draft-description").value = "Primary engage version";
    doc.querySelector("#builder-save-draft-description").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    doc.querySelector("#builder-save-draft-confirm").click();
    await flush();
    await flush();

    const createCall = harness.calls.find((call) => call.path === "/me/draft-setups" && call.method === "POST");
    expect(createCall).toBeTruthy();
    expect(createCall.body.name).toBe("Pocket Setup");
    expect(createCall.body.description).toBe("Primary engage version");
    expect(createCall.body.state_json.builder.teamId).toBe("1");
    expect(createCall.body.state_json.builder.useCustomScopes).toBe(false);

    const customScopes = doc.querySelector("#builder-custom-scopes-enabled");
    customScopes.checked = true;
    customScopes.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await flush();
    await flush();
    expect(customScopes.checked).toBe(true);
    expect(doc.querySelector("#builder-scope-controls").hidden).toBe(false);

    doc.querySelector("#builder-generate").click();
    await flush();
    await flush();
    expect(state.builder.stage).toBe("inspect");

    doc.querySelector("#builder-draft-setup-load").click();
    await flush();
    await flush();
    expect(doc.querySelector("#builder-load-draft-modal").hidden).toBe(false);
    expect(doc.querySelector("#builder-load-draft-list").textContent).toContain("Primary engage version");

    const loadButton = Array.from(doc.querySelectorAll("#builder-load-draft-list button"))
      .find((button) => button.textContent.trim() === "Load");
    expect(loadButton).toBeTruthy();
    loadButton.click();
    await flush();
    doc.querySelector("#confirmation-confirm").click();
    await flush();
    await flush();

    expect(doc.querySelector("#builder-active-team").value).toBe("1");
    expect(doc.querySelector("#builder-custom-scopes-enabled").checked).toBe(false);
    expect(doc.querySelector("#builder-scope-controls").hidden).toBe(true);
    expect(state.builder.stage).toBe("setup");
    expect(doc.querySelector("#builder-generate").textContent).toBe("Start Draft");
    expect(doc.querySelector("#draft-results-area").hidden).toBe(true);
  });

  test("profile display team selection persists across reload via API", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      profile: {
        id: 11,
        email: "lead@example.com",
        gameName: "LeadPlayer",
        tagline: "NA1",
        displayTeamId: null,
        avatarChampionId: null,
        primaryRole: "Mid",
        secondaryRoles: ["Top"]
      },
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          logo_data_url: "data:image/png;base64,bW9jazE=",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        },
        {
          id: 2,
          name: "Team Bravo",
          tag: "BRAVO",
          logo_data_url: null,
          created_by: 22,
          membership_role: "member",
          membership_team_role: "substitute",
          created_at: "2026-01-02T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [{ team_id: 1, user_id: 11, role: "lead", team_role: "primary", email: "lead@example.com" }],
        "2": [{ team_id: 2, user_id: 11, role: "member", team_role: "substitute", email: "lead@example.com" }]
      }
    });

    const firstBoot = await bootApp({ fetchImpl: harness.impl, storage });
    const firstDoc = firstBoot.dom.window.document;
    openProfile(firstDoc);
    await flush();

    firstDoc.querySelector("[data-setting='display-team'] .profile-setting-row").click();
    await flush();
    firstDoc.querySelector("#profile-display-team-select").value = "2";
    firstDoc.querySelector("#profile-save-display-team").click();
    await flush();
    await flush();

    const saveCall = harness.calls.find((call) => call.path === "/me/profile/display-team" && call.method === "PUT");
    expect(saveCall).toBeTruthy();
    expect(saveCall.body.displayTeamId).toBe(2);
    expect(firstDoc.querySelector("#profile-team-display").textContent).toContain("Team Bravo");

    const secondStorage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const secondBoot = await bootApp({ fetchImpl: harness.impl, storage: secondStorage });
    const secondDoc = secondBoot.dom.window.document;
    openProfile(secondDoc);
    await flush();

    expect(secondDoc.querySelector("#profile-team-display").textContent).toContain("Team Bravo");
  });

  test("profile avatar selection persists via API for authenticated users", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      profile: {
        id: 11,
        email: "lead@example.com",
        gameName: "LeadPlayer",
        tagline: "NA1",
        displayTeamId: null,
        avatarChampionId: null,
        primaryRole: "Mid",
        secondaryRoles: ["Top"]
      }
    });

    const firstBoot = await bootApp({ fetchImpl: harness.impl, storage });
    const firstDoc = firstBoot.dom.window.document;
    openProfile(firstDoc);
    await flush();

    firstDoc.querySelector("#profile-avatar-display").click();
    await flush();
    const braumOption = Array.from(firstDoc.querySelectorAll("#avatar-modal-grid .avatar-option"))
      .find((button) => button.textContent.includes("Braum"));
    expect(braumOption).toBeTruthy();
    braumOption.click();
    firstDoc.querySelector("#avatar-modal-save").click();
    await flush();
    await flush();

    const saveCall = harness.calls.find((call) => call.path === "/me/profile/avatar" && call.method === "PUT");
    expect(saveCall).toBeTruthy();
    expect(Number.isInteger(saveCall.body.avatarChampionId)).toBe(true);
    expect(saveCall.body.avatarChampionId).toBeGreaterThan(0);
    expect(firstDoc.querySelector("#profile-avatar-display img")?.getAttribute("alt")).toBe("Braum");

    const secondStorage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const secondBoot = await bootApp({ fetchImpl: harness.impl, storage: secondStorage });
    const secondDoc = secondBoot.dom.window.document;
    openProfile(secondDoc);
    await flush();

    expect(secondDoc.querySelector("#profile-avatar-display img")?.getAttribute("alt")).toBe("Braum");
  });

  test("selected team shows signed-in user name on their primary role slot label", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "adc@example.com", gameName: "ADCMain", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness({
      profile: {
        id: 11,
        email: "adc@example.com",
        gameName: "ADCMain",
        tagline: "NA1",
        primaryRole: "ADC",
        secondaryRoles: ["Support"]
      },
      teams: [
        {
          id: 1,
          name: "Triple Threat",
          tag: "TTT",
          logo_data_url: "data:image/png;base64,bW9jazE=",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [{
          team_id: 1,
          user_id: 11,
          role: "lead",
          team_role: "primary",
          lane: "ADC",
          email: "adc@example.com",
          game_name: "ADCMain",
          tagline: "NA1",
          display_name: "ADCMain#NA1"
        }]
      },
      teamContext: {
        activeTeamId: 1
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    await flush();

    const adcSlotLabel = doc.querySelector("#team-config-pool-grid [data-slot='ADC'] .pool-snapshot-header strong");
    expect(adcSlotLabel.textContent).toContain("ADCMain");
  });

  test("slot label primary-role name uses roster fallback when team summary omits membership team role", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "adc@example.com", gameName: "ADCMain", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness({
      profile: {
        id: 11,
        email: "adc@example.com",
        gameName: "ADCMain",
        tagline: "NA1",
        primaryRole: "ADC",
        secondaryRoles: ["Support"]
      },
      teams: [
        {
          id: 1,
          name: "Triple Threat",
          tag: "TTT",
          logo_data_url: null,
          created_by: 11,
          membership_role: "lead",
          membership_team_role: null,
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [{
          team_id: 1,
          user_id: 11,
          role: "lead",
          team_role: "primary",
          lane: "ADC",
          email: "adc@example.com",
          game_name: "ADCMain",
          tagline: "NA1",
          display_name: "ADCMain#NA1"
        }]
      },
      teamContext: {
        activeTeamId: 1
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    await flush();

    const adcSlotLabel = doc.querySelector("#team-config-pool-grid [data-slot='ADC'] .pool-snapshot-header strong");
    expect(adcSlotLabel.textContent).toContain("ADCMain");
  });

  test("profile roles save and champion editing stays scoped to one role", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      pools: [
        {
          id: 1,
          user_id: 11,
          name: "Main",
          champion_ids: [1, 2],
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      teams: [],
      membersByTeam: {}
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    openProfile(doc);
    await flush();

    expect(doc.querySelector("#profile-primary-role").value).toBe("Mid");

    doc.querySelector("#profile-primary-role").value = "Support";
    doc.querySelector("#profile-primary-role").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    doc.querySelector("#profile-save-roles").click();
    await flush();
    await flush();

    const saveProfileCall = harness.calls.find((call) => call.path === "/me/profile" && call.method === "PUT");
    expect(saveProfileCall).toBeTruthy();
    expect(saveProfileCall.body.primaryRole).toBe("Support");
    expect(saveProfileCall.body.secondaryRoles).not.toContain("Support");

    openMyChampions(doc);
    await flush();
    expect(doc.querySelector("#player-config-team").value).toBe("role:Support");

    doc.querySelector("#player-config-team").value = "role:Top";
    doc.querySelector("#player-config-team").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(doc.querySelector("#my-champions-card-grid").textContent).toContain("No champions selected for Top");
  });

  test("champion pool changes save through the My Champions selector modal", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      pools: [
        {
          id: 1,
          user_id: 11,
          name: "Mid",
          champion_ids: [1],
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      teams: [],
      membersByTeam: {}
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    openMyChampions(doc);
    await flush();

    doc.querySelector("#my-champions-add-btn").click();
    await flush();

    const selectedAhri = Array.from(
      doc.querySelectorAll("#champion-selector-selected .champion-selector-option")
    ).find((button) => button.textContent.includes("Ahri"));
    expect(selectedAhri).toBeTruthy();
    selectedAhri.click();
    await flush();

    doc.querySelector("#champion-selector-done").click();
    await flush();
    await flush();

    const syncedCalls = harness.calls.filter(
      (call) => /^\/me\/pools\/\d+\/champions/.test(call.path) && ["POST", "DELETE"].includes(call.method)
    );
    expect(syncedCalls.length).toBeGreaterThan(0);
    expect(doc.querySelector("#player-config-feedback").textContent).toContain("Saved pool updates for Mid");
  });

  test("champion familiarity grade changes save immediately from My Champions cards", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      pools: [
        {
          id: 1,
          user_id: 11,
          name: "Mid",
          champion_ids: [1],
          champion_familiarity: { 1: 3 },
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      teams: [],
      membersByTeam: {}
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    openMyChampions(doc);
    await flush();

    const familiaritySelect = doc.querySelector("#my-champions-card-grid .comfort-select");
    expect(familiaritySelect).toBeTruthy();
    expect(familiaritySelect.value).toBe("B");

    familiaritySelect.value = "S";
    familiaritySelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await flush();
    await flush();

    const familiaritySyncCalls = harness.calls.filter(
      (call) => /^\/me\/pools\/\d+\/champions\/\d+\/familiarity$/.test(call.path) && call.method === "PUT"
    );
    expect(familiaritySyncCalls).toHaveLength(1);
    expect(familiaritySyncCalls[0].body).toEqual({ familiarity: 1 });
    expect(doc.querySelector("#player-config-feedback").textContent).toContain("Saved pool updates for Mid");
  });

  test("champion selector save works when champions endpoint returns string ids", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const harness = createFetchHarness({
      championIdsAsStrings: true,
      pools: [
        {
          id: 1,
          user_id: 11,
          name: "Mid",
          champion_ids: [],
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      teams: [],
      membersByTeam: {}
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    openMyChampions(doc);
    await flush();

    doc.querySelector("#my-champions-add-btn").click();
    await flush();

    const availableAhri = Array.from(
      doc.querySelectorAll("#champion-selector-available .champion-selector-option")
    ).find((button) => button.textContent.includes("Ahri"));
    expect(availableAhri).toBeTruthy();
    availableAhri.click();
    await flush();

    doc.querySelector("#champion-selector-done").click();
    await flush();
    await flush();

    const addChampionCall = harness.calls.find(
      (call) => /^\/me\/pools\/\d+\/champions$/.test(call.path) && call.method === "POST"
    );
    expect(addChampionCall).toBeTruthy();
    expect(addChampionCall.body.champion_id).toBe(1);
    expect(doc.querySelector("#player-config-feedback").textContent).toContain("Saved pool updates for Mid");
  });

  test("team admin controls are disabled for non-lead members and enabled for leads or admins", async () => {
    const memberStorage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "member-token",
        user: { id: 22, email: "member@example.com" }
      })
    });
    const memberHarness = createFetchHarness({
      pools: [],
      profile: {
        id: 22,
        email: "member@example.com",
        role: "member",
        gameName: "Member",
        tagline: "NA1",
        primaryRole: "ADC",
        secondaryRoles: ["Support"]
      },
      loginUser: {
        id: 22,
        email: "member@example.com",
        role: "member",
        gameName: "Member",
        tagline: "NA1",
        primaryRole: "ADC",
        secondaryRoles: ["Support"]
      },
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          logo_data_url: "data:image/png;base64,bW9jazE=",
          created_by: 11,
          membership_role: "member",
          membership_team_role: "substitute",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [
          {
            team_id: 1,
            user_id: 11,
            role: "lead",
            team_role: "primary",
            email: "lead@example.com",
            display_name: "Lead#NA1",
            lane: "Top"
          },
          {
            team_id: 1,
            user_id: 22,
            role: "member",
            team_role: "substitute",
            email: "member@example.com",
            display_name: "Member#NA1",
            lane: "ADC"
          }
        ]
      }
    });

    let app = await bootApp({ fetchImpl: memberHarness.impl, storage: memberStorage });
    let doc = app.dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();

    expect(doc.querySelector("#team-admin-open-edit").hidden).toBe(true);
    expect(doc.querySelector("#team-admin-rename").disabled).toBe(true);
    expect(doc.querySelector("#team-admin-add-member").disabled).toBe(true);
    expect(doc.querySelector("#team-admin-members").textContent).toContain("Lead#NA1");
    expect(doc.querySelector("#team-admin-members").textContent).toContain("Member#NA1");
    expect(doc.querySelector("#team-admin-members").textContent).not.toContain("member@example.com");
    expect(doc.querySelector("#team-admin-members").textContent).not.toContain("lead@example.com");
    expect(doc.querySelector("#team-admin-members").textContent).toContain("Top");
    expect(doc.querySelector("#team-admin-members").textContent).toContain("Jungle");
    expect(doc.querySelector("#team-admin-members").textContent).toContain("Mid");
    expect(doc.querySelector("#team-admin-members").textContent).toContain("ADC");
    expect(doc.querySelector("#team-admin-members").textContent).toContain("Support");
    expect(doc.querySelectorAll("#team-admin-members .roster-slot-empty")).toHaveLength(4);

    const leadStorage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "lead-token",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const leadHarness = createFetchHarness({
      pools: [],
      profile: {
        id: 11,
        email: "lead@example.com",
        role: "member",
        gameName: "Lead",
        tagline: "NA1",
        primaryRole: "Top",
        secondaryRoles: ["Mid"]
      },
      loginUser: {
        id: 11,
        email: "lead@example.com",
        role: "member",
        gameName: "Lead",
        tagline: "NA1",
        primaryRole: "Top",
        secondaryRoles: ["Mid"]
      },
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          logo_data_url: "data:image/png;base64,bW9jazE=",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [
          {
            team_id: 1,
            user_id: 11,
            role: "lead",
            team_role: "primary",
            email: "lead@example.com",
            display_name: "Lead#NA1",
            lane: "Top"
          },
          {
            team_id: 1,
            user_id: 22,
            role: "member",
            team_role: "substitute",
            email: "member@example.com",
            display_name: "Member#NA1",
            lane: "ADC"
          }
        ]
      }
    });

    app = await bootApp({ fetchImpl: leadHarness.impl, storage: leadStorage });
    doc = app.dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();

    expect(doc.querySelector("#team-admin-open-edit").hidden).toBe(false);
    expect(doc.querySelector("#team-admin-rename").disabled).toBe(false);
    expect(doc.querySelector("#team-admin-add-member").disabled).toBe(false);

    const adminStorage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "admin-token",
        user: { id: 11, email: "jirving0311@gmail.com", role: "admin" }
      })
    });
    const adminHarness = createFetchHarness({
      pools: [],
      profile: {
        id: 11,
        email: "jirving0311@gmail.com",
        role: "admin",
        gameName: "OwnerAdmin",
        tagline: "NA1",
        primaryRole: "Mid",
        secondaryRoles: ["Top"]
      },
      loginUser: {
        id: 11,
        email: "jirving0311@gmail.com",
        role: "admin",
        gameName: "OwnerAdmin",
        tagline: "NA1",
        primaryRole: "Mid",
        secondaryRoles: ["Top"]
      },
      teams: [
        {
          id: 1,
          name: "Team Alpha",
          tag: "ALPHA",
          logo_data_url: "data:image/png;base64,bW9jazE=",
          created_by: 11,
          membership_role: "member",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [
          {
            team_id: 1,
            user_id: 11,
            role: "member",
            team_role: "primary",
            email: "jirving0311@gmail.com",
            display_name: "OwnerAdmin#NA1",
            lane: "Mid"
          },
          {
            team_id: 1,
            user_id: 22,
            role: "lead",
            team_role: "substitute",
            email: "lead@example.com",
            display_name: "Lead#NA1",
            lane: "Top"
          }
        ]
      }
    });

    app = await bootApp({ fetchImpl: adminHarness.impl, storage: adminStorage });
    doc = app.dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();

    expect(doc.querySelector("#team-admin-open-edit").hidden).toBe(false);
    expect(doc.querySelector("#team-admin-rename").disabled).toBe(false);
    expect(doc.querySelector("#team-admin-add-member").disabled).toBe(false);
  });
});
