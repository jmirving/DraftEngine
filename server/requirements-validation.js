import { SLOTS } from "../src/domain/model.js";
import { badRequest } from "./errors.js";

const SLOT_SET = new Set(SLOTS);
export const MAX_REQUIREMENT_DEFINITION_LENGTH = 500;
const MAX_REQUIREMENT_CLAUSE_ID_LENGTH = 120;

export function normalizeRequirementDefinitionText(rawValue, fieldName = "definition") {
  if (rawValue === undefined) {
    return "";
  }
  if (typeof rawValue !== "string") {
    throw badRequest(`Expected '${fieldName}' to be a string.`);
  }
  const normalized = rawValue.trim();
  if (normalized.length > MAX_REQUIREMENT_DEFINITION_LENGTH) {
    throw badRequest(
      `Expected '${fieldName}' to be ${MAX_REQUIREMENT_DEFINITION_LENGTH} characters or fewer.`
    );
  }
  return normalized;
}

function normalizeRoleFilter(rawRoleFilter, clauseIndex, fieldPrefix) {
  if (rawRoleFilter === undefined) {
    return null;
  }

  const values = Array.isArray(rawRoleFilter) ? rawRoleFilter : [rawRoleFilter];
  const roles = [];
  for (const rawRole of values) {
    if (typeof rawRole !== "string") {
      throw badRequest(`Expected '${fieldPrefix}[${clauseIndex}].roleFilter' values to be strings.`);
    }
    const normalizedRole = rawRole.trim();
    if (!SLOT_SET.has(normalizedRole)) {
      throw badRequest(`Unknown slot '${normalizedRole}' in ${fieldPrefix}[${clauseIndex}].roleFilter.`);
    }
    if (!roles.includes(normalizedRole)) {
      roles.push(normalizedRole);
    }
  }

  return roles.length > 0 ? roles : null;
}

function normalizeClauseId(rawClauseId, clauseIndex, fieldPrefix) {
  if (rawClauseId === undefined) {
    return null;
  }
  if (typeof rawClauseId !== "string" || rawClauseId.trim() === "") {
    throw badRequest(`Expected '${fieldPrefix}[${clauseIndex}].id' to be a non-empty string.`);
  }
  const normalized = rawClauseId.trim();
  if (normalized.length > MAX_REQUIREMENT_CLAUSE_ID_LENGTH) {
    throw badRequest(
      `Expected '${fieldPrefix}[${clauseIndex}].id' to be ${MAX_REQUIREMENT_CLAUSE_ID_LENGTH} characters or fewer.`
    );
  }
  return normalized;
}

function normalizeClauseReferences(rawReferences, clauseIndex, fieldPrefix) {
  if (rawReferences === undefined) {
    return null;
  }
  if (!Array.isArray(rawReferences)) {
    throw badRequest(`Expected '${fieldPrefix}[${clauseIndex}].separateFrom' to be an array.`);
  }
  const references = [];
  for (const value of rawReferences) {
    if (typeof value !== "string" || value.trim() === "") {
      throw badRequest(
        `Expected '${fieldPrefix}[${clauseIndex}].separateFrom' values to be non-empty strings.`
      );
    }
    const normalizedValue = value.trim();
    if (normalizedValue.length > MAX_REQUIREMENT_CLAUSE_ID_LENGTH) {
      throw badRequest(
        `Expected '${fieldPrefix}[${clauseIndex}].separateFrom' values to be ${MAX_REQUIREMENT_CLAUSE_ID_LENGTH} characters or fewer.`
      );
    }
    if (!references.includes(normalizedValue)) {
      references.push(normalizedValue);
    }
  }
  return references.length > 0 ? references : null;
}

function normalizeClauseJoiner(rawClauseJoiner, clauseIndex, fieldPrefix) {
  if (rawClauseJoiner === undefined) {
    return null;
  }
  if (typeof rawClauseJoiner !== "string" || rawClauseJoiner.trim() === "") {
    throw badRequest(`Expected '${fieldPrefix}[${clauseIndex}].clauseJoiner' to be 'and' or 'or'.`);
  }
  const normalized = rawClauseJoiner.trim().toLowerCase();
  if (normalized !== "and" && normalized !== "or") {
    throw badRequest(`Expected '${fieldPrefix}[${clauseIndex}].clauseJoiner' to be 'and' or 'or'.`);
  }
  return normalized;
}

