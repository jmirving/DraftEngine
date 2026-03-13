import { Router } from "express";

import { SLOTS } from "../../src/domain/model.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { parsePositiveInteger, requireObject } from "../http/validation.js";
import {
  assertScopeReadAuthorization,
  assertScopeWriteAuthorization,
  parseScope,
  resolveScopedTeamId
} from "../scope-authorization.js";

const SLOT_SET = new Set(SLOTS);
const MAX_REQUIREMENT_NAME_LENGTH = 80;
const MAX_REQUIREMENT_DEFINITION_LENGTH = 500;
const MAX_REQUIREMENT_CLAUSE_ID_LENGTH = 120;
const MAX_COMPOSITION_NAME_LENGTH = 80;
const MAX_COMPOSITION_DESCRIPTION_LENGTH = 500;

function isUniqueViolation(error) {
  return Boolean(error && typeof error === "object" && error.code === "23505");
}

function normalizeName(rawName, fieldName, maxLength) {
  if (typeof rawName !== "string" || rawName.trim() === "") {
    throw badRequest(`Expected '${fieldName}' to be a non-empty string.`);
  }
  const normalized = rawName.trim();
  if (normalized.length > maxLength) {
    throw badRequest(`Expected '${fieldName}' to be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

function normalizeDefinition(rawValue) {
  if (rawValue === undefined) {
    return "";
  }
  if (typeof rawValue !== "string") {
    throw badRequest("Expected 'definition' to be a string.");
  }
  const normalized = rawValue.trim();
  if (normalized.length > MAX_REQUIREMENT_DEFINITION_LENGTH) {
    throw badRequest(
      `Expected 'definition' to be ${MAX_REQUIREMENT_DEFINITION_LENGTH} characters or fewer.`
    );
  }
  return normalized;
}

function normalizeRoleFilter(rawRoleFilter, clauseIndex) {
  if (rawRoleFilter === undefined) {
    return null;
  }

  const values = Array.isArray(rawRoleFilter) ? rawRoleFilter : [rawRoleFilter];
  const roles = [];
  for (const rawRole of values) {
    if (typeof rawRole !== "string") {
      throw badRequest(`Expected 'rules[${clauseIndex}].roleFilter' values to be strings.`);
    }
    const normalizedRole = rawRole.trim();
    if (!SLOT_SET.has(normalizedRole)) {
      throw badRequest(`Unknown slot '${normalizedRole}' in rules[${clauseIndex}].roleFilter.`);
    }
    if (!roles.includes(normalizedRole)) {
      roles.push(normalizedRole);
    }
  }

  return roles.length > 0 ? roles : null;
}

function normalizeClauseId(rawClauseId, clauseIndex) {
  if (rawClauseId === undefined) {
    return null;
  }
  if (typeof rawClauseId !== "string" || rawClauseId.trim() === "") {
    throw badRequest(`Expected 'rules[${clauseIndex}].id' to be a non-empty string.`);
  }
  const normalized = rawClauseId.trim();
  if (normalized.length > MAX_REQUIREMENT_CLAUSE_ID_LENGTH) {
    throw badRequest(
      `Expected 'rules[${clauseIndex}].id' to be ${MAX_REQUIREMENT_CLAUSE_ID_LENGTH} characters or fewer.`
    );
  }
  return normalized;
}

function normalizeClauseReferences(rawReferences, clauseIndex) {
  if (rawReferences === undefined) {
    return null;
  }
  if (!Array.isArray(rawReferences)) {
    throw badRequest(`Expected 'rules[${clauseIndex}].separateFrom' to be an array.`);
  }
  const references = [];
  for (const value of rawReferences) {
    if (typeof value !== "string" || value.trim() === "") {
      throw badRequest(`Expected 'rules[${clauseIndex}].separateFrom' values to be non-empty strings.`);
    }
    const normalizedValue = value.trim();
    if (normalizedValue.length > MAX_REQUIREMENT_CLAUSE_ID_LENGTH) {
      throw badRequest(
        `Expected 'rules[${clauseIndex}].separateFrom' values to be ${MAX_REQUIREMENT_CLAUSE_ID_LENGTH} characters or fewer.`
      );
    }
    if (!references.includes(normalizedValue)) {
      references.push(normalizedValue);
    }
  }
  return references.length > 0 ? references : null;
}

function normalizeClauseJoiner(rawClauseJoiner, clauseIndex) {
  if (rawClauseJoiner === undefined) {
    return null;
  }
  if (typeof rawClauseJoiner !== "string" || rawClauseJoiner.trim() === "") {
    throw badRequest(`Expected 'rules[${clauseIndex}].clauseJoiner' to be 'and' or 'or'.`);
  }
  const normalized = rawClauseJoiner.trim().toLowerCase();
  if (normalized !== "and" && normalized !== "or") {
    throw badRequest(`Expected 'rules[${clauseIndex}].clauseJoiner' to be 'and' or 'or'.`);
  }
  return normalized;
}

function normalizeRuleClause(rawClause, clauseIndex) {
  if (!rawClause || typeof rawClause !== "object" || Array.isArray(rawClause)) {
    throw badRequest(`Expected 'rules[${clauseIndex}]' to be an object.`);
  }

  const { id, expr, minCount, maxCount, roleFilter, separateFrom, clauseJoiner } = rawClause;
  if (expr === undefined || expr === null) {
    throw badRequest(`Expected 'rules[${clauseIndex}].expr' to be provided.`);
  }
  const exprType = typeof expr;
  if (exprType !== "string" && (exprType !== "object" || Array.isArray(expr))) {
    throw badRequest(`Expected 'rules[${clauseIndex}].expr' to be a string or object.`);
  }
  if (exprType === "string" && expr.trim() === "") {
    throw badRequest(`Expected 'rules[${clauseIndex}].expr' to be non-empty.`);
  }

  const normalizedMinCount =
    minCount === undefined ? 1 : Number.isInteger(minCount) && minCount > 0 ? minCount : null;
  if (!normalizedMinCount) {
    throw badRequest(`Expected 'rules[${clauseIndex}].minCount' to be a positive integer.`);
  }

  if (maxCount !== undefined && (!Number.isInteger(maxCount) || maxCount < normalizedMinCount)) {
    throw badRequest(
      `Expected 'rules[${clauseIndex}].maxCount' to be an integer >= minCount (${normalizedMinCount}).`
    );
  }

  const normalizedRoleFilter = normalizeRoleFilter(roleFilter, clauseIndex);
  const normalizedClauseId = normalizeClauseId(id, clauseIndex);
  const normalizedSeparateFrom = normalizeClauseReferences(separateFrom, clauseIndex);
  const normalizedClauseJoiner = normalizeClauseJoiner(clauseJoiner, clauseIndex);
  if (normalizedSeparateFrom && !normalizedClauseId) {
    throw badRequest(`Expected 'rules[${clauseIndex}].id' when using separateFrom.`);
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

function normalizeRequirementRules(rawRules) {
  if (!Array.isArray(rawRules)) {
    throw badRequest("Expected 'rules' to be an array of requirement clauses.");
  }
  if (rawRules.length < 1) {
    throw badRequest("Expected 'rules' to include at least one clause.");
  }
  const normalizedRules = rawRules.map((rule, index) => normalizeRuleClause(rule, index));
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
      throw badRequest(`Duplicate rules[${index}].id '${rule.id}' is not allowed.`);
    }
    clauseIdSet.add(rule.id);
  }
  for (const [index, rule] of normalizedRules.entries()) {
    if (!Array.isArray(rule.separateFrom) || rule.separateFrom.length < 1) {
      continue;
    }
    for (const referenceId of rule.separateFrom) {
      if (!clauseIdSet.has(referenceId)) {
        throw badRequest(`Unknown clause id '${referenceId}' in rules[${index}].separateFrom.`);
      }
      if (rule.id === referenceId) {
        throw badRequest(`rules[${index}].separateFrom cannot reference its own id.`);
      }
    }
  }
  return normalizedRules;
}

function normalizeRequirementIds(rawRequirementIds) {
  if (!Array.isArray(rawRequirementIds)) {
    throw badRequest("Expected 'requirement_ids' to be an array.");
  }
  const deduped = new Set();
  for (const value of rawRequirementIds) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw badRequest("Expected each 'requirement_ids' entry to be a positive integer.");
    }
    deduped.add(parsed);
  }
  return [...deduped].sort((left, right) => left - right);
}

function normalizeActiveFlag(rawValue) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (typeof rawValue !== "boolean") {
    throw badRequest("Expected 'is_active' to be a boolean.");
  }
  return rawValue;
}

function normalizeDescription(rawDescription) {
  if (rawDescription === undefined) {
    return "";
  }
  if (typeof rawDescription !== "string") {
    throw badRequest("Expected 'description' to be a string.");
  }
  const normalized = rawDescription.trim();
  if (normalized.length > MAX_COMPOSITION_DESCRIPTION_LENGTH) {
    throw badRequest(
      `Expected 'description' to be ${MAX_COMPOSITION_DESCRIPTION_LENGTH} characters or fewer.`
    );
  }
  return normalized;
}

function buildIdentityDisplayName(identity) {
  const gameName = typeof identity?.game_name === "string" ? identity.game_name.trim() : "";
  const tagline = typeof identity?.tagline === "string" ? identity.tagline.trim() : "";
  const email = typeof identity?.email === "string" ? identity.email.trim() : "";
  if (gameName && tagline) {
    return `${gameName}#${tagline}`;
  }
  if (gameName) {
    return gameName;
  }
  if (email) {
    return email;
  }
  return "";
}

function serializeRequirement(requirement, updatedByDisplayName = "") {
  return {
    id: Number(requirement.id),
    name: requirement.name,
    definition: requirement.definition,
    rules: Array.isArray(requirement.rules) ? requirement.rules : [],
    scope: requirement.scope ?? "all",
    team_id:
      requirement.team_id === null || requirement.team_id === undefined ? null : Number(requirement.team_id),
    created_by_user_id:
      requirement.created_by_user_id === null || requirement.created_by_user_id === undefined
        ? null
        : Number(requirement.created_by_user_id),
    updated_by_user_id:
      requirement.updated_by_user_id === null || requirement.updated_by_user_id === undefined
        ? null
        : Number(requirement.updated_by_user_id),
    updated_by_display_name: updatedByDisplayName || null,
    created_at: requirement.created_at,
    updated_at: requirement.updated_at
  };
}

function serializeComposition(composition, updatedByDisplayName = "") {
  return {
    id: Number(composition.id),
    name: composition.name,
    description: composition.description,
    requirement_ids: Array.isArray(composition.requirement_ids)
      ? composition.requirement_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
      : [],
    is_active: composition.is_active === true,
    scope: composition.scope ?? "all",
    team_id:
      composition.team_id === null || composition.team_id === undefined ? null : Number(composition.team_id),
    created_by_user_id:
      composition.created_by_user_id === null || composition.created_by_user_id === undefined
        ? null
        : Number(composition.created_by_user_id),
    updated_by_user_id:
      composition.updated_by_user_id === null || composition.updated_by_user_id === undefined
        ? null
        : Number(composition.updated_by_user_id),
    updated_by_display_name: updatedByDisplayName || null,
    created_at: composition.created_at,
    updated_at: composition.updated_at
  };
}

async function buildIdentityDisplayNameMap(usersRepository, entities) {
  const ids = [...new Set(
    (Array.isArray(entities) ? entities : [])
      .map((entity) => entity?.updated_by_user_id)
      .filter((value) => Number.isInteger(value) && value > 0)
  )];
  if (ids.length < 1) {
    return new Map();
  }
  const identities = await usersRepository.listIdentityByIds(ids);
  return new Map(
    identities.map((identity) => [Number(identity.id), buildIdentityDisplayName(identity)])
  );
}

async function assertRequirementIdsExist(compositionsCatalogRepository, requirementIds, { scope, userId, teamId }) {
  const missingRequirementIds = await compositionsCatalogRepository.listMissingRequirementIds(requirementIds, {
    scope,
    userId,
    teamId
  });
  if (missingRequirementIds.length > 0) {
    throw badRequest(`Unknown requirement ids: ${missingRequirementIds.join(", ")}.`);
  }
}

async function resolveCatalogScopeContext({
  rawScope,
  rawTeamId,
  userId,
  usersRepository,
  teamsRepository,
  write = false,
  teamReadMessage,
  teamWriteMessage,
  teamLeadMessage,
  globalWriteMessage
}) {
  const scope = parseScope(rawScope, {
    defaultScope: "all",
    fieldName: "scope"
  });
  const teamId = await resolveScopedTeamId({
    scope,
    rawTeamId,
    userId,
    usersRepository,
    fieldName: "team_id",
    contextFieldName: "active_team_id"
  });

  if (scope !== "team" && rawTeamId !== undefined && rawTeamId !== null && rawTeamId !== "") {
    throw badRequest("Expected 'team_id' to be omitted unless scope is 'team'.");
  }

  if (write) {
    await assertScopeWriteAuthorization({
      scope,
      userId,
      teamId,
      teamsRepository,
      usersRepository,
      teamWriteMessage,
      teamLeadMessage,
      globalWriteMessage,
      allowGlobalRoleWrite: true,
      allowGlobalWriteWhenNoAdmins: true
    });
  } else {
    await assertScopeReadAuthorization({
      scope,
      userId,
      teamId,
      teamsRepository,
      teamReadMessage
    });
  }

  return {
    scope,
    teamId,
    userId: scope === "self" ? userId : null
  };
}

async function assertRequirementWriteAuthorization({
  scope,
  userId,
  teamId,
  usersRepository,
  teamsRepository,
  action
}) {
  await assertScopeWriteAuthorization({
    scope,
    userId,
    teamId,
    teamsRepository,
    usersRepository,
    teamWriteMessage: `You must be on the selected team to ${action} requirements.`,
    teamLeadMessage: `Only team leads can ${action} team-scoped requirements.`,
    globalWriteMessage: `Only admins or global editors can ${action} requirements.`,
    allowGlobalRoleWrite: true,
    allowGlobalWriteWhenNoAdmins: true
  });
}

async function assertCompositionWriteAuthorization({
  scope,
  userId,
  teamId,
  usersRepository,
  teamsRepository,
  action
}) {
  await assertScopeWriteAuthorization({
    scope,
    userId,
    teamId,
    teamsRepository,
    usersRepository,
    teamWriteMessage: `You must be on the selected team to ${action} compositions.`,
    teamLeadMessage: `Only team leads can ${action} team-scoped compositions.`,
    globalWriteMessage: `Only admins or global editors can ${action} compositions.`,
    allowGlobalRoleWrite: true,
    allowGlobalWriteWhenNoAdmins: true
  });
}

export function createCompositionsCatalogRouter({
  compositionsCatalogRepository,
  usersRepository,
  teamsRepository,
  requireAuth
}) {
  const router = Router();

  router.use("/requirements", requireAuth);
  router.use("/compositions", requireAuth);

  router.get("/requirements", async (request, response) => {
    const userId = request.user.userId;
    const scopeContext = await resolveCatalogScopeContext({
      rawScope: request.query.scope,
      rawTeamId: request.query.team_id,
      userId,
      usersRepository,
      teamsRepository,
      teamReadMessage: "You must be on the selected team to read team-scoped requirements."
    });
    const requirements = await compositionsCatalogRepository.listRequirements(scopeContext);
    const updatedByDisplayNameById = await buildIdentityDisplayNameMap(usersRepository, requirements);
    response.json({
      scope: scopeContext.scope,
      team_id: scopeContext.teamId,
      requirements: requirements.map((requirement) =>
        serializeRequirement(requirement, updatedByDisplayNameById.get(requirement.updated_by_user_id) ?? "")
      )
    });
  });

  router.post("/requirements", async (request, response) => {
    const userId = request.user.userId;
    const body = requireObject(request.body);
    const scopeContext = await resolveCatalogScopeContext({
      rawScope: body.scope,
      rawTeamId: body.team_id,
      userId,
      usersRepository,
      teamsRepository,
      write: true,
      teamWriteMessage: "You must be on the selected team to create requirements.",
      teamLeadMessage: "Only team leads can create team-scoped requirements.",
      globalWriteMessage: "Only admins or global editors can create requirements."
    });
    const name = normalizeName(body.name, "name", MAX_REQUIREMENT_NAME_LENGTH);
    const definition = normalizeDefinition(body.definition);
    const rules = normalizeRequirementRules(body.rules);

    try {
      const requirement = await compositionsCatalogRepository.createRequirement({
        name,
        definition,
        rules,
        scope: scopeContext.scope,
        userId: scopeContext.userId,
        teamId: scopeContext.teamId,
        actorUserId: userId
      });
      response.status(201).json({
        requirement: serializeRequirement(
          requirement,
          buildIdentityDisplayName(await usersRepository.findById(userId))
        )
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("A requirement with that name already exists.");
      }
      throw error;
    }
  });

  router.put("/requirements/:id", async (request, response) => {
    const userId = request.user.userId;
    const requirementId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const existing = await compositionsCatalogRepository.getRequirementById(requirementId);
    if (!existing) {
      throw notFound("Requirement not found.");
    }
    await assertRequirementWriteAuthorization({
      scope: existing.scope ?? "all",
      userId,
      teamId: existing.team_id ?? null,
      usersRepository,
      teamsRepository,
      action: "update"
    });

    const hasName = body.name !== undefined;
    const hasDefinition = body.definition !== undefined;
    const hasRules = body.rules !== undefined;
    if (!hasName && !hasDefinition && !hasRules) {
      throw badRequest("Expected at least one update field: name, definition, or rules.");
    }

    const updates = {
      name: hasName ? normalizeName(body.name, "name", MAX_REQUIREMENT_NAME_LENGTH) : undefined,
      definition: hasDefinition ? normalizeDefinition(body.definition) : undefined,
      rules: hasRules ? normalizeRequirementRules(body.rules) : undefined,
      actorUserId: userId
    };

    try {
      const requirement = await compositionsCatalogRepository.updateRequirement(requirementId, updates);
      response.json({
        requirement: serializeRequirement(
          requirement,
          buildIdentityDisplayName(await usersRepository.findById(userId))
        )
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("A requirement with that name already exists.");
      }
      throw error;
    }
  });

  router.delete("/requirements/:id", async (request, response) => {
    const userId = request.user.userId;
    const requirementId = parsePositiveInteger(request.params.id, "id");
    const existing = await compositionsCatalogRepository.getRequirementById(requirementId);
    if (!existing) {
      throw notFound("Requirement not found.");
    }
    await assertRequirementWriteAuthorization({
      scope: existing.scope ?? "all",
      userId,
      teamId: existing.team_id ?? null,
      usersRepository,
      teamsRepository,
      action: "delete"
    });

    const requirement = await compositionsCatalogRepository.deleteRequirement(requirementId);
    if (!requirement) {
      throw notFound("Requirement not found.");
    }
    await compositionsCatalogRepository.removeRequirementFromCompositions(requirementId, {
      actorUserId: userId,
      scope: requirement.scope ?? "all",
      userId: requirement.user_id ?? null,
      teamId: requirement.team_id ?? null
    });
    response.status(204).end();
  });

  router.get("/compositions", async (request, response) => {
    const userId = request.user.userId;
    const scopeContext = await resolveCatalogScopeContext({
      rawScope: request.query.scope,
      rawTeamId: request.query.team_id,
      userId,
      usersRepository,
      teamsRepository,
      teamReadMessage: "You must be on the selected team to read team-scoped compositions."
    });
    const compositions = await compositionsCatalogRepository.listCompositions(scopeContext);
    const updatedByDisplayNameById = await buildIdentityDisplayNameMap(usersRepository, compositions);
    const activeComposition = compositions.find((composition) => composition.is_active) ?? null;
    response.json({
      scope: scopeContext.scope,
      team_id: scopeContext.teamId,
      compositions: compositions.map((composition) =>
        serializeComposition(composition, updatedByDisplayNameById.get(composition.updated_by_user_id) ?? "")
      ),
      active_composition_id: activeComposition ? Number(activeComposition.id) : null
    });
  });

  router.get("/compositions/active", async (request, response) => {
    const userId = request.user.userId;
    const scopeContext = await resolveCatalogScopeContext({
      rawScope: request.query.scope,
      rawTeamId: request.query.team_id,
      userId,
      usersRepository,
      teamsRepository,
      teamReadMessage: "You must be on the selected team to read team-scoped compositions."
    });
    const composition = await compositionsCatalogRepository.getActiveComposition(scopeContext);
    if (!composition) {
      response.json({
        scope: scopeContext.scope,
        team_id: scopeContext.teamId,
        composition: null,
        requirements: []
      });
      return;
    }

    const requirementById = new Map(
      (await compositionsCatalogRepository.listRequirements(scopeContext)).map((requirement) => [
        Number(requirement.id),
        requirement
      ])
    );
    const requirements = composition.requirement_ids
      .map((requirementId) => requirementById.get(Number(requirementId)) ?? null)
      .filter(Boolean)
      .map((requirement) => serializeRequirement(requirement));

    response.json({
      scope: scopeContext.scope,
      team_id: scopeContext.teamId,
      composition: serializeComposition(composition),
      requirements
    });
  });

  router.post("/compositions", async (request, response) => {
    const userId = request.user.userId;
    const body = requireObject(request.body);
    const scopeContext = await resolveCatalogScopeContext({
      rawScope: body.scope,
      rawTeamId: body.team_id,
      userId,
      usersRepository,
      teamsRepository,
      write: true,
      teamWriteMessage: "You must be on the selected team to create compositions.",
      teamLeadMessage: "Only team leads can create team-scoped compositions.",
      globalWriteMessage: "Only admins or global editors can create compositions."
    });
    const name = normalizeName(body.name, "name", MAX_COMPOSITION_NAME_LENGTH);
    const description = normalizeDescription(body.description);
    const requirementIds = normalizeRequirementIds(body.requirement_ids);
    const isActive = normalizeActiveFlag(body.is_active) ?? false;

    await assertRequirementIdsExist(compositionsCatalogRepository, requirementIds, scopeContext);

    try {
      const composition = await compositionsCatalogRepository.createComposition({
        name,
        description,
        requirementIds,
        isActive,
        scope: scopeContext.scope,
        userId: scopeContext.userId,
        teamId: scopeContext.teamId,
        actorUserId: userId
      });

      response.status(201).json({
        composition: serializeComposition(
          composition,
          buildIdentityDisplayName(await usersRepository.findById(userId))
        )
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("A composition with that name already exists.");
      }
      throw error;
    }
  });

  router.put("/compositions/:id", async (request, response) => {
    const userId = request.user.userId;
    const compositionId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const existing = await compositionsCatalogRepository.getCompositionById(compositionId);
    if (!existing) {
      throw notFound("Composition not found.");
    }
    await assertCompositionWriteAuthorization({
      scope: existing.scope ?? "all",
      userId,
      teamId: existing.team_id ?? null,
      usersRepository,
      teamsRepository,
      action: "update"
    });

    const hasName = body.name !== undefined;
    const hasDescription = body.description !== undefined;
    const hasRequirementIds = body.requirement_ids !== undefined;
    const hasIsActive = body.is_active !== undefined;
    if (!hasName && !hasDescription && !hasRequirementIds && !hasIsActive) {
      throw badRequest("Expected at least one update field: name, description, requirement_ids, or is_active.");
    }

    const requirementIds = hasRequirementIds ? normalizeRequirementIds(body.requirement_ids) : undefined;
    if (requirementIds) {
      await assertRequirementIdsExist(compositionsCatalogRepository, requirementIds, {
        scope: existing.scope ?? "all",
        userId: existing.user_id ?? null,
        teamId: existing.team_id ?? null
      });
    }

    const updates = {
      name: hasName ? normalizeName(body.name, "name", MAX_COMPOSITION_NAME_LENGTH) : undefined,
      description: hasDescription ? normalizeDescription(body.description) : undefined,
      requirementIds,
      isActive: hasIsActive ? normalizeActiveFlag(body.is_active) : undefined,
      actorUserId: userId
    };

    try {
      const composition = await compositionsCatalogRepository.updateComposition(compositionId, updates);
      response.json({
        composition: serializeComposition(
          composition,
          buildIdentityDisplayName(await usersRepository.findById(userId))
        )
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("A composition with that name already exists.");
      }
      throw error;
    }
  });

  router.delete("/compositions/:id", async (request, response) => {
    const userId = request.user.userId;
    const compositionId = parsePositiveInteger(request.params.id, "id");
    const existing = await compositionsCatalogRepository.getCompositionById(compositionId);
    if (!existing) {
      throw notFound("Composition not found.");
    }
    await assertCompositionWriteAuthorization({
      scope: existing.scope ?? "all",
      userId,
      teamId: existing.team_id ?? null,
      usersRepository,
      teamsRepository,
      action: "delete"
    });

    const composition = await compositionsCatalogRepository.deleteComposition(compositionId);
    if (!composition) {
      throw notFound("Composition not found.");
    }
    response.status(204).end();
  });

  return router;
}
