import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { BOOLEAN_TAGS } from "../../src/index.js";

const htmlFixture = readFileSync(resolve("public/index.html"), "utf8");

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
  return {
    primaryDamageType,
    effectiveness: {
      early,
      mid,
      late
    }
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
  failCreatePoolWith401 = false,
  championIdsAsStrings = false,
  loginUser = null,
  profile = null,
  teamContext = null
} = {}) {
  const calls = [];
  let nextPoolId = pools.length + 1;
  const tags = [
    { id: 1, name: "engage", definition: "Helps your comp start fights." },
    { id: 2, name: "frontline", definition: "Adds durable front line presence." },
    { id: 3, name: "burst", definition: "Adds fast pick damage windows." }
  ];
  let nextTagId = 4;
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
  let persistedTeamContext = {
    defaultTeamId: null,
    activeTeamId: null,
    ...(teamContext && typeof teamContext === "object" ? teamContext : {})
  };  let requirementDefinitions = [
    {
      id: 1,
      name: "Frontline Anchor",
      definition: "At least one frontline tag.",
      rules: [
        {
          expr: { tag: "Frontline" },
          minCount: 1
        }
      ]
    }
  ];
  let nextRequirementDefinitionId = 2;
  let compositions = [
    {
      id: 1,
      name: "Standard Comp",
      description: "Baseline setup",
      requirement_ids: [1],
      is_active: true
    }
  ];
  let nextCompositionId = 2;
  let joinRequestsByTeam = Object.fromEntries(
    Object.entries(teamJoinRequestsByTeam).map(([teamId, requests]) => [String(teamId), [...(requests ?? [])]])
  );
  const resolvedLoginUser = loginUser ?? {
    id: 11,
    email: "user@example.com",
    role: "admin",
    gameName: "LoginUser",
    tagline: "NA1",
    primaryRole: "Mid",
    secondaryRoles: ["Top"]
  };
  const resolvedProfile = profile ?? {
    id: 11,
    email: "user@example.com",
    role: "admin",
    gameName: "LoginUser",
    tagline: "NA1",
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
  const adminUsers = [
    {
      id: 11,
      email: resolvedLoginUser.email,
      role: typeof resolvedLoginUser.role === "string" ? resolvedLoginUser.role : "admin",
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
      pool.champion_familiarity[key] = Number.isInteger(existing) && existing >= 1 && existing <= 6 ? existing : 3;
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

    calls.push({ path, method, headers, body, isFormData });

    if (path === "/champions" && method === "GET") {
      const toChampionId = (value) => (championIdsAsStrings ? String(value) : value);
      return createJsonResponse({
        champions: [
          {
            id: toChampionId(1),
            name: "Ahri",
            role: "Mid",
            tagIds: [...(globalChampionTagIds.get(1) ?? [])],
            reviewed: championReviewedById.get(1) === true,
            metadata: championMetadataById.get(1)
          },
          {
            id: toChampionId(2),
            name: "Ashe",
            role: "ADC",
            tagIds: [...(globalChampionTagIds.get(2) ?? [])],
            reviewed: championReviewedById.get(2) === true,
            metadata: championMetadataById.get(2)
          },
          {
            id: toChampionId(3),
            name: "Braum",
            role: "Support",
            tagIds: [...(globalChampionTagIds.get(3) ?? [])],
            reviewed: championReviewedById.get(3) === true,
            metadata: championMetadataById.get(3)
          }
        ]
      });
    }

    if (path === "/tags" && method === "GET") {
      return createJsonResponse({
        tags: [...tags]
      });
    }

    if (path === "/tags" && method === "POST") {
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const definition = typeof body?.definition === "string" ? body.definition.trim() : "";
      if (!name || !definition) {
        return createJsonResponse({ error: { code: "BAD_REQUEST", message: "Expected name/definition." } }, 400);
      }
      const duplicate = tags.some((tag) => tag.name === name);
      if (duplicate) {
        return createJsonResponse({ error: { code: "CONFLICT", message: "Tag name already exists." } }, 409);
      }
      const created = { id: nextTagId, name, definition };
      nextTagId += 1;
      tags.push(created);
      return createJsonResponse({ tag: created }, 201);
    }

    const tagMutationMatch = path.match(/^\/tags\/(\d+)$/);
    if (tagMutationMatch && method === "PUT") {
      const tagId = Number(tagMutationMatch[1]);
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const definition = typeof body?.definition === "string" ? body.definition.trim() : "";
      const existing = tags.find((tag) => tag.id === tagId) ?? null;
      if (!existing) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Tag not found." } }, 404);
      }
      const duplicate = tags.some((tag) => tag.id !== tagId && tag.name === name);
      if (duplicate) {
        return createJsonResponse({ error: { code: "CONFLICT", message: "Tag name already exists." } }, 409);
      }
      existing.name = name;
      existing.definition = definition;
      return createJsonResponse({ tag: existing });
    }

    if (tagMutationMatch && method === "DELETE") {
      const tagId = Number(tagMutationMatch[1]);
      for (const scopedTagIds of globalChampionTagIds.values()) {
        if (scopedTagIds.has(tagId)) {
          return createJsonResponse(
            { error: { code: "CONFLICT", message: "Cannot delete a tag that is assigned to champions." } },
            409
          );
        }
      }
      const index = tags.findIndex((tag) => tag.id === tagId);
      if (index < 0) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Tag not found." } }, 404);
      }
      tags.splice(index, 1);
      return createJsonResponse({}, 204);
    }

    const championTagsMatch = path.match(/^\/champions\/(\d+)\/tags$/);
    if (championTagsMatch && method === "GET") {
      const championId = Number(championTagsMatch[1]);
      return createJsonResponse({
        scope: "all",
        team_id: null,
        tag_ids: [...(globalChampionTagIds.get(championId) ?? [])].sort((left, right) => left - right),
        reviewed: championReviewedById.get(championId) === true
      });
    }

    if (championTagsMatch && method === "PUT") {
      const championId = Number(championTagsMatch[1]);
      const nextTagIds = Array.isArray(body?.tag_ids)
        ? [...new Set(body.tag_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
            .sort((left, right) => left - right)
        : [];
      if (typeof body?.reviewed === "boolean") {
        championReviewedById.set(championId, body.reviewed);
      }
      globalChampionTagIds.set(championId, new Set(nextTagIds));
      return createJsonResponse({
        scope: "all",
        team_id: null,
        tag_ids: nextTagIds,
        reviewed: championReviewedById.get(championId) === true
      });
    }

    const championMetadataMatch = path.match(/^\/champions\/(\d+)\/metadata$/);
    if (championMetadataMatch && method === "PUT") {
      const championId = Number(championMetadataMatch[1]);
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
              effectiveness: {
                early: profile?.effectiveness?.early ?? "neutral",
                mid: profile?.effectiveness?.mid ?? "neutral",
                late: profile?.effectiveness?.late ?? "neutral"
              }
            }
          ])
        ),
        damageType: nextDamageType
      };
      championMetadataById.set(championId, nextMetadata);
      return createJsonResponse({
        champion: {
          id: championId,
          metadata: nextMetadata,
          tag_ids: [...(globalChampionTagIds.get(championId) ?? [])].sort((left, right) => left - right)
        }
      });
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
          primaryRole: "Mid",
          secondaryRoles: []
        }
      }, 201);
    }

    if (path === "/me/profile" && method === "GET") {
      return createJsonResponse({
        profile: resolvedProfile
      });
    }

    if (path === "/me/profile" && method === "PUT") {
      return createJsonResponse({
        profile: {
          id: 11,
          email: "user@example.com",
          gameName: "LoginUser",
          tagline: "NA1",
          primaryRole: body.primaryRole,
          secondaryRoles: Array.isArray(body.secondaryRoles) ? body.secondaryRoles : []
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
        defaultTeamId: body.defaultTeamId ?? null,
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
        authorization: {
          global_roles: [
            { id: "member", label: "member", description: "Default authenticated role." },
            { id: "global", label: "global", description: "Global editor role." },
            { id: "admin", label: "admin", description: "Administrator role." }
          ],
          team_membership_roles: [
            { id: "member", label: "member", description: "Standard team membership role." },
            { id: "lead", label: "lead", description: "Team management role." }
          ],
          team_roster_roles: [
            { id: "primary", label: "primary", description: "Primary roster designation." },
            { id: "substitute", label: "substitute", description: "Substitute roster designation." }
          ],
          permissions: [
            { id: "admin.users.read", description: "Read admin users directory." },
            { id: "admin.users.write", description: "Update user role and Riot ID correction." },
            { id: "admin.users.delete", description: "Delete non-owner user accounts." },
            { id: "champion_tags.write.global", description: "Edit global champion tags." }
          ],
          assignments: {
            global_roles: {
              member: ["admin.users.read"],
              global: ["admin.users.read", "champion_tags.write.global"],
              admin: ["admin.users.read", "admin.users.write", "admin.users.delete", "champion_tags.write.global"]
            },
            team_membership_roles: {
              member: [],
              lead: ["champion_tags.write.global"]
            }
          }
        }
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
      if (String(targetUser.email ?? "").trim().toLowerCase() === "jirving0311@gmail.com") {
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
          default_team: null,
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
      return createJsonResponse({
        requirements: [...requirementDefinitions]
      });
    }

    if (path === "/requirements" && method === "POST") {
      const isAdmin = String(resolvedLoginUser.role ?? "").trim().toLowerCase() === "admin";
      if (!isAdmin) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "Only admins can create requirements." } },
          403
        );
      }
      const created = {
        id: nextRequirementDefinitionId,
        name: body?.name ?? "Untitled Requirement",
        definition: body?.definition ?? "",
        rules: Array.isArray(body?.rules) ? body.rules : []
      };
      nextRequirementDefinitionId += 1;
      requirementDefinitions.push(created);
      return createJsonResponse({ requirement: created }, 201);
    }

    const requirementDefinitionMatch = path.match(/^\/requirements\/(\d+)$/);
    if (requirementDefinitionMatch && method === "PUT") {
      const isAdmin = String(resolvedLoginUser.role ?? "").trim().toLowerCase() === "admin";
      if (!isAdmin) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "Only admins can update requirements." } },
          403
        );
      }
      const requirementId = Number(requirementDefinitionMatch[1]);
      const requirement = requirementDefinitions.find((candidate) => candidate.id === requirementId) ?? null;
      if (!requirement) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Requirement not found." } }, 404);
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
      const isAdmin = String(resolvedLoginUser.role ?? "").trim().toLowerCase() === "admin";
      if (!isAdmin) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "Only admins can delete requirements." } },
          403
        );
      }
      const requirementId = Number(requirementDefinitionMatch[1]);
      requirementDefinitions = requirementDefinitions.filter((candidate) => candidate.id !== requirementId);
      compositions = compositions.map((composition) => ({
        ...composition,
        requirement_ids: composition.requirement_ids.filter((id) => id !== requirementId)
      }));
      return createJsonResponse({}, 204);
    }

    if (path === "/compositions" && method === "GET") {
      const active = compositions.find((composition) => composition.is_active) ?? null;
      return createJsonResponse({
        compositions: [...compositions],
        active_composition_id: active ? active.id : null
      });
    }

    if (path === "/compositions" && method === "POST") {
      const isAdmin = String(resolvedLoginUser.role ?? "").trim().toLowerCase() === "admin";
      if (!isAdmin) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "Only admins can create compositions." } },
          403
        );
      }
      if (body?.is_active === true) {
        compositions = compositions.map((composition) => ({ ...composition, is_active: false }));
      }
      const created = {
        id: nextCompositionId,
        name: body?.name ?? "Untitled Composition",
        description: body?.description ?? "",
        requirement_ids: Array.isArray(body?.requirement_ids) ? body.requirement_ids : [],
        is_active: body?.is_active === true
      };
      nextCompositionId += 1;
      compositions.push(created);
      return createJsonResponse({ composition: created }, 201);
    }

    if (path === "/compositions/active" && method === "GET") {
      const active = compositions.find((composition) => composition.is_active) ?? null;
      const requirements = active
        ? active.requirement_ids
            .map((requirementId) => requirementDefinitions.find((candidate) => candidate.id === requirementId) ?? null)
            .filter(Boolean)
        : [];
      return createJsonResponse({ composition: active, requirements });
    }

    const compositionMatch = path.match(/^\/compositions\/(\d+)$/);
    if (compositionMatch && method === "PUT") {
      const isAdmin = String(resolvedLoginUser.role ?? "").trim().toLowerCase() === "admin";
      if (!isAdmin) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "Only admins can update compositions." } },
          403
        );
      }
      const compositionId = Number(compositionMatch[1]);
      const composition = compositions.find((candidate) => candidate.id === compositionId) ?? null;
      if (!composition) {
        return createJsonResponse({ error: { code: "NOT_FOUND", message: "Composition not found." } }, 404);
      }
      if (body?.is_active === true) {
        compositions = compositions.map((candidate) =>
          candidate.id === compositionId ? candidate : { ...candidate, is_active: false }
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
      const isAdmin = String(resolvedLoginUser.role ?? "").trim().toLowerCase() === "admin";
      if (!isAdmin) {
        return createJsonResponse(
          { error: { code: "FORBIDDEN", message: "Only admins can delete compositions." } },
          403
        );
      }
      const compositionId = Number(compositionMatch[1]);
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
      const normalizedFamiliarity = Number.isInteger(familiarity) && familiarity >= 1 && familiarity <= 6 ? familiarity : 3;
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
      if (!Number.isInteger(familiarity) || familiarity < 1 || familiarity > 6) {
        return createJsonResponse(
          { error: { code: "BAD_REQUEST", message: "Expected 'familiarity' to be between 1 and 6." } },
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
  await initApp({
    document: dom.window.document,
    window: dom.window,
    fetchImpl,
    storage,
    matchMediaImpl: createMatchMedia(),
    apiBaseUrl
  });

  return { dom };
}

describe("auth + pools + team management", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("unauthenticated users only see auth gate and not app screens", async () => {
    const storage = createStorageStub();
    const harness = createFetchHarness();
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    expect(doc.querySelector("#auth-gate").hidden).toBe(false);
    expect(doc.querySelector("#app-shell").hidden).toBe(true);
    expect(doc.querySelector("#auth-login").hidden).toBe(false);
    expect(doc.querySelector("#auth-register").hidden).toBe(false);
    expect(doc.querySelector("#auth-email-group").hidden).toBe(false);
    expect(doc.querySelector("#auth-game-name-group").hidden).toBe(true);
    expect(doc.querySelector("#auth-tagline-group").hidden).toBe(true);
    expect(doc.querySelector("#auth-registration-help").hidden).toBe(true);

    const reportIssueLink = doc.querySelector("#report-issue-link");
    expect(reportIssueLink).toBeTruthy();
    expect(reportIssueLink.getAttribute("href")).toContain("/issues/new/choose");

    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    expect(doc.querySelector("#auth-feedback").textContent).toContain("Login required");
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
    expect(doc.querySelector("#auth-gate").hidden).toBe(true);
    expect(doc.querySelector("#app-shell").hidden).toBe(false);
    expect(doc.querySelector("#auth-login").hidden).toBe(true);
    expect(doc.querySelector("#auth-register").hidden).toBe(true);
    expect(doc.querySelector("#auth-email-group").hidden).toBe(true);
    expect(doc.querySelector("#auth-password-group").hidden).toBe(true);

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

    doc.querySelector("#auth-email").value = "user@example.com";
    doc.querySelector("#auth-password").value = "strong-pass-123";
    doc.querySelector("#auth-register").click();
    expect(doc.querySelector("#auth-game-name-group").hidden).toBe(false);
    expect(doc.querySelector("#auth-tagline-group").hidden).toBe(false);
    expect(doc.querySelector("#auth-registration-help").hidden).toBe(false);

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
        user: { id: 11, email: "lead@example.com", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness();
    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;

    doc.querySelector(".side-menu-link[data-tab='explorer']").click();
    await flush();

    expect(doc.querySelector("#champion-tag-catalog-list").textContent).toContain("engage");

    const editButton = doc.querySelector("#explorer-results .champ-card-actions button");
    expect(editButton).toBeTruthy();
    editButton.click();
    await flush();

    expect(doc.querySelector("#champion-tag-editor").hidden).toBe(false);
    const engageCheckbox = doc.querySelector("#champion-tag-editor-tags input[type='checkbox'][value='1']");
    expect(engageCheckbox).toBeTruthy();
    expect(engageCheckbox.checked).toBe(true);
    engageCheckbox.checked = true;
    engageCheckbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    doc.querySelector("#champion-tag-editor-save").click();
    await flush();

    const saveCall = harness.calls.find(
      (call) => /^\/champions\/\d+\/tags$/.test(call.path) && call.method === "PUT"
    );
    expect(saveCall).toBeTruthy();
    expect(saveCall.body.scope).toBe("all");
    expect(Array.isArray(saveCall.body.tag_ids)).toBe(true);
    expect(doc.querySelector("#champion-tag-editor-feedback").textContent).toContain("saved");
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

    doc.querySelector(".side-menu-link[data-tab='explorer']").click();
    await flush();

    doc.querySelector("#explorer-results .champ-card-actions button").click();
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
    expect(doc.querySelector("#explorer-results .champ-card").textContent).toContain("Review: Human reviewed");
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

    doc.querySelector(".side-menu-link[data-tab='explorer']").click();
    await flush();

    const editButton = doc.querySelector("#explorer-results .champ-card-actions button");
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

    const engageCheckbox = doc.querySelector("#champion-tag-editor-tags input[type='checkbox'][value='1']");
    expect(engageCheckbox).toBeTruthy();
    expect(engageCheckbox.checked).toBe(true);
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

    doc.querySelector(".side-menu-link[data-tab='explorer']").click();
    await flush();

    const editButton = doc.querySelector("#explorer-results .champ-card-actions button");
    expect(editButton).toBeTruthy();
    editButton.click();
    await flush();

    const engageCheckbox = doc.querySelector("#champion-tag-editor-tags input[type='checkbox'][value='1']");
    expect(engageCheckbox).toBeTruthy();
    expect(engageCheckbox.checked).toBe(true);

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

    doc.querySelector(".side-menu-link[data-tab='explorer']").click();
    await flush();

    const editButton = doc.querySelector("#explorer-results .champ-card-actions button");
    expect(editButton).toBeTruthy();
    editButton.click();
    await flush();

    const engageCheckbox = doc.querySelector("#champion-tag-editor-tags input[type='checkbox'][value='1']");
    expect(engageCheckbox).toBeTruthy();
    expect(engageCheckbox.checked).toBe(true);
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

    doc.querySelector(".side-menu-link[data-tab='explorer']").click();
    await flush();

    const editButton = doc.querySelector("#explorer-results .champ-card-actions button");
    expect(editButton).toBeTruthy();
    editButton.click();
    await flush();

    const labels = [...doc.querySelectorAll("#champion-tag-editor-tags .selection-option span")]
      .map((node) => node.textContent.trim());
    expect(labels).toEqual([
      "burst",
      "engage",
      "frontline"
    ]);
  });

  test("champion editor does not prefill from legacy metadata tags when global tags are empty", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness();
    const legacyTags = tagsFalse();
    legacyTags.HardEngage = true;
    legacyTags.Frontline = true;

    const legacyFallbackFetchImpl = async (url, init = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const parsedUrl = new URL(url, "http://api.test");

      if (method === "GET" && parsedUrl.pathname === "/tags") {
        return createJsonResponse({
          tags: [
            { id: 11, name: "Hard Engage", definition: "Hard engage options." },
            { id: 12, name: "Frontline", definition: "Frontline options." },
            { id: 13, name: "Disengage", definition: "Disengage options." }
          ]
        });
      }

      if (method === "GET" && parsedUrl.pathname === "/champions") {
        return createJsonResponse({
          champions: [
            {
              id: 1,
              name: "Aatrox",
              role: "Top",
              metadata: {
                roles: ["Top"],
                damageType: "AD",
                scaling: "Mid",
                tags: legacyTags
              },
              tagIds: []
            }
          ]
        });
      }

      if (method === "GET" && parsedUrl.pathname === "/champions/1/tags") {
        return createJsonResponse({
          scope: "all",
          team_id: null,
          tag_ids: []
        });
      }

      return harness.impl(url, init);
    };

    const { dom } = await bootApp({ fetchImpl: legacyFallbackFetchImpl, storage });
    const doc = dom.window.document;

    doc.querySelector(".side-menu-link[data-tab='explorer']").click();
    await flush();

    const editButton = doc.querySelector("#explorer-results .champ-card-actions button");
    expect(editButton).toBeTruthy();
    editButton.click();
    await flush();

    const hardEngageCheckbox = doc.querySelector("#champion-tag-editor-tags input[type='checkbox'][value='11']");
    const frontlineCheckbox = doc.querySelector("#champion-tag-editor-tags input[type='checkbox'][value='12']");
    expect(hardEngageCheckbox).toBeTruthy();
    expect(frontlineCheckbox).toBeTruthy();
    expect(hardEngageCheckbox.checked).toBe(false);
    expect(frontlineCheckbox.checked).toBe(false);
    expect(doc.querySelector("#champion-tag-editor-feedback").textContent).not.toContain("prefilled");

    doc.querySelector("#champion-tag-editor-save").click();
    await flush();

    const saveCall = harness.calls.find(
      (call) => /^\/champions\/\d+\/tags$/.test(call.path) && call.method === "PUT"
    );
    expect(saveCall).toBeTruthy();
    expect(saveCall.body.tag_ids).toEqual([]);
  });

  test("explorer cards hide legacy indicator chips in API mode", async () => {
    const storage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "token-123",
        user: { id: 11, email: "lead@example.com", gameName: "LeadPlayer", tagline: "NA1" }
      })
    });
    const harness = createFetchHarness();
    const legacyTags = tagsFalse();
    legacyTags.HardEngage = true;
    legacyTags.Frontline = true;

    const apiModeFetchImpl = async (url, init = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const parsedUrl = new URL(url, "http://api.test");

      if (method === "GET" && parsedUrl.pathname === "/champions") {
        return createJsonResponse({
          champions: [
            {
              id: 1,
              name: "Aatrox",
              role: "Top",
              metadata: {
                roles: ["Top"],
                damageType: "AD",
                scaling: "Mid",
                tags: legacyTags
              },
              tagIds: [1]
            }
          ]
        });
      }

      return harness.impl(url, init);
    };

    const { dom } = await bootApp({ fetchImpl: apiModeFetchImpl, storage });
    const doc = dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='explorer']").click();
    await flush();

    const card = doc.querySelector("#explorer-results .champ-card");
    expect(card).toBeTruthy();
    expect(card.textContent).not.toContain("HardEngage");
    expect(card.textContent).not.toContain("Frontline");
    expect(card.textContent).toContain("engage");
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

    doc.querySelector(".side-menu-link[data-tab='explorer']").click();
    await flush();

    const editButton = doc.querySelector("#explorer-results .champ-card-actions button");
    expect(editButton).toBeTruthy();
    editButton.click();
    await flush();

    const topRoleCheckbox = doc.querySelector("#champion-metadata-editor-roles input[value='Top']");
    expect(topRoleCheckbox).toBeTruthy();
    topRoleCheckbox.checked = true;
    topRoleCheckbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    await flush();
    const sharedProfileToggle = doc.querySelector("#champion-metadata-share-role-profile");
    expect(sharedProfileToggle).toBeTruthy();
    sharedProfileToggle.checked = true;
    sharedProfileToggle.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    const sharedProfileCard = Array.from(doc.querySelectorAll(".champion-role-profile-card")).find((node) =>
      node.textContent.includes("All Selected Roles Profile")
    );
    expect(sharedProfileCard).toBeTruthy();
    const sharedDamageSelect = sharedProfileCard.querySelector("select");
    sharedDamageSelect.value = "mixed";
    sharedDamageSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    doc.querySelector("#champion-tag-editor-save").click();
    await flush();

    const metadataSaveCall = harness.calls.find(
      (call) => /^\/champions\/\d+\/metadata$/.test(call.path) && call.method === "PUT"
    );
    expect(metadataSaveCall).toBeTruthy();
    expect(metadataSaveCall.body.role_profiles.Top.primary_damage_type).toBe("mixed");
    expect(metadataSaveCall.body.role_profiles.Mid.primary_damage_type).toBe("mixed");
    expect(new Set(metadataSaveCall.body.roles)).toEqual(new Set(["Top", "Mid"]));
    expect(doc.querySelector("#champion-tag-editor-feedback").textContent).toContain("saved");
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
    await flush();

    const deleteCall = harness.calls.find((call) => /^\/tags\/\d+$/.test(call.path) && call.method === "DELETE");
    expect(deleteCall).toBeTruthy();
    expect(doc.querySelector("#tags-workspace-summary").textContent).toContain("3 tags");
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

    doc.querySelector(".side-menu-link[data-tab='users']").click();
    await flush();

    expect(doc.querySelector("#users-access").textContent).toContain("users loaded");
    expect(doc.querySelector("#users-authorization-access").textContent).toContain("global roles");
    expect(doc.querySelector("#users-authorization-roles").textContent).toContain("Global Roles");
    expect(doc.querySelector("#users-authorization-roles").textContent).not.toContain("Team Roster Roles");
    expect(doc.querySelector("#users-authorization-permissions").textContent).toContain("Permission Catalog");
    expect(doc.querySelector("#users-authorization-assignments").textContent).toContain("Global Role Assignments");
    expect(doc.querySelector("#users-authorization-assignments").textContent).not.toContain("Team Roster Assignments");
    const matrixCall = harness.calls.find((call) => call.path === "/admin/authorization" && call.method === "GET");
    expect(matrixCall).toBeTruthy();
    const roleSelects = [...doc.querySelectorAll("#users-list select")];
    const memberRoleSelect = roleSelects.find((select) => select.value === "member");
    expect(memberRoleSelect).toBeTruthy();

    memberRoleSelect.value = "global";
    memberRoleSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
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
    await flush();

    const deleteUserCall = harness.calls.find((call) => call.path === "/admin/users/22" && call.method === "DELETE");
    expect(deleteUserCall).toBeTruthy();
    expect(doc.querySelector("#users-list").textContent).not.toContain("member@example.com");
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

    expect(doc.querySelector("#tab-player-config").classList.contains("is-active")).toBe(true);
    expect(doc.querySelector(".side-menu-link[data-tab='player-config']").classList.contains("is-active")).toBe(true);
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

  test("profile page shows teams I am on with membership roles", async () => {
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
    doc.querySelector(".side-menu-link[data-tab='player-config']").click();
    await flush();

    const memberListText = doc.querySelector("#settings-teams-member-list").textContent;
    expect(memberListText).toContain("Team Alpha");
    expect(memberListText).toContain("Team Beta");
    expect(memberListText).toContain("Team Lead");
    expect(memberListText).toContain("Substitute");

    const firstLogoButton = doc.querySelector("#settings-teams-member-list .summary-card-logo-button");
    expect(firstLogoButton).toBeTruthy();
    firstLogoButton.click();
    expect(doc.querySelector("#logo-lightbox").hidden).toBe(false);
    expect(doc.querySelector("#logo-lightbox-caption").textContent).toContain("Team");
    doc.querySelector("#logo-lightbox-close").click();
    expect(doc.querySelector("#logo-lightbox").hidden).toBe(true);
  });

  test("profile page renders Riot champion stats from the profile payload", async () => {
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
          champions: [
            {
              championId: 99,
              championLevel: 7,
              championPoints: 234567,
              lastPlayedAt: "2026-02-24T10:00:00.000Z"
            },
            {
              championId: 266,
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
    doc.querySelector(".side-menu-link[data-tab='player-config']").click();
    await flush();

    expect(doc.querySelector("#profile-riot-stats-summary").textContent).toContain("Top 2 champion mastery entries");
    const riotStatsText = doc.querySelector("#profile-riot-stats-list").textContent;
    expect(riotStatsText).toContain("Champion #99");
    expect(riotStatsText).toContain("Mastery 7");
    expect(riotStatsText).toContain("Champion #266");
  });

  test("profile page shows not-implemented placeholder when Riot stats are idle", async () => {
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
    doc.querySelector(".side-menu-link[data-tab='player-config']").click();
    await flush();

    expect(doc.querySelector("#profile-riot-stats-summary").textContent).toContain("not implemented yet");
    expect(doc.querySelector("#profile-riot-stats-list").textContent.trim()).toBe("");
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

    inlineAddAction.click();
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

    doc.querySelector("#team-join-load-discover").click();
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

    doc.querySelector("#team-join-load-review").click();
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
        defaultTeamId: null,
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
        "1": [{ team_id: 1, user_id: 11, role: "lead", team_role: "primary", email: "adc@example.com" }]
      },
      teamContext: {
        defaultTeamId: null,
        activeTeamId: 1
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    await flush();

    const adcSlotLabel = doc.querySelector("#slot-label-ADC");
    expect(adcSlotLabel.textContent).toContain("ADCMain");
    expect(adcSlotLabel.textContent).toContain("ADC");
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
        "1": [{ team_id: 1, user_id: 11, role: "lead", team_role: "primary", email: "adc@example.com" }]
      },
      teamContext: {
        defaultTeamId: null,
        activeTeamId: 1
      }
    });

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    await flush();

    const adcSlotLabel = doc.querySelector("#slot-label-ADC");
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
    doc.querySelector(".side-menu-link[data-tab='player-config']").click();
    await flush();

    expect(doc.querySelector("#profile-primary-role").value).toBe("Mid");
    expect(doc.querySelectorAll("#player-config-grid .player-config-card").length).toBe(1);

    const legacyMigrationCall = harness.calls.find((call) => call.path === "/me/pools/1" && call.method === "PUT");
    expect(legacyMigrationCall).toBeTruthy();
    expect(legacyMigrationCall.body).toEqual({ name: "Mid" });

    const midAhriCheckbox = doc.querySelector("#player-config-grid input[type='checkbox'][value='Ahri']");
    expect(midAhriCheckbox).toBeTruthy();
    expect(midAhriCheckbox.checked).toBe(true);

    doc.querySelector("#profile-primary-role").value = "Support";
    doc.querySelector("#profile-primary-role").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    doc.querySelector("#profile-save-roles").click();
    expect(doc.querySelector("#profile-save-roles").textContent).toBe("Saving...");
    expect(doc.querySelector("#profile-save-roles").disabled).toBe(true);
    await flush();
    await flush();

    const saveProfileCall = harness.calls.find((call) => call.path === "/me/profile" && call.method === "PUT");
    expect(saveProfileCall).toBeTruthy();
    expect(saveProfileCall.body.primaryRole).toBe("Support");
    expect(saveProfileCall.body.secondaryRoles).not.toContain("Support");
    expect(doc.querySelector("#profile-save-roles").textContent).toBe("Save Roles");
    expect(doc.querySelector("#profile-save-roles").disabled).toBe(false);
    expect(doc.querySelector("#profile-roles-feedback").textContent).toContain("Saved profile roles. Primary: Support.");
    expect(doc.querySelector("#profile-roles-feedback").textContent).toContain("Secondary: Top.");

    doc.querySelector("#player-config-team").value = "role:Top";
    doc.querySelector("#player-config-team").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(doc.querySelectorAll("#player-config-grid .player-config-card").length).toBe(1);
  });

  test("champion pool changes require explicit save", async () => {
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
    doc.querySelector(".side-menu-link[data-tab='player-config']").click();
    await flush();

    const ahriCheckbox = doc.querySelector("#player-config-grid input[type='checkbox'][value='Ahri']");
    ahriCheckbox.checked = false;
    ahriCheckbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await flush();

    expect(doc.querySelector("#player-config-feedback").textContent).toContain("Unsaved champion changes");
    expect(doc.querySelector("#player-config-save-pool").disabled).toBe(false);

    const immediatePoolSync = harness.calls.filter(
      (call) => /^\/me\/pools\/\d+\/champions/.test(call.path) && ["POST", "DELETE"].includes(call.method)
    );
    expect(immediatePoolSync).toHaveLength(0);

    doc.querySelector("#player-config-save-pool").click();
    await flush();
    await flush();

    const syncedCalls = harness.calls.filter(
      (call) => /^\/me\/pools\/\d+\/champions/.test(call.path) && ["POST", "DELETE"].includes(call.method)
    );
    expect(syncedCalls.length).toBeGreaterThan(0);
    expect(doc.querySelector("#player-config-feedback").textContent).toContain("Saved pool updates for Mid");
  });

  test("champion pool save works when champions endpoint returns string ids", async () => {
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
    doc.querySelector(".side-menu-link[data-tab='player-config']").click();
    await flush();

    const ahriCheckbox = doc.querySelector("#player-config-grid input[type='checkbox'][value='Ahri']");
    expect(ahriCheckbox).toBeTruthy();
    ahriCheckbox.checked = true;
    ahriCheckbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await flush();

    doc.querySelector("#player-config-save-pool").click();
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
