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
  failCreatePoolWith401 = false,
  championIdsAsStrings = false,
  loginUser = null,
  profile = null,
  teamContext = null
} = {}) {
  const calls = [];
  let nextPoolId = pools.length + 1;
  const globalChampionTagIds = new Map([
    [1, new Set([1])],
    [2, new Set([])],
    [3, new Set([])]
  ]);
  const selfChampionTagIds = new Map();
  const teamChampionTagIds = new Map();
  let persistedTeamContext = {
    defaultTeamId: null,
    activeTeamId: null,
    ...(teamContext && typeof teamContext === "object" ? teamContext : {})
  };
  const resolvedLoginUser = loginUser ?? {
    id: 11,
    email: "user@example.com",
    gameName: "LoginUser",
    tagline: "NA1",
    primaryRole: "Mid",
    secondaryRoles: ["Top"]
  };
  const resolvedProfile = profile ?? {
    id: 11,
    email: "user@example.com",
    gameName: "LoginUser",
    tagline: "NA1",
    primaryRole: "Mid",
    secondaryRoles: ["Top"]
  };

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
            metadata: {
              roles: ["Mid"],
              damageType: "AP",
              scaling: "Mid",
              tags: tagsFalse()
            }
          },
          {
            id: toChampionId(2),
            name: "Ashe",
            role: "ADC",
            tagIds: [...(globalChampionTagIds.get(2) ?? [])],
            metadata: {
              roles: ["ADC", "Support"],
              damageType: "AD",
              scaling: "Late",
              tags: tagsFalse()
            }
          },
          {
            id: toChampionId(3),
            name: "Braum",
            role: "Support",
            tagIds: [...(globalChampionTagIds.get(3) ?? [])],
            metadata: {
              roles: ["Support"],
              damageType: "AD",
              scaling: "Mid",
              tags: tagsFalse()
            }
          }
        ]
      });
    }

    if (path === "/tags" && method === "GET") {
      return createJsonResponse({
        tags: [
          { id: 1, name: "engage", category: "utility" },
          { id: 2, name: "frontline", category: "utility" },
          { id: 3, name: "burst", category: "damage" }
        ]
      });
    }

    const championTagsMatch = path.match(/^\/champions\/(\d+)\/tags$/);
    if (championTagsMatch && method === "GET") {
      const championId = Number(championTagsMatch[1]);
      const scope = query.get("scope") ?? "self";
      if (scope === "all") {
        return createJsonResponse({
          scope,
          team_id: null,
          tag_ids: [...(globalChampionTagIds.get(championId) ?? [])].sort((left, right) => left - right)
        });
      }
      if (scope === "team") {
        const teamId = Number.parseInt(query.get("team_id") ?? "", 10);
        const key = `${teamId}:${championId}`;
        return createJsonResponse({
          scope,
          team_id: Number.isInteger(teamId) ? teamId : null,
          tag_ids: [...(teamChampionTagIds.get(key) ?? [])].sort((left, right) => left - right)
        });
      }
      const key = `${resolvedLoginUser.id}:${championId}`;
      return createJsonResponse({
        scope: "self",
        team_id: null,
        tag_ids: [...(selfChampionTagIds.get(key) ?? [])].sort((left, right) => left - right)
      });
    }

    if (championTagsMatch && method === "PUT") {
      const championId = Number(championTagsMatch[1]);
      const scope = body?.scope ?? "self";
      const nextTagIds = Array.isArray(body?.tag_ids)
        ? [...new Set(body.tag_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
            .sort((left, right) => left - right)
        : [];

      if (scope === "all") {
        globalChampionTagIds.set(championId, new Set(nextTagIds));
        return createJsonResponse({
          scope,
          team_id: null,
          tag_ids: nextTagIds
        });
      }

      if (scope === "team") {
        const teamId = Number.parseInt(String(body?.team_id ?? ""), 10);
        const key = `${teamId}:${championId}`;
        teamChampionTagIds.set(key, new Set(nextTagIds));
        return createJsonResponse({
          scope,
          team_id: Number.isInteger(teamId) ? teamId : null,
          tag_ids: nextTagIds
        });
      }

      const key = `${resolvedLoginUser.id}:${championId}`;
      selfChampionTagIds.set(key, new Set(nextTagIds));
      return createJsonResponse({
        scope: "self",
        team_id: null,
        tag_ids: nextTagIds
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
      return createJsonResponse(
        {
          member: {
            team_id: Number(membersMatch[1]),
            user_id: body.user_id,
            role: body.role,
            team_role: body.team_role ?? "substitute"
          }
        },
        201
      );
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

  test("champion explorer loads tag catalog and saves scoped tag edits", async () => {
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
    const firstTagCheckbox = doc.querySelector("#champion-tag-editor-tags input[type='checkbox']");
    expect(firstTagCheckbox).toBeTruthy();
    firstTagCheckbox.checked = true;
    firstTagCheckbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    doc.querySelector("#champion-tag-editor-save").click();
    await flush();

    const saveCall = harness.calls.find(
      (call) => /^\/champions\/\d+\/tags$/.test(call.path) && call.method === "PUT"
    );
    expect(saveCall).toBeTruthy();
    expect(saveCall.body.scope).toBe("self");
    expect(Array.isArray(saveCall.body.tag_ids)).toBe(true);
    expect(doc.querySelector("#champion-tag-editor-feedback").textContent).toContain("saved");
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

    const managePanel = doc.querySelector("#team-workspace-manage");
    const createPanel = doc.querySelector("#team-workspace-create");
    const manageTab = doc.querySelector("#team-workspace-tab-manage");
    const createTab = doc.querySelector("#team-workspace-tab-create");
    const activeTeamSelect = doc.querySelector("#team-config-active-team");
    const contextHelp = doc.querySelector("#team-config-context-help");
    const activeTeamOptions = Array.from(activeTeamSelect.options, (option) => option.textContent);
    const editAction = doc.querySelector("button[data-team-manage-action='team-settings']");
    const addAction = doc.querySelector("button[data-team-manage-action='add-member']");
    const editPanel = doc.querySelector("[data-team-manage-panel='team-settings']");
    const addPanel = doc.querySelector("[data-team-manage-panel='add-member']");
    const actionHelp = doc.querySelector("#team-manage-action-help");
    const teamWorkspaceHelp = doc.querySelector("#team-admin-team-help");
    const currentLogoHelp = doc.querySelector("#team-admin-current-logo-help");
    const currentLogoOpen = doc.querySelector("#team-admin-current-logo-open");

    expect(managePanel.hidden).toBe(false);
    expect(createPanel.hidden).toBe(true);
    expect(manageTab.getAttribute("aria-selected")).toBe("true");
    expect(createTab.getAttribute("aria-selected")).toBe("false");
    expect(activeTeamOptions.some((option) => option.includes("Team Alpha"))).toBe(true);
    expect(activeTeamOptions.some((option) => option === "Mid")).toBe(false);
    expect(contextHelp.textContent).toContain("Team Workspace's Team selector only chooses");
    expect(teamWorkspaceHelp.textContent).toContain("does not change Active Team");
    expect(editPanel.hidden).toBe(true);
    expect(addPanel.hidden).toBe(true);
    expect(actionHelp.hidden).toBe(false);

    editAction.click();
    expect(editAction.getAttribute("aria-pressed")).toBe("true");
    expect(editPanel.hidden).toBe(false);
    expect(addPanel.hidden).toBe(true);
    expect(actionHelp.hidden).toBe(true);
    expect(currentLogoHelp.textContent).toContain("Current logo shown");
    expect(currentLogoOpen.hidden).toBe(false);

    currentLogoOpen.click();
    expect(doc.querySelector("#logo-lightbox").hidden).toBe(false);
    doc.querySelector("#logo-lightbox-close").click();
    expect(doc.querySelector("#logo-lightbox").hidden).toBe(true);

    activeTeamSelect.value = "1";
    activeTeamSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await flush();
    const saveTeamContextCall = harness.calls.find(
      (call) => call.path === "/me/team-context" && call.method === "PUT"
    );
    expect(saveTeamContextCall).toBeTruthy();
    expect(saveTeamContextCall.body.activeTeamId).toBe(1);

    addAction.click();
    expect(editPanel.hidden).toBe(true);
    expect(addPanel.hidden).toBe(false);

    addAction.click();
    expect(addPanel.hidden).toBe(true);
    expect(actionHelp.hidden).toBe(false);

    createTab.click();
    expect(managePanel.hidden).toBe(true);
    expect(createPanel.hidden).toBe(false);
    expect(manageTab.getAttribute("aria-selected")).toBe("false");
    expect(createTab.getAttribute("aria-selected")).toBe("true");
  });

  test("team manage row actions send role and team-role updates", async () => {
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

    doc.querySelector("button[data-team-manage-action='update-member-role']").click();
    doc.querySelector("#team-admin-role-user-id").value = "22";
    doc.querySelector("#team-admin-role").value = "lead";
    doc.querySelector("#team-admin-update-role").click();
    await flush();
    await flush();

    const updateRoleCall = harness.calls.find(
      (call) => call.path === "/teams/1/members/22/role" && call.method === "PUT"
    );
    expect(updateRoleCall).toBeTruthy();
    expect(updateRoleCall.body).toEqual({ role: "lead" });

    doc.querySelector("button[data-team-manage-action='update-team-role']").click();
    doc.querySelector("#team-admin-team-role-user-id").value = "22";
    doc.querySelector("#team-admin-team-role").value = "primary";
    doc.querySelector("#team-admin-update-team-role").click();
    await flush();
    await flush();

    const updateTeamRoleCall = harness.calls.find(
      (call) => call.path === "/teams/1/members/22/team-role" && call.method === "PUT"
    );
    expect(updateTeamRoleCall).toBeTruthy();
    expect(updateTeamRoleCall.body).toEqual({ team_role: "primary" });
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

    doc.querySelector("button[data-team-manage-action='team-settings']").click();
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
    firstDoc.querySelector("#team-config-active-team").value = "1";
    firstDoc.querySelector("#team-config-active-team").dispatchEvent(
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

    expect(secondDoc.querySelector("#team-config-active-team").value).toBe("1");
  });

  test("team-context default team persists through API payloads", async () => {
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

    const { dom } = await bootApp({ fetchImpl: harness.impl, storage });
    const doc = dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();
    doc.querySelector("#team-config-default-team").value = "1";
    doc.querySelector("#team-config-default-team").dispatchEvent(
      new dom.window.Event("change", { bubbles: true })
    );
    await flush();
    await flush();

    const saveCall = harness.calls.find((call) => call.path === "/me/team-context" && call.method === "PUT");
    expect(saveCall).toBeTruthy();
    expect(saveCall.body.defaultTeamId).toBe(1);
    expect(saveCall.body.activeTeamId).toBe(null);
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
    expect(doc.querySelector("#player-config-summary").textContent).toContain("Editing Mid pool. 1 champion selected.");

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
    expect(doc.querySelector("#player-config-grid").textContent).toContain("Top Champion Pool");
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
    expect(doc.querySelector("#player-config-summary").textContent).toContain("Editing Mid pool. 0 champions selected.");
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
    expect(doc.querySelector("#player-config-summary").textContent).toContain("Editing Mid pool. 1 champion selected.");
  });

  test("team admin controls are disabled for non-leads and enabled for leads", async () => {
    const memberStorage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "member-token",
        user: { id: 22, email: "member@example.com" }
      })
    });
    const memberHarness = createFetchHarness({
      pools: [],
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

    expect(doc.querySelector("#team-admin-readonly-note").textContent).toContain("Read-only mode");
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
    expect(doc.querySelectorAll("#team-admin-members .roster-slot-empty")).toHaveLength(3);

    const leadStorage = createStorageStub({
      "draftflow.authSession.v1": JSON.stringify({
        token: "lead-token",
        user: { id: 11, email: "lead@example.com" }
      })
    });
    const leadHarness = createFetchHarness({
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

    app = await bootApp({ fetchImpl: leadHarness.impl, storage: leadStorage });
    doc = app.dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();

    expect(doc.querySelector("#team-admin-readonly-note").textContent).toContain("Lead mode");
    expect(doc.querySelector("#team-admin-rename").disabled).toBe(false);
    expect(doc.querySelector("#team-admin-add-member").disabled).toBe(false);
  });
});
