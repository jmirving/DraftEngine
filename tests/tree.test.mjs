import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildDraftflowData } from "../src/data/loaders.js";
import { BOOLEAN_TAGS } from "../src/domain/model.js";
import { generatePossibilityTree } from "../src/engine/tree.js";

const championsCsv = readFileSync(resolve("docs/DraftFlow_champions.csv"), "utf8");
const teamPoolsCsv = readFileSync(resolve("docs/DraftFlow_team_pools.csv"), "utf8");
const configJson = readFileSync(resolve("docs/DraftFlow_config.json"), "utf8");

const data = buildDraftflowData({
  championsCsvText: championsCsv,
  teamPoolsCsvText: teamPoolsCsv,
  configJsonText: configJson
});

function collectPickedChampionsFromTree(node, picked = new Set()) {
  if (node.addedChampion) {
    picked.add(node.addedChampion);
  }
  for (const child of node.children) {
    collectPickedChampionsFromTree(child, picked);
  }
  return picked;
}

function collectRationaleFromTree(node, all = []) {
  if (Array.isArray(node.rationale)) {
    all.push(...node.rationale);
  }
  for (const child of node.children) {
    collectRationaleFromTree(child, all);
  }
  return all;
}

function collectNodes(node, nodes = []) {
  nodes.push(node);
  for (const child of node.children) {
    collectNodes(child, nodes);
  }
  return nodes;
}

function createTags(overrides = {}) {
  const tags = {};
  for (const tag of BOOLEAN_TAGS) {
    tags[tag] = false;
  }
  return {
    ...tags,
    ...overrides
  };
}

function createChampion({ name, roles, damageType, tags = {} }) {
  return {
    name,
    roles,
    damageType,
    scaling: "Mid",
    tags: createTags(tags)
  };
}

test("generatePossibilityTree is deterministic for same inputs", () => {
  const params = {
    teamState: {
      Mid: "Azir",
      ADC: "Ashe"
    },
    teamId: "TTT",
    nextRole: "Top",
    teamPools: data.teamPools,
    championsByName: data.championsByName,
    toggles: {
      requireHardEngage: true,
      requireFrontline: true,
      requireWaveclear: true,
      requireDamageMix: true,
      requireAntiTank: false,
      requireDisengage: false,
      requirePrimaryCarry: true,
      topMustBeThreat: true
    },
    excludedChampions: ["Aatrox"],
    weights: data.config.recommendation.weights,
    maxDepth: 2,
    maxBranch: 5
  };

  const first = generatePossibilityTree(params);
  const second = generatePossibilityTree(params);
  expect(first).toEqual(second);
});

test("excluded champions never appear in generated tree", () => {
  const tree = generatePossibilityTree({
    teamState: {
      Mid: "Azir",
      ADC: "Ashe"
    },
    teamId: "TTT",
    nextRole: "Jungle",
    teamPools: data.teamPools,
    championsByName: data.championsByName,
    excludedChampions: ["Hecarim", "Zac", "Amumu"],
    weights: data.config.recommendation.weights,
    maxDepth: 2,
    maxBranch: 10
  });

  const picks = collectPickedChampionsFromTree(tree);
  expect(picks.has("Hecarim")).toBe(false);
  expect(picks.has("Zac")).toBe(false);
  expect(picks.has("Amumu")).toBe(false);
});

test("top threat enforcement filters illegal top candidates", () => {
  const tree = generatePossibilityTree({
    teamState: {
      Mid: "Azir"
    },
    teamId: "TTT",
    nextRole: "Top",
    teamPools: data.teamPools,
    championsByName: data.championsByName,
    toggles: {
      topMustBeThreat: true
    },
    weights: data.config.recommendation.weights,
    maxDepth: 1,
    maxBranch: 20
  });

  expect(tree.children.length).toBeGreaterThan(0);
  for (const child of tree.children) {
    const topChampion = data.championsByName[child.addedChampion];
    const isThreat = topChampion.tags.SideLaneThreat || topChampion.tags.DiveThreat;
    expect(isThreat).toBe(true);
  }
});

test("candidate expansion respects selected role pools", () => {
  const teamId = "TTT";
  const junglePool = new Set(data.teamPools[teamId].Jungle);

  const tree = generatePossibilityTree({
    teamState: {
      Mid: "Azir"
    },
    teamId,
    nextRole: "Jungle",
    teamPools: data.teamPools,
    championsByName: data.championsByName,
    toggles: {
      topMustBeThreat: true
    },
    weights: data.config.recommendation.weights,
    maxDepth: 2,
    maxBranch: 10
  });

  expect(tree.children.length).toBeGreaterThan(0);
  for (const child of tree.children) {
    expect(child.addedRole).toBe("Jungle");
    expect(junglePool.has(child.addedChampion)).toBe(true);
  }
});

