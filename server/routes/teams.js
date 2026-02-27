import { Router } from "express";
import multer from "multer";

import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { parsePositiveInteger, requireNonEmptyString, requireObject } from "../http/validation.js";

const ALLOWED_MEMBER_ROLES = new Set(["lead", "member"]);
const ALLOWED_TEAM_ROLES = new Set(["primary", "substitute"]);
const ALLOWED_LOGO_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_LOGO_BYTES = 512 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_LOGO_BYTES
  }
});

function requireTeamTag(value) {
  const normalized = requireNonEmptyString(value, "tag").toUpperCase();
  if (normalized.length > 12) {
    throw badRequest("Expected 'tag' to be 12 characters or fewer.");
  }
  return normalized;
}

function parseRemoveLogo(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw badRequest("Expected 'remove_logo' to be a boolean.");
    }
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    throw badRequest("Expected 'remove_logo' to be a boolean.");
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw badRequest("Expected 'remove_logo' to be a boolean.");
}

function parseTeamLogo(file) {
  if (!file) {
    return {
      logoBlob: null,
      logoMimeType: null
    };
  }

  if (!ALLOWED_LOGO_MIME_TYPES.has(file.mimetype)) {
    throw badRequest("Expected 'logo' content-type to be image/png, image/jpeg, or image/webp.");
  }

  if (!Buffer.isBuffer(file.buffer) || file.buffer.length < 1) {
    throw badRequest("Expected 'logo' to be a non-empty file.");
  }

  return {
    logoBlob: file.buffer,
    logoMimeType: file.mimetype
  };
}

function isMultipartRequest(request) {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string") {
    return false;
  }
  return contentType.toLowerCase().startsWith("multipart/form-data");
}

function maybeParseMultipart(request, response, next) {
  if (!isMultipartRequest(request)) {
    next();
    return;
  }

  upload.single("logo")(request, response, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error.code === "LIMIT_FILE_SIZE") {
      next(badRequest("Expected 'logo' to be 512KB or smaller."));
      return;
    }

    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      next(badRequest("Expected multipart field 'logo' for team logo upload."));
      return;
    }

    next(badRequest("Invalid multipart payload."));
  });
}

function requireTeamMutationInput(request, { allowRemoveLogo }) {
  const body = requireObject(request.body);
  const name = requireNonEmptyString(body.name, "name");
  const tag = requireTeamTag(body.tag);
  const removeLogo = allowRemoveLogo ? parseRemoveLogo(body.remove_logo) : false;
  const { logoBlob, logoMimeType } = parseTeamLogo(request.file);

  if (!allowRemoveLogo && body.remove_logo !== undefined) {
    throw badRequest("Expected 'remove_logo' to be omitted for team creation.");
  }

  if (removeLogo && logoBlob) {
    throw badRequest("Expected either a 'logo' upload or 'remove_logo=true', but not both.");
  }

  return {
    name,
    tag,
    logoBlob,
    logoMimeType,
    removeLogo
  };
}

function parseMemberRole(rawRole, fieldName = "role", fallback = "member") {
  if (rawRole === undefined || rawRole === null || rawRole === "") {
    return fallback;
  }

  if (typeof rawRole !== "string") {
    throw badRequest(`Expected '${fieldName}' to be one of: lead, member.`);
  }

  const normalized = rawRole.trim().toLowerCase();
  if (!ALLOWED_MEMBER_ROLES.has(normalized)) {
    throw badRequest(`Expected '${fieldName}' to be one of: lead, member.`);
  }
  return normalized;
}

function parseTeamRole(rawRole, fieldName = "team_role", fallback = "substitute") {
  if (rawRole === undefined || rawRole === null || rawRole === "") {
    return fallback;
  }

  if (typeof rawRole !== "string") {
    throw badRequest(`Expected '${fieldName}' to be one of: primary, substitute.`);
  }

  const normalized = rawRole.trim().toLowerCase();
  if (!ALLOWED_TEAM_ROLES.has(normalized)) {
    throw badRequest(`Expected '${fieldName}' to be one of: primary, substitute.`);
  }
  return normalized;
}

