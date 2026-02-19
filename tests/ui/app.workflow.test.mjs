import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, test, vi } from "vitest";

const htmlFixture = readFileSync(resolve("public/index.html"), "utf8");
const championsCsv = readFileSync(resolve("public/data/champions.csv"), "utf8");
const teamPoolsCsv = readFileSync(resolve("public/data/team_pools.csv"), "utf8");
const configJson = readFileSync(resolve("public/data/config.json"), "utf8");

function createFetchImpl() {
  const payloads = {
    "/public/data/champions.csv": championsCsv,
    "/public/data/team_pools.csv": teamPoolsCsv,
    "/public/data/config.json": configJson
  };

  return async (path) => {
    const text = payloads[path];
    if (text === undefined) {
      return {
        ok: false,
        status: 404,
        async text() {
          return "";
        }
      };
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return text;
      }
    };
  };
}

function createStorageStub() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
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

async function bootApp() {
  vi.resetModules();
  const dom = new JSDOM(htmlFixture, {
    url: "http://localhost/public/index.html",
    pretendToBeVisual: true
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};

  const { initApp, getAppState } = await import("../../public/app/app.js");
  await initApp({
    document: dom.window.document,
    window: dom.window,
    fetchImpl: createFetchImpl(),
    storage: createStorageStub(),
    matchMediaImpl: createMatchMedia()
  });
  return { dom, state: getAppState() };
}

describe("workflow app integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("initializes in setup stage with review stage hidden and generation gated", async () => {
    const { dom, state } = await bootApp();
    const setupPanel = dom.window.document.querySelector("#builder-stage-setup");
    const reviewPanel = dom.window.document.querySelector("#builder-stage-inspect");
    const generateButton = dom.window.document.querySelector("#builder-generate");

    expect(state.activeTab).toBe("workflow");
    expect(setupPanel.hidden).toBe(false);
    expect(reviewPanel.hidden).toBe(true);
    expect(generateButton.disabled).toBe(true);
  });

  test("requires at least one pick before entering review, then auto-generates on transition", async () => {
    const { dom } = await bootApp();
    const doc = dom.window.document;
    const continueButton = doc.querySelector("#builder-continue-validate");
    expect(continueButton.disabled).toBe(true);

    const topSelect = doc.querySelector("#slot-Top");
    const firstTop = Array.from(topSelect.options).find((option) => option.value);
    expect(firstTop).toBeTruthy();
    topSelect.value = firstTop.value;
    topSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    expect(continueButton.disabled).toBe(false);
    continueButton.click();

    expect(doc.querySelector("#builder-stage-inspect").hidden).toBe(false);
    expect(doc.querySelector("#builder-generate").disabled).toBe(false);
    expect(doc.querySelectorAll("#builder-tree-map circle").length).toBeGreaterThan(0);
  });

  test("invalid slot picks are rejected and excluded picks are cleared from slots", async () => {
    const { dom } = await bootApp();
    const doc = dom.window.document;
    const teamSelect = doc.querySelector("#builder-active-team");
    const topSelect = doc.querySelector("#slot-Top");
    const jungleSelect = doc.querySelector("#slot-Jungle");
    const setupFeedback = doc.querySelector("#builder-setup-feedback");
    const excludedSearch = doc.querySelector("#builder-excluded-search");

    teamSelect.value = "__NONE_TEAM__";
    teamSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    const topPool = Array.from(topSelect.options).map((option) => option.value).filter(Boolean);
    const junglePool = Array.from(jungleSelect.options).map((option) => option.value).filter(Boolean);
    const topChampion = topPool[0];
    const invalidJunglePick = topPool.find((champion) => !junglePool.includes(champion)) ?? "NotInJunglePool";
    expect(topChampion).toBeTruthy();

    topSelect.value = topChampion;
    topSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    const forced = doc.createElement("option");
    forced.value = invalidJunglePick;
    forced.textContent = invalidJunglePick;
    jungleSelect.append(forced);
    jungleSelect.value = invalidJunglePick;
    jungleSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    expect(setupFeedback.textContent).toContain("allowed pool");

    excludedSearch.value = topChampion;
    excludedSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    const excludeCheckbox = doc.querySelector("#builder-excluded-options input[type='checkbox']");
    excludeCheckbox.checked = true;
    excludeCheckbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    expect(topSelect.value).toBe("");
    expect(doc.querySelector("#builder-excluded-pills").textContent).toContain(topChampion);
  });

  test("generates tree output and tree filters reduce visible map nodes", async () => {
    const { dom } = await bootApp();
    const doc = dom.window.document;
    const topSelect = doc.querySelector("#slot-Top");
    const continueButton = doc.querySelector("#builder-continue-validate");
    const generateButton = doc.querySelector("#builder-generate");
    const treeSearch = doc.querySelector("#tree-search");
    const treeMinScore = doc.querySelector("#tree-min-score");

    const firstTop = Array.from(topSelect.options).find((option) => option.value);
    topSelect.value = firstTop.value;
    topSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    continueButton.click();
    generateButton.click();

    const initialCircles = doc.querySelectorAll("#builder-tree-map circle").length;
    expect(initialCircles).toBeGreaterThan(0);

    treeSearch.value = "zzzz-no-node";
    treeSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    const afterSearchCircles = doc.querySelectorAll("#builder-tree-map circle").length;
    expect(afterSearchCircles).toBeLessThanOrEqual(initialCircles);

    treeMinScore.value = "999";
    treeMinScore.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    const afterMinScoreCircles = doc.querySelectorAll("#builder-tree-map circle").length;
    expect(afterMinScoreCircles).toBe(1);
  });

  test("team context supports named team labels and None global pool mode", async () => {
    const { dom } = await bootApp();
    const doc = dom.window.document;
    const teamSelect = doc.querySelector("#builder-active-team");
    const topLabel = doc.querySelector("#slot-label-Top");
    const teamHelp = doc.querySelector("#builder-team-help");

    expect(topLabel.textContent).toContain("(");

    teamSelect.value = "__NONE_TEAM__";
    teamSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    expect(teamHelp.textContent).toContain("global champion eligibility");
    expect(topLabel.textContent).toBe("Top");
  });

  test("explorer include/exclude tags remain mutually exclusive", async () => {
    const { dom, state } = await bootApp();
    const doc = dom.window.document;

    doc.querySelector(".side-menu-link[data-tab='explorer']").click();

    const includeHardEngage = doc.querySelector("#explorer-include-tags input[type='checkbox'][value='HardEngage']");
    includeHardEngage.checked = true;
    includeHardEngage.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(state.explorer.includeTags).toContain("HardEngage");

    const excludeHardEngage = doc.querySelector("#explorer-exclude-tags input[type='checkbox'][value='HardEngage']");
    excludeHardEngage.checked = true;
    excludeHardEngage.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    expect(state.explorer.excludeTags).toContain("HardEngage");
    expect(state.explorer.includeTags).not.toContain("HardEngage");

    doc.querySelector("#explorer-clear-all").click();
    expect(state.explorer.includeTags).toEqual([]);
    expect(state.explorer.excludeTags).toEqual([]);
  });

  test("player pool edits persist and refresh workflow context", async () => {
    const { dom, state } = await bootApp();
    const doc = dom.window.document;

    doc.querySelector(".side-menu-link[data-tab='player-config']").click();
    const firstPoolCheckbox = doc.querySelector(".player-pool-control input[type='checkbox']");
    expect(firstPoolCheckbox).toBeTruthy();

    firstPoolCheckbox.checked = !firstPoolCheckbox.checked;
    firstPoolCheckbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    expect(doc.querySelector("#player-config-feedback").textContent).toContain("Saved pool updates");
    expect(Object.keys(state.data.teamPools).length).toBeGreaterThan(0);
    expect(state.builder.stage).toBe("setup");
  });

  test("tree inspect supports compare actions and apply node flow", async () => {
    const { dom, state } = await bootApp();
    const doc = dom.window.document;
    const topSelect = doc.querySelector("#slot-Top");
    const continueButton = doc.querySelector("#builder-continue-validate");
    const generateButton = doc.querySelector("#builder-generate");

    const firstTop = Array.from(topSelect.options).find((option) => option.value);
    topSelect.value = firstTop.value;
    topSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    continueButton.click();
    generateButton.click();

    const inspectButtons = doc.querySelectorAll("#builder-tree-summary button");
    expect(inspectButtons.length).toBeGreaterThan(0);
    inspectButtons[0].click();

    const setCompareA = Array.from(doc.querySelectorAll("#builder-preview button")).find((button) =>
      button.textContent.includes("Set Compare A")
    );
    const setCompareB = Array.from(doc.querySelectorAll("#builder-preview button")).find((button) =>
      button.textContent.includes("Set Compare B")
    );
    const clearCompare = Array.from(doc.querySelectorAll("#builder-preview button")).find((button) =>
      button.textContent.includes("Clear Compare")
    );
    const applyNode = Array.from(doc.querySelectorAll("#builder-preview button")).find((button) =>
      button.textContent.includes("Apply Node")
    );

    setCompareA.click();
    setCompareB.click();
    expect(doc.querySelector("#builder-preview").textContent).toContain("Score delta");

    clearCompare.click();
    expect(doc.querySelector("#builder-preview").textContent).toContain("Not set");

    applyNode.click();
    expect(state.builder.stage).toBe("inspect");
    expect(doc.querySelector("#builder-preview").textContent).toContain("No node selected");
    expect(doc.querySelectorAll("#builder-tree-map circle").length).toBeGreaterThan(0);
  });
});
