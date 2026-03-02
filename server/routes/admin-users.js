import { Router } from "express";

import { badRequest, notFound } from "../errors.js";
import { parsePositiveInteger, requireObject } from "../http/validation.js";
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
  return {
    id: Number(user.id),
    email: user.email,
    role: resolveAuthorizationRole(user),
    game_name: gameName,
    tagline,
    riot_id: gameName && tagline ? `${gameName}#${tagline}` : (gameName || ""),
    created_at: user.created_at
  };
}

export function createAdminUsersRouter({ usersRepository, requireAuth }) {
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

  return router;
}
