export const DEFAULT_CANDIDATE_SCORING_WEIGHTS = Object.freeze({
  redundancyPenalty: 1
});

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

export function buildRequirementScoreBreakdown(
  requirementEvaluation,
  redundancyPenalty = DEFAULT_CANDIDATE_SCORING_WEIGHTS.redundancyPenalty
) {
  const requirements = Array.isArray(requirementEvaluation?.requirements)
    ? requirementEvaluation.requirements
    : [];
  const requirementBreakdown = requirements.map((requirement) => {
    const clauses = Array.isArray(requirement?.clauses)
      ? requirement.clauses.map((clause, clauseIndex) => {
        const underBy = Number.isFinite(clause?.underBy) ? clause.underBy : 0;
        const overBy = Number.isFinite(clause?.overBy) ? clause.overBy : 0;
        return {
          id:
            typeof clause?.id === "string" && clause.id.trim() !== ""
              ? clause.id.trim()
              : `clause-${clauseIndex + 1}`,
          clauseIndex,
          label: `C${clauseIndex + 1}`,
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
          scoreContribution: -underBy - overBy * redundancyPenalty
        };
      })
      : [];

    return {
      requirementId: Number(requirement?.id ?? 0),
      requirementName: typeof requirement?.name === "string" ? requirement.name : "Unnamed requirement",
      status: requirement?.status ?? "pending",
      reason: requirement?.reason ?? "",
      totalUnderBy: clauses.reduce((sum, clause) => sum + clause.underBy, 0),
      totalOverBy: clauses.reduce((sum, clause) => sum + clause.overBy, 0),
      totalScore: clauses.reduce((sum, clause) => sum + clause.scoreContribution, 0),
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
