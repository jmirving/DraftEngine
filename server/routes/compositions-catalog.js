import { Router } from "express";

import { SLOTS } from "../../src/domain/model.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { parsePositiveInteger, requireObject } from "../http/validation.js";
import { assertAdminAuthorization } from "../scope-authorization.js";

const SLOT_SET = new Set(SLOTS);
const MAX_REQUIREMENT_NAME_LENGTH = 80;
const MAX_REQUIREMENT_DEFINITION_LENGTH = 500;
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

function normalizeRuleClause(rawClause, clauseIndex) {
  if (!rawClause || typeof rawClause !== "object" || Array.isArray(rawClause)) {
    throw badRequest(`Expected 'rules[${clauseIndex}]' to be an object.`);
  }

  const { expr, minCount, maxCount, roleFilter } = rawClause;
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

  return {
    expr,
    minCount: normalizedMinCount,
    ...(maxCount === undefined ? {} : { maxCount }),
    ...(normalizedRoleFilter ? { roleFilter: normalizedRoleFilter } : {})
  };
}

function normalizeRequirementRules(rawRules) {
  if (!Array.isArray(rawRules)) {
    throw badRequest("Expected 'rules' to be an array of requirement clauses.");
  }
  if (rawRules.length < 1) {
    throw badRequest("Expected 'rules' to include at least one clause.");
  }
  return rawRules.map((rule, index) => normalizeRuleClause(rule, index));
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

function serializeRequirement(requirement) {
  return {
    id: Number(requirement.id),
    name: requirement.name,
    definition: requirement.definition,
    rules: Array.isArray(requirement.rules) ? requirement.rules : [],
    created_by_user_id:
      requirement.created_by_user_id === null || requirement.created_by_user_id === undefined
        ? null
        : Number(requirement.created_by_user_id),
    updated_by_user_id:
      requirement.updated_by_user_id === null || requirement.updated_by_user_id === undefined
        ? null
        : Number(requirement.updated_by_user_id),
    created_at: requirement.created_at,
    updated_at: requirement.updated_at
  };
}

function serializeComposition(composition) {
  return {
    id: Number(composition.id),
    name: composition.name,
    description: composition.description,
    requirement_ids: Array.isArray(composition.requirement_ids)
      ? composition.requirement_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
      : [],
    is_active: composition.is_active === true,
    created_by_user_id:
      composition.created_by_user_id === null || composition.created_by_user_id === undefined
        ? null
        : Number(composition.created_by_user_id),
    updated_by_user_id:
      composition.updated_by_user_id === null || composition.updated_by_user_id === undefined
        ? null
        : Number(composition.updated_by_user_id),
    created_at: composition.created_at,
    updated_at: composition.updated_at
  };
}

async function assertRequirementIdsExist(compositionsCatalogRepository, requirementIds) {
  const missingRequirementIds = await compositionsCatalogRepository.listMissingRequirementIds(requirementIds);
  if (missingRequirementIds.length > 0) {
    throw badRequest(`Unknown requirement ids: ${missingRequirementIds.join(", ")}.`);
  }
}

export function createCompositionsCatalogRouter({
  compositionsCatalogRepository,
  usersRepository,
  requireAuth
}) {
  const router = Router();

  router.use("/requirements", requireAuth);
  router.use("/compositions", requireAuth);

  router.get("/requirements", async (_request, response) => {
    const requirements = await compositionsCatalogRepository.listRequirements();
    response.json({
      requirements: requirements.map(serializeRequirement)
    });
  });

  router.post("/requirements", async (request, response) => {
    const userId = request.user.userId;
    await assertAdminAuthorization({
      userId,
      usersRepository,
      message: "Only admins can create requirements."
    });

    const body = requireObject(request.body);
    const name = normalizeName(body.name, "name", MAX_REQUIREMENT_NAME_LENGTH);
    const definition = normalizeDefinition(body.definition);
    const rules = normalizeRequirementRules(body.rules);

    try {
      const requirement = await compositionsCatalogRepository.createRequirement({
        name,
        definition,
        rules,
        actorUserId: userId
      });
      response.status(201).json({
        requirement: serializeRequirement(requirement)
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
    await assertAdminAuthorization({
      userId,
      usersRepository,
      message: "Only admins can update requirements."
    });

    const requirementId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);

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
      if (!requirement) {
        throw notFound("Requirement not found.");
      }
      response.json({
        requirement: serializeRequirement(requirement)
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
    await assertAdminAuthorization({
      userId,
      usersRepository,
      message: "Only admins can delete requirements."
    });

    const requirementId = parsePositiveInteger(request.params.id, "id");
    const requirement = await compositionsCatalogRepository.deleteRequirement(requirementId);
    if (!requirement) {
      throw notFound("Requirement not found.");
    }
    await compositionsCatalogRepository.removeRequirementFromCompositions(requirementId, userId);
    response.status(204).end();
  });

  router.get("/compositions", async (_request, response) => {
    const compositions = await compositionsCatalogRepository.listCompositions();
    const activeComposition = compositions.find((composition) => composition.is_active) ?? null;
    response.json({
      compositions: compositions.map(serializeComposition),
      active_composition_id: activeComposition ? Number(activeComposition.id) : null
    });
  });

  router.get("/compositions/active", async (_request, response) => {
    const composition = await compositionsCatalogRepository.getActiveComposition();
    if (!composition) {
      response.json({ composition: null, requirements: [] });
      return;
    }

    const requirementById = new Map(
      (await compositionsCatalogRepository.listRequirements()).map((requirement) => [Number(requirement.id), requirement])
    );
    const requirements = composition.requirement_ids
      .map((requirementId) => requirementById.get(Number(requirementId)) ?? null)
      .filter(Boolean)
      .map(serializeRequirement);

    response.json({
      composition: serializeComposition(composition),
      requirements
    });
  });

  router.post("/compositions", async (request, response) => {
    const userId = request.user.userId;
    await assertAdminAuthorization({
      userId,
      usersRepository,
      message: "Only admins can create compositions."
    });

    const body = requireObject(request.body);
    const name = normalizeName(body.name, "name", MAX_COMPOSITION_NAME_LENGTH);
    const description = normalizeDescription(body.description);
    const requirementIds = normalizeRequirementIds(body.requirement_ids);
    const isActive = normalizeActiveFlag(body.is_active) ?? false;

    await assertRequirementIdsExist(compositionsCatalogRepository, requirementIds);

    try {
      const composition = await compositionsCatalogRepository.createComposition({
        name,
        description,
        requirementIds,
        isActive,
        actorUserId: userId
      });

      response.status(201).json({
        composition: serializeComposition(composition)
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
    await assertAdminAuthorization({
      userId,
      usersRepository,
      message: "Only admins can update compositions."
    });

    const compositionId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);

    const hasName = body.name !== undefined;
    const hasDescription = body.description !== undefined;
    const hasRequirementIds = body.requirement_ids !== undefined;
    const hasIsActive = body.is_active !== undefined;
    if (!hasName && !hasDescription && !hasRequirementIds && !hasIsActive) {
      throw badRequest("Expected at least one update field: name, description, requirement_ids, or is_active.");
    }

    const requirementIds = hasRequirementIds ? normalizeRequirementIds(body.requirement_ids) : undefined;
    if (requirementIds) {
      await assertRequirementIdsExist(compositionsCatalogRepository, requirementIds);
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
      if (!composition) {
        throw notFound("Composition not found.");
      }
      response.json({
        composition: serializeComposition(composition)
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
    await assertAdminAuthorization({
      userId,
      usersRepository,
      message: "Only admins can delete compositions."
    });

    const compositionId = parsePositiveInteger(request.params.id, "id");
    const composition = await compositionsCatalogRepository.deleteComposition(compositionId);
    if (!composition) {
      throw notFound("Composition not found.");
    }
    response.status(204).end();
  });

  return router;
}
