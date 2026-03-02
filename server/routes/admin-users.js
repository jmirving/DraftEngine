import { Router } from "express";

import { badRequest, notFound } from "../errors.js";
import { parsePositiveInteger, requireGameName, requireObject, requireTagline } from "../http/validation.js";
import { assertAdminAuthorization } from "../scope-authorization.js";
import {
  USER_ROLE_ADMIN,
  USER_ROLE_GLOBAL,
  USER_ROLE_MEMBER,
  isOwnerAdminEmail,
  normalizeUserRole,
  resolveAuthorizationRole
} from "../user-roles.js";

const ASSIGNABLE_ROLES = Object.freeze([USER_ROLE_MEMBER, USER_ROLE_GLOBAL, USER_ROLE_ADMIN]);
const ASSIGNABLE_ROLE_SET = new Set(ASSIGNABLE_ROLES);
const MAX_RIOT_ID_CORRECTIONS = 1;

function normalizeRiotIdCorrectionCount(rawValue) {
  const parsed = Number.parseInt(String(rawValue ?? 0), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseAssignableRole(rawRole) {
  if (typeof rawRole !== "string" || rawRole.trim() === "") {
    throw badRequest(`Expected 'role' to be one of: ${ASSIGNABLE_ROLES.join(", ")}.`);
  }
  const normalized = normalizeUserRole(rawRole);
  if (!ASSIGNABLE_ROLE_SET.has(normalized)) {
    throw badRequest(`Expected 'role' to be one of: ${ASSIGNABLE_ROLES.join(", ")}.`);
  }
  return normalized;
}

function serializeAdminUser(user) {
  const gameName = typeof user.game_name === "string" ? user.game_name.trim() : "";
  const tagline = typeof user.tagline === "string" ? user.tagline.trim() : "";
  const correctionCount = normalizeRiotIdCorrectionCount(user?.riot_id_correction_count);
  return {
    id: Number(user.id),
    email: user.email,
    role: resolveAuthorizationRole(user),
    game_name: gameName,
    tagline,
    riot_id: gameName && tagline ? `${gameName}#${tagline}` : (gameName || ""),
    riot_id_correction_count: correctionCount,
    can_update_riot_id: correctionCount < MAX_RIOT_ID_CORRECTIONS,
    created_at: user.created_at
  };
}

export function createAdminUsersRouter({
  usersRepository,
  teamsRepository,
  poolsRepository,
  promotionRequestsRepository,
  requireAuth
}) {
  const router = Router();
  router.use("/admin/users", requireAuth);

  router.get("/admin/users", async (request, response) => {
    const userId = request.user.userId;
    await assertAdminAuthorization({
      userId,
      usersRepository,
      message: "Only admins can view users."
    });

    const users = await usersRepository.listUsersForAdmin();
    response.json({
      users: users.map(serializeAdminUser)
    });
  });

  router.get("/admin/users/:id/details", async (request, response) => {
    const userId = request.user.userId;
    await assertAdminAuthorization({
      userId,
      usersRepository,
      message: "Only admins can view users."
    });

    const targetUserId = parsePositiveInteger(request.params.id, "id");
    const targetUser = await usersRepository.findById(targetUserId);
    if (!targetUser) {
      throw notFound("User not found.");
    }

    const [pools, memberships, tagPromotions] = await Promise.all([
      poolsRepository.listPoolSummariesByUser(targetUserId),
      teamsRepository.listTeamsByUser(targetUserId),
      promotionRequestsRepository.countChampionTagPromotionsByRequester(targetUserId)
    ]);

    const defaultTeam =
      Number.isInteger(targetUser.default_team_id) && targetUser.default_team_id > 0
        ? await teamsRepository.getTeamById(targetUser.default_team_id)
        : null;
    const activeTeam =
      Number.isInteger(targetUser.active_team_id) && targetUser.active_team_id > 0
        ? await teamsRepository.getTeamById(targetUser.active_team_id)
        : null;

    response.json({
      details: {
        user_id: targetUserId,
        primary_role: typeof targetUser.primary_role === "string" ? targetUser.primary_role : null,
        secondary_roles: Array.isArray(targetUser.secondary_roles) ? targetUser.secondary_roles : [],
        default_team: defaultTeam
          ? {
              team_id: Number(defaultTeam.id),
              name: defaultTeam.name,
              tag: defaultTeam.tag
            }
          : null,
        active_team: activeTeam
          ? {
              team_id: Number(activeTeam.id),
              name: activeTeam.name,
              tag: activeTeam.tag
            }
          : null,
        champion_pools: pools.map((pool) => ({
          pool_id: pool.id,
          name: pool.name ?? "",
          champion_count: pool.champion_count
        })),
        team_memberships: memberships.map((membership) => ({
          team_id: Number(membership.id),
          name: membership.name,
          tag: membership.tag,
          membership_role: membership.membership_role ?? null,
          membership_team_role: membership.membership_team_role ?? null,
          membership_lane: membership.membership_lane ?? null
        })),
        champion_tag_promotions: {
          pending: tagPromotions.pending ?? 0,
          approved: tagPromotions.approved ?? 0,
          rejected: tagPromotions.rejected ?? 0
        }
      }
    });
  });

  router.put("/admin/users/:id/role", async (request, response) => {
    const requesterUserId = request.user.userId;
    await assertAdminAuthorization({
      userId: requesterUserId,
      usersRepository,
      message: "Only admins can update user permissions."
    });

    const targetUserId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const requestedRole = parseAssignableRole(body.role);

    const targetUser = await usersRepository.findById(targetUserId);
    if (!targetUser) {
      throw notFound("User not found.");
    }

    const isOwnerUser = isOwnerAdminEmail(targetUser.email);
    if (isOwnerUser && requestedRole !== USER_ROLE_ADMIN) {
      throw badRequest("The owner account must keep the admin role.");
    }
    if (!isOwnerUser && requestedRole === USER_ROLE_ADMIN) {
      throw badRequest("Admin role may only be assigned to the owner account.");
    }

    const updatedUser = await usersRepository.updateUserRole(targetUserId, requestedRole);
    if (!updatedUser) {
      throw notFound("User not found.");
    }

    response.json({
      user: serializeAdminUser(updatedUser)
    });
  });

  router.put("/admin/users/:id/riot-id", async (request, response) => {
    const requesterUserId = request.user.userId;
    await assertAdminAuthorization({
      userId: requesterUserId,
      usersRepository,
      message: "Only admins can update user Riot ID."
    });

    const targetUserId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const gameName = requireGameName(body.gameName);
    const tagline = requireTagline(body.tagline);

    const targetUser = await usersRepository.findById(targetUserId);
    if (!targetUser) {
      throw notFound("User not found.");
    }

    const currentGameName = typeof targetUser.game_name === "string" ? targetUser.game_name.trim() : "";
    const currentTagline = typeof targetUser.tagline === "string" ? targetUser.tagline.trim() : "";
    const isSameRiotId =
      currentGameName.toLowerCase() === gameName.toLowerCase() &&
      currentTagline.toLowerCase() === tagline.toLowerCase();
    if (isSameRiotId) {
      response.json({
        user: serializeAdminUser(targetUser)
      });
      return;
    }

    const correctionCount = normalizeRiotIdCorrectionCount(targetUser.riot_id_correction_count);
    if (correctionCount >= MAX_RIOT_ID_CORRECTIONS) {
      throw badRequest("This user's one-time Riot ID correction has already been used.");
    }

    const updatedUser = await usersRepository.updateUserRiotIdOneTime(targetUserId, { gameName, tagline });
    if (!updatedUser) {
      throw badRequest("This user's one-time Riot ID correction has already been used.");
    }

    response.json({
      user: serializeAdminUser(updatedUser)
    });
  });

  router.delete("/admin/users/:id", async (request, response) => {
    const requesterUserId = request.user.userId;
    await assertAdminAuthorization({
      userId: requesterUserId,
      usersRepository,
      message: "Only admins can delete users."
    });

    const targetUserId = parsePositiveInteger(request.params.id, "id");
    if (targetUserId === requesterUserId) {
      throw badRequest("You cannot delete your own account.");
    }

    const targetUser = await usersRepository.findById(targetUserId);
    if (!targetUser) {
      throw notFound("User not found.");
    }

    if (isOwnerAdminEmail(targetUser.email)) {
      throw badRequest("The owner account cannot be deleted.");
    }

    const deleted = await usersRepository.deleteUser(targetUserId);
    if (!deleted) {
      throw notFound("User not found.");
    }

    response.status(200).json({ ok: true });
  });

  return router;
}
