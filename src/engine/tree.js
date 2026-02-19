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
const COMPLETION_PROGRESS_SCORE = 1;
const MIN_REQUIRED_TAG_SCORE = 1;
const REQUIRED_GAP_DELTA_WEIGHT = 4;
const REQUIRED_GAP_REMAINING_PENALTY = 2;
const RELATIVE_SCORE_WINDOW = 1;
const MIN_RELATIVE_KEEP_OPEN_REQUIREMENTS = 2;
const MIN_RELATIVE_KEEP_CLOSED_REQUIREMENTS = 1;
const BRANCH_CAP_ONE_REQUIRED_GAP = 5;
const BRANCH_CAP_CLOSED_REQUIREMENTS = 3;
const NO_CRITICAL_PROGRESS_PENALTY_OPEN_REQUIREMENTS = 5;
const NO_CRITICAL_PROGRESS_PENALTY_CLOSED_REQUIREMENTS = 3;
const GAPS_EXCEED_HORIZON_PENALTY = 8;
const MAX_FALLBACK_KEEP = 2;

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
    candidateGenerationCalls: 0,
    candidatesEvaluated: 0,
    candidatesSelected: 0,
    prunedUnreachable: 0,
    prunedLowCandidateScore: 0,
    prunedRelativeCandidateScore: 0,
    fallbackCandidatesUsed: 0,
    fallbackNodes: 0,
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
      const configuredWeight = weights[tag] ?? 0;
      const appliedWeight = configuredWeight > 0 ? configuredWeight : MIN_REQUIRED_TAG_SCORE;
      score += appliedWeight;
      rationale.push(
        configuredWeight > 0
          ? `adds ${tag} (+${appliedWeight})`
          : `adds ${tag} (+${appliedWeight}, required-check floor)`
      );
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

  score += COMPLETION_PROGRESS_SCORE;
  rationale.push(`keeps slot progression (+${COMPLETION_PROGRESS_SCORE})`);

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

