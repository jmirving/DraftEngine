import {
  BOOLEAN_TAGS,
  DEFAULT_REQUIREMENT_TOGGLES,
  SLOTS,
  mergeRequirementToggles,
  normalizeTeamState
} from "../domain/model.js";

const REQUIRED_TAG_REQUIREMENTS = Object.freeze({
  HasHardEngage: "HardEngage",
  HasFrontline: "Frontline",
  HasWaveclear: "Waveclear",
  HasDisengage: "Disengage",
  HasAntiTank: "AntiTank",
  HasPrimaryCarry: "PrimaryCarry"
});

const OPTIONAL_TAG_CHECKS = Object.freeze({
  HasSustainedDPS: "SustainedDPS",
  HasTurretSiege: "TurretSiege",
  HasSelfPeel: "SelfPeel",
  HasUtilityCarry: "UtilityCarry"
});

function createFilledTagCounts() {
  const counts = {};
  for (const tag of BOOLEAN_TAGS) {
    counts[tag] = 0;
  }
  return counts;
}

export function isTopThreatChampion(champion) {
  if (!champion || !champion.tags) {
    return false;
  }
  return champion.tags.SideLaneThreat || champion.tags.DiveThreat;
}

export function computeTeamHelpers(teamState, championsByName) {
  const normalized = normalizeTeamState(teamState);
  const filledTags = createFilledTagCounts();
  const selectedChampions = [];
  let hasAD = false;
  let hasAP = false;

  for (const slot of SLOTS) {
    const championName = normalized[slot];
    if (!championName) {
      continue;
    }

    const champion = championsByName[championName];
    if (!champion) {
      throw new Error(`Unknown champion '${championName}' in team state for slot '${slot}'.`);
    }

    selectedChampions.push({
      slot,
      champion
    });

    if (champion.damageType === "AD" || champion.damageType === "Mixed") {
      hasAD = true;
    }
    if (champion.damageType === "AP" || champion.damageType === "Mixed") {
      hasAP = true;
    }

    for (const tag of BOOLEAN_TAGS) {
      if (champion.tags[tag]) {
        filledTags[tag] += 1;
      }
    }
  }

  return {
    normalizedTeamState: normalized,
    selectedChampions,
    filledTags,
    hasAD,
    hasAP
  };
}

function buildCheckResult(id, required, satisfied, reason, metadata = {}) {
  return {
    id,
    required,
    satisfied,
    status: satisfied ? "good" : "warn",
    reason,
    ...metadata
  };
}

function mapMissingNeeds(toggles, helpers, checks) {
  const missingTags = [];

  if (toggles.requireHardEngage && !checks.HasHardEngage.satisfied) {
    missingTags.push("HardEngage");
  }
  if (toggles.requireFrontline && !checks.HasFrontline.satisfied) {
    missingTags.push("Frontline");
  }
  if (toggles.requireWaveclear && !checks.HasWaveclear.satisfied) {
    missingTags.push("Waveclear");
  }
  if (toggles.requireDisengage && !checks.HasDisengage.satisfied) {
    missingTags.push("Disengage");
  }
  if (toggles.requireAntiTank && !checks.HasAntiTank.satisfied) {
    missingTags.push("AntiTank");
  }
  if (toggles.requirePrimaryCarry && !checks.HasPrimaryCarry.satisfied) {
    missingTags.push("PrimaryCarry");
  }

  return {
    tags: missingTags,
    needsAD: toggles.requireDamageMix && !helpers.hasAD,
    needsAP: toggles.requireDamageMix && !helpers.hasAP,
    needsTopThreat:
      toggles.topMustBeThreat &&
      checks.TopMustBeThreat.applicable &&
      !checks.TopMustBeThreat.satisfied
  };
}

