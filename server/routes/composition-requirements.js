import { Router } from "express";

import { DEFAULT_REQUIREMENT_TOGGLES } from "../../src/domain/model.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { parsePositiveInteger, requireObject } from "../http/validation.js";
import { REQUIREMENT_TOGGLE_KEYS } from "../repositories/checks.js";
import { assertAdminAuthorization } from "../scope-authorization.js";

const REQUIREMENT_TOGGLE_KEY_SET = new Set(REQUIREMENT_TOGGLE_KEYS);
const MAX_REQUIREMENT_NAME_LENGTH = 80;

function normalizeRequirementName(rawName) {
  if (typeof rawName !== "string" || rawName.trim() === "") {
    throw badRequest("Expected 'name' to be a non-empty string.");
  }
  const normalized = rawName.trim();
  if (normalized.length > MAX_REQUIREMENT_NAME_LENGTH) {
    throw badRequest(`Expected 'name' to be ${MAX_REQUIREMENT_NAME_LENGTH} characters or fewer.`);
  }
  return normalized;
}

function normalizeRequirementToggles(rawToggles) {
  if (rawToggles === undefined) {
    return undefined;
  }
  if (rawToggles === null || typeof rawToggles !== "object" || Array.isArray(rawToggles)) {
    throw badRequest("Expected 'toggles' to be a JSON object.");
  }

  const normalized = {};
  for (const [key, value] of Object.entries(rawToggles)) {
    if (!REQUIREMENT_TOGGLE_KEY_SET.has(key)) {
      throw badRequest(`Unknown check toggle '${key}'.`);
    }
    if (typeof value !== "boolean") {
      throw badRequest(`Expected 'toggles.${key}' to be a boolean.`);
    }
    normalized[key] = value;
  }

  return {
    ...DEFAULT_REQUIREMENT_TOGGLES,
    ...normalized
  };
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

function serializeRequirement(requirement) {
  return {
    id: Number(requirement.id),
    name: requirement.name,
    toggles: requirement.toggles,
    is_active: requirement.is_active === true,
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

function isUniqueViolation(error) {
  return Boolean(error && typeof error === "object" && error.code === "23505");
}

export function createCompositionRequirementsRouter({
  compositionRequirementsRepository,
  usersRepository,
  requireAuth
}) {
  const router = Router();
  router.use("/composition-requirements", requireAuth);

  router.get("/composition-requirements", async (_request, response) => {
    const requirements = await compositionRequirementsRepository.listRequirements();
    const active = requirements.find((requirement) => requirement.is_active) ?? null;
    response.json({
      requirements: requirements.map(serializeRequirement),
      active_requirement_id: active ? Number(active.id) : null
    });
  });

  router.get("/composition-requirements/active", async (_request, response) => {
    const requirement = await compositionRequirementsRepository.getActiveRequirement();
    response.json({
      requirement: requirement ? serializeRequirement(requirement) : null,
      toggles: requirement?.toggles ?? { ...DEFAULT_REQUIREMENT_TOGGLES }
    });
  });

  router.post("/composition-requirements", async (request, response) => {
    const userId = request.user.userId;
    await assertAdminAuthorization({
      userId,
      usersRepository,
      message: "Only admins can create composition requirements."
    });

    const body = requireObject(request.body);
    const name = normalizeRequirementName(body.name);
    const toggles = normalizeRequirementToggles(body.toggles) ?? { ...DEFAULT_REQUIREMENT_TOGGLES };
    const isActive = normalizeActiveFlag(body.is_active) ?? false;

    try {
      const requirement = await compositionRequirementsRepository.createRequirement({
        name,
        toggles,
        isActive,
        actorUserId: userId
      });
      response.status(201).json({
        requirement: serializeRequirement(requirement)
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("A composition requirement with that name already exists.");
      }
      throw error;
    }
  });

  router.put("/composition-requirements/:id", async (request, response) => {
    const userId = request.user.userId;
    await assertAdminAuthorization({
      userId,
      usersRepository,
      message: "Only admins can update composition requirements."
    });

    const requirementId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);

    const name = body.name === undefined ? undefined : normalizeRequirementName(body.name);
    const toggles = normalizeRequirementToggles(body.toggles);
    const isActive = normalizeActiveFlag(body.is_active);
    if (name === undefined && toggles === undefined && isActive === undefined) {
      throw badRequest("Expected at least one update field: name, toggles, or is_active.");
    }

    try {
      const requirement = await compositionRequirementsRepository.updateRequirement(requirementId, {
        name,
        toggles,
        isActive,
        actorUserId: userId
      });
      if (!requirement) {
        throw notFound("Composition requirement not found.");
      }
      response.json({
        requirement: serializeRequirement(requirement)
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("A composition requirement with that name already exists.");
      }
      throw error;
    }
  });

  router.delete("/composition-requirements/:id", async (request, response) => {
    const userId = request.user.userId;
    await assertAdminAuthorization({
      userId,
      usersRepository,
      message: "Only admins can delete composition requirements."
    });
    const requirementId = parsePositiveInteger(request.params.id, "id");
    const deleted = await compositionRequirementsRepository.deleteRequirement(requirementId);
    if (!deleted) {
      throw notFound("Composition requirement not found.");
    }
    response.status(204).end();
  });

  return router;
}
