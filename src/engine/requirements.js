import { BOOLEAN_TAGS, SLOTS, getPickedChampionNames, normalizeTeamState } from "../domain/model.js";

const EFFECTIVENESS_PHASES = Object.freeze(["early", "mid", "late"]);
const EFFECTIVENESS_RANK = Object.freeze({
  weak: 1,
  neutral: 2,
  strong: 3
});
const DEFAULT_OPTIONAL_REQUIREMENT_BONUS_WEIGHT = 1;

function normalizeJoiner(rawJoiner, fallback = "and") {
  const normalized = typeof rawJoiner === "string" ? rawJoiner.trim().toLowerCase() : "";
  if (normalized === "and" || normalized === "or") {
    return normalized;
  }
  return fallback;
}

function normalizeRoleFilter(rawRoleFilter) {
  if (!Array.isArray(rawRoleFilter) || rawRoleFilter.length < 1) {
    return [...SLOTS];
  }
  const normalized = rawRoleFilter
    .map((role) => (typeof role === "string" ? role.trim() : ""))
    .filter((role) => SLOTS.includes(role));
  return normalized.length > 0 ? normalized : [...SLOTS];
}

function normalizePrimaryDamageType(rawValue) {
  const value = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
  if (value === "ad" || value === "ap" || value === "mixed" || value === "utility") {
    return value;
  }
  if (value === "attackdamage" || value === "physical") {
    return "ad";
  }
  if (value === "abilitypower" || value === "magic") {
    return "ap";
  }
  return "mixed";
}

function normalizeEffectivenessLevel(rawValue) {
  const value = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
  if (value === "weak" || value === "neutral" || value === "strong") {
    return value;
  }
  return "neutral";
}

function normalizeEffectivenessFocus(rawValue) {
  const value = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
  if (value === "early" || value === "mid" || value === "late") {
    return value;
  }
  return "";
}

function normalizeTagName(rawValue) {
  return typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
}

function normalizeRequirementIdentifier(rawValue, fallback = 0) {
  if (typeof rawValue === "string") {
    const normalized = rawValue.trim();
    if (normalized !== "") {
      return normalized;
    }
  }
  if (Number.isInteger(rawValue)) {
    return rawValue;
  }
  return fallback;
}

function cloneRequirementDefinition(requirement) {
  return JSON.parse(JSON.stringify(requirement));
}

function normalizeChampionCompositionSynergies(rawValue) {
  const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const definition = typeof source.definition === "string" ? source.definition.trim() : "";
  const rules = Array.isArray(source.rules) ? source.rules : [];
  const optional = source.optional === true;
  const rawBonusWeight = source.bonusWeight ?? source.bonus_weight;
  const parsedBonusWeight = Number(rawBonusWeight);
  return {
    definition,
    optional,
    bonusWeight:
      Number.isFinite(parsedBonusWeight) && parsedBonusWeight > 0
        ? parsedBonusWeight
        : DEFAULT_OPTIONAL_REQUIREMENT_BONUS_WEIGHT,
    rules
  };
}

const LEGACY_BOOLEAN_TAG_MAP = new Map(
  BOOLEAN_TAGS.map((tag) => [normalizeTagName(tag), tag])
);

function resolveChampionRoleProfile(champion, role) {
  const roleProfiles =
    champion?.roleProfiles && typeof champion.roleProfiles === "object" && !Array.isArray(champion.roleProfiles)
      ? champion.roleProfiles
      : {};
  const direct = roleProfiles[role];
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct;
  }
  const fallbackRole = Array.isArray(champion?.roles) && champion.roles.length > 0 ? champion.roles[0] : null;
  const fallback = fallbackRole ? roleProfiles[fallbackRole] : null;
  if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
    return fallback;
  }
  return null;
}

function resolveChampionDamageType(champion, role) {
  const profile = resolveChampionRoleProfile(champion, role);
  if (
    profile &&
    Object.prototype.hasOwnProperty.call(profile, "primaryDamageType") &&
    profile.primaryDamageType !== null &&
    profile.primaryDamageType !== undefined
  ) {
    return normalizePrimaryDamageType(profile.primaryDamageType);
  }
  return normalizePrimaryDamageType(champion?.damageType);
}

