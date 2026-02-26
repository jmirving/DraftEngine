import { Router } from "express";

import { ApiError, conflict, unauthorized } from "../errors.js";
import { requireEmail, requireGameName, requireObject, requirePassword, requireTagline } from "../http/validation.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { signAccessToken } from "../auth/tokens.js";

function serializeAuthUser(user) {
  return {
    id: Number(user.id),
    email: user.email,
    gameName: user.game_name ?? "",
    tagline: user.tagline ?? ""
  };
}

function mapUniqueConstraintError(error) {
  if (error && error.code === "23505") {
    return conflict("Email already exists.", { field: "email" });
  }
  return error;
}

export function createAuthRouter({ config, usersRepository }) {
  const router = Router();

  router.post("/register", async (request, response) => {
    const body = requireObject(request.body);
    const email = requireEmail(body.email);
    const password = requirePassword(body.password);
    const gameName = requireGameName(body.gameName);
    const tagline = requireTagline(body.tagline);

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
        tagline
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

  return router;
}
