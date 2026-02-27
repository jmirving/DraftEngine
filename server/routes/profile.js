import { Router } from "express";

import { badRequest, notFound } from "../errors.js";
import { parsePositiveInteger, requireObject } from "../http/validation.js";

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

function parseNullableTeamId(rawValue, fieldName) {
  if (rawValue === null) {
    return null;
  }

  if (rawValue === undefined) {
    throw badRequest(`Expected '${fieldName}' to be a positive integer or null.`);
  }

  return parsePositiveInteger(rawValue, fieldName);
}

function serializeTeamContext(teamContext) {
  return {
    defaultTeamId:
      teamContext.default_team_id === null || teamContext.default_team_id === undefined
        ? null
        : Number(teamContext.default_team_id),
    activeTeamId:
      teamContext.active_team_id === null || teamContext.active_team_id === undefined
        ? null
        : Number(teamContext.active_team_id)
  };
}

async function assertTeamMembershipOrNull(teamId, userId, teamsRepository, fieldName) {
  if (teamId === null) {
    return;
  }

  const membership = await teamsRepository.getMembership(teamId, userId);
  if (!membership) {
    throw badRequest(`Expected '${fieldName}' to reference a team where the user is a member.`);
  }
}

export function createProfileRouter({ usersRepository, teamsRepository, requireAuth }) {
  const router = Router();
  router.use("/me/profile", requireAuth);
  router.use("/me/team-context", requireAuth);

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

  router.get("/me/team-context", async (request, response) => {
    const userId = request.user.userId;
    const storedContext = await usersRepository.findTeamContextById(userId);
    if (!storedContext) {
      throw notFound("User not found.");
    }

    const current = serializeTeamContext(storedContext);
    let defaultTeamId = current.defaultTeamId;
    let activeTeamId = current.activeTeamId;

    if (defaultTeamId !== null) {
      const membership = await teamsRepository.getMembership(defaultTeamId, userId);
      if (!membership) {
        defaultTeamId = null;
      }
    }

    if (activeTeamId !== null) {
      const membership = await teamsRepository.getMembership(activeTeamId, userId);
      if (!membership) {
        activeTeamId = null;
      }
    }

    if (defaultTeamId !== current.defaultTeamId || activeTeamId !== current.activeTeamId) {
      const persisted = await usersRepository.updateTeamContext(userId, {
        defaultTeamId,
        activeTeamId
      });
      if (!persisted) {
        throw notFound("User not found.");
      }
      response.json({
        teamContext: serializeTeamContext(persisted)
      });
      return;
    }

    response.json({
      teamContext: {
        defaultTeamId,
        activeTeamId
      }
    });
  });

  router.put("/me/team-context", async (request, response) => {
    const userId = request.user.userId;
    const body = requireObject(request.body);
    const defaultTeamId = parseNullableTeamId(body.defaultTeamId, "defaultTeamId");
    const activeTeamId = parseNullableTeamId(body.activeTeamId, "activeTeamId");

    await assertTeamMembershipOrNull(defaultTeamId, userId, teamsRepository, "defaultTeamId");
    await assertTeamMembershipOrNull(activeTeamId, userId, teamsRepository, "activeTeamId");

    const updated = await usersRepository.updateTeamContext(userId, {
      defaultTeamId,
      activeTeamId
    });
    if (!updated) {
      throw notFound("User not found.");
    }

    response.json({
      teamContext: serializeTeamContext(updated)
    });
  });

  return router;
}
