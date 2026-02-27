import { Router } from "express";
import multer from "multer";

import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { parsePositiveInteger, requireNonEmptyString, requireObject } from "../http/validation.js";

const ALLOWED_MEMBER_ROLES = new Set(["lead", "member"]);
const ALLOWED_TEAM_ROLES = new Set(["primary", "substitute"]);
const ALLOWED_LANES = new Set(["Top", "Jungle", "Mid", "ADC", "Support"]);
const ALLOWED_JOIN_REQUEST_STATUSES = new Set(["pending", "approved", "rejected"]);
const ALLOWED_JOIN_REQUEST_DECISIONS = new Set(["approved", "rejected"]);
const ALLOWED_LOGO_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_LOGO_BYTES = 512 * 1024;
const MAX_JOIN_REQUEST_NOTE_LENGTH = 280;
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

function parseJoinRequestNote(rawNote) {
  if (rawNote === undefined || rawNote === null || rawNote === "") {
    return "";
  }

  if (typeof rawNote !== "string") {
    throw badRequest("Expected 'note' to be a string.");
  }

  const trimmed = rawNote.trim();
  if (trimmed.length > MAX_JOIN_REQUEST_NOTE_LENGTH) {
    throw badRequest(`Expected 'note' to be ${MAX_JOIN_REQUEST_NOTE_LENGTH} characters or fewer.`);
  }
  return trimmed;
}

function parseJoinRequestListStatus(rawStatus) {
  if (rawStatus === undefined || rawStatus === null || rawStatus === "" || rawStatus === "all") {
    return null;
  }

  if (typeof rawStatus !== "string") {
    throw badRequest("Expected 'status' to be one of: pending, approved, rejected, all.");
  }

  const normalized = rawStatus.trim().toLowerCase();
  if (!ALLOWED_JOIN_REQUEST_STATUSES.has(normalized)) {
    throw badRequest("Expected 'status' to be one of: pending, approved, rejected, all.");
  }
  return normalized;
}

function parseJoinRequestDecision(rawStatus) {
  if (typeof rawStatus !== "string" || rawStatus.trim() === "") {
    throw badRequest("Expected 'status' to be one of: approved, rejected.");
  }

  const normalized = rawStatus.trim().toLowerCase();
  if (!ALLOWED_JOIN_REQUEST_DECISIONS.has(normalized)) {
    throw badRequest("Expected 'status' to be one of: approved, rejected.");
  }

  return normalized;
}

function buildIdentityDisplayName(identity) {
  const gameName = typeof identity?.game_name === "string" ? identity.game_name.trim() : "";
  const tagline = typeof identity?.tagline === "string" ? identity.tagline.trim() : "";
  const email = typeof identity?.email === "string" ? identity.email.trim() : "";

  if (gameName && tagline) {
    return `${gameName}#${tagline}`;
  }
  if (gameName) {
    return gameName;
  }
  if (email) {
    return email;
  }
  return identity?.user_id ? `User ${identity.user_id}` : "Unknown Player";
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
    membership_lane: team.membership_lane ?? null,
    pending_join_request_id:
      team.pending_join_request_id === null || team.pending_join_request_id === undefined
        ? null
        : Number(team.pending_join_request_id),
    pending_join_request_status: team.pending_join_request_status ?? null,
    created_at: team.created_at
  };
}

function serializeMember(member) {
  const lane = member.primary_role ?? null;
  return {
    team_id: Number(member.team_id),
    user_id: Number(member.user_id),
    role: member.role,
    team_role: member.team_role,
    lane,
    position: lane,
    display_name: member.display_name ?? buildIdentityDisplayName(member),
    game_name: member.game_name ?? "",
    tagline: member.tagline ?? "",
    email: member.email,
    created_at: member.created_at
  };
}

