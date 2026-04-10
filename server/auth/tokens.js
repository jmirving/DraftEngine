import jwt from "jsonwebtoken";

import { unauthorized } from "../errors.js";

export function signAccessToken(userId, config) {
  return jwt.sign({ sub: String(userId) }, config.jwtSecret, {
    algorithm: "HS256",
    expiresIn: "24h"
  });
}

export function verifyAccessToken(token, config) {
  return jwt.verify(token, config.jwtSecret, {
    algorithms: ["HS256"]
  });
}

export function verifyHostedAccessToken(token, config) {
  if (!config.nexusAppSigningSecret) {
    throw unauthorized("Hosted auth is not configured.");
  }

  try {
    return jwt.verify(token, config.nexusAppSigningSecret, {
      algorithms: ["HS256"],
      issuer: config.nexusAuthIssuer,
      audience: config.nexusAuthAudience
    });
  } catch {
    throw unauthorized("Invalid hosted authentication token.");
  }
}
