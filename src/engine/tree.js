import {
  DEFAULT_RECOMMENDATION_WEIGHTS,
  DEFAULT_TREE_SETTINGS,
  SLOTS,
  getPickedChampionNames,
  isTeamComplete,
  normalizeTeamState
} from "../domain/model.js";
import { evaluateCompositionChecks, isTopThreatChampion, scoreNodeFromChecks } from "./checks.js";

const DEFAULT_MIN_CANDIDATE_SCORE = 1;
const DEFAULT_RANK_GOAL = "valid_end_states";

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

function normalizeRankGoal(rankGoal) {
  return rankGoal === DEFAULT_RANK_GOAL ? rankGoal : DEFAULT_RANK_GOAL;
}

function createGenerationStats() {
  return {
    nodesVisited: 0,
    nodesKept: 0,
    prunedUnreachable: 0,
    prunedLowCandidateScore: 0,
    completeDraftLeaves: 0,
    incompleteDraftLeaves: 0,
    validLeaves: 0,
    incompleteLeaves: 0
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

function getRequiredSummary(checks) {
  const requiredChecks = Object.values(checks).filter((result) => Boolean(result.required));
  const requiredTotal = requiredChecks.length;
  const requiredPassed = requiredChecks.filter((result) => Boolean(result.satisfied)).length;
  return {
    requiredTotal,
    requiredPassed,
    requiredGaps: requiredTotal - requiredPassed
  };
}

function createLeafBranchPotential(node) {
  return {
    validLeafCount: node.viability.isTerminalValid ? 1 : 0,
    bestLeafScore: node.viability.isTerminalValid ? node.score : null
  };
}

function isTerminalValidDraft(isDraftComplete, requiredSummary) {
  return Boolean(isDraftComplete) && requiredSummary.requiredGaps === 0;
}

function finalizeLeafNode(node, stats) {
  node.branchPotential = createLeafBranchPotential(node);
  if (node.viability.isDraftComplete) {
    stats.completeDraftLeaves += 1;
  } else {
    stats.incompleteDraftLeaves += 1;
  }
  if (node.branchPotential.validLeafCount > 0) {
    stats.validLeaves += 1;
  } else {
    stats.incompleteLeaves += 1;
  }
  return node;
}

function getBestLeafScore(node) {
  const score = node.branchPotential?.bestLeafScore;
  return Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY;
}

function compareChildrenForRank(left, right, rankGoal) {
  if (rankGoal === DEFAULT_RANK_GOAL) {
    const leftValidLeaves = left.branchPotential?.validLeafCount ?? 0;
    const rightValidLeaves = right.branchPotential?.validLeafCount ?? 0;
    if (rightValidLeaves !== leftValidLeaves) {
      return rightValidLeaves - leftValidLeaves;
    }

    const leftBestLeafScore = getBestLeafScore(left);
    const rightBestLeafScore = getBestLeafScore(right);
    if (rightBestLeafScore !== leftBestLeafScore) {
      return rightBestLeafScore - leftBestLeafScore;
    }
  }

  if ((right.candidateScore ?? 0) !== (left.candidateScore ?? 0)) {
    return (right.candidateScore ?? 0) - (left.candidateScore ?? 0);
  }

  return (left.addedChampion ?? "").localeCompare(right.addedChampion ?? "");
}

function getRemainingExpansionRoles({
  teamState,
  preferredNextRole,
  roleOrder,
  remainingSteps
}) {
  const roles = [];
  const projected = normalizeTeamState(teamState);
  for (let step = 0; step < remainingSteps; step += 1) {
    const role = resolveNextRole(projected, preferredNextRole, roleOrder);
    if (!role) {
      break;
    }
    roles.push(role);
    projected[role] = `__projected__${step}`;
  }
  return roles;
}

function hasReachableChampionForRole({
  role,
  teamPools,
  teamId,
  picked,
  excludedChampions,
  championsByName,
  predicate
}) {
  const pool = getPoolForRole(teamPools, teamId, role);
  for (const championName of pool) {
    if (picked.has(championName) || excludedChampions.has(championName)) {
      continue;
    }
    const champion = championsByName[championName];
    if (!champion) {
      continue;
    }
    if (predicate(champion, role)) {
      return true;
    }
  }
  return false;
}

function hasReachableChampionAcrossRoles({
  roles,
  teamPools,
  teamId,
  picked,
  excludedChampions,
  championsByName,
  predicate
}) {
  for (const role of roles) {
    if (
      hasReachableChampionForRole({
        role,
        teamPools,
        teamId,
        picked,
        excludedChampions,
        championsByName,
        predicate
      })
    ) {
      return true;
    }
  }
  return false;
}

function isDamageTypeOption(champion, damageType) {
  if (damageType === "AD") {
    return champion.damageType === "AD" || champion.damageType === "Mixed";
  }
  if (damageType === "AP") {
    return champion.damageType === "AP" || champion.damageType === "Mixed";
  }
  return champion.damageType === "Mixed";
}

export function evaluateRequiredReachability({
  teamState,
  teamId,
  preferredNextRole,
  roleOrder = SLOTS,
  teamPools,
  championsByName,
  excludedChampions = [],
  remainingSteps = 0,
  checkEvaluation = null,
  toggles = {}
}) {
  const normalized = normalizeTeamState(teamState);
  const evaluation = checkEvaluation ?? evaluateCompositionChecks(normalized, championsByName, toggles);
  const requiredCheckNames = Object.entries(evaluation.checks)
    .filter(([, result]) => Boolean(result.required))
    .map(([checkName]) => checkName);
  const unmetRequired = requiredCheckNames.filter((checkName) => !evaluation.checks[checkName].satisfied);

  if (unmetRequired.length === 0) {
    return {
      remainingRoles: [],
      unmetRequired,
      unreachableRequired: []
    };
  }

  const roles = getRemainingExpansionRoles({
    teamState: normalized,
    preferredNextRole,
    roleOrder,
    remainingSteps
  });
  const picked = getPickedChampionNames(normalized);
  const excluded = normalizeExclusions(excludedChampions);
  const unreachableRequired = [];

  for (const checkName of unmetRequired) {
    const check = evaluation.checks[checkName];
    const requirementType = check?.requirementType;
    let reachable = false;

    if (requirementType === "tag" && check?.requirementTag) {
      const tag = check.requirementTag;
      reachable = hasReachableChampionAcrossRoles({
        roles,
        teamPools,
        teamId,
        picked,
        excludedChampions: excluded,
        championsByName,
        predicate(champion, role) {
          if (role === "Top" && evaluation.toggles.topMustBeThreat && !isTopThreatChampion(champion)) {
            return false;
          }
          return Boolean(champion.tags[tag]);
        }
      });
    } else if (requirementType === "damage_mix") {
      const needsAD = evaluation.missingNeeds.needsAD;
      const needsAP = evaluation.missingNeeds.needsAP;
      const adReachable = hasReachableChampionAcrossRoles({
        roles,
        teamPools,
        teamId,
        picked,
        excludedChampions: excluded,
        championsByName,
        predicate(champion, role) {
          if (role === "Top" && evaluation.toggles.topMustBeThreat && !isTopThreatChampion(champion)) {
            return false;
          }
          return isDamageTypeOption(champion, "AD");
        }
      });
      const apReachable = hasReachableChampionAcrossRoles({
        roles,
        teamPools,
        teamId,
        picked,
        excludedChampions: excluded,
        championsByName,
        predicate(champion, role) {
          if (role === "Top" && evaluation.toggles.topMustBeThreat && !isTopThreatChampion(champion)) {
            return false;
          }
          return isDamageTypeOption(champion, "AP");
        }
      });
      const mixedReachable = hasReachableChampionAcrossRoles({
        roles,
        teamPools,
        teamId,
        picked,
        excludedChampions: excluded,
        championsByName,
        predicate(champion, role) {
          if (role === "Top" && evaluation.toggles.topMustBeThreat && !isTopThreatChampion(champion)) {
            return false;
          }
          return isDamageTypeOption(champion, "Mixed");
        }
      });

      if (needsAD && needsAP) {
        reachable = mixedReachable || (adReachable && apReachable && roles.length >= 2);
      } else if (needsAD) {
        reachable = adReachable;
      } else if (needsAP) {
        reachable = apReachable;
      } else {
        reachable = true;
      }
    } else if (requirementType === "top_threat") {
      const role = check.requiredRole ?? "Top";
      const topName = normalized[role];
      if (topName) {
        reachable = false;
      } else if (!roles.includes(role)) {
        reachable = false;
      } else {
        reachable = hasReachableChampionForRole({
          role,
          teamPools,
          teamId,
          picked,
          excludedChampions: excluded,
          championsByName,
          predicate(champion) {
            return isTopThreatChampion(champion);
          }
        });
      }
    } else {
      reachable = true;
    }

    if (!reachable) {
      unreachableRequired.push(checkName);
    }
  }

  return {
    remainingRoles: roles,
    unmetRequired,
    unreachableRequired
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
  maxBranch = DEFAULT_TREE_SETTINGS.maxBranch,
  minCandidateScore = DEFAULT_MIN_CANDIDATE_SCORE
}) {
  const normalized = normalizeTeamState(teamState);
  const role = resolveNextRole(normalized, nextRole, roleOrder);

  if (!role) {
    return {
      role: null,
      candidates: [],
      prunedLowCandidateScoreCount: 0
    };
  }

  const pool = getPoolForRole(teamPools, teamId, role);
  const picked = getPickedChampionNames(normalized);
  const excluded = normalizeExclusions(excludedChampions);
  const mergedWeights = normalizeWeights(weights);
  const currentEvaluation = evaluateCompositionChecks(normalized, championsByName, toggles);

  const scored = [];
  let prunedLowCandidateScoreCount = 0;
  let filteredTopThreatCount = 0;
  let eligibleBeforeScoreCount = 0;

  for (const championName of pool) {
    if (picked.has(championName) || excluded.has(championName)) {
      continue;
    }

    const champion = championsByName[championName];
    if (!champion) {
      continue;
    }

    if (role === "Top" && currentEvaluation.toggles.topMustBeThreat && !isTopThreatChampion(champion)) {
      filteredTopThreatCount += 1;
      continue;
    }

    eligibleBeforeScoreCount += 1;
    const candidateScore = scoreCandidate({
      champion,
      currentEvaluation,
      weights: mergedWeights
    });

    if (candidateScore.score < minCandidateScore) {
      prunedLowCandidateScoreCount += 1;
      continue;
    }

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
    candidates: scored.slice(0, maxBranch),
    prunedLowCandidateScoreCount,
    filteredTopThreatCount,
    eligibleBeforeScoreCount
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
  minCandidateScore,
  pruneUnreachableRequired,
  rankGoal,
  depth,
  parentPathRationale = [],
  generationStats,
  isRoot = false
}) {
  generationStats.nodesVisited += 1;
  const normalized = normalizeTeamState(teamState);
  const checkEvaluation = evaluateCompositionChecks(normalized, championsByName, toggles);
  const nodeScore = scoreNodeFromChecks(checkEvaluation);
  const requiredSummary = getRequiredSummary(checkEvaluation.checks);
  const remainingSteps = Math.max(0, maxDepth - depth);
  const reachability = evaluateRequiredReachability({
    teamState: normalized,
    teamId,
    preferredNextRole,
    roleOrder,
    teamPools,
    championsByName,
    excludedChampions,
    remainingSteps,
    checkEvaluation
  });
  const teamComplete = isTeamComplete(normalized);
  const terminalByDepth = depth >= maxDepth;
  const isTerminal = terminalByDepth || teamComplete;
  const unreachableRequired = pruneUnreachableRequired ? reachability.unreachableRequired : [];

  const node = {
    depth,
    teamSlots: normalized,
    score: nodeScore,
    checks: checkEvaluation.checks,
    missingNeeds: checkEvaluation.missingNeeds,
    requiredSummary,
    viability: {
      remainingSteps,
      unreachableRequired,
      isDraftComplete: teamComplete,
      isTerminalValid: isTerminalValidDraft(teamComplete, requiredSummary)
    },
    pathRationale: parentPathRationale,
    branchPotential: {
      validLeafCount: 0,
      bestLeafScore: null
    },
    children: []
  };

  if (!isRoot && pruneUnreachableRequired && unreachableRequired.length > 0) {
    generationStats.prunedUnreachable += 1;
    return null;
  }

  generationStats.nodesKept += 1;

  if (isTerminal) {
    return finalizeLeafNode(node, generationStats);
  }

  const {
    role,
    candidates,
    prunedLowCandidateScoreCount,
    filteredTopThreatCount,
    eligibleBeforeScoreCount
  } = generateNextCandidates({
    teamState: normalized,
    teamId,
    nextRole: preferredNextRole,
    roleOrder,
    teamPools,
    championsByName,
    toggles,
    excludedChampions,
    weights,
    maxBranch,
    minCandidateScore
  });
  generationStats.prunedLowCandidateScore += prunedLowCandidateScoreCount;

  if (!role || candidates.length === 0) {
    node.viability.isTerminalValid = isTerminalValidDraft(node.viability.isDraftComplete, requiredSummary);
    if (role) {
      node.viability.blockedRole = role;
      if (eligibleBeforeScoreCount === 0) {
        node.viability.blockedReason = filteredTopThreatCount > 0
          ? "top_threat_filter"
          : "no_eligible_champions_for_role";
      } else if (prunedLowCandidateScoreCount >= eligibleBeforeScoreCount) {
        node.viability.blockedReason = "candidate_score_floor";
      } else {
        node.viability.blockedReason = "no_candidates";
      }
    }
    return finalizeLeafNode(node, generationStats);
  }

  const builtChildren = [];

  for (const candidate of candidates) {
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
      minCandidateScore,
      pruneUnreachableRequired,
      rankGoal,
      depth: depth + 1,
      parentPathRationale: candidatePathRationale,
      generationStats
    });
    if (!childNode) {
      continue;
    }

    builtChildren.push({
      ...childNode,
      addedRole: role,
      addedChampion: candidate.championName,
      candidateScore: candidate.score,
      rationale: candidate.rationale
    });
  }

  node.children = builtChildren;
  if (node.children.length === 0) {
    node.viability.isTerminalValid = isTerminalValidDraft(node.viability.isDraftComplete, requiredSummary);
    return finalizeLeafNode(node, generationStats);
  }

  let validLeafCount = 0;
  let bestLeafScore = Number.NEGATIVE_INFINITY;
  for (const child of node.children) {
    validLeafCount += child.branchPotential?.validLeafCount ?? 0;
    bestLeafScore = Math.max(bestLeafScore, getBestLeafScore(child));
  }
  node.branchPotential = {
    validLeafCount,
    bestLeafScore: bestLeafScore === Number.NEGATIVE_INFINITY ? null : bestLeafScore
  };

  node.children.sort((left, right) => compareChildrenForRank(left, right, rankGoal));

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
  maxBranch = DEFAULT_TREE_SETTINGS.maxBranch,
  minCandidateScore = DEFAULT_MIN_CANDIDATE_SCORE,
  pruneUnreachableRequired = true,
  rankGoal = DEFAULT_RANK_GOAL
}) {
  if (!teamId || typeof teamId !== "string") {
    throw new Error("teamId is required to generate a tree.");
  }

  const generationStats = createGenerationStats();
  const tree = buildNode({
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
    minCandidateScore,
    pruneUnreachableRequired: Boolean(pruneUnreachableRequired),
    rankGoal: normalizeRankGoal(rankGoal),
    depth: 0,
    parentPathRationale: [],
    generationStats,
    isRoot: true
  });

  tree.generationStats = generationStats;
  return tree;
}
