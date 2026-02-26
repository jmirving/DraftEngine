import { unauthorized } from "../errors.js";
import { verifyAccessToken } from "./tokens.js";

function extractBearerToken(authorizationHeader) {
  if (typeof authorizationHeader !== "string") {
    return null;
  }
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }
  return token;
}

export function createRequireAuth(config) {
  return function requireAuth(request, _response, next) {
    try {
      const token = extractBearerToken(request.headers.authorization);
      if (!token) {
        throw unauthorized("Missing or invalid Authorization header.");
      }

      const payload = verifyAccessToken(token, config);
      const userId = Number.parseInt(String(payload.sub), 10);
      if (!Number.isInteger(userId)) {
        throw unauthorized("Invalid authentication token.");
      }

      request.user = { userId };
      next();
    } catch (_error) {
      next(unauthorized("Invalid authentication token."));
    }
  };
}