test("candidate rationale no longer includes redundancy penalties", () => {
  const tree = generatePossibilityTree({
    teamState: {
      Mid: "Azir",
      ADC: "Ashe"
    },
    teamId: "TTT",
    nextRole: "Top",
    teamPools: data.teamPools,
    championsByName: data.championsByName,
    weights: data.config.recommendation.weights,
    maxDepth: 2,
    maxBranch: 6
  });

  const rationale = collectRationaleFromTree(tree);
  expect(rationale.some((entry) => entry.toLowerCase().includes("redundancy penalty"))).toBe(false);
});

test("roleOrder controls which unfilled role expands first", () => {
  const tree = generatePossibilityTree({
    teamState: {
      Mid: "Azir",
      Support: "Nami"
    },
    teamId: "TTT",
    roleOrder: ["Support", "Top", "ADC", "Jungle", "Mid"],
    teamPools: data.teamPools,
    championsByName: data.championsByName,
    weights: data.config.recommendation.weights,
    maxDepth: 1,
    maxBranch: 5
  });

  expect(tree.children.length).toBeGreaterThan(0);
  for (const child of tree.children) {
    expect(child.addedRole).toBe("Top");
  }
});

test("node scoring can exceed historical low cap for richer comps", () => {
  const tree = generatePossibilityTree({
    teamState: {
      Top: "Aatrox",
      Jungle: "Hecarim",
      Mid: "Azir",
      ADC: "Ashe",
      Support: "Nami"
    },
    teamId: "TTT",
    teamPools: data.teamPools,
    championsByName: data.championsByName,
    toggles: {
      requireHardEngage: true,
      requireFrontline: true,
      requireWaveclear: true,
      requireDamageMix: true,
      requireAntiTank: true,
      requireDisengage: true,
      requirePrimaryCarry: true,
      topMustBeThreat: true
    },
    weights: data.config.recommendation.weights,
    maxDepth: 1,
    maxBranch: 5
  });

  expect(tree.score).toBeGreaterThan(50);
});

test("deeper nodes include cumulative path rationale", () => {
  const tree = generatePossibilityTree({
    teamState: {
      Mid: "Azir"
    },
    teamId: "TTT",
    roleOrder: ["Top", "Jungle", "ADC", "Support", "Mid"],
    teamPools: data.teamPools,
    championsByName: data.championsByName,
    weights: data.config.recommendation.weights,
    maxDepth: 3,
    maxBranch: 4
  });

  const nodes = collectNodes(tree);
  const deepNodes = nodes.filter((node) => node.depth >= 2);
  expect(deepNodes.length).toBeGreaterThan(0);
  for (const node of deepNodes) {
    expect(Array.isArray(node.pathRationale)).toBe(true);
    expect(node.pathRationale.length).toBeGreaterThanOrEqual(2);
  }
});

test("tree exposes requiredSummary, viability, and generation stats metadata", () => {
  const tree = generatePossibilityTree({
    teamState: {
      Mid: "Azir"
    },
    teamId: "TTT",
    teamPools: data.teamPools,
    championsByName: data.championsByName,
    weights: data.config.recommendation.weights,
    maxDepth: 2,
    maxBranch: 4
  });

  expect(tree.requiredSummary).toMatchObject({
    requiredTotal: expect.any(Number),
    requiredPassed: expect.any(Number),
    requiredGaps: expect.any(Number)
  });
  expect(tree.viability).toMatchObject({
    remainingSteps: expect.any(Number),
    unreachableRequired: expect.any(Array),
    isTerminalValid: expect.any(Boolean),
    fallbackApplied: expect.any(Boolean)
  });
  expect(tree.generationStats).toMatchObject({
    nodesVisited: expect.any(Number),
    nodesKept: expect.any(Number),
    prunedUnreachable: expect.any(Number),
    prunedLowCandidateScore: expect.any(Number),
    fallbackCandidatesUsed: expect.any(Number),
    fallbackNodes: expect.any(Number),
    completeDraftLeaves: expect.any(Number),
    incompleteDraftLeaves: expect.any(Number),
    validLeaves: expect.any(Number),
    incompleteLeaves: expect.any(Number)
  });
});

