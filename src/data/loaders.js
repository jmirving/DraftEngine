import {
  BOOLEAN_TAGS,
  DAMAGE_TYPES,
  DEFAULT_RECOMMENDATION_WEIGHTS,
  DEFAULT_TREE_SETTINGS,
  SCALING_VALUES,
  SLOTS,
  createEmptyTeamState,
  isDamageType,
  isScaling,
  isSlot
} from "../domain/model.js";
import { parseCsvRecords } from "./csv.js";

const CHAMPIONS_REQUIRED_HEADERS = ["Champion", "Roles", "DamageType", "Scaling", ...BOOLEAN_TAGS];
const TEAM_POOLS_REQUIRED_HEADERS = ["Team", "Player", "PrimaryRole", "Champion"];

export class DataValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "DataValidationError";
    this.details = details;
  }
}

function validateHeaders(headers, requiredHeaders, sourceName) {
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new DataValidationError(`${sourceName} is missing required columns: ${missing.join(", ")}`, {
      missingHeaders: missing
    });
  }
}

function parseBooleanTag(value, line, column) {
  if (value === "0") {
    return false;
  }
  if (value === "1") {
    return true;
  }
  throw new DataValidationError(`Invalid boolean tag value '${value}' at ${column}. Expected 0 or 1.`, {
    line,
    column,
    value
  });
}

function parseRoles(rawRoles, line) {
  if (!rawRoles) {
    throw new DataValidationError("Champion role list cannot be empty.", { line, column: "Roles" });
  }

  const roles = rawRoles
    .split(/[|/;]+/)
    .map((role) => role.trim())
    .filter(Boolean);

  if (roles.length === 0) {
    throw new DataValidationError("Champion role list cannot be empty.", { line, column: "Roles" });
  }

  for (const role of roles) {
    if (!isSlot(role)) {
      throw new DataValidationError(
        `Invalid role '${role}'. Expected one of ${SLOTS.join(", ")}.`,
        { line, column: "Roles", value: role }
      );
    }
  }

  return Array.from(new Set(roles));
}

export function parseChampionsCsv(csvText) {
  const { headers, records } = parseCsvRecords(csvText);
  validateHeaders(headers, CHAMPIONS_REQUIRED_HEADERS, "champions.csv");

  const champions = [];
  const championsByName = {};
  const seenNames = new Set();

  for (const { line, values } of records) {
    const name = values.Champion?.trim();
    if (!name) {
      throw new DataValidationError("Champion name cannot be empty.", { line, column: "Champion" });
    }
    if (seenNames.has(name)) {
      throw new DataValidationError(`Duplicate champion '${name}'.`, { line, column: "Champion", value: name });
    }

    const damageType = values.DamageType?.trim();
    if (!isDamageType(damageType)) {
      throw new DataValidationError(
        `Invalid DamageType '${damageType}'. Expected one of ${DAMAGE_TYPES.join(", ")}.`,
        { line, column: "DamageType", value: damageType }
      );
    }

    const scaling = values.Scaling?.trim();
    if (!isScaling(scaling)) {
      throw new DataValidationError(
        `Invalid Scaling '${scaling}'. Expected one of ${SCALING_VALUES.join(", ")}.`,
        { line, column: "Scaling", value: scaling }
      );
    }

    const roles = parseRoles(values.Roles, line);
    const tags = {};
    for (const tag of BOOLEAN_TAGS) {
      tags[tag] = parseBooleanTag(values[tag], line, tag);
    }

    const champion = {
      name,
      roles,
      damageType,
      scaling,
      tags
    };

    champions.push(champion);
    championsByName[name] = champion;
    seenNames.add(name);
  }

  return {
    champions,
    championsByName
  };
}

function createRolePools() {
  const pools = createEmptyTeamState();
  for (const slot of SLOTS) {
    pools[slot] = [];
  }
  return pools;
}

