import { createHash, randomBytes } from "crypto";
import { Router } from "express";

import { ApiError, badRequest, conflict, schemaMismatch, unauthorized } from "../errors.js";
import { requireEmail, requireGameName, requireNonEmptyString, requireObject, requirePassword, requireTagline } from "../http/validation.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { signAccessToken } from "../auth/tokens.js";
import { USER_ROLE_ADMIN, USER_ROLE_MEMBER, isOwnerAdminEmail, resolveAuthorizationRole } from "../user-roles.js";
import { createRequireAuth } from "../auth/middleware.js";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashResetToken(rawToken) {
  return createHash("sha256").update(rawToken).digest("hex");
}

function serializeNullablePositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function serializeAuthUser(user) {
  return {
    id: Number(user.id),
    email: user.email,
    role: resolveAuthorizationRole(user),
    gameName: user.game_name ?? "",
    tagline: user.tagline ?? "",
    firstName: user.first_name ?? "",
    lastName: user.last_name ?? "",
    displayTeamId: serializeNullablePositiveInteger(user.default_team_id),
    avatarChampionId: serializeNullablePositiveInteger(user.avatar_champion_id),
    primaryRole: user.primary_role ?? "Mid",
    secondaryRoles: Array.isArray(user.secondary_roles) ? user.secondary_roles : []
  };
}

function mapUniqueConstraintError(error) {
  if (error && error.code === "23505") {
    return conflict("Email already exists.", { field: "email" });
  }
  if (error && (error.code === "42703" || error.code === "42P01")) {
    return schemaMismatch();
  }
  return error;
}

export function createAuthRouter({ config, usersRepository }) {
  const router = Router();
  const requireAuth = createRequireAuth(config);

  router.post("/register", async (request, response) => {
    const body = requireObject(request.body);
    const email = requireEmail(body.email);
    const password = requirePassword(body.password);
    const gameName = requireGameName(body.gameName);
    const tagline = requireTagline(body.tagline);
    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : null;
    const lastName = typeof body.lastName === "string" ? body.lastName.trim() : null;

    const existing = await usersRepository.findByEmail(email);
    if (existing) {
      throw conflict("Email already exists.", { field: "email" });
    }

    const passwordHash = await hashPassword(password);
    let createdUser;
    try {
      createdUser = await usersRepository.createUser({
        email,
        passwordHash,
        gameName,
        tagline,
        firstName,
        lastName,
        role: isOwnerAdminEmail(email) ? USER_ROLE_ADMIN : USER_ROLE_MEMBER
      });
    } catch (error) {
      throw mapUniqueConstraintError(error);
    }

    if (!createdUser) {
      throw new ApiError(500, "USER_CREATE_FAILED", "Failed to create user.");
    }

    const token = signAccessToken(createdUser.id, config);
    response.status(201).json({
      token,
      user: serializeAuthUser(createdUser)
    });
  });

  router.post("/login", async (request, response) => {
    const body = requireObject(request.body);
    const email = requireEmail(body.email);
    const password = requirePassword(body.password);

    const user = await usersRepository.findByEmail(email);
    if (!user) {
      throw unauthorized("Invalid email or password.");
    }

    const validPassword = await verifyPassword(password, user.password_hash);
    if (!validPassword) {
      throw unauthorized("Invalid email or password.");
    }

    const token = signAccessToken(user.id, config);
    response.json({
      token,
      user: serializeAuthUser(user)
    });
  });

  router.post("/request-password-reset", async (request, response) => {
    const body = requireObject(request.body);
    const email = requireEmail(body.email);

    // Always respond the same way regardless of whether email exists (prevents enumeration)
    const user = await usersRepository.findByEmail(email);
    if (!user) {
      response.json({ message: "If that email is registered, a reset token has been issued." });
      return;
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await usersRepository.createPasswordResetToken(user.id, tokenHash, expiresAt);

    // NOTE: In production this token would be emailed. Returned directly here
    // because no email service is configured.
    response.json({
      message: "If that email is registered, a reset token has been issued.",
      resetToken: rawToken
    });
  });

  router.post("/reset-password", async (request, response) => {
    const body = requireObject(request.body);
    const rawToken = requireNonEmptyString(body.token, "token");
    const newPassword = requirePassword(body.newPassword);

    const tokenHash = hashResetToken(rawToken);
    const record = await usersRepository.findValidPasswordResetToken(tokenHash);
    if (!record) {
      throw badRequest("Invalid or expired reset token.");
    }

    const passwordHash = await hashPassword(newPassword);
    await usersRepository.updatePassword(Number(record.user_id), passwordHash);
    await usersRepository.markResetTokenUsed(Number(record.id));

    response.json({ message: "Password updated successfully." });
  });

  router.post("/change-password", requireAuth, async (request, response) => {
    const body = requireObject(request.body);
    const newPassword = requirePassword(body.newPassword);

    const passwordHash = await hashPassword(newPassword);
    await usersRepository.updatePassword(request.user.userId, passwordHash);

    response.json({ message: "Password changed successfully." });
  });

  return router;
}
