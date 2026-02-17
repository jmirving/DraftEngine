import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildDraftflowData } from "../src/data/loaders.js";
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
      topMustBeThreat: true
    },
    excludedChampions: ["Aatrox"],
    weights: data.config.recommendation.weights,
    maxDepth: 2,
    maxBranch: 5
  };

  const first = generatePossibilityTree(params);
  const second = generatePossibilityTree(params);
  assert.deepEqual(first, second);
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
  assert.equal(picks.has("Hecarim"), false);
  assert.equal(picks.has("Zac"), false);
  assert.equal(picks.has("Amumu"), false);
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

  assert.ok(tree.children.length > 0);
  for (const child of tree.children) {
    const topChampion = data.championsByName[child.addedChampion];
    const isThreat = topChampion.tags.SideLaneThreat || topChampion.tags.DiveThreat;
    assert.equal(isThreat, true);
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
    maxDepth: 1,
    maxBranch: 10
  });

  assert.ok(tree.children.length > 0);
  for (const child of tree.children) {
    assert.equal(child.addedRole, "Jungle");
    assert.equal(junglePool.has(child.addedChampion), true);
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
  assert.equal(rationale.some((entry) => entry.toLowerCase().includes("redundancy penalty")), false);
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

  assert.ok(tree.children.length > 0);
  for (const child of tree.children) {
    assert.equal(child.addedRole, "Top");
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
      topMustBeThreat: true
    },
    weights: data.config.recommendation.weights,
    maxDepth: 1,
    maxBranch: 5
  });

  assert.ok(tree.score > 50);
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
  assert.ok(deepNodes.length > 0);
  for (const node of deepNodes) {
    assert.ok(Array.isArray(node.pathRationale));
    assert.ok(node.pathRationale.length >= 2);
  }
});
