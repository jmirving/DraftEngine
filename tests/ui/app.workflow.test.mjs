import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { parseChampionsCsv } from "../../src/index.js";

const htmlFixture = readFileSync(resolve("public/index.html"), "utf8");
const championsCsv = readFileSync(resolve("public/data/champions.csv"), "utf8");

function createFetchImpl() {
  const parsed = parseChampionsCsv(championsCsv);
  const champions = parsed.champions.map((champion, index) => ({
    id: index + 1,
    name: champion.name,
    role: champion.roles[0],
    metadata: {
      roles: champion.roles,
      damageType: champion.damageType,
      scaling: champion.scaling,
      tags: champion.tags
    },
    tagIds: []
  }));

  return async (url) => {
    const path = new URL(url, "http://api.test").pathname;
    if (path === "/champions") {
      return {
        ok: true,
        status: 200,
        async json() {
          return { champions };
        }
      };
    }
    if (path === "/me/pools") {
      return {
        ok: true,
        status: 200,
        async json() {
          return { pools: [] };
        }
      };
    }
    if (path === "/me/profile") {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            profile: {
              id: 1,
              email: "workflow@example.com",
              gameName: "WorkflowPlayer",
              tagline: "NA1",
              primaryRole: "Mid",
              secondaryRoles: ["Top"]
            }
          };
        }
      };
    }
    if (path === "/teams") {
      return {
        ok: true,
        status: 200,
        async json() {
          return { teams: [] };
        }
      };
    }
    return {
      ok: false,
      status: 404,
      async json() {
        return {
          error: {
            code: "NOT_FOUND",
            message: "Route not mocked."
          }
        };
      }
    };
  };
}