function serializeJoinRequest(request) {
  const requester = request.requester ?? {
    user_id: request.requester_user_id,
    email: null,
    game_name: "",
    tagline: "",
    primary_role: null
  };

  return {
    id: Number(request.id),
    team_id: Number(request.team_id),
    requester_user_id: Number(request.requester_user_id),
    requested_lane: request.requested_lane,
    requested_position: request.requested_lane,
    status: request.status,
    note: request.note ?? "",
    reviewed_by_user_id:
      request.reviewed_by_user_id === null || request.reviewed_by_user_id === undefined
        ? null
        : Number(request.reviewed_by_user_id),
    reviewed_at: request.reviewed_at,
    created_at: request.created_at,
    requester: {
      user_id: Number(requester.user_id),
      lane: requester.primary_role ?? null,
      display_name: requester.display_name ?? buildIdentityDisplayName(requester),
      game_name: requester.game_name ?? "",
      tagline: requester.tagline ?? "",
      email: requester.email ?? null
    }
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

function assertUserHasPrimaryLane(user) {
  const lane = typeof user?.primary_role === "string" ? user.primary_role : null;
  if (!lane || !ALLOWED_LANES.has(lane)) {
    throw badRequest("Set your primary role before joining a team roster.");
  }
  return lane;
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

    const creator = await usersRepository.findById(userId);
    const membershipLane = creator?.primary_role ?? null;

    response.status(201).json({
      team: {
        ...serializeTeam({ ...team, membership_role: "lead", membership_team_role: "primary", membership_lane: membershipLane })
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

  router.get("/teams/discover", async (request, response) => {
    const userId = request.user.userId;
    const teams = await teamsRepository.listDiscoverableTeams(userId);
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

    const leadMembership = await requireTeamLead(teamId, userId, teamsRepository);
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
        membership_role: leadMembership.role,
        membership_team_role: leadMembership.team_role,
        membership_lane: leadMembership.primary_role ?? null
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

    const targetUser = await usersRepository.findById(memberUserId);
    if (!targetUser) {
      throw notFound("User not found.");
    }
    assertUserHasPrimaryLane(targetUser);

    try {
      await teamsRepository.addMember(teamId, memberUserId, role, teamRole);
      await teamsRepository.clearPendingJoinRequestsForUser(teamId, memberUserId);
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

    const currentMembers = await teamsRepository.listMembers(teamId);
    if (currentMembers.length <= 1) {
      throw badRequest("Cannot remove the last team member.");
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

  router.post("/teams/:id/join-requests", async (request, response) => {
    const userId = request.user.userId;
    const teamId = parsePositiveInteger(request.params.id, "id");
    const body = request.body === undefined ? {} : requireObject(request.body);
    const note = parseJoinRequestNote(body.note);

    const teamExists = await teamsRepository.teamExists(teamId);
    if (!teamExists) {
      throw notFound("Team not found.");
    }

    const existingMembership = await teamsRepository.getMembership(teamId, userId);
    if (existingMembership) {
      throw conflict("You are already a member of this team.");
    }

    const requester = await usersRepository.findById(userId);
    if (!requester) {
      throw notFound("User not found.");
    }
    const requestedLane = assertUserHasPrimaryLane(requester);

    let createdRequest;
    try {
      createdRequest = await teamsRepository.createJoinRequest({
        teamId,
        requesterUserId: userId,
        requestedLane,
        note
      });
    } catch (error) {
      if (error?.code === "23505") {
        throw conflict("A pending join request already exists for this team.");
      }
      throw error;
    }

    const hydratedRequest = await teamsRepository.getJoinRequestById(teamId, createdRequest.id);
    response.status(201).json({
      request: serializeJoinRequest(hydratedRequest ?? createdRequest)
    });
  });

  router.delete("/teams/:id/join-requests/:request_id", async (request, response) => {
    const userId = request.user.userId;
    const teamId = parsePositiveInteger(request.params.id, "id");
    const requestId = parsePositiveInteger(request.params.request_id, "request_id");

    const existingRequest = await teamsRepository.getJoinRequestById(teamId, requestId);
    if (!existingRequest) {
      throw notFound("Join request not found.");
    }

    if (existingRequest.requester_user_id !== userId) {
      throw forbidden("You can only cancel your own join requests.");
    }

    if (existingRequest.status !== "pending") {
      throw badRequest("Only pending join requests can be canceled.");
    }

    const deleted = await teamsRepository.deletePendingJoinRequest(teamId, requestId, userId);
    if (!deleted) {
      throw badRequest("Join request is no longer pending.");
    }

    response.status(200).json({ ok: true });
  });

  router.get("/teams/:id/join-requests", async (request, response) => {
    const userId = request.user.userId;
    const teamId = parsePositiveInteger(request.params.id, "id");
    const status = parseJoinRequestListStatus(request.query.status);

    await requireTeamLead(teamId, userId, teamsRepository);
    const requests = await teamsRepository.listJoinRequests(teamId, { status });

    response.json({
      requests: requests.map(serializeJoinRequest)
    });
  });

  router.put("/teams/:id/join-requests/:request_id", async (request, response) => {
    const userId = request.user.userId;
    const teamId = parsePositiveInteger(request.params.id, "id");
    const requestId = parsePositiveInteger(request.params.request_id, "request_id");
    const body = requireObject(request.body);
    const decision = parseJoinRequestDecision(body.status);

    await requireTeamLead(teamId, userId, teamsRepository);

    const existingRequest = await teamsRepository.getJoinRequestById(teamId, requestId);
    if (!existingRequest) {
      throw notFound("Join request not found.");
    }

    if (existingRequest.status !== "pending") {
      throw badRequest("Only pending join requests can be updated.");
    }

    if (decision === "approved") {
      const existingMembership = await teamsRepository.getMembership(teamId, existingRequest.requester_user_id);
      if (existingMembership) {
        throw conflict("Requester is already a team member.");
      }

      const requester = await usersRepository.findById(existingRequest.requester_user_id);
      if (!requester) {
        throw notFound("Requester not found.");
      }
      assertUserHasPrimaryLane(requester);

      try {
        await teamsRepository.addMember(teamId, existingRequest.requester_user_id, "member", "primary");
      } catch (error) {
        throw mapConstraintError(error);
      }
    }

    const updatedRequest = await teamsRepository.setJoinRequestStatus(teamId, requestId, {
      status: decision,
      reviewedByUserId: userId
    });

    if (!updatedRequest) {
      throw badRequest("Join request is no longer pending.");
    }

    if (decision === "approved") {
      await teamsRepository.clearPendingJoinRequestsForUser(teamId, existingRequest.requester_user_id);
    }

    const hydratedRequest = await teamsRepository.getJoinRequestById(teamId, requestId);
    response.json({
      request: serializeJoinRequest(hydratedRequest ?? updatedRequest)
    });
  });

  return router;
}
