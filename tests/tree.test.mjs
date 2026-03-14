import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildDraftflowData } from "../src/data/loaders.js";
import { generatePossibilityTree } from "../src/engine/tree.js";

const championsCsv = readFileSync(resolve("docs/deprecated/DraftFlow_champions.csv"), "utf8");
const teamPoolsCsv = readFileSync(resolve("docs/deprecated/DraftFlow_team_pools.csv"), "utf8");
const configJson = readFileSync(resolve("docs/deprecated/DraftFlow_config.json"), "utf8");

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

function collectNodes(node, nodes = []) {
  nodes.push(node);
  for (const child of node.children) {
    collectNodes(child, nodes);
  }
  return nodes;
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
    requirements: [],
    excludedChampions: ["Aatrox"],
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
    requirements: [],
    excludedChampions: ["Hecarim", "Zac", "Amumu"],
    maxDepth: 2,
    maxBranch: 10
  });

  const picks = collectPickedChampionsFromTree(tree);
  expect(picks.has("Hecarim")).toBe(false);
  expect(picks.has("Zac")).toBe(false);
  expect(picks.has("Amumu")).toBe(false);
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
    requirements: [],
    maxDepth: 2,
    maxBranch: 10
  });

  expect(tree.children.length).toBeGreaterThan(0);
  for (const child of tree.children) {
    expect(child.addedRole).toBe("Jungle");
    expect(junglePool.has(child.addedChampion)).toBe(true);
  }
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
    requirements: [],
    maxDepth: 1,
    maxBranch: 5
  });

  expect(tree.children.length).toBeGreaterThan(0);
  for (const child of tree.children) {
    expect(child.addedRole).toBe("Top");
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
    requirements: [],
    maxDepth: 2,
    maxBranch: 4
  });

  expect(tree.requiredSummary).toMatchObject({
    requiredTotal: expect.any(Number),
    requiredPassed: expect.any(Number),
    requiredGaps: expect.any(Number)
  });
  expect(tree.scoreBreakdown).toMatchObject({
    totalUnderBy: expect.any(Number),
    totalOverBy: expect.any(Number),
    totalScore: expect.any(Number),
    requirements: expect.any(Array)
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
    prunedRelativeCandidateScore: expect.any(Number),
    fallbackCandidatesUsed: expect.any(Number),
    fallbackNodes: expect.any(Number),
    completeDraftLeaves: expect.any(Number),
    incompleteDraftLeaves: expect.any(Number),
    validLeaves: expect.any(Number),
    incompleteLeaves: expect.any(Number)
  });
});

test("tree always expands to the end of the remaining composition", () => {
  const tree = generatePossibilityTree({
    teamState: {},
    teamId: "TTT",
    nextRole: "Top",
    teamPools: data.teamPools,
    championsByName: data.championsByName,
    requirements: [],
    maxBranch: 5,
    minCandidateScore: 0,
    pruneUnreachableRequired: false
  });

  expect(tree.children.length).toBeGreaterThan(0);
  expect(tree.viability.remainingSteps).toBe(5);
  expect(tree.generationStats.validLeaves).toBeGreaterThan(0);
  const nodes = collectNodes(tree);
  const deepestNode = Math.max(...nodes.map((node) => node.depth));
  expect(deepestNode).toBe(5);
  expect(nodes.some((node) => node.viability.isDraftComplete)).toBe(true);
});

