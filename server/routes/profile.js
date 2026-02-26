import { Router } from "express";

import { badRequest, notFound } from "../errors.js";
import { requireObject } from "../http/validation.js";

const PROFILE_ROLES = Object.freeze(["Top", "Jungle", "Mid", "ADC", "Support"]);
const PROFILE_ROLE_ALIASES = Object.freeze({
  TOP: "Top",
  JUNGLE: "Jungle",
  MID: "Mid",
  ADC: "ADC",
  SUPPORT: "Support",
  SUP: "Support"
});

function parseProfileRole(rawRole, fieldName = "primaryRole") {
  if (typeof rawRole !== "string" || rawRole.trim() === "") {
    throw badRequest(`Expected '${fieldName}' to be one of: ${PROFILE_ROLES.join(", ")}.`);
  }
  const normalized = PROFILE_ROLE_ALIASES[rawRole.trim().toUpperCase()];
  if (!normalized) {
    throw badRequest(`Expected '${fieldName}' to be one of: ${PROFILE_ROLES.join(", ")}.`);
  }
  return normalized;
}

function parseSecondaryRoles(rawRoles, primaryRole) {
  if (rawRoles === undefined || rawRoles === null) {
    return [];
  }
  if (!Array.isArray(rawRoles)) {
    throw badRequest("Expected 'secondaryRoles' to be an array.");
  }

  const parsed = rawRoles.map((value, index) => parseProfileRole(value, `secondaryRoles[${index}]`));
  const unique = Array.from(new Set(parsed));
  if (unique.includes(primaryRole)) {
    throw badRequest("secondaryRoles cannot include primaryRole.");
  }
  if (unique.length > PROFILE_ROLES.length - 1) {
    throw badRequest("secondaryRoles cannot contain more than 4 roles.");
  }
  return unique;
}

function serializeProfile(user) {
  return {
    id: Number(user.id),
    email: user.email,
    gameName: user.game_name ?? "",
    tagline: user.tagline ?? "",
    primaryRole: user.primary_role,
    secondaryRoles: Array.isArray(user.secondary_roles) ? user.secondary_roles : []
  };
}

export function createProfileRouter({ usersRepository, requireAuth }) {
  const router = Router();
  router.use("/me/profile", requireAuth);

  router.get("/me/profile", async (request, response) => {
    const userId = request.user.userId;
    const profile = await usersRepository.findProfileById(userId);
    if (!profile) {
      throw notFound("User not found.");
    }
    response.json({ profile: serializeProfile(profile) });
  });

  router.put("/me/profile", async (request, response) => {
    const userId = request.user.userId;
    const body = requireObject(request.body);
    const primaryRole = parseProfileRole(body.primaryRole, "primaryRole");
    const secondaryRoles = parseSecondaryRoles(body.secondaryRoles, primaryRole);
    const updated = await usersRepository.updateProfileRoles(userId, { primaryRole, secondaryRoles });
    if (!updated) {
      throw notFound("User not found.");
    }
    response.json({ profile: serializeProfile(updated) });
  });

  return router;
}