function serializeTeam(team) {
  return {
    id: Number(team.id),
    name: team.name,
    tag: team.tag,
    logo_data_url: team.logo_data_url ?? null,
    created_by: Number(team.created_by),
    membership_role: team.membership_role,
    membership_team_role: team.membership_team_role,
    created_at: team.created_at
  };
}

function serializeMember(member) {
  return {
    team_id: Number(member.team_id),
    user_id: Number(member.user_id),
    role: member.role,
    team_role: member.team_role,
    email: member.email,
    created_at: member.created_at
  };
}

function mapConstraintError(error) {
  if (!error || typeof error !== "object") {
    return error;
  }

  if (error.code === "23505") {
    return conflict("Membership already exists.");
  }

  if (error.code === "23503") {
    return notFound("User not found.");
  }

  return error;
}

async function loadMembership(teamId, userId, teamsRepository) {
  const teamExists = await teamsRepository.teamExists(teamId);
  if (!teamExists) {
    throw notFound("Team not found.");
  }

  const membership = await teamsRepository.getMembership(teamId, userId);
  if (!membership) {
    return null;
  }

  return membership;
}

async function requireTeamMembership(teamId, userId, teamsRepository) {
  const membership = await loadMembership(teamId, userId, teamsRepository);
  if (!membership) {
    throw forbidden("You are not a member of this team.");
  }
  return membership;
}

async function requireTeamLead(teamId, userId, teamsRepository) {
  const membership = await requireTeamMembership(teamId, userId, teamsRepository);
  if (membership.role !== "lead") {
    throw forbidden("Only team leads can perform this action.");
  }
  return membership;
}

async function assertLeadInvariantBeforeLeadRemoval(teamId, teamsRepository) {
  const leadCount = await teamsRepository.countLeads(teamId);
  if (leadCount <= 1) {
    throw badRequest("Each team must have at least one lead.");
  }
}

