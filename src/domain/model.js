/**
 * @typedef {"Top"|"Jungle"|"Mid"|"ADC"|"Support"} Slot
 * @typedef {"AD"|"AP"|"Mixed"} DamageType
 * @typedef {"Early"|"Mid"|"Late"} Scaling
 */

export const SLOTS = Object.freeze(["Top", "Jungle", "Mid", "ADC", "Support"]);
export const DAMAGE_TYPES = Object.freeze(["AD", "AP", "Mixed"]);
export const SCALING_VALUES = Object.freeze(["Early", "Mid", "Late"]);

export const BOOLEAN_TAGS = Object.freeze([
  "HardEngage",
  "FollowUpEngage",
  "PickThreat",
  "Frontline",
  "Disengage",
  "Waveclear",
  "ZoneControl",
  "ObjectiveSecure",
  "AntiTank",
  "FrontToBackDPS",
  "DiveThreat",
  "SideLaneThreat",
  "Poke",
  "FogThreat",
  "EarlyPriority",
  "PrimaryCarry",
  "SustainedDPS",
  "TurretSiege",
  "SelfPeel",
  "UtilityCarry"
]);

export const REQUIREMENT_CHECKS = Object.freeze([
  "HasHardEngage",
  "HasFrontline",
  "HasWaveclear",
  "HasDisengage",
  "HasAntiTank",
  "HasPrimaryCarry",
  "DamageMix",
  "TopMustBeThreat"
]);

export const DEFAULT_REQUIREMENT_TOGGLES = Object.freeze({
  requireHardEngage: true,
  requireFrontline: true,
  requireWaveclear: true,
  requireDamageMix: true,
  requireAntiTank: false,
  requireDisengage: false,
  requirePrimaryCarry: true,
  topMustBeThreat: true
});

export const DEFAULT_RECOMMENDATION_WEIGHTS = Object.freeze({
  HardEngage: 10,
  Frontline: 8,
  Waveclear: 8,
  Disengage: 6,
  AntiTank: 5,
  ZoneControl: 5,
  PickThreat: 4,
  DiveThreat: 4,
  SideLaneThreat: 4,
  Poke: 3,
  FogThreat: 3,
  FollowUpEngage: 3,
  FrontToBackDPS: 3,
  EarlyPriority: 2,
  PrimaryCarry: 0,
  SustainedDPS: 0,
  TurretSiege: 0,
  SelfPeel: 0,
  UtilityCarry: 0
});

export const DEFAULT_TREE_SETTINGS = Object.freeze({
  maxDepth: 4,
  maxBranch: 8
});

const SLOT_SET = new Set(SLOTS);
const DAMAGE_TYPE_SET = new Set(DAMAGE_TYPES);
const SCALING_SET = new Set(SCALING_VALUES);
const TAG_SET = new Set(BOOLEAN_TAGS);

export function isSlot(value) {
  return SLOT_SET.has(value);
}

export function isDamageType(value) {
  return DAMAGE_TYPE_SET.has(value);
}

export function isScaling(value) {
  return SCALING_SET.has(value);
}

export function isTag(value) {
  return TAG_SET.has(value);
}

export function createEmptyTeamState() {
  return {
    Top: null,
    Jungle: null,
    Mid: null,
    ADC: null,
    Support: null
  };
}

export function normalizeTeamState(teamState = {}) {
  const normalized = createEmptyTeamState();
  for (const slot of SLOTS) {
    const rawValue = teamState[slot];
    normalized[slot] = typeof rawValue === "string" && rawValue.trim() !== "" ? rawValue.trim() : null;
  }
  return normalized;
}

export function getPickedChampionNames(teamState = {}) {
  const normalized = normalizeTeamState(teamState);
  return new Set(SLOTS.map((slot) => normalized[slot]).filter(Boolean));
}

export function isTeamComplete(teamState = {}) {
  const normalized = normalizeTeamState(teamState);
  return SLOTS.every((slot) => normalized[slot] !== null);
}

export function mergeRequirementToggles(overrides = {}) {
  return {
    ...DEFAULT_REQUIREMENT_TOGGLES,
    ...overrides
  };
}