function normalizeRuleClause(rawClause, clauseIndex, fieldPrefix) {
  if (!rawClause || typeof rawClause !== "object" || Array.isArray(rawClause)) {
    throw badRequest(`Expected '${fieldPrefix}[${clauseIndex}]' to be an object.`);
  }

  const { id, expr, minCount, maxCount, roleFilter, separateFrom, clauseJoiner } = rawClause;
  if (expr === undefined || expr === null) {
    throw badRequest(`Expected '${fieldPrefix}[${clauseIndex}].expr' to be provided.`);
  }
  const exprType = typeof expr;
  if (exprType !== "string" && (exprType !== "object" || Array.isArray(expr))) {
    throw badRequest(`Expected '${fieldPrefix}[${clauseIndex}].expr' to be a string or object.`);
  }
  if (exprType === "string" && expr.trim() === "") {
    throw badRequest(`Expected '${fieldPrefix}[${clauseIndex}].expr' to be non-empty.`);
  }

  const normalizedMinCount =
    minCount === undefined ? 1 : Number.isInteger(minCount) && minCount > 0 ? minCount : null;
  if (!normalizedMinCount) {
    throw badRequest(`Expected '${fieldPrefix}[${clauseIndex}].minCount' to be a positive integer.`);
  }

  if (maxCount !== undefined && (!Number.isInteger(maxCount) || maxCount < normalizedMinCount)) {
    throw badRequest(
      `Expected '${fieldPrefix}[${clauseIndex}].maxCount' to be an integer >= minCount (${normalizedMinCount}).`
    );
  }

  const normalizedRoleFilter = normalizeRoleFilter(roleFilter, clauseIndex, fieldPrefix);
  const normalizedClauseId = normalizeClauseId(id, clauseIndex, fieldPrefix);
  const normalizedSeparateFrom = normalizeClauseReferences(separateFrom, clauseIndex, fieldPrefix);
  const normalizedClauseJoiner = normalizeClauseJoiner(clauseJoiner, clauseIndex, fieldPrefix);
  if (normalizedSeparateFrom && !normalizedClauseId) {
    throw badRequest(`Expected '${fieldPrefix}[${clauseIndex}].id' when using separateFrom.`);
  }

  return {
    ...(normalizedClauseId ? { id: normalizedClauseId } : {}),
    expr,
    minCount: normalizedMinCount,
    ...(maxCount === undefined ? {} : { maxCount }),
    ...(normalizedRoleFilter ? { roleFilter: normalizedRoleFilter } : {}),
    ...(normalizedClauseJoiner ? { clauseJoiner: normalizedClauseJoiner } : {}),
    ...(normalizedSeparateFrom ? { separateFrom: normalizedSeparateFrom } : {})
  };
}

export function normalizeRequirementRules(rawRules, fieldName = "rules") {
  if (!Array.isArray(rawRules)) {
    throw badRequest(`Expected '${fieldName}' to be an array of requirement clauses.`);
  }
  if (rawRules.length < 1) {
    throw badRequest(`Expected '${fieldName}' to include at least one clause.`);
  }
  const normalizedRules = rawRules.map((rule, index) => normalizeRuleClause(rule, index, fieldName));
  for (const [index, rule] of normalizedRules.entries()) {
    if (index < 1) {
      delete rule.clauseJoiner;
      continue;
    }
    if (!rule.clauseJoiner) {
      rule.clauseJoiner = "and";
    }
  }
  const clauseIdSet = new Set();
  for (const [index, rule] of normalizedRules.entries()) {
    if (!rule.id) {
      continue;
    }
    if (clauseIdSet.has(rule.id)) {
      throw badRequest(`Duplicate ${fieldName}[${index}].id '${rule.id}' is not allowed.`);
    }
    clauseIdSet.add(rule.id);
  }
  for (const [index, rule] of normalizedRules.entries()) {
    if (!Array.isArray(rule.separateFrom) || rule.separateFrom.length < 1) {
      continue;
    }
    for (const referenceId of rule.separateFrom) {
      if (!clauseIdSet.has(referenceId)) {
        throw badRequest(`Unknown clause id '${referenceId}' in ${fieldName}[${index}].separateFrom.`);
      }
      if (rule.id === referenceId) {
        throw badRequest(`${fieldName}[${index}].separateFrom cannot reference its own id.`);
      }
    }
  }
  return normalizedRules;
}
