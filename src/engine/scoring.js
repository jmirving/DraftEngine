export const DEFAULT_CANDIDATE_SCORING_WEIGHTS = Object.freeze({
  redundancyPenalty: 1
});

function normalizeJoiner(rawJoiner, fallback = "and") {
  const normalized = typeof rawJoiner === "string" ? rawJoiner.trim().toLowerCase() : "";
  if (normalized === "and" || normalized === "or") {
    return normalized;
  }
  return fallback;
}

function normalizeFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeCandidateScoringWeights(weights = DEFAULT_CANDIDATE_SCORING_WEIGHTS) {
  const source = weights && typeof weights === "object" && !Array.isArray(weights)
    ? weights
    : DEFAULT_CANDIDATE_SCORING_WEIGHTS;
  return {
    redundancyPenalty: Math.max(
      0,
      normalizeFiniteNumber(source.redundancyPenalty, DEFAULT_CANDIDATE_SCORING_WEIGHTS.redundancyPenalty)
    )
  };
}

function createClauseScoreDetail(clause, clauseIndex, redundancyPenalty) {
  const underBy = Number.isFinite(clause?.underBy) ? clause.underBy : 0;
  const overBy = Number.isFinite(clause?.overBy) ? clause.overBy : 0;
  return {
    id:
      typeof clause?.id === "string" && clause.id.trim() !== ""
        ? clause.id.trim()
        : `clause-${clauseIndex + 1}`,
    clauseIndex,
    label: `C${clauseIndex + 1}`,
    clauseJoiner: normalizeJoiner(clause?.clauseJoiner, "and"),
    status: clause?.status ?? "pending",
    reason: clause?.reason ?? "",
    minCount: Number.isFinite(clause?.minCount) ? clause.minCount : 1,
    maxCount: Number.isFinite(clause?.maxCount) ? clause.maxCount : null,
    currentMatches: Number.isFinite(clause?.currentMatches) ? clause.currentMatches : 0,
    maxPossibleMatches: Number.isFinite(clause?.maxPossibleMatches) ? clause.maxPossibleMatches : 0,
    underBy,
    overBy,
    inRange: clause?.inRange === true,
    canStillReachMin: clause?.canStillReachMin !== false,
    progressToMin: Number.isFinite(clause?.progressToMin) ? clause.progressToMin : 0,
    currentMatchSlots: Array.isArray(clause?.currentMatchSlots) ? clause.currentMatchSlots : [],
    potentialMatchRoles: Array.isArray(clause?.potentialMatchRoles) ? clause.potentialMatchRoles : [],
    rawScoreContribution: -underBy - overBy * redundancyPenalty,
    effectiveUnderBy: 0,
    effectiveOverBy: 0,
    effectiveScoreContribution: 0,
    countsTowardAggregate: false
  };
}

function createAggregateSelection(detail) {
  return {
    totalUnderBy: detail.underBy,
    totalOverBy: detail.overBy,
    totalScore: detail.rawScoreContribution,
    selectedClauseIds: new Set([detail.id])
  };
}

function combineAndSelection(left, right) {
  return {
    totalUnderBy: left.totalUnderBy + right.totalUnderBy,
    totalOverBy: left.totalOverBy + right.totalOverBy,
    totalScore: left.totalScore + right.totalScore,
    selectedClauseIds: new Set([...left.selectedClauseIds, ...right.selectedClauseIds])
  };
}

function compareSelections(left, right) {
  if (left.totalScore !== right.totalScore) {
    return left.totalScore - right.totalScore;
  }
  if (left.totalUnderBy !== right.totalUnderBy) {
    return right.totalUnderBy - left.totalUnderBy;
  }
  if (left.totalOverBy !== right.totalOverBy) {
    return right.totalOverBy - left.totalOverBy;
  }
  return right.selectedClauseIds.size - left.selectedClauseIds.size;
}

function selectBestBranch(left, right) {
  return compareSelections(left, right) >= 0 ? left : right;
}

function buildAggregateSelection(clauses) {
  if (!Array.isArray(clauses) || clauses.length < 1) {
    return {
      totalUnderBy: 0,
      totalOverBy: 0,
      totalScore: 0,
      selectedClauseIds: new Set()
    };
  }

  let aggregate = createAggregateSelection(clauses[0]);
  for (let index = 1; index < clauses.length; index += 1) {
    const detail = clauses[index];
    const clauseSelection = createAggregateSelection(detail);
    if (normalizeJoiner(detail.clauseJoiner, "and") === "or") {
      aggregate = selectBestBranch(aggregate, clauseSelection);
    } else {
      aggregate = combineAndSelection(aggregate, clauseSelection);
    }
  }
  return aggregate;
}

export function buildRequirementScoreBreakdown(
  requirementEvaluation,
  redundancyPenalty = DEFAULT_CANDIDATE_SCORING_WEIGHTS.redundancyPenalty
) {
  const requirements = Array.isArray(requirementEvaluation?.requirements)
    ? requirementEvaluation.requirements
    : [];
  const requirementBreakdown = requirements.map((requirement) => {
    const clauses = Array.isArray(requirement?.clauses)
      ? requirement.clauses.map((clause, clauseIndex) =>
        createClauseScoreDetail(clause, clauseIndex, redundancyPenalty)
      )
      : [];
    const aggregate = buildAggregateSelection(clauses);
    for (const clause of clauses) {
      if (!aggregate.selectedClauseIds.has(clause.id)) {
        continue;
      }
      clause.countsTowardAggregate = true;
      clause.effectiveUnderBy = clause.underBy;
      clause.effectiveOverBy = clause.overBy;
      clause.effectiveScoreContribution = clause.rawScoreContribution;
    }

    return {
      requirementId: Number(requirement?.id ?? 0),
      requirementName: typeof requirement?.name === "string" ? requirement.name : "Unnamed requirement",
      status: requirement?.status ?? "pending",
      reason: requirement?.reason ?? "",
      totalUnderBy: aggregate.totalUnderBy,
      totalOverBy: aggregate.totalOverBy,
      totalScore: aggregate.totalScore,
      clauses
    };
  });

  return {
    requirements: requirementBreakdown,
    totalUnderBy: requirementBreakdown.reduce((sum, requirement) => sum + requirement.totalUnderBy, 0),
    totalOverBy: requirementBreakdown.reduce((sum, requirement) => sum + requirement.totalOverBy, 0),
    totalScore: requirementBreakdown.reduce((sum, requirement) => sum + requirement.totalScore, 0)
  };
}