test("valid-end-state ranking prefers branches that satisfy more requirements", () => {
  const championsByName = {
    MidAP: {
      name: "MidAP",
      tagIds: [],
      tags: {}
    },
    TopFrontline: {
      name: "TopFrontline",
      tagIds: [1],
      tags: { Frontline: true }
    },
    TopNoFrontline: {
      name: "TopNoFrontline",
      tagIds: [],
      tags: {}
    }
  };

  const requirements = [
    {
      id: 10,
      name: "Need Top Frontline",
      definition: "Top slot should be frontline",
      rules: [
        {
          id: "top-frontline",
          expr: { tag: "Frontline" },
          minCount: 1,
          roleFilter: ["Top"]
        }
      ]
    }
  ];

  const tree = generatePossibilityTree({
    teamState: {
      Mid: "MidAP"
    },
    teamId: "X",
    nextRole: "Top",
    roleOrder: ["Top", "Jungle", "Mid", "ADC", "Support"],
    teamPools: {
      X: {
        Top: ["TopNoFrontline", "TopFrontline"],
        Jungle: [],
        Mid: ["MidAP"],
        ADC: [],
        Support: []
      }
    },
    championsByName,
    requirements,
    tagById: {
      "1": { id: 1, name: "Frontline" }
    },
    maxDepth: 1,
    maxBranch: 5,
    minCandidateScore: -100,
    pruneUnreachableRequired: false
  });

  expect(tree.children.length).toBe(2);
  expect(tree.children[0].addedChampion).toBe("TopFrontline");
  expect(tree.children[0].requiredSummary.requiredGaps).toBeLessThan(tree.children[1].requiredSummary.requiredGaps);
  expect(tree.children[0].candidateBreakdown).toMatchObject({
    totalScore: expect.any(Number),
    requirements: expect.any(Array)
  });

  const nodes = collectNodes(tree);
  expect(nodes.some((node) => node.requiredSummary.requiredTotal > 0)).toBe(true);
});

test("rankGoal candidate_score can prioritize immediate score over downstream valid-leaf count", () => {
  const championsByName = {
    FlexTag: {
      name: "FlexTag",
      tagIds: [1],
      tags: { Frontline: true }
    },
    TopOnly: {
      name: "TopOnly",
      tagIds: [],
      tags: {}
    },
    MidLock: {
      name: "MidLock",
      tagIds: [],
      tags: {}
    },
    ADCLock: {
      name: "ADCLock",
      tagIds: [],
      tags: {}
    },
    SupportLock: {
      name: "SupportLock",
      tagIds: [],
      tags: {}
    }
  };

  const requirements = [
    {
      id: 77,
      name: "Need Frontline",
      definition: "Need one frontline champion anywhere",
      rules: [
        {
          id: "need-frontline-anywhere",
          expr: { tag: "Frontline" },
          minCount: 1
        }
      ]
    }
  ];

  const baseParams = {
    teamState: {
      Mid: "MidLock",
      ADC: "ADCLock",
      Support: "SupportLock"
    },
    teamId: "X",
    nextRole: "Top",
    roleOrder: ["Top", "Jungle", "Mid", "ADC", "Support"],
    teamPools: {
      X: {
        Top: ["FlexTag", "TopOnly"],
        Jungle: ["FlexTag"],
        Mid: ["MidLock"],
        ADC: ["ADCLock"],
        Support: ["SupportLock"]
      }
    },
    championsByName,
    requirements,
    tagById: {
      "1": { id: 1, name: "Frontline" }
    },
    maxDepth: 2,
    maxBranch: 5,
    minCandidateScore: -100,
    pruneUnreachableRequired: true
  };

  const validEndStateTree = generatePossibilityTree({
    ...baseParams,
    rankGoal: "valid_end_states"
  });
  const candidateScoreTree = generatePossibilityTree({
    ...baseParams,
    rankGoal: "candidate_score"
  });

  expect(validEndStateTree.children).toHaveLength(2);
  expect(candidateScoreTree.children).toHaveLength(2);
  expect(validEndStateTree.children[0].addedChampion).toBe("TopOnly");
  expect(validEndStateTree.children[0].branchPotential.validLeafCount).toBeGreaterThan(
    validEndStateTree.children[1].branchPotential.validLeafCount
  );
  expect(candidateScoreTree.children[0].addedChampion).toBe("FlexTag");
  expect(candidateScoreTree.children[0].candidateScore).toBeGreaterThan(
    candidateScoreTree.children[1].candidateScore
  );
});