function countReachableChampionsForRole({
  role,
  teamPools,
  teamId,
  picked,
  excludedChampions,
  championsByName,
  predicate
}) {
  const pool = getPoolForRole(teamPools, teamId, role);
  let count = 0;
  for (const championName of pool) {
    if (picked.has(championName) || excludedChampions.has(championName)) {
      continue;
    }
    const champion = championsByName[championName];
    if (!champion) {
      continue;
    }
    if (!predicate(champion, role)) {
      continue;
    }
    count += 1;
  }
  return count;
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
  minCandidateScore = DEFAULT_MIN_CANDIDATE_SCORE,
  remainingSteps = 0
}) {
  const normalized = normalizeTeamState(teamState);
  const role = resolveNextRole(normalized, nextRole, roleOrder);

  if (!role) {
    return {
      role: null,
      candidates: [],
      prunedLowCandidateScoreCount: 0,
      prunedRelativeCandidateScoreCount: 0,
      filteredTopThreatCount: 0,
      eligibleBeforeScoreCount: 0,
      fallbackUsed: false,
      fallbackCandidateCount: 0
    };
  }

  const pool = getPoolForRole(teamPools, teamId, role);
  const picked = getPickedChampionNames(normalized);
  const excluded = normalizeExclusions(excludedChampions);
  const mergedWeights = normalizeWeights(weights);
  const currentEvaluation = evaluateCompositionChecks(normalized, championsByName, toggles);

  const scored = [];
  let prunedLowCandidateScoreCount = 0;
  let prunedRelativeCandidateScoreCount = 0;
  let filteredTopThreatCount = 0;
  let eligibleBeforeScoreCount = 0;
  const currentRequiredSummary = getRequiredSummary(currentEvaluation.checks);
  const nextRemainingSteps = Math.max(0, remainingSteps - 1);

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

    const candidate = {
      role,
      championName,
      score: candidateScore.score,
      rationale: candidateScore.rationale,
      passesMinScore: candidateScore.score >= minCandidateScore
    };
    const childState = {
      ...normalized,
      [role]: championName
    };
    const projectedEvaluation = evaluateCompositionChecks(childState, championsByName, toggles);
    const projectedRequiredSummary = getRequiredSummary(projectedEvaluation.checks);
    const projectedRoles = getRemainingExpansionRoles({
      teamState: childState,
      preferredNextRole: nextRole,
      roleOrder,
      remainingSteps: nextRemainingSteps
    });
    const projectedPicked = getPickedChampionNames(childState);
    const projectedRoleSupplies = projectedRoles.map((futureRole) =>
      countReachableChampionsForRole({
        role: futureRole,
        teamPools,
        teamId,
        picked: projectedPicked,
        excludedChampions: excluded,
        championsByName,
        predicate(champion, roleToCheck) {
          if (roleToCheck === "Top" && projectedEvaluation.toggles.topMustBeThreat && !isTopThreatChampion(champion)) {
            return false;
          }
          return true;
        }
      })
    );
    const minRoleSupply = projectedRoleSupplies.length > 0 ? Math.min(...projectedRoleSupplies) : 0;
    const requiredGapDelta = currentRequiredSummary.requiredGaps - projectedRequiredSummary.requiredGaps;
    let viabilityScore = requiredGapDelta * REQUIRED_GAP_DELTA_WEIGHT;
    viabilityScore -= projectedRequiredSummary.requiredGaps * REQUIRED_GAP_REMAINING_PENALTY;
    if (requiredGapDelta <= 0) {
      viabilityScore -= currentRequiredSummary.requiredGaps > 0
        ? NO_CRITICAL_PROGRESS_PENALTY_OPEN_REQUIREMENTS
        : NO_CRITICAL_PROGRESS_PENALTY_CLOSED_REQUIREMENTS;
    }
    if (projectedRequiredSummary.requiredGaps > nextRemainingSteps) {
      viabilityScore -= GAPS_EXCEED_HORIZON_PENALTY;
    }
    if (projectedRoleSupplies.length > 0) {
      if (minRoleSupply === 0) {
        viabilityScore -= 6;
      } else if (minRoleSupply === 1) {
        viabilityScore -= 2;
      } else {
        viabilityScore += Math.min(2, minRoleSupply - 1);
      }
    }
    candidate.selectionScore = candidate.score + viabilityScore;
    scored.push(candidate);
  }

  const compareCandidates = (left, right) => {
    if ((right.selectionScore ?? 0) !== (left.selectionScore ?? 0)) {
      return (right.selectionScore ?? 0) - (left.selectionScore ?? 0);
    }
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.championName.localeCompare(right.championName);
  };

  scored.sort(compareCandidates);
  const aboveFloor = scored.filter((candidate) => candidate.passesMinScore);
  const belowFloor = scored.filter((candidate) => !candidate.passesMinScore);
  const dynamicBranchCap = currentRequiredSummary.requiredGaps === 0
    ? Math.min(maxBranch, BRANCH_CAP_CLOSED_REQUIREMENTS)
    : currentRequiredSummary.requiredGaps === 1
      ? Math.min(maxBranch, BRANCH_CAP_ONE_REQUIRED_GAP)
      : maxBranch;

  let selectedCandidates = [];
  let fallbackUsed = false;
  let fallbackCandidateCount = 0;

  if (aboveFloor.length > 0) {
    const bestSelectionScore = aboveFloor[0].selectionScore ?? 0;
    let relativeKept = aboveFloor.filter(
      (candidate) => (candidate.selectionScore ?? 0) >= bestSelectionScore - RELATIVE_SCORE_WINDOW
    );
    const minRelativeKeep = currentRequiredSummary.requiredGaps > 0
      ? MIN_RELATIVE_KEEP_OPEN_REQUIREMENTS
      : MIN_RELATIVE_KEEP_CLOSED_REQUIREMENTS;
    const minKeepCount = Math.min(
      aboveFloor.length,
      Math.max(1, Math.min(dynamicBranchCap, minRelativeKeep))
    );
    if (relativeKept.length < minKeepCount) {
      relativeKept = aboveFloor.slice(0, minKeepCount);
    }
    selectedCandidates = relativeKept.slice(0, dynamicBranchCap);
    prunedRelativeCandidateScoreCount =
      (aboveFloor.length - relativeKept.length) +
      (relativeKept.length - selectedCandidates.length);
    prunedLowCandidateScoreCount = belowFloor.length;
  } else {
    fallbackUsed = belowFloor.length > 0;
    if (fallbackUsed) {
      const bestBelowFloorScore = belowFloor[0].selectionScore ?? 0;
      const fallbackCandidates = belowFloor.filter(
        (candidate) => (candidate.selectionScore ?? 0) >= bestBelowFloorScore - RELATIVE_SCORE_WINDOW
      );
      const fallbackKeep = Math.min(dynamicBranchCap, MAX_FALLBACK_KEEP);
      selectedCandidates = fallbackCandidates.slice(0, fallbackKeep);
      fallbackCandidateCount = selectedCandidates.length;
      prunedRelativeCandidateScoreCount =
        (belowFloor.length - fallbackCandidates.length) +
        (fallbackCandidates.length - selectedCandidates.length);
      prunedLowCandidateScoreCount = belowFloor.length - fallbackCandidateCount;
    }
  }

  return {
    role,
    candidates: selectedCandidates,
    prunedLowCandidateScoreCount,
    prunedRelativeCandidateScoreCount,
    filteredTopThreatCount,
    eligibleBeforeScoreCount,
    fallbackUsed,
    fallbackCandidateCount
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
      isTerminalValid: isTerminalValidDraft(teamComplete, requiredSummary),
      fallbackApplied: false
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
    prunedRelativeCandidateScoreCount,
    filteredTopThreatCount,
    eligibleBeforeScoreCount,
    fallbackUsed,
    fallbackCandidateCount
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
    minCandidateScore,
    remainingSteps
  });
  generationStats.candidateGenerationCalls += 1;
  generationStats.candidatesEvaluated += eligibleBeforeScoreCount;
  generationStats.candidatesSelected += candidates.length;
  generationStats.prunedLowCandidateScore += prunedLowCandidateScoreCount;
  generationStats.prunedRelativeCandidateScore += prunedRelativeCandidateScoreCount;
  if (fallbackUsed) {
    generationStats.fallbackNodes += 1;
    generationStats.fallbackCandidatesUsed += fallbackCandidateCount;
    node.viability.fallbackApplied = true;
  }

  if (!role || candidates.length === 0) {
    node.viability.isTerminalValid = isTerminalValidDraft(node.viability.isDraftComplete, requiredSummary);
    if (role) {
      node.viability.blockedRole = role;
      if (eligibleBeforeScoreCount === 0) {
        node.viability.blockedReason = filteredTopThreatCount > 0
          ? "top_threat_filter"
          : "no_eligible_champions_for_role";
        node.viability.blockedReasonDetail = filteredTopThreatCount > 0
          ? "all_candidates_filtered_by_top_threat"
          : "pool_exclusion_or_duplicate_constraints";
      } else if (prunedLowCandidateScoreCount >= eligibleBeforeScoreCount) {
        node.viability.blockedReason = "candidate_score_floor";
        node.viability.blockedReasonDetail = requiredSummary.requiredGaps === 0
          ? "all_below_floor_after_required_checks_satisfied"
          : "all_below_floor";
      } else {
        node.viability.blockedReason = "no_candidates";
        node.viability.blockedReasonDetail = "all_candidates_removed_after_generation";
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
      passesMinScore: candidate.passesMinScore,
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