test("default minCandidateScore no longer forces dead-end tree for Top=Aatrox baseline", () => {
  const tree = generatePossibilityTree({
    teamState: {
      Top: "Aatrox"
    },
    teamId: "TTT",
    roleOrder: ["Top", "Jungle", "Mid", "ADC", "Support"],
    teamPools: data.teamPools,
    championsByName: data.championsByName,
    toggles: {
      requireHardEngage: true,
      requireFrontline: true,
      requireWaveclear: true,
      requireDamageMix: true,
      requireAntiTank: false,
      requireDisengage: false,
      requirePrimaryCarry: true,
      topMustBeThreat: true
    },
    weights: data.config.recommendation.weights,
    maxDepth: 4,
    maxBranch: 8,
    minCandidateScore: 1,
    pruneUnreachableRequired: true,
    rankGoal: "valid_end_states"
  });

  // Historical baseline before adaptive/floor-aware scoring was:
  // completeDraftLeaves=0, validLeaves=0, prunedLowCandidateScore=174.
  expect(tree.generationStats.completeDraftLeaves).toBeGreaterThan(0);
  expect(tree.generationStats.validLeaves).toBeGreaterThan(0);
});

test("adaptive fallback expands below-floor candidates when strict floor prunes all legal options", () => {
  const params = {
    teamState: {
      Mid: "Azir"
    },
    teamId: "TTT",
    nextRole: "Top",
    teamPools: data.teamPools,
    championsByName: data.championsByName,
    toggles: {
      requireHardEngage: false,
      requireFrontline: false,
      requireWaveclear: false,
      requireDamageMix: false,
      requireAntiTank: false,
      requireDisengage: false,
      requirePrimaryCarry: false,
      topMustBeThreat: false
    },
    weights: data.config.recommendation.weights,
    maxDepth: 1,
    maxBranch: 10,
    minCandidateScore: 2
  };

  const tree = generatePossibilityTree(params);

  expect(tree.children.length).toBeGreaterThan(0);
  expect(tree.generationStats.prunedLowCandidateScore).toBeGreaterThan(0);
  expect(tree.generationStats.fallbackNodes).toBeGreaterThan(0);
  expect(tree.generationStats.fallbackCandidatesUsed).toBeGreaterThan(0);
  for (const child of tree.children) {
    expect(child.passesMinScore).toBe(false);
  }
});

test("missing PrimaryCarry gets minimum required-check gain even when configured weight is zero", () => {
  const championsByName = {
    UtilityMid: createChampion({
      name: "UtilityMid",
      roles: ["Mid"],
      damageType: "AP"
    }),
    TopPrimary: createChampion({
      name: "TopPrimary",
      roles: ["Top"],
      damageType: "AD",
      tags: { PrimaryCarry: true }
    })
  };

  const tree = generatePossibilityTree({
    teamState: {
      Mid: "UtilityMid"
    },
    teamId: "X",
    nextRole: "Top",
    teamPools: {
      X: {
        Top: ["TopPrimary"],
        Jungle: [],
        Mid: ["UtilityMid"],
        ADC: [],
        Support: []
      }
    },
    championsByName,
    toggles: {
      requireHardEngage: false,
      requireFrontline: false,
      requireWaveclear: false,
      requireDamageMix: false,
      requireAntiTank: false,
      requireDisengage: false,
      requirePrimaryCarry: true,
      topMustBeThreat: false
    },
    weights: data.config.recommendation.weights,
    maxDepth: 1,
    maxBranch: 5,
    minCandidateScore: 2,
    pruneUnreachableRequired: false
  });

  expect(tree.children.length).toBe(1);
  expect(tree.children[0].addedChampion).toBe("TopPrimary");
  expect(tree.children[0].candidateScore).toBeGreaterThanOrEqual(2);
  expect(tree.children[0].passesMinScore).toBe(true);
  expect(tree.children[0].rationale.some((entry) => entry.includes("required-check floor"))).toBe(true);
});

test("depth-limited incomplete leaves are never terminal-valid", () => {
  const tree = generatePossibilityTree({
    teamState: {},
    teamId: "TTT",
    nextRole: "Top",
    teamPools: data.teamPools,
    championsByName: data.championsByName,
    toggles: {
      requireHardEngage: false,
      requireFrontline: false,
      requireWaveclear: false,
      requireDamageMix: false,
      requireAntiTank: false,
      requireDisengage: false,
      requirePrimaryCarry: false,
      topMustBeThreat: false
    },
    weights: data.config.recommendation.weights,
    maxDepth: 1,
    maxBranch: 5,
    minCandidateScore: 0,
    pruneUnreachableRequired: false
  });

  expect(tree.children.length).toBeGreaterThan(0);
  for (const child of tree.children) {
    expect(child.viability.isDraftComplete).toBe(false);
    expect(child.viability.isTerminalValid).toBe(false);
    expect(child.branchPotential.validLeafCount).toBe(0);
  }
  expect(tree.generationStats.validLeaves).toBe(0);
});