function resolveChampionEffectivenessFocus(champion, role) {
  const profile = resolveChampionRoleProfile(champion, role);

  // New power spikes format: derive phase from level ranges
  const rawSpikes = profile?.powerSpikes ?? profile?.power_spikes;
  if (Array.isArray(rawSpikes) && rawSpikes.length > 0) {
    // Phase boundaries: early=1-6, mid=7-12, late=13-18
    const phaseCoverage = { early: 0, mid: 0, late: 0 };
    for (const spike of rawSpikes) {
      if (!spike || typeof spike !== "object") continue;
      const start = Number(spike.start);
      const end = Number(spike.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      for (let lvl = Math.max(1, start); lvl <= Math.min(18, end); lvl++) {
        if (lvl <= 6) phaseCoverage.early++;
        else if (lvl <= 12) phaseCoverage.mid++;
        else phaseCoverage.late++;
      }
    }
    let bestPhase = "mid";
    let bestCount = 0;
    for (const phase of EFFECTIVENESS_PHASES) {
      if (phaseCoverage[phase] > bestCount) {
        bestCount = phaseCoverage[phase];
        bestPhase = phase;
      }
    }
    return bestPhase;
  }

  // Legacy effectiveness format
  const effectiveness =
    profile?.effectiveness && typeof profile.effectiveness === "object" && !Array.isArray(profile.effectiveness)
      ? profile.effectiveness
      : null;
  if (effectiveness) {
    let bestPhase = "mid";
    let bestRank = 0;
    for (const phase of EFFECTIVENESS_PHASES) {
      const level = normalizeEffectivenessLevel(effectiveness[phase]);
      const rank = EFFECTIVENESS_RANK[level] ?? 0;
      if (rank > bestRank) {
        bestRank = rank;
        bestPhase = phase;
      }
    }
    return bestPhase;
  }
  const legacyScaling = typeof champion?.scaling === "string" ? champion.scaling.trim().toLowerCase() : "";
  return normalizeEffectivenessFocus(legacyScaling) || "mid";
}

function championHasTag(champion, rawTagName, tagById = {}) {
  const target = normalizeTagName(rawTagName);
  if (!target) {
    return false;
  }

  const tagIds = Array.isArray(champion?.tagIds) ? champion.tagIds : [];
  for (const tagId of tagIds) {
    const tag = tagById[String(tagId)];
    const tagName = normalizeTagName(tag?.name);
    if (tagName && tagName === target) {
      return true;
    }
  }

  const mappedLegacyTag = LEGACY_BOOLEAN_TAG_MAP.get(target);
  if (!mappedLegacyTag) {
    return false;
  }
  return champion?.tags?.[mappedLegacyTag] === true;
}

function evaluateExprForChampion(expr, champion, role, tagById) {
  if (typeof expr === "string") {
    const trimmed = expr.trim();
    if (!trimmed) {
      return false;
    }
    return championHasTag(champion, trimmed, tagById);
  }

  if (!expr || typeof expr !== "object" || Array.isArray(expr)) {
    return false;
  }

  if (Array.isArray(expr.and) && expr.and.length > 0) {
    return expr.and.every((child) => evaluateExprForChampion(child, champion, role, tagById));
  }

  if (Array.isArray(expr.or) && expr.or.length > 0) {
    return expr.or.some((child) => evaluateExprForChampion(child, champion, role, tagById));
  }

  if (expr.not !== undefined) {
    return !evaluateExprForChampion(expr.not, champion, role, tagById);
  }

  const tagValue = typeof expr.tag === "string" ? expr.tag : null;
  if (tagValue) {
    return championHasTag(champion, tagValue, tagById);
  }

  const rawDamageType =
    typeof expr.damageType === "string"
      ? expr.damageType
      : typeof expr.primaryDamageType === "string"
        ? expr.primaryDamageType
        : typeof expr.damage_type === "string"
          ? expr.damage_type
          : "";
  if (rawDamageType) {
    return resolveChampionDamageType(champion, role) === normalizePrimaryDamageType(rawDamageType);
  }

  const rawEffectivenessFocus =
    typeof expr.effectivenessFocus === "string"
      ? expr.effectivenessFocus
      : typeof expr.effectiveness_focus === "string"
        ? expr.effectiveness_focus
        : "";
  if (rawEffectivenessFocus) {
    return resolveChampionEffectivenessFocus(champion, role) === normalizeEffectivenessFocus(rawEffectivenessFocus);
  }

  return false;
}

function toPositiveInt(rawValue, fallback = 1) {
  const parsed = Number.parseInt(String(rawValue), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function toNullableMax(rawValue, minValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return null;
  }
  const parsed = Number.parseInt(String(rawValue), 10);
  if (!Number.isInteger(parsed) || parsed < minValue) {
    return null;
  }
  return parsed;
}

function evaluateClause({
  clause,
  clauseIndex,
  teamState,
  championsByName,
  tagById,
  teamPools,
  teamId,
  excludedChampions,
  pickedChampionNames
}) {
  const roleFilter = normalizeRoleFilter(clause.roleFilter);
  const minCount = toPositiveInt(clause.minCount, 1);
  const maxCount = toNullableMax(clause.maxCount, minCount);
  const expr = clause.expr;
  const currentMatchSlots = [];

  for (const role of roleFilter) {
    const championName = teamState[role];
    if (!championName) {
      continue;
    }
    const champion = championsByName[championName];
    if (!champion) {
      continue;
    }
    if (evaluateExprForChampion(expr, champion, role, tagById)) {
      currentMatchSlots.push(role);
    }
  }

  const unresolvedRoles = roleFilter.filter((role) => !teamState[role]);
  const potentialMatchRoles = [];
  for (const role of unresolvedRoles) {
    const rolePool = teamPools?.[teamId]?.[role];
    if (!Array.isArray(rolePool) || rolePool.length < 1) {
      // If we do not know future candidates for this role, keep it as potentially satisfiable.
      potentialMatchRoles.push(role);
      continue;
    }
    let canMatch = false;
    for (const championName of rolePool) {
      if (pickedChampionNames.has(championName) || excludedChampions.has(championName)) {
        continue;
      }
      const champion = championsByName[championName];
      if (!champion) {
        continue;
      }
      if (evaluateExprForChampion(expr, champion, role, tagById)) {
        canMatch = true;
        break;
      }
    }
    if (canMatch) {
      potentialMatchRoles.push(role);
    }
  }

  const currentMatches = currentMatchSlots.length;
  const remainingSlots = potentialMatchRoles.length;
  const maxPossibleMatches = currentMatches + remainingSlots;
  const underBy = Math.max(0, minCount - currentMatches);
  const overBy = maxCount === null ? 0 : Math.max(0, currentMatches - maxCount);
  const canStillReachMin = maxPossibleMatches >= minCount;
  const inRange = underBy === 0 && overBy === 0;
  const progressToMin = minCount > 0 ? Math.min(currentMatches, minCount) / minCount : 1;

  let status = "pending";
  let reason = "";
  let failType = null;
  if (maxPossibleMatches < minCount) {
    status = "fail";
    failType = "min_unreachable";
    reason = `Cannot reach min (${currentMatches}/${minCount}); max possible is ${maxPossibleMatches}.`;
  } else if (currentMatches >= minCount) {
    status = "pass";
    reason = overBy > 0
      ? `Meets min (${currentMatches}/${minCount}) but exceeds max (${maxCount}) by ${overBy}.`
      : `Meets min (${currentMatches}/${minCount})${maxCount === null ? "" : ` and max (${maxCount})`}.`;
  } else {
    status = "pending";
    reason = `Needs ${minCount - currentMatches} more match(es) with ${remainingSlots} eligible open slot(s).`;
  }

  return {
    id:
      typeof clause?.id === "string" && clause.id.trim() !== ""
        ? clause.id.trim()
        : `clause-${clauseIndex + 1}`,
    clauseJoiner: normalizeJoiner(clause?.clauseJoiner, "and"),
    status,
    reason,
    failType,
    minCount,
    maxCount,
    currentMatches,
    remainingSlots,
    maxPossibleMatches,
    underBy,
    overBy,
    inRange,
    canStillReachMin,
    progressToMin,
    currentMatchSlots,
    potentialMatchRoles
  };
}

function combineClauseStatuses(leftStatus, rightStatus, joiner) {
  if (joiner === "or") {
    if (leftStatus === "pass" || rightStatus === "pass") {
      return "pass";
    }
    if (leftStatus === "fail" && rightStatus === "fail") {
      return "fail";
    }
    return "pending";
  }

  // and
  if (leftStatus === "fail" || rightStatus === "fail") {
    return "fail";
  }
  if (leftStatus === "pass" && rightStatus === "pass") {
    return "pass";
  }
  return "pending";
}

function buildChampionCompositionSynergyRequirements({
  teamState,
  championsByName
}) {
  const normalizedTeamState = normalizeTeamState(teamState);
  const derivedRequirements = [];

  for (const role of SLOTS) {
    const championName = normalizedTeamState[role];
    if (!championName) {
      continue;
    }
    const champion = championsByName?.[championName];
    const compositionSynergies = normalizeChampionCompositionSynergies(champion?.compositionSynergies);
    if (!Array.isArray(compositionSynergies.rules) || compositionSynergies.rules.length < 1) {
      continue;
    }

    const surroundingTeamState = {
      ...normalizedTeamState,
      [role]: null
    };

    derivedRequirements.push({
      id: `champion-synergy:${championName}:${role}`,
      sourceChampionName: championName,
      sourceRole: role,
      sourceType: "composition_synergy",
      required: compositionSynergies.optional !== true,
      bonusWeight: compositionSynergies.optional === true ? compositionSynergies.bonusWeight : 0,
      name: `${championName} Composition Synergy`,
      definition:
        compositionSynergies.definition !== ""
          ? compositionSynergies.definition
          : `${championName} wants specific support from the rest of the team.`,
      rules: cloneRequirementDefinition(compositionSynergies.rules),
      evaluationTeamState: surroundingTeamState
    });
  }

  return derivedRequirements;
}

function evaluateRequirement(requirement, context) {
  const clauses = Array.isArray(requirement?.rules) ? requirement.rules : [];
  const evaluationTeamState = normalizeTeamState(requirement?.evaluationTeamState ?? context.teamState);
  const evaluationPickedChampionNames = getPickedChampionNames(evaluationTeamState);
  if (clauses.length < 1) {
    return {
      id: normalizeRequirementIdentifier(requirement?.id, 0),
      sourceRequirementId: normalizeRequirementIdentifier(requirement?.sourceRequirementId, null),
      sourceChampionName:
        typeof requirement?.sourceChampionName === "string" ? requirement.sourceChampionName : "",
      sourceRole: typeof requirement?.sourceRole === "string" ? requirement.sourceRole : "",
      sourceType: typeof requirement?.sourceType === "string" ? requirement.sourceType : "",
      required: requirement?.required !== false,
      bonusWeight:
        requirement?.required === false
          ? Number.isFinite(Number(requirement?.bonusWeight)) && Number(requirement?.bonusWeight) > 0
            ? Number(requirement?.bonusWeight)
            : DEFAULT_OPTIONAL_REQUIREMENT_BONUS_WEIGHT
          : 0,
      name: typeof requirement?.name === "string" ? requirement.name : "Unnamed requirement",
      definition: typeof requirement?.definition === "string" ? requirement.definition : "",
      status: "pass",
      reason: "No clauses defined.",
      clauses: [],
      unreachable: false
    };
  }

  const clauseResults = clauses.map((clause, clauseIndex) =>
    evaluateClause({
      clause,
      clauseIndex,
      ...context,
      teamState: evaluationTeamState,
      pickedChampionNames: evaluationPickedChampionNames
    })
  );
  const clauseById = new Map(clauseResults.map((result) => [result.id, result]));

  for (let clauseIndex = 0; clauseIndex < clauses.length; clauseIndex += 1) {
    const sourceClause = clauses[clauseIndex];
    const sourceResult = clauseResults[clauseIndex];
    const separateFrom = Array.isArray(sourceClause?.separateFrom)
      ? sourceClause.separateFrom
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean)
      : [];
    if (separateFrom.length < 1) {
      continue;
    }

    for (const referenceId of separateFrom) {
      const referenceResult = clauseById.get(referenceId);
      if (!referenceResult) {
        continue;
      }
      const sourcePossible = new Set([...sourceResult.currentMatchSlots, ...sourceResult.potentialMatchRoles]);
      const referencePossible = new Set([...referenceResult.currentMatchSlots, ...referenceResult.potentialMatchRoles]);
      if (sourcePossible.size !== 1 || referencePossible.size !== 1) {
        continue;
      }
      const [sourceOnly] = sourcePossible;
      const [referenceOnly] = referencePossible;
      if (sourceOnly !== referenceOnly) {
        continue;
      }
      sourceResult.status = "fail";
      sourceResult.failType = "separation_unreachable";
      sourceResult.reason = `Separation from '${referenceId}' is unreachable with remaining slot options.`;
      break;
    }
  }

  let aggregateStatus = clauseResults[0].status;
  for (let index = 1; index < clauseResults.length; index += 1) {
    const joiner = normalizeJoiner(clauses[index]?.clauseJoiner, "and");
    aggregateStatus = combineClauseStatuses(aggregateStatus, clauseResults[index].status, joiner);
  }

  let reason = "";
  if (aggregateStatus === "pass") {
    reason = "All required clause constraints are currently satisfied.";
  } else if (aggregateStatus === "fail") {
    const failedClauses = clauseResults
      .map((clause, index) => ({ clause, index }))
      .filter(({ clause }) => clause.status === "fail")
      .map(({ index, clause }) => `Clause ${index + 1}: ${clause.reason}`);
    reason = failedClauses.join(" ");
  } else {
    const pendingClauses = clauseResults
      .map((clause, index) => ({ clause, index }))
      .filter(({ clause }) => clause.status !== "pass")
      .map(({ index, clause }) => `Clause ${index + 1}: ${clause.reason}`);
    reason = pendingClauses.join(" ");
  }

  return {
    id: normalizeRequirementIdentifier(requirement?.id, 0),
    sourceRequirementId: normalizeRequirementIdentifier(requirement?.sourceRequirementId, null),
    sourceChampionName:
      typeof requirement?.sourceChampionName === "string" ? requirement.sourceChampionName : "",
    sourceRole: typeof requirement?.sourceRole === "string" ? requirement.sourceRole : "",
    sourceType: typeof requirement?.sourceType === "string" ? requirement.sourceType : "",
    required: requirement?.required !== false,
    bonusWeight:
      requirement?.required === false
        ? Number.isFinite(Number(requirement?.bonusWeight)) && Number(requirement?.bonusWeight) > 0
          ? Number(requirement?.bonusWeight)
          : DEFAULT_OPTIONAL_REQUIREMENT_BONUS_WEIGHT
        : 0,
    name: typeof requirement?.name === "string" ? requirement.name : "Unnamed requirement",
    definition: typeof requirement?.definition === "string" ? requirement.definition : "",
    status: aggregateStatus,
    reason,
    clauses: clauseResults,
    unreachable: aggregateStatus === "fail"
  };
}

export function evaluateCompositionRequirements({
  teamState,
  championsByName,
  requirements = [],
  teamPools = {},
  teamId = null,
  excludedChampions = [],
  tagById = {}
}) {
  const normalizedTeamState = normalizeTeamState(teamState);
  const pickedChampionNames = getPickedChampionNames(normalizedTeamState);
  const excludedChampionSet = new Set(
    Array.isArray(excludedChampions)
      ? excludedChampions.filter((name) => typeof name === "string" && name.trim() !== "")
      : []
  );
  const normalizedRequirements = Array.isArray(requirements) ? requirements : [];
  const championCompositionSynergies = buildChampionCompositionSynergyRequirements({
    teamState: normalizedTeamState,
    championsByName
  });
  const allRequirements = [...normalizedRequirements, ...championCompositionSynergies];

  const context = {
    teamState: normalizedTeamState,
    championsByName: championsByName ?? {},
    tagById: tagById ?? {},
    teamPools: teamPools ?? {},
    teamId,
    excludedChampions: excludedChampionSet,
    pickedChampionNames
  };

  const results = allRequirements.map((requirement) => evaluateRequirement(requirement, context));
  const requiredResults = results.filter((result) => result.required !== false);
  const optionalResults = results.filter((result) => result.required === false);
  const requiredTotal = requiredResults.length;
  const requiredPassed = requiredResults.filter((result) => result.status === "pass").length;
  const requiredGaps = requiredTotal - requiredPassed;
  const optionalTotal = optionalResults.length;
  const optionalPassed = optionalResults.filter((result) => result.status === "pass").length;
  const optionalMisses = optionalTotal - optionalPassed;
  const unreachableRequirements = requiredResults
    .filter((result) => result.unreachable)
    .map((result) => result.name);

  return {
    requirements: results,
    requiredSummary: {
      requiredTotal,
      requiredPassed,
      requiredGaps
    },
    optionalSummary: {
      optionalTotal,
      optionalPassed,
      optionalMisses
    },
    unreachableRequirements
  };
}