export function createTeamsRouter({ teamsRepository, usersRepository, requireAuth }) {
  const router = Router();

  router.use("/teams", requireAuth);

  router.post("/teams", maybeParseMultipart, async (request, response) => {
    const userId = request.user.userId;
    const { name, tag, logoBlob, logoMimeType } = requireTeamMutationInput(request, {
      allowRemoveLogo: false
    });

    const team = await teamsRepository.createTeam({
      name,
      tag,
      logoBlob,
      logoMimeType,
      creatorUserId: userId
    });

    response.status(201).json({
      team: {
        ...serializeTeam({ ...team, membership_role: "lead", membership_team_role: "primary" })
      }
    });
  });

  router.get("/teams", async (request, response) => {
    const userId = request.user.userId;
    const teams = await teamsRepository.listTeamsByUser(userId);
    response.json({
      teams: teams.map(serializeTeam)
    });
  });

  router.patch("/teams/:id", maybeParseMultipart, async (request, response) => {
    const userId = request.user.userId;
    const teamId = parsePositiveInteger(request.params.id, "id");
    const { name, tag, logoBlob, logoMimeType, removeLogo } = requireTeamMutationInput(request, {
      allowRemoveLogo: true
    });

    await requireTeamLead(teamId, userId, teamsRepository);
    const updated = await teamsRepository.updateTeam(teamId, {
      name,
      tag,
      logoBlob,
      logoMimeType,
      removeLogo
    });
    if (!updated) {
      throw notFound("Team not found.");
    }

    response.json({
      team: serializeTeam({
        ...updated,
        membership_role: "lead",
        membership_team_role: "primary"
      })
    });
  });

  router.delete("/teams/:id", async (request, response) => {
    const userId = request.user.userId;
    const teamId = parsePositiveInteger(request.params.id, "id");

    await requireTeamLead(teamId, userId, teamsRepository);
    await teamsRepository.deleteTeam(teamId);
    response.status(204).send();
  });

  router.get("/teams/:id/members", async (request, response) => {
    const userId = request.user.userId;
    const teamId = parsePositiveInteger(request.params.id, "id");

    await requireTeamMembership(teamId, userId, teamsRepository);
    const members = await teamsRepository.listMembers(teamId);
    response.json({
      members: members.map(serializeMember)
    });
  });

  router.post("/teams/:id/members", async (request, response) => {
    const userId = request.user.userId;
    const teamId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const memberUserId = parsePositiveInteger(body.user_id, "user_id");
    const role = parseMemberRole(body.role, "role", "member");
    const teamRole = parseTeamRole(body.team_role, "team_role", "substitute");

    await requireTeamLead(teamId, userId, teamsRepository);

    const userExists = await usersRepository.findById(memberUserId);
    if (!userExists) {
      throw notFound("User not found.");
    }

    try {
      await teamsRepository.addMember(teamId, memberUserId, role, teamRole);
    } catch (error) {
      throw mapConstraintError(error);
    }

    const membership = await teamsRepository.getMembership(teamId, memberUserId);
    response.status(201).json({
      member: serializeMember(membership)
    });
  });

  router.delete("/teams/:id/members/:user_id", async (request, response) => {
    const userId = request.user.userId;
    const teamId = parsePositiveInteger(request.params.id, "id");
    const memberUserId = parsePositiveInteger(request.params.user_id, "user_id");

    await requireTeamLead(teamId, userId, teamsRepository);

    const existingMembership = await teamsRepository.getMembership(teamId, memberUserId);
    if (!existingMembership) {
      throw notFound("Team member not found.");
    }

    if (existingMembership.role === "lead") {
      await assertLeadInvariantBeforeLeadRemoval(teamId, teamsRepository);
    }

    await teamsRepository.removeMember(teamId, memberUserId);
    response.status(200).json({ ok: true });
  });

  router.put("/teams/:id/members/:user_id/role", async (request, response) => {
    const userId = request.user.userId;
    const teamId = parsePositiveInteger(request.params.id, "id");
    const memberUserId = parsePositiveInteger(request.params.user_id, "user_id");
    const body = requireObject(request.body);
    const nextRole = parseMemberRole(body.role, "role");

    await requireTeamLead(teamId, userId, teamsRepository);

    const existingMembership = await teamsRepository.getMembership(teamId, memberUserId);
    if (!existingMembership) {
      throw notFound("Team member not found.");
    }

    if (existingMembership.role === "lead" && nextRole !== "lead") {
      await assertLeadInvariantBeforeLeadRemoval(teamId, teamsRepository);
    }

    await teamsRepository.setMemberRole(teamId, memberUserId, nextRole);
    const updatedMembership = await teamsRepository.getMembership(teamId, memberUserId);

    response.json({
      member: serializeMember(updatedMembership)
    });
  });

  router.put("/teams/:id/members/:user_id/team-role", async (request, response) => {
    const userId = request.user.userId;
    const teamId = parsePositiveInteger(request.params.id, "id");
    const memberUserId = parsePositiveInteger(request.params.user_id, "user_id");
    const body = requireObject(request.body);
    const nextTeamRole = parseTeamRole(body.team_role, "team_role");

    await requireTeamLead(teamId, userId, teamsRepository);

    const existingMembership = await teamsRepository.getMembership(teamId, memberUserId);
    if (!existingMembership) {
      throw notFound("Team member not found.");
    }

    await teamsRepository.setMemberTeamRole(teamId, memberUserId, nextTeamRole);
    const updatedMembership = await teamsRepository.getMembership(teamId, memberUserId);

    response.json({
      member: serializeMember(updatedMembership)
    });
  });

  return router;
}
