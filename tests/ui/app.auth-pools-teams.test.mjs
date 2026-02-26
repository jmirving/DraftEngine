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
  championIdsAsStrings = false
} = {}) {
  const calls = [];
  let nextPoolId = pools.length + 1;

  const impl = async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const parsedUrl = new URL(url, "http://api.test");
    const path = parsedUrl.pathname;
    const headers = init.headers ?? {};
    const authHeader = headers.Authorization ?? headers.authorization ?? null;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;

    calls.push({ path, method, headers, body });

    if (path === "/champions" && method === "GET") {
      const toChampionId = (value) => (championIdsAsStrings ? String(value) : value);
      return createJsonResponse({
        champions: [
          {
            id: toChampionId(1),
            name: "Ahri",
            role: "Mid",
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

    if (path === "/auth/login" && method === "POST") {
      return createJsonResponse({
        token: "token-123",
        user: {
          id: 11,
          email: body.email,
          gameName: "LoginUser",
          tagline: "NA1",
          primaryRole: "Mid",
          secondaryRoles: ["Top"]
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
        profile: {
          id: 11,
          email: "user@example.com",
          gameName: "LoginUser",
          tagline: "NA1",
          primaryRole: "Mid",
          secondaryRoles: ["Top"]
        }
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

    if (path === "/me/pools" && method === "GET") {
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
      if (pool && !pool.champion_ids.includes(body.champion_id)) {
        pool.champion_ids.push(body.champion_id);
      }
      return createJsonResponse({ pool });
    }

    if (/^\/me\/pools\/\d+\/champions\/\d+$/.test(path) && method === "DELETE") {
      const [poolIdRaw, championIdRaw] = [path.split("/")[3], path.split("/")[5]];
      const pool = pools.find((candidate) => candidate.id === Number(poolIdRaw));
      if (pool) {
        pool.champion_ids = pool.champion_ids.filter((id) => id !== Number(championIdRaw));
      }
      return createJsonResponse({ pool });
    }

    if (path === "/teams" && method === "GET") {
      return createJsonResponse({ teams });
    }

    if (path === "/teams" && method === "POST") {
      if (!body.name || !body.tag || !body.logo_url) {
        return createJsonResponse(
          {
            error: {
              code: "BAD_REQUEST",
              message: "Expected team name, tag, and logo_url."
            }
          },
          400
        );
      }
      const created = {
        id: 99,
        name: body.name,
        tag: body.tag,
        logo_url: body.logo_url,
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
      return createJsonResponse({
        team: {
          id: Number(path.split("/")[2]),
          name: body.name,
          tag: body.tag,
          logo_url: body.logo_url,
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
          logo_url: "https://example.com/alpha.png",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        },
        {
          id: 2,
          name: "Team Beta",
          tag: "BETA",
          logo_url: "https://example.com/beta.png",
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
  });

  test("creating a team from team context sends name, tag, and logo", async () => {
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
          logo_url: "https://example.com/alpha.png",
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
    doc.querySelector("#team-admin-create-name").value = "My New Team";
    doc.querySelector("#team-admin-create-tag").value = "MNT";
    doc.querySelector("#team-admin-create-logo-url").value = "https://example.com/my-new-team.png";
    doc.querySelector("#team-admin-create").click();
    await flush();
    await flush();

    const createTeamCall = harness.calls.find((call) => call.path === "/teams" && call.method === "POST");
    expect(createTeamCall).toBeTruthy();
    expect(createTeamCall.body.name).toBe("My New Team");
    expect(createTeamCall.body.tag).toBe("MNT");
    expect(createTeamCall.body.logo_url).toBe("https://example.com/my-new-team.png");
    expect(doc.querySelector("#team-admin-feedback").textContent).toContain("Created team 'My New Team'.");
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
          logo_url: "https://example.com/alpha.png",
          created_by: 11,
          membership_role: "member",
          membership_team_role: "substitute",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [
          { team_id: 1, user_id: 11, role: "lead", team_role: "primary", email: "lead@example.com" },
          { team_id: 1, user_id: 22, role: "member", team_role: "substitute", email: "member@example.com" }
        ]
      }
    });

    let app = await bootApp({ fetchImpl: memberHarness.impl, storage: memberStorage });
    let doc = app.dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();

    expect(doc.querySelector("#team-admin-rename").disabled).toBe(true);
    expect(doc.querySelector("#team-admin-add-member").disabled).toBe(true);

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
          logo_url: "https://example.com/alpha.png",
          created_by: 11,
          membership_role: "lead",
          membership_team_role: "primary",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      membersByTeam: {
        "1": [
          { team_id: 1, user_id: 11, role: "lead", team_role: "primary", email: "lead@example.com" },
          { team_id: 1, user_id: 22, role: "member", team_role: "substitute", email: "member@example.com" }
        ]
      }
    });

    app = await bootApp({ fetchImpl: leadHarness.impl, storage: leadStorage });
    doc = app.dom.window.document;
    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    await flush();

    expect(doc.querySelector("#team-admin-rename").disabled).toBe(false);
    expect(doc.querySelector("#team-admin-add-member").disabled).toBe(false);
  });
});
