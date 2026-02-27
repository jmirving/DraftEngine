import { badRequest, forbidden } from "./errors.js";
import { parsePositiveInteger } from "./http/validation.js";

export const SCOPE_SET = new Set(["self", "team", "all"]);
export const SOURCE_PROMOTION_SCOPE_SET = new Set(["self", "team"]);
export const TARGET_PROMOTION_SCOPE_SET = new Set(["team", "all"]);

export function parseScope(value, { defaultScope = "all", fieldName = "scope", allowedScopes = SCOPE_SET } = {}) {
  const raw = value === undefined || value === null ? defaultScope : value;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw badRequest(`Expected '${fieldName}' to be one of: ${[...allowedScopes].join(", ")}.`);
  }

  const normalized = raw.trim().toLowerCase();
  if (!allowedScopes.has(normalized)) {
    throw badRequest(`Expected '${fieldName}' to be one of: ${[...allowedScopes].join(", ")}.`);
  }
  return normalized;
}

export async function resolveScopedTeamId({
  scope,
  rawTeamId,
  userId,
  usersRepository,
  fieldName = "team_id",
  contextFieldName = "active_team_id"
}) {
  if (scope !== "team") {
    return null;
  }

  if (rawTeamId !== undefined && rawTeamId !== null && rawTeamId !== "") {
    return parsePositiveInteger(rawTeamId, fieldName);
  }

  const teamContext = await usersRepository.findTeamContextById(userId);
  const activeTeamId = teamContext?.active_team_id;
  if (activeTeamId === undefined || activeTeamId === null) {
    throw badRequest(`Expected '${fieldName}' or an active team context when scope is 'team'.`);
  }

  return parsePositiveInteger(activeTeamId, contextFieldName);
}

function normalizeUserRole(rawRole) {
  if (typeof rawRole !== "string") {
    return "member";
  }
  return rawRole.trim().toLowerCase() === "admin" ? "admin" : "member";
}

async function requireTeamMembership(teamId, userId, teamsRepository, message) {
  const membership = await teamsRepository.getMembership(teamId, userId);
  if (!membership) {
    throw forbidden(message);
  }
  return membership;
}

export async function assertScopeReadAuthorization({ scope, userId, teamId, teamsRepository, teamReadMessage }) {
  if (scope !== "team") {
    return;
  }

  await requireTeamMembership(teamId, userId, teamsRepository, teamReadMessage);
}

export async function assertScopeWriteAuthorization({
  scope,
  userId,
  teamId,
  teamsRepository,
  usersRepository,
  teamWriteMessage,
  teamLeadMessage,
  globalWriteMessage
}) {
  if (scope === "self") {
    return;
  }

  if (scope === "team") {
    const membership = await requireTeamMembership(teamId, userId, teamsRepository, teamWriteMessage);
    if (membership.role !== "lead") {
      throw forbidden(teamLeadMessage);
    }
    return;
  }

  const user = await usersRepository.findById(userId);
  if (normalizeUserRole(user?.role) !== "admin") {
    throw forbidden(globalWriteMessage);
  }
}

export async function assertPromotionAuthorization({
  sourceScope,
  targetScope,
  sourceTeamId,
  targetTeamId,
  userId,
  teamsRepository
}) {
  if (sourceScope === "self" && targetScope === "team") {
    if (!targetTeamId) {
      throw badRequest("Expected 'target_team_id' to be a positive integer when requesting self-to-team promotion.");
    }
    await requireTeamMembership(
      targetTeamId,
      userId,
      teamsRepository,
      "You must be on the selected team to request self-scope promotion."
    );
    return;
  }

  if (sourceScope === "team" && targetScope === "all") {
    if (!sourceTeamId) {
      throw badRequest("Expected 'team_id' to be a positive integer when requesting team-to-global promotion.");
    }

    const membership = await requireTeamMembership(
      sourceTeamId,
      userId,
      teamsRepository,
      "You must be on the selected team to request team-scope promotion."
    );
    if (membership.role !== "lead") {
      throw forbidden("Only team leads can request team-to-global promotion.");
    }
    return;
  }

  throw badRequest("Unsupported promotion path. Supported paths are self->team and team->all.");
}