test("hard pruning removes branches with unreachable required checks", () => {
  const championsByName = {
    ThreatTop: createChampion({
      name: "ThreatTop",
      roles: ["Top"],
      damageType: "AD",
      tags: { SideLaneThreat: true }
    }),
    JungleNoWave: createChampion({
      name: "JungleNoWave",
      roles: ["Jungle"],
      damageType: "AD"
    })
  };

  const tree = generatePossibilityTree({
    teamState: {
      Top: "ThreatTop"
    },
    teamId: "X",
    roleOrder: ["Jungle", "Top", "Mid", "ADC", "Support"],
    teamPools: {
      X: {
        Top: ["ThreatTop"],
        Jungle: ["JungleNoWave"],
        Mid: [],
        ADC: [],
        Support: []
      }
    },
    championsByName,
    toggles: {
      requireHardEngage: false,
      requireFrontline: false,
      requireWaveclear: true,
      requireDamageMix: false,
      requireAntiTank: false,
      requireDisengage: false,
      requirePrimaryCarry: false,
      topMustBeThreat: false
    },
    maxDepth: 1,
    maxBranch: 5,
    minCandidateScore: 0
  });

  expect(tree.viability.unreachableRequired).toContain("HasWaveclear");
  expect(tree.children.length).toBe(0);
  expect(tree.viability.isDraftComplete).toBe(false);
  expect(tree.generationStats.incompleteDraftLeaves).toBeGreaterThan(0);
  expect(tree.generationStats.prunedUnreachable).toBeGreaterThan(0);
});

test("top threat requirement can be unreachable by horizon and branch gets pruned", () => {
  const championsByName = {
    JungleOnly: createChampion({
      name: "JungleOnly",
      roles: ["Jungle"],
      damageType: "AD"
    })
  };

  const tree = generatePossibilityTree({
    teamState: {},
    teamId: "X",
    roleOrder: ["Jungle", "Top", "Mid", "ADC", "Support"],
    teamPools: {
      X: {
        Top: [],
        Jungle: ["JungleOnly"],
        Mid: [],
        ADC: [],
        Support: []
      }
    },
    championsByName,
    toggles: {
      requireHardEngage: false,
      requireFrontline: false,
      requireWaveclear: false,
      requireDamageMix: false,
      requireAntiTank: false,
      requireDisengage: false,
      requirePrimaryCarry: false,
      topMustBeThreat: true
    },
    maxDepth: 1,
    maxBranch: 5,
    minCandidateScore: 0
  });

  expect(tree.viability.unreachableRequired).toContain("TopMustBeThreat");
  expect(tree.children.length).toBe(0);
  expect(tree.generationStats.prunedUnreachable).toBeGreaterThan(0);
});

test("valid-end-state ranking can outrank immediate candidate score", () => {
  const championsByName = {
    MidAP: createChampion({
      name: "MidAP",
      roles: ["Mid"],
      damageType: "AP"
    }),
    ADCAD: createChampion({
      name: "ADCAD",
      roles: ["ADC"],
      damageType: "AD"
    }),
    SupportUtility: createChampion({
      name: "SupportUtility",
      roles: ["Support"],
      damageType: "AP"
    }),
    TopHardOnly: createChampion({
      name: "TopHardOnly",
      roles: ["Top"],
      damageType: "AP",
      tags: { HardEngage: true }
    }),
    TopFrontlineOnly: createChampion({
      name: "TopFrontlineOnly",
      roles: ["Top"],
      damageType: "AD",
      tags: { Frontline: true }
    }),
    JungleHardOnly: createChampion({
      name: "JungleHardOnly",
      roles: ["Jungle"],
      damageType: "AP",
      tags: { HardEngage: true }
    })
  };

  const tree = generatePossibilityTree({
    teamState: {
      Mid: "MidAP",
      ADC: "ADCAD",
      Support: "SupportUtility"
    },
    teamId: "X",
    roleOrder: ["Top", "Jungle", "Mid", "ADC", "Support"],
    teamPools: {
      X: {
        Top: ["TopHardOnly", "TopFrontlineOnly"],
        Jungle: ["JungleHardOnly"],
        Mid: ["MidAP"],
        ADC: ["ADCAD"],
        Support: ["SupportUtility"]
      }
    },
    championsByName,
    toggles: {
      requireHardEngage: true,
      requireFrontline: true,
      requireWaveclear: false,
      requireDamageMix: true,
      requireAntiTank: false,
      requireDisengage: false,
      requirePrimaryCarry: false,
      topMustBeThreat: false
    },
    maxDepth: 2,
    maxBranch: 5,
    minCandidateScore: 0,
    pruneUnreachableRequired: false
  });

  expect(tree.children.length).toBeGreaterThan(1);
  expect(tree.children[0].addedChampion).toBe("TopFrontlineOnly");
  expect(tree.children[0].branchPotential.validLeafCount).toBeGreaterThan(
    tree.children[1].branchPotential.validLeafCount
  );
});
