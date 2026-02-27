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
    }
  };
}

function createMatchMedia(initialMatches = false) {
  let matches = Boolean(initialMatches);
  const impl = (query) => ({
    get matches() {
      return matches;
    },
    media: query,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {}
  });
  impl.setMatches = (next) => {
    matches = Boolean(next);
  };
  return impl;
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

function emptyTags() {
  return Object.fromEntries(BOOLEAN_TAGS.map((tag) => [tag, false]));
}

function createFetchHarness({
  loginUser = null,
  profile = null
} = {}) {
  const calls = [];
  let teamContext = {
    defaultTeamId: null,
    activeTeamId: null
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

  const impl = async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const parsedUrl = new URL(url, "http://api.test");
    const path = parsedUrl.pathname;
    const headers = init.headers ?? {};
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;

    calls.push({ path, method, headers, body });

    if (path === "/champions" && method === "GET") {
      return createJsonResponse({
        champions: [
          {
            id: 1,
            name: "Ahri",
            role: "Mid",
            metadata: {
              roles: ["Mid"],
              damageType: "AP",
              scaling: "Mid",
              tags: emptyTags()
            }
          },
          {
            id: 2,
            name: "Ashe",
            role: "ADC",
            metadata: {
              roles: ["ADC"],
              damageType: "AD",
              scaling: "Late",
              tags: emptyTags()
            }
          }
        ]
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

    if (path === "/me/profile" && method === "GET") {
      return createJsonResponse({ profile: resolvedProfile });
    }

    if (path === "/me/team-context" && method === "GET") {
      return createJsonResponse({
        teamContext
      });
    }

    if (path === "/me/team-context" && method === "PUT") {
      teamContext = {
        defaultTeamId: body?.defaultTeamId ?? null,
        activeTeamId: body?.activeTeamId ?? null
      };
      return createJsonResponse({ teamContext });
    }

    if (path === "/me/pools" && method === "GET") {
      return createJsonResponse({ pools: [] });
    }

    if (path === "/teams" && method === "GET") {
      return createJsonResponse({ teams: [] });
    }

    return createJsonResponse({ error: { code: "NOT_FOUND", message: `${path} not mocked` } }, 404);
  };

  return { impl, calls };
}

function createAuthStorage(user = null) {
  const resolvedUser = user ?? {
    id: 11,
    email: "user@example.com",
    gameName: "LoginUser",
    tagline: "NA1",
    primaryRole: "Mid",
    secondaryRoles: ["Top"]
  };
  return {
    "draftflow.authSession.v1": JSON.stringify({
      token: "token-123",
      user: resolvedUser
    })
  };
}

async function flush() {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}

async function bootApp({ url, storageInitial = {}, fetchHarness, matchMediaImpl = createMatchMedia() } = {}) {
  vi.resetModules();
  const dom = new JSDOM(htmlFixture, {
    url: url ?? "http://localhost/public/index.html",
    pretendToBeVisual: true
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const historyLengthBeforeInit = dom.window.history.length;

  const { initApp, getAppState } = await import("../../public/app/app.js");
  await initApp({
    document: dom.window.document,
    window: dom.window,
    fetchImpl: fetchHarness.impl,
    storage: createStorageStub(storageInitial),
    matchMediaImpl,
    apiBaseUrl: "http://api.test"
  });

  return {
    dom,
    state: getAppState(),
    historyLengthBeforeInit,
    matchMediaImpl
  };
}

describe("hash navigation routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("authenticated initial hash selects matching tab", async () => {
    const harness = createFetchHarness();
    const { dom } = await bootApp({
      url: "http://localhost/public/index.html#team-config",
      storageInitial: createAuthStorage(),
      fetchHarness: harness
    });
    const doc = dom.window.document;

    expect(dom.window.location.hash).toBe("#team-config");
    expect(doc.querySelector("#tab-team-config").classList.contains("is-active")).toBe(true);
    expect(doc.querySelector(".side-menu-link[data-tab='team-config']").classList.contains("is-active")).toBe(true);
  });

  test("invalid initial hash normalizes to workflow with replace semantics", async () => {
    const harness = createFetchHarness();
    const { dom, historyLengthBeforeInit } = await bootApp({
      url: "http://localhost/public/index.html#not-a-tab",
      storageInitial: createAuthStorage(),
      fetchHarness: harness
    });

    expect(dom.window.location.hash).toBe("#workflow");
    expect(dom.window.history.length).toBe(historyLengthBeforeInit);
    expect(dom.window.document.querySelector("#tab-workflow").classList.contains("is-active")).toBe(true);
  });

  test("unauthenticated deep link normalizes to workflow", async () => {
    const harness = createFetchHarness();
    const { dom, state } = await bootApp({
      url: "http://localhost/public/index.html#explorer",
      storageInitial: {},
      fetchHarness: harness
    });
    const doc = dom.window.document;

    expect(state.activeTab).toBe("workflow");
    expect(dom.window.location.hash).toBe("#workflow");
    expect(doc.querySelector("#auth-gate").hidden).toBe(false);
    expect(doc.querySelector("#app-shell").hidden).toBe(true);
  });

  test("tab clicks update hash route", async () => {
    const harness = createFetchHarness();
    const { dom } = await bootApp({
      url: "http://localhost/public/index.html#workflow",
      storageInitial: createAuthStorage(),
      fetchHarness: harness
    });
    const doc = dom.window.document;

    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    expect(dom.window.location.hash).toBe("#team-config");

    doc.querySelector(".side-menu-link[data-tab='explorer']").click();
    expect(dom.window.location.hash).toBe("#explorer");
  });

  test("browser back/forward updates active tab from hash", async () => {
    const harness = createFetchHarness();
    const { dom } = await bootApp({
      url: "http://localhost/public/index.html#workflow",
      storageInitial: createAuthStorage(),
      fetchHarness: harness
    });
    const doc = dom.window.document;

    doc.querySelector(".side-menu-link[data-tab='team-config']").click();
    doc.querySelector(".side-menu-link[data-tab='explorer']").click();
    expect(dom.window.location.hash).toBe("#explorer");

    dom.window.history.back();
    await flush();
    dom.window.dispatchEvent(new dom.window.HashChangeEvent("hashchange"));
    await flush();

    expect(dom.window.location.hash).toBe("#team-config");
    expect(doc.querySelector("#tab-team-config").classList.contains("is-active")).toBe(true);

    dom.window.history.forward();
    await flush();
    dom.window.dispatchEvent(new dom.window.HashChangeEvent("hashchange"));
    await flush();

    expect(dom.window.location.hash).toBe("#explorer");
    expect(doc.querySelector("#tab-explorer").classList.contains("is-active")).toBe(true);
  });

  test("clicking already-active tab does not grow history", async () => {
    const harness = createFetchHarness();
    const { dom } = await bootApp({
      url: "http://localhost/public/index.html#workflow",
      storageInitial: createAuthStorage(),
      fetchHarness: harness
    });
    const doc = dom.window.document;
    const historyLength = dom.window.history.length;

    doc.querySelector(".side-menu-link[data-tab='workflow']").click();

    expect(dom.window.location.hash).toBe("#workflow");
    expect(dom.window.history.length).toBe(historyLength);
  });

  test("desktop nav toggle collapses sidebar and coming-soon tab routes correctly", async () => {
    const harness = createFetchHarness();
    const { dom } = await bootApp({
      url: "http://localhost/public/index.html#workflow",
      storageInitial: createAuthStorage(),
      fetchHarness: harness
    });
    const doc = dom.window.document;
    const navToggle = doc.querySelector("#nav-toggle");
    const appShell = doc.querySelector("#app-shell");

    expect(navToggle.textContent).toBe("◀");
    expect(navToggle.getAttribute("aria-label")).toBe("Collapse sidebar");
    expect(doc.querySelector("#nav-title").textContent).toBe("Workspace");
    expect(appShell.classList.contains("is-nav-collapsed")).toBe(false);

    navToggle.click();
    expect(appShell.classList.contains("is-nav-collapsed")).toBe(true);
    expect(navToggle.textContent).toBe("▶");
    expect(navToggle.getAttribute("aria-label")).toBe("Expand sidebar");

    navToggle.click();
    doc.querySelector(".side-menu-link[data-tab='coming-soon']").click();

    expect(dom.window.location.hash).toBe("#coming-soon");
    expect(doc.querySelector("#tab-coming-soon").classList.contains("is-active")).toBe(true);
  });

  test("mobile nav toggle still controls drawer open state", async () => {
    const harness = createFetchHarness();
    const matchMediaImpl = createMatchMedia(true);
    const { dom } = await bootApp({
      url: "http://localhost/public/index.html#workflow",
      storageInitial: createAuthStorage(),
      fetchHarness: harness,
      matchMediaImpl
    });
    const doc = dom.window.document;
    const navToggle = doc.querySelector("#nav-toggle");
    const navDrawer = doc.querySelector("#nav-drawer");

    expect(navToggle.textContent).toBe("Menu");
    expect(navDrawer.classList.contains("is-open")).toBe(false);

    navToggle.click();
    expect(navDrawer.classList.contains("is-open")).toBe(true);
    expect(navToggle.textContent).toBe("Close Menu");
  });

  test("stored desktop nav collapse state is restored on boot", async () => {
    const harness = createFetchHarness();
    const { dom } = await bootApp({
      url: "http://localhost/public/index.html#workflow",
      storageInitial: {
        ...createAuthStorage(),
        "draftflow.ui.v1": JSON.stringify({ navCollapsed: true })
      },
      fetchHarness: harness
    });
    const doc = dom.window.document;

    expect(doc.querySelector("#app-shell").classList.contains("is-nav-collapsed")).toBe(true);
    expect(doc.querySelector("#nav-toggle").textContent).toBe("▶");
  });

  test("login without defined roles routes to player-config hash", async () => {
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
    const { dom } = await bootApp({
      url: "http://localhost/public/index.html#workflow",
      storageInitial: {},
      fetchHarness: harness
    });
    const doc = dom.window.document;

    doc.querySelector("#auth-email").value = "user@example.com";
    doc.querySelector("#auth-password").value = "strong-pass-123";
    doc.querySelector("#auth-login").click();
    await flush();

    expect(dom.window.location.hash).toBe("#player-config");
    expect(doc.querySelector("#tab-player-config").classList.contains("is-active")).toBe(true);
  });

  test("logout always normalizes route to workflow", async () => {
    const harness = createFetchHarness();
    const { dom, state } = await bootApp({
      url: "http://localhost/public/index.html#explorer",
      storageInitial: createAuthStorage(),
      fetchHarness: harness
    });
    const doc = dom.window.document;

    doc.querySelector("#auth-logout").click();
    await flush();

    expect(state.activeTab).toBe("workflow");
    expect(dom.window.location.hash).toBe("#workflow");
    expect(doc.querySelector("#auth-gate").hidden).toBe(false);
  });
});
