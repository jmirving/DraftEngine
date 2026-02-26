import jwt from "jsonwebtoken";

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