function createStorageStub() {
  const store = new Map([
    [
      "draftflow.authSession.v1",
      JSON.stringify({
        token: "token-123",
        user: {
          id: 1,
          email: "workflow@example.com",
          gameName: "WorkflowPlayer",
          tagline: "NA1"
        }
      })
    ]
  ]);
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
    matchMediaImpl: createMatchMedia(),
    apiBaseUrl: "http://api.test"
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
    const validLeavesOnly = doc.querySelector("#tree-valid-leaves-only");
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

  test("empty root summary offers recovery CTAs for filters and candidate floor", async () => {
    const { dom, state } = await bootApp();
    const doc = dom.window.document;
    const topSelect = doc.querySelector("#slot-Top");
    const continueButton = doc.querySelector("#builder-continue-validate");
    const generateButton = doc.querySelector("#builder-generate");
    const treeSearch = doc.querySelector("#tree-search");
    const validLeavesOnly = doc.querySelector("#tree-valid-leaves-only");

    const firstTop = Array.from(topSelect.options).find((option) => option.value);
    topSelect.value = firstTop.value;
    topSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    continueButton.click();
    generateButton.click();

    state.builder.treeMinCandidateScore = 2;
    state.builder.treeValidLeavesOnly = true;
    validLeavesOnly.checked = true;
    state.builder.treeSearch = "blocked";
    treeSearch.value = "blocked";
    state.builder.tree = {
      depth: 0,
      teamSlots: { Top: firstTop.value, Jungle: null, Mid: null, ADC: null, Support: null },
      score: 16,
      requiredSummary: { requiredGaps: 1 },
      viability: {
        remainingSteps: 4,
        unreachableRequired: [],
        isDraftComplete: false,
        isTerminalValid: false,
        fallbackApplied: false
      },
      pathRationale: [],
      branchPotential: {
        validLeafCount: 0,
        bestLeafScore: null
      },
      children: [
        {
          depth: 1,
          teamSlots: { Top: firstTop.value, Jungle: "Hecarim", Mid: null, ADC: null, Support: null },
          score: 17,
          requiredSummary: { requiredGaps: 1 },
          viability: {
            remainingSteps: 3,
            unreachableRequired: [],
            isDraftComplete: false,
            isTerminalValid: false,
            fallbackApplied: true
          },
          pathRationale: [],
          branchPotential: {
            validLeafCount: 0,
            bestLeafScore: null
          },
          addedRole: "Jungle",
          addedChampion: "Hecarim",
          candidateScore: 1,
          passesMinScore: false,
          rationale: [],
          children: []
        }
      ],
      generationStats: {
        nodesVisited: 2,
        nodesKept: 2,
        prunedUnreachable: 0,
        prunedLowCandidateScore: 1,
        fallbackCandidatesUsed: 1,
        fallbackNodes: 1,
        completeDraftLeaves: 0,
        incompleteDraftLeaves: 1,
        validLeaves: 0,
        incompleteLeaves: 1
      }
    };

    treeSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    expect(doc.querySelector("#builder-tree-summary").textContent).toContain("No root branches match current filters.");
    const clearSearch = Array.from(doc.querySelectorAll("#builder-tree-summary button")).find((button) =>
      button.textContent.includes("Clear Search")
    );
    const showAll = Array.from(doc.querySelectorAll("#builder-tree-summary button")).find((button) =>
      button.textContent.includes("Show all branches")
    );
    const lowerFloor = Array.from(doc.querySelectorAll("#builder-tree-summary button")).find((button) =>
      button.textContent.includes("Lower Min Candidate Score to 0")
    );

    expect(clearSearch).toBeTruthy();
    expect(showAll).toBeTruthy();
    expect(lowerFloor).toBeTruthy();

    clearSearch.click();
    expect(treeSearch.value).toBe("");
    expect(state.builder.treeSearch).toBe("");

    showAll.click();
    expect(validLeavesOnly.checked).toBe(false);
    expect(state.builder.treeValidLeavesOnly).toBe(false);
    expect(doc.querySelectorAll("#builder-tree-summary button").length).toBeGreaterThan(0);

    validLeavesOnly.checked = true;
    validLeavesOnly.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    const lowerFloorAfterReset = Array.from(doc.querySelectorAll("#builder-tree-summary button")).find((button) =>
      button.textContent.includes("Lower Min Candidate Score to 0")
    );
    lowerFloorAfterReset.click();
    expect(state.builder.treeMinCandidateScore).toBe(0);
    expect(state.builder.stage).toBe("setup");
    expect(state.builder.tree).toBe(null);
  });

  test("team context supports named team labels and None global pool mode", async () => {
    const { dom } = await bootApp();
    const doc = dom.window.document;
    const teamSelect = doc.querySelector("#builder-active-team");
    const topLabel = doc.querySelector("#slot-label-Top");
    const teamHelp = doc.querySelector("#builder-team-help");

    expect(topLabel.textContent).toBe("Top");

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

  test("profile screen defaults to primary role pool when API pools are missing", async () => {
    const { dom, state } = await bootApp();
    const doc = dom.window.document;

    doc.querySelector(".side-menu-link[data-tab='player-config']").click();
    const firstPoolCheckbox = doc.querySelector(".player-pool-control input[type='checkbox']");
    expect(firstPoolCheckbox).toBeTruthy();
    expect(doc.querySelector("#player-config-team").value).toBe("role:Mid");
    expect(doc.querySelector("#player-config-summary").textContent).toContain("Editing Mid pool");
    expect(state.builder.stage).toBe("setup");
  });

  test("tree inspect drills into next branch layer and supports back navigation", async () => {
    const { dom, state } = await bootApp();
    const doc = dom.window.document;
    const topSelect = doc.querySelector("#slot-Top");
    const continueButton = doc.querySelector("#builder-continue-validate");
    const generateButton = doc.querySelector("#builder-generate");
    const validLeavesOnly = doc.querySelector("#tree-valid-leaves-only");

    const firstTop = Array.from(topSelect.options).find((option) => option.value);
    topSelect.value = firstTop.value;
    topSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    continueButton.click();
    generateButton.click();
    validLeavesOnly.checked = false;
    validLeavesOnly.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    const initialFilledSlots = Object.values(state.builder.teamState).filter(Boolean).length;
    const inspectButtons = doc.querySelectorAll("#builder-tree-summary .summary-card button");
    expect(inspectButtons.length).toBeGreaterThan(0);
    inspectButtons[0].click();

    expect(state.builder.stage).toBe("inspect");
    expect(state.builder.focusNodeId).not.toBe("0");
    expect(Object.values(state.builder.teamState).filter(Boolean).length).toBeGreaterThan(initialFilledSlots);
    expect(doc.querySelector("#builder-tree-summary").textContent).toContain("Top branches from");

    const backButton = Array.from(doc.querySelectorAll("#builder-tree-summary button")).find((button) =>
      button.textContent === "Back"
    );
    expect(backButton).toBeTruthy();
    backButton.click();

    expect(state.builder.focusNodeId).toBe("0");
    expect(doc.querySelector("#builder-tree-summary").textContent).toContain("Top branches from root:");
    expect(doc.querySelector("#builder-preview")).toBe(null);
    expect(doc.querySelectorAll("#builder-tree-map circle").length).toBeGreaterThan(0);
  });
});
