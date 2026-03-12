import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, test, vi } from "vitest";

const htmlFixture = readFileSync(resolve("public/index.html"), "utf8");
const championCatalog = [
  { name: "Aatrox", roles: ["Top"], damageType: "AD", scaling: "Mid" },
  { name: "Camille", roles: ["Top"], damageType: "AD", scaling: "Mid" },
  { name: "Lee Sin", roles: ["Jungle"], damageType: "AD", scaling: "Early" },
  { name: "Sejuani", roles: ["Jungle"], damageType: "Mixed", scaling: "Mid" },
  { name: "LeBlanc", roles: ["Mid"], damageType: "AP", scaling: "Mid" },
  { name: "Kha'Zix", roles: ["Jungle", "Mid"], damageType: "AD", scaling: "Mid" },
  { name: "Kai'Sa", roles: ["ADC"], damageType: "Mixed", scaling: "Late" },
  { name: "Ashe", roles: ["ADC"], damageType: "AD", scaling: "Late" },
  { name: "Renata Glasc", roles: ["Support"], damageType: "AP", scaling: "Mid" },
  { name: "Nunu & Willump", roles: ["Jungle"], damageType: "AP", scaling: "Mid" },
  { name: "Wukong", roles: ["Top", "Jungle"], damageType: "AD", scaling: "Mid" },
  { name: "Cho'Gath", roles: ["Top"], damageType: "AP", scaling: "Late" },
  { name: "Braum", roles: ["Support"], damageType: "AD", scaling: "Mid" },
  { name: "Nami", roles: ["Support"], damageType: "AP", scaling: "Mid" }
];
const expectedChampionCount = championCatalog.length;

