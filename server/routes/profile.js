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

function serializeNullablePositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

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

function serializeProfile(user, championStats = undefined) {
  const serialized = {
    id: Number(user.id),
    email: user.email,
    gameName: user.game_name ?? "",
    tagline: user.tagline ?? "",
    displayTeamId: serializeNullablePositiveInteger(user.default_team_id),
    avatarChampionId: serializeNullablePositiveInteger(user.avatar_champion_id),
    primaryRole: user.primary_role,
    secondaryRoles: Array.isArray(user.secondary_roles) ? user.secondary_roles : []
  };

  if (championStats && typeof championStats === "object" && !Array.isArray(championStats)) {
    serialized.championStats = championStats;
  }

  return serialized;
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

function parseNullableChampionId(rawValue, fieldName) {
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

export function createProfileRouter({
  usersRepository,
  championsRepository,
  teamsRepository,
  requireAuth,
  riotChampionStatsService = null
}) {
  const router = Router();
  router.use("/me/profile", requireAuth);
  router.use("/me/account", requireAuth);
  router.use("/me/team-context", requireAuth);
  router.use("/me/profile/avatar", requireAuth);
  router.use("/me/profile/display-team", requireAuth);

  router.get("/me/profile", async (request, response) => {
    const userId = request.user.userId;
    let profile = await usersRepository.findProfileById(userId);
    if (!profile) {
      throw notFound("User not found.");
    }
    const displayTeamId = serializeNullablePositiveInteger(profile.default_team_id);
    if (displayTeamId !== null) {
      const membership = await teamsRepository.getMembership(displayTeamId, userId);
      if (!membership) {
        profile = await usersRepository.updateProfileDisplayTeam(userId, {
          displayTeamId: null
        });
        if (!profile) {
          throw notFound("User not found.");
        }
      }
    }
    let championStats;
    if (riotChampionStatsService?.getProfileChampionStats) {
      championStats = await riotChampionStatsService.getProfileChampionStats({
        gameName: profile.game_name,
        tagline: profile.tagline
      });
    }

    response.json({ profile: serializeProfile(profile, championStats) });
  });

  router.put("/me/account", async (request, response) => {
    const userId = request.user.userId;
    const body = requireObject(request.body);
    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
    const updated = await usersRepository.updateAccountInfo(userId, { firstName, lastName });
    if (!updated) {
      throw notFound("User not found.");
    }
    const user = {
      id: Number(updated.id),
      email: updated.email,
      role: updated.role,
      gameName: updated.game_name ?? "",
      tagline: updated.tagline ?? "",
      firstName: updated.first_name ?? "",
      lastName: updated.last_name ?? "",
      primaryRole: updated.primary_role ?? "Mid",
      secondaryRoles: Array.isArray(updated.secondary_roles) ? updated.secondary_roles : []
    };
    response.json({ user });
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

  router.put("/me/profile/display-team", async (request, response) => {
    const userId = request.user.userId;
    const body = requireObject(request.body);
    const displayTeamId = parseNullableTeamId(body.displayTeamId, "displayTeamId");

    await assertTeamMembershipOrNull(displayTeamId, userId, teamsRepository, "displayTeamId");

    const updated = await usersRepository.updateProfileDisplayTeam(userId, { displayTeamId });
    if (!updated) {
      throw notFound("User not found.");
    }

    response.json({ profile: serializeProfile(updated) });
  });

  router.put("/me/profile/avatar", async (request, response) => {
    const userId = request.user.userId;
    const body = requireObject(request.body);
    const avatarChampionId = parseNullableChampionId(body.avatarChampionId, "avatarChampionId");

    if (avatarChampionId !== null) {
      const champion = await championsRepository.getChampionById(avatarChampionId);
      if (!champion) {
        throw badRequest("Expected 'avatarChampionId' to reference a valid champion.");
      }
    }

    const updated = await usersRepository.updateProfileAvatar(userId, { avatarChampionId });
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
    let activeTeamId = current.activeTeamId;

    if (activeTeamId !== null) {
      const membership = await teamsRepository.getMembership(activeTeamId, userId);
      if (!membership) {
        activeTeamId = null;
      }
    }

    if (activeTeamId !== current.activeTeamId) {
      const persisted = await usersRepository.updateTeamContext(userId, {
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
        activeTeamId
      }
    });
  });

  router.put("/me/team-context", async (request, response) => {
    const userId = request.user.userId;
    const body = requireObject(request.body);
    const activeTeamId = parseNullableTeamId(body.activeTeamId, "activeTeamId");

    await assertTeamMembershipOrNull(activeTeamId, userId, teamsRepository, "activeTeamId");

    const updated = await usersRepository.updateTeamContext(userId, {
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
