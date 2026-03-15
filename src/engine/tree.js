import {
  DEFAULT_TREE_SETTINGS,
  SLOTS,
  getPickedChampionNames,
  isTeamComplete,
  normalizeTeamState
} from "../domain/model.js";
import { evaluateCompositionRequirements } from "./requirements.js";
import {
  DEFAULT_CANDIDATE_SCORING_WEIGHTS,
  buildRequirementScoreBreakdown,
  normalizeCandidateScoringWeights
} from "./scoring.js";

const DEFAULT_MIN_CANDIDATE_SCORE = 1;
const DEFAULT_RANK_GOAL = "valid_end_states";
const RANK_GOAL_CANDIDATE_SCORE = "candidate_score";
const RANK_GOAL_VALUES = new Set([DEFAULT_RANK_GOAL, RANK_GOAL_CANDIDATE_SCORE]);
const MAX_FALLBACK_KEEP = 2;
const UNREACHABLE_CANDIDATE_PENALTY = 100;

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

function normalizeRankGoal(rankGoal) {
  return RANK_GOAL_VALUES.has(rankGoal) ? rankGoal : DEFAULT_RANK_GOAL;
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

function buildRequirementCheckMap(requirementEvaluation) {
  const checks = {};
  for (const requirement of requirementEvaluation.requirements) {
    const isRequired = requirement.required !== false;
    checks[requirement.name] = {
      id: requirement.id,
      required: isRequired,
      satisfied: requirement.status === "pass",
      status: requirement.status === "pass" ? "good" : "warn",
      reason: requirement.reason
    };
  }
  return checks;
}

function countFilledSlots(teamState) {
  return Object.values(normalizeTeamState(teamState)).filter(Boolean).length;
}

function getRemainingDraftSlots(teamState) {
  return SLOTS.length - countFilledSlots(teamState);
}

function buildNodeScoreBreakdown(requirementEvaluation, redundancyPenalty) {
  return buildRequirementScoreBreakdown(requirementEvaluation, redundancyPenalty);
}

function scoreRequirementNode(requirementEvaluation, teamState, candidateScoringWeights = DEFAULT_CANDIDATE_SCORING_WEIGHTS) {
  const scoreBreakdown = buildNodeScoreBreakdown(
    requirementEvaluation,
    candidateScoringWeights.redundancyPenalty
  );
  const filledSlots = Object.values(normalizeTeamState(teamState)).filter(Boolean).length;
  return {
    scoreBreakdown,
    score: scoreBreakdown.totalScore + filledSlots
  };
}

function buildClauseDeltaScoreBreakdown(currentEvaluation, projectedEvaluation, candidateScoringWeights) {
  const redundancyPenalty = candidateScoringWeights.redundancyPenalty;
  const currentBreakdown = buildNodeScoreBreakdown(currentEvaluation, redundancyPenalty);
  const projectedBreakdown = buildNodeScoreBreakdown(projectedEvaluation, redundancyPenalty);
  const currentRequirementsById = new Map(
    currentBreakdown.requirements.map((requirement) => [requirement.requirementId, requirement])
  );

  const requirements = projectedBreakdown.requirements.map((projectedRequirement) => {
    const currentRequirement = currentRequirementsById.get(projectedRequirement.requirementId) ?? null;
    const currentClausesById = new Map(
      Array.isArray(currentRequirement?.clauses)
        ? currentRequirement.clauses.map((clause) => [clause.id, clause])
        : []
    );

    const clauses = projectedRequirement.clauses.map((projectedClause) => {
      const currentClause = currentClausesById.get(projectedClause.id) ?? null;
      const currentUnderBy = Number.isFinite(currentClause?.effectiveUnderBy) ? currentClause.effectiveUnderBy : 0;
      const projectedUnderBy = Number.isFinite(projectedClause?.effectiveUnderBy) ? projectedClause.effectiveUnderBy : 0;
      const currentOverBy = Number.isFinite(currentClause?.effectiveOverBy) ? currentClause.effectiveOverBy : 0;
      const projectedOverBy = Number.isFinite(projectedClause?.effectiveOverBy) ? projectedClause.effectiveOverBy : 0;
      const underDelta = currentUnderBy - projectedUnderBy;
      const overDelta = projectedOverBy - currentOverBy;
      const scoreContribution = underDelta - overDelta * redundancyPenalty;
      return {
        id: projectedClause.id,
        label: projectedClause.label,
        status: projectedClause.status,
        previousStatus: currentClause?.status ?? null,
        countsTowardAggregate: projectedClause.countsTowardAggregate === true,
        previousCountsTowardAggregate: currentClause?.countsTowardAggregate === true,
        currentMatches: projectedClause.currentMatches,
        previousMatches: currentClause?.currentMatches ?? 0,
        minCount: projectedClause.minCount,
        maxCount: projectedClause.maxCount,
        underBy: projectedUnderBy,
        overBy: projectedOverBy,
        underDelta,
        overDelta,
        scoreContribution
      };
    });
    const bonusDelta = (projectedRequirement.optionalBonus ?? 0) - (currentRequirement?.optionalBonus ?? 0);

    return {
      requirementId: projectedRequirement.requirementId,
      requirementName: projectedRequirement.requirementName,
      required: projectedRequirement.required !== false,
      bonusWeight: Number.isFinite(projectedRequirement.bonusWeight) ? projectedRequirement.bonusWeight : 0,
      optionalBonus: Number.isFinite(projectedRequirement.optionalBonus) ? projectedRequirement.optionalBonus : 0,
      bonusDelta,
      totalScore: clauses.reduce((sum, clause) => sum + clause.scoreContribution, 0) + bonusDelta,
      clauses
    };
  });

  const unreachablePenalty =
    projectedEvaluation.unreachableRequirements.length > 0
      ? projectedEvaluation.unreachableRequirements.length * UNREACHABLE_CANDIDATE_PENALTY
      : 0;

  return {
    requirements,
    totalScore: requirements.reduce((sum, requirement) => sum + requirement.totalScore, 0),
    unreachablePenalty
  };
}

function buildCandidateRationale(scoreBreakdown, projectedEvaluation) {
  const rationale = [];
  for (const requirement of scoreBreakdown.requirements) {
    if (requirement.required === false) {
      if (requirement.bonusDelta > 0) {
        rationale.push(`${requirement.requirementName}: gains optional bonus ${requirement.bonusDelta}`);
      } else if (requirement.bonusDelta < 0) {
        rationale.push(`${requirement.requirementName}: loses optional bonus ${Math.abs(requirement.bonusDelta)}`);
      }
    }
    for (const clause of requirement.clauses) {
      const matchLabel = requirement.required === false ? "optional match(es)" : "required match(es)";
      if (clause.underDelta > 0) {
        rationale.push(`${requirement.requirementName} ${clause.label}: closes ${clause.underDelta} ${matchLabel}`);
      } else if (clause.underDelta < 0) {
        rationale.push(
          `${requirement.requirementName} ${clause.label}: loses ${Math.abs(clause.underDelta)} ${matchLabel}`
        );
      }
      if (clause.overDelta > 0) {
        rationale.push(`${requirement.requirementName} ${clause.label}: adds ${clause.overDelta} redundancy overflow`);
      } else if (clause.overDelta < 0) {
        rationale.push(
          `${requirement.requirementName} ${clause.label}: reduces redundancy overflow by ${Math.abs(clause.overDelta)}`
        );
      }
    }
  }
  if (projectedEvaluation.unreachableRequirements.length > 0) {
    rationale.push(`creates unreachable requirements: ${projectedEvaluation.unreachableRequirements.join(", ")}`);
  }
  if (rationale.length === 0) {
    rationale.push("does not change clause coverage");
  }
  return rationale;
}

function evaluateRequirementBundleForTree({
  teamState,
  teamId,
  teamPools,
  championsByName,
  requirements,
  excludedChampions,
  tagById
}) {
  const evaluation = evaluateCompositionRequirements({
    teamState,
    championsByName,
    requirements,
    teamPools,
    teamId,
    excludedChampions,
    tagById
  });
  return {
    ...evaluation,
    checks: buildRequirementCheckMap(evaluation)
  };
}

function scoreCandidatesForRole({
  teamState,
  teamId,
  nextRole,
  roleOrder = SLOTS,
  teamPools,
  championsByName,
  requirements,
  excludedChampions = [],
  tagById = {},
  maxBranch = DEFAULT_TREE_SETTINGS.maxBranch,
  minCandidateScore = DEFAULT_MIN_CANDIDATE_SCORE,
  candidateScoringWeights = DEFAULT_CANDIDATE_SCORING_WEIGHTS
}) {
  const normalizedCandidateScoringWeights = normalizeCandidateScoringWeights(candidateScoringWeights);
  const normalized = normalizeTeamState(teamState);
  const role = resolveNextRole(normalized, nextRole, roleOrder);
  if (!role) {
    return {
      role: null,
      scoredCandidates: [],
      eligibleBeforeScoreCount: 0,
      currentEvaluation: null
    };
  }

  const pool = getPoolForRole(teamPools, teamId, role);
  const picked = getPickedChampionNames(normalized);
  const excluded = normalizeExclusions(excludedChampions);
  const currentEvaluation = evaluateRequirementBundleForTree({
    teamState: normalized,
    teamId,
    teamPools,
    championsByName,
    requirements,
    excludedChampions,
    tagById
  });

  const scored = [];
  let eligibleBeforeScoreCount = 0;
  for (const championName of pool) {
    if (picked.has(championName) || excluded.has(championName)) {
      continue;
    }
    const champion = championsByName[championName];
    if (!champion) {
      continue;
    }
    eligibleBeforeScoreCount += 1;
    const childState = {
      ...normalized,
      [role]: championName
    };
    const projectedEvaluation = evaluateRequirementBundleForTree({
      teamState: childState,
      teamId,
      teamPools,
      championsByName,
      requirements,
      excludedChampions,
      tagById
    });
    const scoreBreakdown = buildClauseDeltaScoreBreakdown(
      currentEvaluation,
      projectedEvaluation,
      normalizedCandidateScoringWeights
    );
    const score = scoreBreakdown.totalScore - scoreBreakdown.unreachablePenalty;
    const rationale = buildCandidateRationale(scoreBreakdown, projectedEvaluation);
    rationale.push("keeps slot progression (+1)");

    scored.push({
      role,
      championName,
      score,
      selectionScore: score,
      scoreBreakdown,
      rationale,
      passesMinScore: score >= minCandidateScore
    });
  }

  scored.sort((left, right) => {
    if (right.selectionScore !== left.selectionScore) {
      return right.selectionScore - left.selectionScore;
    }
    return left.championName.localeCompare(right.championName);
  });

  return {
    role,
    scoredCandidates: scored,
    eligibleBeforeScoreCount,
    currentEvaluation
  };
}

function generateNextCandidatesByRequirements({
  teamState,
  teamId,
  nextRole,
  roleOrder = SLOTS,
  teamPools,
  championsByName,
  requirements,
  excludedChampions = [],
  tagById = {},
  maxBranch = DEFAULT_TREE_SETTINGS.maxBranch,
  minCandidateScore = DEFAULT_MIN_CANDIDATE_SCORE,
  candidateScoringWeights = DEFAULT_CANDIDATE_SCORING_WEIGHTS
}) {
  const {
    role,
    scoredCandidates,
    eligibleBeforeScoreCount
  } = scoreCandidatesForRole({
    teamState,
    teamId,
    nextRole,
    roleOrder,
    teamPools,
    championsByName,
    requirements,
    excludedChampions,
    tagById,
    maxBranch,
    minCandidateScore,
    candidateScoringWeights
  });

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

  const aboveFloor = scoredCandidates.filter((candidate) => candidate.passesMinScore);
  const belowFloor = scoredCandidates.filter((candidate) => !candidate.passesMinScore);
  const selectedCandidates = aboveFloor.length > 0
    ? aboveFloor.slice(0, maxBranch)
    : belowFloor.slice(0, Math.min(maxBranch, MAX_FALLBACK_KEEP));

  return {
    role,
    candidates: selectedCandidates,
    prunedLowCandidateScoreCount: scoredCandidates.length - aboveFloor.length,
    prunedRelativeCandidateScoreCount: Math.max(0, aboveFloor.length - selectedCandidates.length),
    filteredTopThreatCount: 0,
    eligibleBeforeScoreCount,
    fallbackUsed: aboveFloor.length < 1 && selectedCandidates.length > 0,
    fallbackCandidateCount: aboveFloor.length < 1 ? selectedCandidates.length : 0
  };
}

export function rankRoleCandidates({
  teamState,
  teamId,
  nextRole,
  roleOrder = SLOTS,
  teamPools,
  championsByName,
  requirements = [],
  excludedChampions = [],
  tagById = {},
  minCandidateScore = DEFAULT_MIN_CANDIDATE_SCORE,
  candidateScoringWeights = DEFAULT_CANDIDATE_SCORING_WEIGHTS
}) {
  const {
    role,
    scoredCandidates,
    eligibleBeforeScoreCount
  } = scoreCandidatesForRole({
    teamState,
    teamId,
    nextRole,
    roleOrder,
    teamPools,
    championsByName,
    requirements,
    excludedChampions,
    tagById,
    minCandidateScore,
    candidateScoringWeights
  });

  return {
    role,
    candidates: scoredCandidates,
    eligibleBeforeScoreCount
  };
}

function buildNodeByRequirements({
  teamState,
  teamId,
  preferredNextRole,
  roleOrder,
  teamPools,
  championsByName,
  requirements,
  excludedChampions,
  tagById,
  maxBranch,
  minCandidateScore,
  candidateScoringWeights,
  pruneUnreachableRequired,
  rankGoal,
  depth,
  parentPathRationale = [],
  generationStats,
  isRoot = false
}) {
  generationStats.nodesVisited += 1;
  const normalized = normalizeTeamState(teamState);
  const requirementEvaluation = evaluateRequirementBundleForTree({
    teamState: normalized,
    teamId,
    teamPools,
    championsByName,
    requirements,
    excludedChampions,
    tagById
  });
  const requiredSummary = requirementEvaluation.requiredSummary;
  const optionalSummary = requirementEvaluation.optionalSummary;
  const { score: nodeScore, scoreBreakdown } = scoreRequirementNode(
    requirementEvaluation,
    normalized,
    candidateScoringWeights
  );
  const remainingSteps = getRemainingDraftSlots(normalized);
  const teamComplete = isTeamComplete(normalized);
  const isTerminal = teamComplete;
  const unreachableRequired = pruneUnreachableRequired ? requirementEvaluation.unreachableRequirements : [];

  const node = {
    depth,
    teamSlots: normalized,
    score: nodeScore,
    checks: requirementEvaluation.checks,
    missingNeeds: {
      tags: [],
      needsAD: false,
      needsAP: false,
      needsTopThreat: false
    },
    requiredSummary,
    optionalSummary,
    scoreBreakdown,
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
    eligibleBeforeScoreCount,
    fallbackUsed,
    fallbackCandidateCount
  } = generateNextCandidatesByRequirements({
    teamState: normalized,
    teamId,
    nextRole: preferredNextRole,
    roleOrder,
    teamPools,
    championsByName,
    requirements,
    excludedChampions,
    tagById,
    maxBranch,
    minCandidateScore,
    candidateScoringWeights
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
      node.viability.blockedReason = eligibleBeforeScoreCount === 0 ? "no_eligible_champions_for_role" : "no_candidates";
      node.viability.blockedReasonDetail = eligibleBeforeScoreCount === 0
        ? "pool_exclusion_or_duplicate_constraints"
        : "all_candidates_removed_after_generation";
    }
    return finalizeLeafNode(node, generationStats);
  }

  const children = [];
  for (const candidate of candidates) {
    const childState = {
      ...normalized,
      [role]: candidate.championName
    };
    const childPathRationale = [
      ...parentPathRationale,
      `${role} -> ${candidate.championName} (candidate score ${candidate.score})`,
      ...candidate.rationale.map((reason) => `${candidate.championName}: ${reason}`)
    ];
    const childNode = buildNodeByRequirements({
      teamState: childState,
      teamId,
      preferredNextRole,
      roleOrder,
      teamPools,
      championsByName,
      requirements,
      excludedChampions,
      tagById,
      maxBranch,
      minCandidateScore,
      candidateScoringWeights,
      pruneUnreachableRequired,
      rankGoal,
      depth: depth + 1,
      parentPathRationale: childPathRationale,
      generationStats
    });
    if (!childNode) {
      continue;
    }
    children.push({
      ...childNode,
      addedRole: role,
      addedChampion: candidate.championName,
      candidateScore: candidate.score,
      passesMinScore: candidate.passesMinScore,
      candidateBreakdown: candidate.scoreBreakdown,
      rationale: candidate.rationale
    });
  }

  node.children = children;
  if (children.length === 0) {
    node.viability.isTerminalValid = isTerminalValidDraft(node.viability.isDraftComplete, requiredSummary);
    return finalizeLeafNode(node, generationStats);
  }

  let validLeafCount = 0;
  let bestLeafScore = Number.NEGATIVE_INFINITY;
  for (const child of children) {
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

function generatePossibilityTreeByRequirements({
  teamState,
  teamId,
  nextRole,
  roleOrder = SLOTS,
  teamPools,
  championsByName,
  requirements = [],
  excludedChampions = [],
  tagById = {},
  maxBranch = DEFAULT_TREE_SETTINGS.maxBranch,
  minCandidateScore = DEFAULT_MIN_CANDIDATE_SCORE,
  candidateScoringWeights = DEFAULT_CANDIDATE_SCORING_WEIGHTS,
  pruneUnreachableRequired = true,
  rankGoal = DEFAULT_RANK_GOAL
}) {
  const normalizedCandidateScoringWeights = normalizeCandidateScoringWeights(candidateScoringWeights);
  const generationStats = createGenerationStats();
  const tree = buildNodeByRequirements({
    teamState,
    teamId,
    preferredNextRole: nextRole,
    roleOrder,
    teamPools,
    championsByName,
    requirements,
    excludedChampions,
    tagById,
    maxBranch,
    minCandidateScore,
    candidateScoringWeights: normalizedCandidateScoringWeights,
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

export function generatePossibilityTree({
  teamState,
  teamId,
  nextRole,
  roleOrder = SLOTS,
  teamPools,
  championsByName,
  requirements = [],
  tagById = {},
  excludedChampions = [],
  maxBranch = DEFAULT_TREE_SETTINGS.maxBranch,
  minCandidateScore = DEFAULT_MIN_CANDIDATE_SCORE,
  candidateScoringWeights = DEFAULT_CANDIDATE_SCORING_WEIGHTS,
  pruneUnreachableRequired = true,
  rankGoal = DEFAULT_RANK_GOAL
}) {
  if (!teamId || typeof teamId !== "string") {
    throw new Error("teamId is required to generate a tree.");
  }

  return generatePossibilityTreeByRequirements({
    teamState,
    teamId,
    nextRole,
    roleOrder,
    teamPools,
    championsByName,
    requirements: Array.isArray(requirements) ? requirements : [],
    excludedChampions,
    tagById,
    maxBranch,
    minCandidateScore,
    candidateScoringWeights,
    pruneUnreachableRequired,
    rankGoal
  });
}