export function evaluateCompositionChecks(teamState, championsByName, toggleOverrides = {}) {
  const toggles = mergeRequirementToggles(toggleOverrides);
  const helpers = computeTeamHelpers(teamState, championsByName);
  const checks = {};

  for (const [checkName, tag] of Object.entries(REQUIRED_TAG_REQUIREMENTS)) {
    const satisfied = helpers.filledTags[tag] >= 1;
    checks[checkName] = buildCheckResult(
      checkName,
      true,
      satisfied,
      satisfied ? `${tag} covered.` : `${tag} not satisfied yet.`,
      {
        requirementType: "tag",
        requirementTag: tag
      }
    );
  }
  for (const [checkName, tag] of Object.entries(OPTIONAL_TAG_CHECKS)) {
    const satisfied = helpers.filledTags[tag] >= 1;
    checks[checkName] = buildCheckResult(
      checkName,
      false,
      satisfied,
      satisfied ? `${tag} covered.` : `${tag} not satisfied yet.`,
      {
        requirementType: "tag",
        requirementTag: tag
      }
    );
  }

  const damageMixSatisfied = helpers.hasAD && helpers.hasAP;
  checks.DamageMix = buildCheckResult(
    "DamageMix",
    true,
    damageMixSatisfied,
    damageMixSatisfied ? "Team has both AD and AP damage types." : "Team damage mix is missing AD or AP.",
    {
      requirementType: "damage_mix",
      hasAD: helpers.hasAD,
      hasAP: helpers.hasAP
    }
  );

  const topName = helpers.normalizedTeamState.Top;
  const topFilled = topName !== null;
  if (!topFilled) {
    checks.TopMustBeThreat = buildCheckResult(
      "TopMustBeThreat",
      true,
      false,
      "Top slot is not filled yet.",
      {
        requirementType: "top_threat",
        requiredRole: "Top",
        applicable: false
      }
    );
  } else {
    const topChampion = championsByName[topName];
    const topSatisfied = isTopThreatChampion(topChampion);
    checks.TopMustBeThreat = buildCheckResult(
      "TopMustBeThreat",
      true,
      topSatisfied,
      topSatisfied
        ? "Top provides SideLaneThreat or DiveThreat."
        : "Top must provide SideLaneThreat or DiveThreat.",
      {
        requirementType: "top_threat",
        requiredRole: "Top",
        applicable: true
      }
    );
  }

  // Mark disabled checks as informational-only while still exposing evaluated state.
  checks.HasHardEngage.required = toggles.requireHardEngage;
  checks.HasFrontline.required = toggles.requireFrontline;
  checks.HasWaveclear.required = toggles.requireWaveclear;
  checks.HasDisengage.required = toggles.requireDisengage;
  checks.HasAntiTank.required = toggles.requireAntiTank;
  checks.HasPrimaryCarry.required = toggles.requirePrimaryCarry;
  checks.DamageMix.required = toggles.requireDamageMix;
  checks.TopMustBeThreat.required = toggles.topMustBeThreat;

  const missingNeeds = mapMissingNeeds(toggles, helpers, checks);

  return {
    toggles,
    helpers,
    checks,
    missingNeeds
  };
}

export function scoreNodeFromChecks(checkEvaluation) {
  const { checks, toggles, helpers } = checkEvaluation;
  let score = 0;

  const requiredChecks = [
    ["requireHardEngage", "HasHardEngage"],
    ["requireFrontline", "HasFrontline"],
    ["requireWaveclear", "HasWaveclear"],
    ["requireDisengage", "HasDisengage"],
    ["requireAntiTank", "HasAntiTank"],
    ["requirePrimaryCarry", "HasPrimaryCarry"],
    ["requireDamageMix", "DamageMix"]
  ];

  for (const [toggleKey, checkName] of requiredChecks) {
    if (!toggles[toggleKey]) {
      continue;
    }
    score += checks[checkName].satisfied ? 10 : 3;
  }

  if (toggles.topMustBeThreat && checks.TopMustBeThreat.applicable && checks.TopMustBeThreat.satisfied) {
    score += 5;
  }

  if (toggles.requireDamageMix && checks.DamageMix.satisfied) {
    score += 5;
  }

  const filledSlots = helpers.selectedChampions.length;
  score += filledSlots * 4;

  const uniqueTagCount = BOOLEAN_TAGS.reduce(
    (count, tag) => count + (helpers.filledTags[tag] > 0 ? 1 : 0),
    0
  );
  score += uniqueTagCount * 2;

  return score;
}

export function getDefaultRequirementToggles() {
  return {
    ...DEFAULT_REQUIREMENT_TOGGLES
  };
}