test("redundancyPenalty can change candidate ordering when a pick exceeds clause max", () => {
  const championsByName = {
    MidFrontline: {
      name: "MidFrontline",
      tagIds: [1],
      tags: { Frontline: true }
    },
    ATopFrontline: {
      name: "ATopFrontline",
      tagIds: [1],
      tags: { Frontline: true }
    },
    BTopNoFrontline: {
      name: "BTopNoFrontline",
      tagIds: [],
      tags: {}
    }
  };
  const requirements = [
    {
      id: 10,
      name: "Prefer exactly one frontline source",
      definition: "Meet the minimum but discourage redundant extra sources",
      rules: [
        {
          id: "frontline-cap",
          expr: { tag: "Frontline" },
          minCount: 1,
          maxCount: 1
        }
      ]
    }
  ];
  const baseParams = {
    teamState: {
      Mid: "MidFrontline"
    },
    teamId: "X",
    nextRole: "Top",
    roleOrder: ["Top", "Jungle", "Mid", "ADC", "Support"],
    teamPools: {
      X: {
        Top: ["ATopFrontline", "BTopNoFrontline"],
        Jungle: [],
        Mid: ["MidFrontline"],
        ADC: [],
        Support: []
      }
    },
    championsByName,
    requirements,
    tagById: {
      "1": { id: 1, name: "Frontline" }
    },
    maxBranch: 5,
    minCandidateScore: -100,
    pruneUnreachableRequired: false
  };

  const treeNoPenalty = generatePossibilityTree({
    ...baseParams,
    candidateScoringWeights: {
      redundancyPenalty: 0
    }
  });

  const treeWithPenalty = generatePossibilityTree({
    ...baseParams,
    candidateScoringWeights: {
      redundancyPenalty: 2
    }
  });

  expect(treeNoPenalty.children).toHaveLength(2);
  expect(treeWithPenalty.children).toHaveLength(2);
  expect(treeNoPenalty.children[0].addedChampion).toBe("ATopFrontline");
  expect(treeWithPenalty.children[0].addedChampion).toBe("BTopNoFrontline");
  expect(treeWithPenalty.children[0].candidateScore).toBeGreaterThan(treeWithPenalty.children[1].candidateScore);
});

test("OR-linked requirements stop counting inactive alternate branches in node and candidate scores", () => {
  const championsByName = {
    TopFrontline: {
      name: "TopFrontline",
      tagIds: [1],
      tags: { Frontline: true }
    },
    TopFiller: {
      name: "TopFiller",
      tagIds: [],
      tags: {}
    },
    MidFollowUp: {
      name: "MidFollowUp",
      tagIds: [2],
      tags: { "Follow Up": true }
    }
  };

  const requirements = [
    {
      id: 30,
      name: "Frontline top or follow-up mid",
      definition: "Either top brings frontline or mid brings follow-up.",
      rules: [
        {
          id: "top-frontline",
          expr: { tag: "Frontline" },
          minCount: 1,
          roleFilter: ["Top"]
        },
        {
          id: "mid-follow-up",
          clauseJoiner: "or",
          expr: { tag: "Follow Up" },
          minCount: 1,
          roleFilter: ["Mid"]
        }
      ]
    }
  ];

  const tree = generatePossibilityTree({
    teamState: {
      Mid: "MidFollowUp"
    },
    teamId: "X",
    nextRole: "Top",
    roleOrder: ["Top", "Jungle", "Mid", "ADC", "Support"],
    teamPools: {
      X: {
        Top: ["TopFiller", "TopFrontline"],
        Jungle: [],
        Mid: ["MidFollowUp"],
        ADC: [],
        Support: []
      }
    },
    championsByName,
    requirements,
    tagById: {
      "1": { id: 1, name: "Frontline" },
      "2": { id: 2, name: "Follow Up" }
    },
    maxDepth: 1,
    maxBranch: 5,
    minCandidateScore: -100,
    pruneUnreachableRequired: false,
    rankGoal: "candidate_score"
  });

  const topFrontline = tree.children.find((child) => child.addedChampion === "TopFrontline");
  const topFiller = tree.children.find((child) => child.addedChampion === "TopFiller");

  expect(topFrontline).toBeTruthy();
  expect(topFiller).toBeTruthy();
  expect(topFrontline.scoreBreakdown.totalUnderBy).toBe(0);
  expect(topFiller.scoreBreakdown.totalUnderBy).toBe(0);
  expect(topFrontline.candidateBreakdown.totalScore).toBe(0);
  expect(topFiller.candidateBreakdown.totalScore).toBe(0);
});
