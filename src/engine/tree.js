import {
  DEFAULT_RECOMMENDATION_WEIGHTS,
  DEFAULT_TREE_SETTINGS,
  SLOTS,
  getPickedChampionNames,
  isTeamComplete,
  normalizeTeamState
} from "../domain/model.js";
import { evaluateCompositionChecks, isTopThreatChampion, scoreNodeFromChecks } from "./checks.js";

function normalizeExclusions(excludedChampions = []) {
  return new Set(excludedChampions.filter((name) => typeof name === "string" && name.trim() !== ""));
}

function normalizeRoleOrder(roleOrder = []) {
  const order = [];
  const seen = new Set();
  for (const role of roleOrder) {
    if (!SLOTS.includes(role) || seen.has(role)) {
      continue;
    }
    seen.add(role);
    order.push(role);
  }

  for (const role of SLOTS) {
    if (!seen.has(role)) {
      order.push(role);
    }
  }

  return order;
}

function resolveNextRole(teamState, preferredRole, roleOrder = SLOTS) {
  const normalized = normalizeTeamState(teamState);
  if (preferredRole && normalized[preferredRole] === null) {
    return preferredRole;
  }
  return normalizeRoleOrder(roleOrder).find((slot) => normalized[slot] === null) ?? null;
}

function normalizeWeights(weights = {}) {
  return {
    ...DEFAULT_RECOMMENDATION_WEIGHTS,
    ...weights
  };
}

function getPoolForRole(teamPools, teamId, role) {
  const teamPoolsForTeam = teamPools[teamId];
  if (!teamPoolsForTeam) {
    throw new Error(`Unknown team '${teamId}' in team pools.`);
  }
  const rolePool = teamPoolsForTeam[role];
  if (!Array.isArray(rolePool)) {
    throw new Error(`No pool found for role '${role}' on team '${teamId}'.`);
  }
  return rolePool;
}

function scoreCandidate({
  champion,
  currentEvaluation,
  weights
}) {
  let score = 0;
  const rationale = [];

  for (const tag of currentEvaluation.missingNeeds.tags) {
    if (champion.tags[tag]) {
      const weight = weights[tag] ?? 0;
      score += weight;
      rationale.push(`adds ${tag} (+${weight})`);
    }
  }

  if (currentEvaluation.missingNeeds.needsAD && (champion.damageType === "AD" || champion.damageType === "Mixed")) {
    score += 6;
    rationale.push("improves damage mix with AD (+6)");
  }

  if (currentEvaluation.missingNeeds.needsAP && (champion.damageType === "AP" || champion.damageType === "Mixed")) {
    score += 6;
    rationale.push("improves damage mix with AP (+6)");
  }

  return {
    score,
    rationale
  };
}

export function generateNextCandidates({
  teamState,
  teamId,
  nextRole,
  roleOrder = SLOTS,
  teamPools,
  championsByName,
  toggles = {},
  excludedChampions = [],
  weights = {},
  maxBranch = DEFAULT_TREE_SETTINGS.maxBranch
}) {
  const normalized = normalizeTeamState(teamState);
  const role = resolveNextRole(normalized, nextRole, roleOrder);

  if (!role) {
    return {
      role: null,
      candidates: []
    };
  }

  const pool = getPoolForRole(teamPools, teamId, role);
  const picked = getPickedChampionNames(normalized);
  const excluded = normalizeExclusions(excludedChampions);
  const mergedWeights = normalizeWeights(weights);
  const currentEvaluation = evaluateCompositionChecks(normalized, championsByName, toggles);

  const scored = [];

  for (const championName of pool) {
    if (picked.has(championName) || excluded.has(championName)) {
      continue;
    }

    const champion = championsByName[championName];
    if (!champion) {
      continue;
    }

    if (role === "Top" && currentEvaluation.toggles.topMustBeThreat && !isTopThreatChampion(champion)) {
      continue;
    }

    const candidateScore = scoreCandidate({
      champion,
      currentEvaluation,
      weights: mergedWeights
    });

    scored.push({
      role,
      championName,
      score: candidateScore.score,
      rationale: candidateScore.rationale
    });
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.championName.localeCompare(right.championName);
  });

  return {
    role,
    candidates: scored.slice(0, maxBranch)
  };
}

function buildNode({
  teamState,
  teamId,
  preferredNextRole,
  roleOrder,
  teamPools,
  championsByName,
  toggles,
  excludedChampions,
  weights,
  maxDepth,
  maxBranch,
  depth,
  parentPathRationale = []
}) {
  const normalized = normalizeTeamState(teamState);
  const checkEvaluation = evaluateCompositionChecks(normalized, championsByName, toggles);
  const nodeScore = scoreNodeFromChecks(checkEvaluation);

  const node = {
    depth,
    teamSlots: normalized,
    score: nodeScore,
    checks: checkEvaluation.checks,
    missingNeeds: checkEvaluation.missingNeeds,
    pathRationale: parentPathRationale,
    children: []
  };

  if (depth >= maxDepth || isTeamComplete(normalized)) {
    return node;
  }

  const { role, candidates } = generateNextCandidates({
    teamState: normalized,
    teamId,
    nextRole: preferredNextRole,
    roleOrder,
    teamPools,
    championsByName,
    toggles,
    excludedChampions,
    weights,
    maxBranch
  });

  if (!role || candidates.length === 0) {
    return node;
  }

  node.children = candidates.map((candidate) => {
    const childState = {
      ...normalized,
      [role]: candidate.championName
    };
    const candidatePathRationale = [
      ...parentPathRationale,
      `${role} -> ${candidate.championName} (candidate score ${candidate.score})`,
      ...candidate.rationale.map((reason) => `${candidate.championName}: ${reason}`)
    ];
    const childNode = buildNode({
      teamState: childState,
      teamId,
      preferredNextRole,
      roleOrder,
      teamPools,
      championsByName,
      toggles,
      excludedChampions,
      weights,
      maxDepth,
      maxBranch,
      depth: depth + 1,
      parentPathRationale: candidatePathRationale
    });

    return {
      ...childNode,
      addedRole: role,
      addedChampion: candidate.championName,
      candidateScore: candidate.score,
      rationale: candidate.rationale
    };
  });

  node.children.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return (left.addedChampion ?? "").localeCompare(right.addedChampion ?? "");
  });

  return node;
}

export function generatePossibilityTree({
  teamState,
  teamId,
  nextRole,
  roleOrder = SLOTS,
  teamPools,
  championsByName,
  toggles = {},
  excludedChampions = [],
  weights = {},
  maxDepth = DEFAULT_TREE_SETTINGS.maxDepth,
  maxBranch = DEFAULT_TREE_SETTINGS.maxBranch
}) {
  if (!teamId || typeof teamId !== "string") {
    throw new Error("teamId is required to generate a tree.");
  }

  return buildNode({
    teamState,
    teamId,
    preferredNextRole: nextRole,
    roleOrder,
    teamPools,
    championsByName,
    toggles,
    excludedChampions,
    weights,
    maxDepth,
    maxBranch,
    depth: 0,
    parentPathRationale: []
  });
}