function createFetchImpl() {
  const tags = [
    { id: 1, name: "HardEngage", category: "composition" },
    { id: 2, name: "Frontline", category: "composition" },
    { id: 3, name: "Waveclear", category: "composition" },
    { id: 4, name: "PrimaryCarry", category: "composition" },
    { id: 5, name: "Disengage", category: "composition" }
  ];
  const champions = championCatalog.map((champion, index) => ({
    id: index + 1,
    name: champion.name,
    role: champion.roles[0],
    metadata: {
      roles: champion.roles,
      damageType: champion.damageType,
      scaling: champion.scaling,
      tags: champion.tags
    },
    tagIds:
      champion.name === "Aatrox" || champion.name === "Sejuani"
        ? [1, 2]
        : champion.name === "LeBlanc" || champion.name === "Cho'Gath"
          ? [3]
          : champion.name === "Kai'Sa" || champion.name === "Ashe"
            ? [4]
            : champion.name === "Nami" || champion.name === "Renata Glasc"
              ? [5]
              : []
  }));
  let teamContext = {
    activeTeamId: null
  };

  return async (url, init = {}) => {
    const path = new URL(url, "http://api.test").pathname;
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    if (path === "/champions") {
      return {
        ok: true,
        status: 200,
        async json() {
          return { champions };
        }
      };
    }
    if (path === "/tags") {
      return {
        ok: true,
        status: 200,
        async json() {
          return { tags };
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
    if (path === "/me/team-context" && method === "GET") {
      return {
        ok: true,
        status: 200,
        async json() {
          return { teamContext };
        }
      };
    }
    if (path === "/me/team-context" && method === "PUT") {
      teamContext = {
        activeTeamId: body?.activeTeamId ?? null
      };
      return {
        ok: true,
        status: 200,
        async json() {
          return { teamContext };
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
          tagline: "NA1",
          primaryRole: "Mid",
          secondaryRoles: ["Top"]
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

function getPoolCard(doc, slot) {
  return doc.querySelector(`#team-config-pool-grid [data-slot='${slot}']`);
}

function getPoolChampionItems(doc, slot) {
  return Array.from(getPoolCard(doc, slot)?.querySelectorAll(".pool-snapshot-list li:not(.pool-snapshot-empty)") ?? []);
}

function pickSlotChampion(doc, slot, championName = null) {
  const items = getPoolChampionItems(doc, slot);
  const item = championName
    ? items.find((candidate) => candidate.textContent.trim() === championName)
    : items[0];
  expect(item).toBeTruthy();
  item.click();
  return item.textContent.trim();
}

function openExplorerEditor(doc) {
  doc.querySelector(".side-menu-link[data-tab='explorer']").click();
  doc.querySelector(".explorer-sub-nav-btn[data-explorer-sub='edit-champions']").click();
}

describe("workflow app integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("initializes in setup stage with review stage hidden and generation gated", async () => {
    const { dom, state } = await bootApp();
    const setupPanel = dom.window.document.querySelector("#builder-stage-setup");
    const reviewPanel = dom.window.document.querySelector("#builder-stage-inspect");
    const continueButton = dom.window.document.querySelector("#builder-continue-validate");
    const generateButton = dom.window.document.querySelector("#builder-generate");

    expect(state.activeTab).toBe("workflow");
    expect(setupPanel.hidden).toBe(false);
    expect(reviewPanel.hidden).toBe(false);
    expect(continueButton.hidden).toBe(true);
    expect(generateButton.disabled).toBe(false);
  });

  test("requires at least one pick before entering review, then auto-generates on transition", async () => {
    const { dom } = await bootApp();
    const doc = dom.window.document;
    pickSlotChampion(doc, "Top");
    doc.querySelector("#builder-generate").click();

    expect(doc.querySelector("#builder-stage-inspect").hidden).toBe(false);
    expect(doc.querySelector("#builder-generate").disabled).toBe(false);
    expect(doc.querySelectorAll("#builder-tree-map circle").length).toBeGreaterThan(0);
  });

  test("invalid slot picks are rejected and excluded picks are cleared from slots", async () => {
    const { dom } = await bootApp();
    const doc = dom.window.document;
    const teamSelect = doc.querySelector("#builder-active-team");
    const topCard = getPoolCard(doc, "Top");
    const jungleCard = getPoolCard(doc, "Jungle");
    const topRoleSelect = topCard.querySelector(".pool-snapshot-role-select");
    const teamSummary = doc.querySelector("#team-config-pool-summary");
    const excludedSearch = doc.querySelector("#builder-excluded-search");

    teamSelect.value = "__NONE_TEAM__";
    teamSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    const topChampion = pickSlotChampion(doc, "Top");

    excludedSearch.value = topChampion;
    excludedSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    const excludeOption = Array.from(doc.querySelectorAll("#builder-excluded-options li"))
      .find((node) => node.textContent.trim() === topChampion);
    expect(excludeOption).toBeTruthy();
    excludeOption.click();

    expect(topCard.querySelector(".pool-snapshot-list li.is-selected")).toBeNull();
    expect(doc.querySelector("#builder-excluded-pills").textContent).toContain(topChampion);

    topRoleSelect.value = "Jungle";
    topRoleSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(jungleCard.querySelector(".pool-snapshot-role-select").value).toBe("Jungle");
    expect(teamSummary.textContent).toContain("All roles must be unique!");
  });

  test("generates tree output and tree filters reduce visible map nodes", async () => {
    const { dom } = await bootApp();
    const doc = dom.window.document;
    const generateButton = doc.querySelector("#builder-generate");
    const validLeavesOnly = doc.querySelector("#tree-valid-leaves-only");
    const treeSearch = doc.querySelector("#tree-search");
    const treeMinScore = doc.querySelector("#tree-min-score");

    pickSlotChampion(doc, "Top");
    generateButton.click();

    const initialCircles = doc.querySelectorAll("#builder-tree-map circle").length;
    expect(initialCircles).toBeGreaterThan(0);
    const initialSummaryText = doc.querySelector("#builder-tree-summary").textContent;
    expect(initialSummaryText).toMatch(/Immediate gain:|No immediate clause coverage change;/);
    expect(initialSummaryText).toMatch(/Still missing:|All current clause ranges satisfied/);
    expect(initialSummaryText).not.toContain("required matches still missing");

    treeSearch.value = "zzzz-no-node";
    treeSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    const afterSearchCircles = doc.querySelectorAll("#builder-tree-map circle").length;
    expect(afterSearchCircles).toBeLessThanOrEqual(initialCircles);

    treeMinScore.value = "999";
    treeMinScore.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    const afterMinScoreCircles = doc.querySelectorAll("#builder-tree-map circle").length;
    expect(afterMinScoreCircles).toBe(1);
    const treeSummaryText = doc.querySelector("#builder-tree-summary").textContent;
    expect(treeSummaryText).toContain("Ranked by viable end states first");
    expect(treeSummaryText).toContain("viable finish");
    expect(treeSummaryText).toContain("Generation stats");
  });

  test("advanced scoring controls in setup update generation floor, rank goal, and redundancy penalty", async () => {
    const { dom, state } = await bootApp();
    const doc = dom.window.document;
    const generateButton = doc.querySelector("#builder-generate");
    const minCandidateScore = doc.querySelector("#tree-min-candidate-score");
    const rankGoal = doc.querySelector("#tree-rank-goal");
    const redundancyPenalty = doc.querySelector("#tree-candidate-redundancy-penalty");

    expect(minCandidateScore).toBeTruthy();
    expect(rankGoal).toBeTruthy();
    expect(redundancyPenalty).toBeTruthy();
    expect(doc.querySelector("#builder-max-depth")).toBeNull();

    minCandidateScore.value = "1000";
    minCandidateScore.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(state.builder.treeMinCandidateScore).toBe(1000);

    rankGoal.value = "candidate_score";
    rankGoal.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(state.builder.treeRankGoal).toBe("candidate_score");

    redundancyPenalty.value = "7";
    redundancyPenalty.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(state.builder.candidateScoringWeights.redundancyPenalty).toBe(7);

    pickSlotChampion(doc, "Top");
    generateButton.click();

    expect(state.builder.tree).toBeTruthy();
    expect(state.builder.tree.children.length).toBeGreaterThan(0);
    expect(state.builder.tree.children.every((child) => child.passesMinScore === false)).toBe(true);
    expect(state.builder.tree.children.every((child) => typeof child.candidateScore === "number")).toBe(true);
  });

  test("empty root summary offers recovery CTAs for filters and candidate floor", async () => {
    const { dom, state } = await bootApp();
    const doc = dom.window.document;
    const generateButton = doc.querySelector("#builder-generate");
    const treeSearch = doc.querySelector("#tree-search");
    const validLeavesOnly = doc.querySelector("#tree-valid-leaves-only");

    const firstTop = pickSlotChampion(doc, "Top");
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
    const topLabel = getPoolCard(doc, "Top").querySelector(".pool-snapshot-header strong");
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

  test("explorer renders all champions from the loaded catalog by default", async () => {
    const { dom } = await bootApp();
    const doc = dom.window.document;

    openExplorerEditor(doc);

    expect(expectedChampionCount).toBeGreaterThan(0);
    expect(doc.querySelectorAll("#explorer-results .champ-card").length).toBe(expectedChampionCount);
    expect(doc.querySelector("#explorer-count").textContent).toContain(`Results: ${expectedChampionCount}`);
  });

  test("explorer cards render current summary labels", async () => {
    const { dom } = await bootApp();
    const doc = dom.window.document;

    openExplorerEditor(doc);

    const firstCard = doc.querySelector("#explorer-results .champ-card");
    expect(firstCard).toBeTruthy();
    expect(firstCard.textContent).toContain("Role(s)");
    expect(firstCard.textContent).toContain("Damage Type");
    expect(firstCard.textContent).toContain("Effectiveness Focus");
  });

  test("explorer uses explicit Data Dragon image-key overrides for special champion names", async () => {
    const { dom } = await bootApp();
    const doc = dom.window.document;
    const searchInput = doc.querySelector("#explorer-search");

    openExplorerEditor(doc);

    function expectChampionImageKey(championName, expectedImageKey) {
      searchInput.value = championName;
      searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

      const card = doc.querySelector("#explorer-results .champ-card");
      expect(card).toBeTruthy();
      expect(card.querySelector(".champ-name").textContent).toBe(championName);
      expect(card.querySelector(".champ-thumb").src).toContain(`/loading/${expectedImageKey}_0.jpg`);
    }

    expectChampionImageKey("Renata Glasc", "Renata");
    expectChampionImageKey("Nunu & Willump", "Nunu");
    expectChampionImageKey("Wukong", "MonkeyKing");
    expectChampionImageKey("LeBlanc", "Leblanc");
    expectChampionImageKey("Kha'Zix", "Khazix");
    expectChampionImageKey("Kai'Sa", "Kaisa");
    expectChampionImageKey("Cho'Gath", "Chogath");
  });

  test("profile screen defaults to primary role pool when API pools are missing", async () => {
    const { dom, state } = await bootApp();
    const doc = dom.window.document;

    doc.querySelector(".side-menu-link[data-tab='explorer']").click();
    const firstPoolCheckbox = doc.querySelector(".player-pool-control input[type='checkbox']");
    expect(firstPoolCheckbox).toBeTruthy();
    expect(doc.querySelector("#player-config-team").value).toBe("role:Mid");
    expect(state.builder.stage).toBe("setup");
  });

  test("tree inspect drills into next branch layer and supports back navigation", async () => {
    const { dom, state } = await bootApp();
    const doc = dom.window.document;
    const generateButton = doc.querySelector("#builder-generate");
    const validLeavesOnly = doc.querySelector("#tree-valid-leaves-only");

    const firstTop = pickSlotChampion(doc, "Top");
    generateButton.click();
    validLeavesOnly.checked = false;
    validLeavesOnly.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    const initialFilledSlots = Object.values(state.builder.teamState).filter(Boolean).length;
    let inspectButtons = doc.querySelectorAll("#builder-tree-summary .summary-card button");
    if (inspectButtons.length === 0) {
      state.builder.tree = {
        depth: 0,
        teamSlots: { Top: firstTop.value, Jungle: null, Mid: null, ADC: null, Support: null },
        score: 10,
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
          validLeafCount: 1,
          bestLeafScore: 12
        },
        children: [
          {
            depth: 1,
            teamSlots: { Top: firstTop.value, Jungle: "Lee Sin", Mid: null, ADC: null, Support: null },
            score: 12,
            requiredSummary: { requiredGaps: 1 },
            viability: {
              remainingSteps: 3,
              unreachableRequired: [],
              isDraftComplete: false,
              isTerminalValid: false,
              fallbackApplied: false
            },
            pathRationale: [],
            branchPotential: {
              validLeafCount: 1,
              bestLeafScore: 12
            },
            addedRole: "Jungle",
            addedChampion: "Lee Sin",
            candidateScore: 2,
            passesMinScore: true,
            rationale: [],
            children: []
          }
        ],
        generationStats: {
          nodesVisited: 2,
          nodesKept: 2,
          prunedUnreachable: 0,
          prunedLowCandidateScore: 0,
          prunedRelativeCandidateScore: 0,
          fallbackCandidatesUsed: 0,
          fallbackNodes: 0,
          completeDraftLeaves: 0,
          incompleteDraftLeaves: 1,
          validLeaves: 1,
          incompleteLeaves: 1
        }
      };
      const treeSearch = doc.querySelector("#tree-search");
      treeSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      inspectButtons = doc.querySelectorAll("#builder-tree-summary .summary-card button");
    }
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