export function parseTeamPoolsCsv(csvText) {
  const { headers, records } = parseCsvRecords(csvText);
  validateHeaders(headers, TEAM_POOLS_REQUIRED_HEADERS, "team_pools.csv");

  const entries = [];
  const poolsByTeam = {};
  const dedupeByTeamRole = new Set();

  for (const { line, values } of records) {
    const team = values.Team?.trim();
    const player = values.Player?.trim();
    const role = values.PrimaryRole?.trim();
    const champion = values.Champion?.trim();

    if (!team) {
      throw new DataValidationError("Team cannot be empty.", { line, column: "Team" });
    }
    if (!champion) {
      throw new DataValidationError("Champion cannot be empty in team_pools.csv.", { line, column: "Champion" });
    }
    if (!isSlot(role)) {
      throw new DataValidationError(`Invalid PrimaryRole '${role}'.`, {
        line,
        column: "PrimaryRole",
        value: role
      });
    }

    if (!poolsByTeam[team]) {
      poolsByTeam[team] = createRolePools();
    }

    const dedupeKey = `${team}::${role}::${champion}`;
    if (!dedupeByTeamRole.has(dedupeKey)) {
      poolsByTeam[team][role].push(champion);
      dedupeByTeamRole.add(dedupeKey);
    }

    entries.push({
      line,
      team,
      player: player || null,
      role,
      champion
    });
  }

  return {
    entries,
    poolsByTeam
  };
}

function normalizeInteger(value, fallback, min, fieldName) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (!Number.isInteger(value) || value < min) {
    throw new DataValidationError(`${fieldName} must be an integer >= ${min}.`, { value, fieldName });
  }
  return value;
}

function normalizeNumber(value, fallback, min, fieldName) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value !== "number" || Number.isNaN(value) || value < min) {
    throw new DataValidationError(`${fieldName} must be a number >= ${min}.`, { value, fieldName });
  }
  return value;
}

export function parseConfigJson(jsonText) {
  const trimmed = typeof jsonText === "string" ? jsonText.trim() : "";
  const rawConfig = trimmed === "" ? {} : JSON.parse(trimmed);

  if (rawConfig === null || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    throw new DataValidationError("config.json must be a JSON object.");
  }

  const recommendation = rawConfig.recommendation ?? {};
  if (recommendation === null || typeof recommendation !== "object" || Array.isArray(recommendation)) {
    throw new DataValidationError("config.recommendation must be an object when provided.");
  }

  const weights = {
    ...DEFAULT_RECOMMENDATION_WEIGHTS
  };

  if (recommendation.weights !== undefined) {
    if (recommendation.weights === null || typeof recommendation.weights !== "object" || Array.isArray(recommendation.weights)) {
      throw new DataValidationError("config.recommendation.weights must be an object.");
    }

    for (const [key, value] of Object.entries(recommendation.weights)) {
      if (!BOOLEAN_TAGS.includes(key)) {
        throw new DataValidationError(`Unknown recommendation weight '${key}'.`);
      }
      weights[key] = normalizeNumber(value, weights[key], 0, `recommendation.weights.${key}`);
    }
  }

  const treeDefaults = rawConfig.treeDefaults ?? {};
  if (treeDefaults === null || typeof treeDefaults !== "object" || Array.isArray(treeDefaults)) {
    throw new DataValidationError("config.treeDefaults must be an object when provided.");
  }

  const maxDepth = normalizeInteger(treeDefaults.maxDepth, DEFAULT_TREE_SETTINGS.maxDepth, 1, "treeDefaults.maxDepth");
  const maxBranch = normalizeInteger(
    treeDefaults.maxBranch,
    DEFAULT_TREE_SETTINGS.maxBranch,
    1,
    "treeDefaults.maxBranch"
  );

  return {
    teamDefault: typeof rawConfig.teamDefault === "string" && rawConfig.teamDefault.trim() !== ""
      ? rawConfig.teamDefault.trim()
      : null,
    recommendation: {
      weights
    },
    treeDefaults: {
      maxDepth,
      maxBranch
    }
  };
}

export function buildDraftflowData({ championsCsvText, teamPoolsCsvText, configJsonText = "" }) {
  const championData = parseChampionsCsv(championsCsvText);
  const poolData = parseTeamPoolsCsv(teamPoolsCsvText);
  const config = parseConfigJson(configJsonText);

  for (const [team, rolePools] of Object.entries(poolData.poolsByTeam)) {
    for (const slot of SLOTS) {
      for (const championName of rolePools[slot]) {
        if (!championData.championsByName[championName]) {
          throw new DataValidationError(
            `team_pools.csv references unknown champion '${championName}' for team '${team}' role '${slot}'.`
          );
        }
      }
    }
  }

  return {
    champions: championData.champions,
    championsByName: championData.championsByName,
    teamPools: poolData.poolsByTeam,
    teamPoolEntries: poolData.entries,
    config
  };
}
