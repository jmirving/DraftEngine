import { Router } from "express";

import { DEFAULT_REQUIREMENT_TOGGLES } from "../../src/domain/model.js";
import { badRequest } from "../errors.js";
import { parsePositiveInteger, requireObject } from "../http/validation.js";
import { REQUIREMENT_TOGGLE_KEYS } from "../repositories/checks.js";
import {
  SOURCE_PROMOTION_SCOPE_SET,
  TARGET_PROMOTION_SCOPE_SET,
  assertPromotionAuthorization,
  assertScopeReadAuthorization,
  assertScopeWriteAuthorization,
  parseScope,
  resolveScopedTeamId
} from "../scope-authorization.js";

const REQUIREMENT_TOGGLE_KEY_SET = new Set(REQUIREMENT_TOGGLE_KEYS);

function normalizeRequirementToggles(rawToggles) {
  const source = requireObject(rawToggles, "'toggles'");
  const normalized = {
    ...DEFAULT_REQUIREMENT_TOGGLES
  };

  for (const [key, value] of Object.entries(source)) {
    if (!REQUIREMENT_TOGGLE_KEY_SET.has(key)) {
      throw badRequest(`Unknown check toggle '${key}'.`);
    }
    if (typeof value !== "boolean") {
      throw badRequest(`Expected 'toggles.${key}' to be a boolean.`);
    }
    normalized[key] = value;
  }

  return normalized;
}

function mergeRequirementToggles(storedToggles) {
  return {
    ...DEFAULT_REQUIREMENT_TOGGLES,
    ...(storedToggles && typeof storedToggles === "object" && !Array.isArray(storedToggles) ? storedToggles : {})
  };
}

function parsePromotionTargetTeamId(rawTeamId) {
  if (rawTeamId === undefined || rawTeamId === null || rawTeamId === "") {
    return null;
  }
  return parsePositiveInteger(rawTeamId, "target_team_id");
}

function serializePromotionRequest(request) {
  return {
    id: Number(request.id),
    entity_type: request.entity_type,
    resource_id: request.resource_id === null || request.resource_id === undefined ? null : Number(request.resource_id),
    source_scope: request.source_scope,
    source_user_id:
      request.source_user_id === null || request.source_user_id === undefined ? null : Number(request.source_user_id),
    source_team_id:
      request.source_team_id === null || request.source_team_id === undefined ? null : Number(request.source_team_id),
    target_scope: request.target_scope,
    target_team_id:
      request.target_team_id === null || request.target_team_id === undefined ? null : Number(request.target_team_id),
    requested_by: Number(request.requested_by),
    status: request.status,
    created_at: request.created_at
  };
}

export function createChecksRouter({
  checksRepository,
  promotionRequestsRepository,
  usersRepository,
  teamsRepository,
  requireAuth
}) {
  const router = Router();

  router.use("/checks", requireAuth);

  router.get("/checks/settings", async (request, response) => {
    const scope = parseScope(request.query.scope, { defaultScope: "all", fieldName: "scope" });
    const userId = request.user.userId;
    const teamId = await resolveScopedTeamId({
      scope,
      rawTeamId: request.query.team_id,
      userId,
      usersRepository
    });

    await assertScopeReadAuthorization({
      scope,
      userId,
      teamId,
      teamsRepository,
      teamReadMessage: "You must be on the selected team to read team check settings."
    });

    const scoped = await checksRepository.listRequirementSettingsForScope({
      scope,
      userId,
      teamId
    });

    const fallbackToGlobal =
      scope !== "all"
        ? await checksRepository.listRequirementSettingsForScope({
            scope: "all"
          })
        : null;

    response.json({
      scope,
      team_id: teamId,
      toggles: mergeRequirementToggles(scope === "all" ? scoped : scoped ?? fallbackToGlobal)
    });
  });

  router.put("/checks/settings", async (request, response) => {
    const body = requireObject(request.body);
    const scope = parseScope(body.scope, { defaultScope: "all", fieldName: "scope" });
    const userId = request.user.userId;
    const teamId = await resolveScopedTeamId({
      scope,
      rawTeamId: body.team_id,
      userId,
      usersRepository
    });

    await assertScopeWriteAuthorization({
      scope,
      userId,
      teamId,
      teamsRepository,
      usersRepository,
      teamWriteMessage: "You must be on the selected team to edit team check settings.",
      teamLeadMessage: "Only team leads can edit team check settings.",
      globalWriteMessage: "Only admins can edit global check settings."
    });

    const toggles = normalizeRequirementToggles(body.toggles);
    await checksRepository.replaceRequirementSettingsForScope({
      scope,
      userId,
      teamId,
      toggles
    });

    response.json({
      scope,
      team_id: teamId,
      toggles
    });
  });

  router.post("/checks/promotion-requests", async (request, response) => {
    const body = requireObject(request.body);
    const sourceScope = parseScope(body.source_scope, {
      defaultScope: "self",
      fieldName: "source_scope",
      allowedScopes: SOURCE_PROMOTION_SCOPE_SET
    });
    const targetScope = parseScope(body.target_scope, {
      fieldName: "target_scope",
      allowedScopes: TARGET_PROMOTION_SCOPE_SET
    });

    const userId = request.user.userId;
    const sourceTeamId = await resolveScopedTeamId({
      scope: sourceScope,
      rawTeamId: body.team_id,
      userId,
      usersRepository
    });
    const targetTeamId = targetScope === "team" ? parsePromotionTargetTeamId(body.target_team_id) : null;

    await assertPromotionAuthorization({
      sourceScope,
      targetScope,
      sourceTeamId,
      targetTeamId,
      userId,
      teamsRepository
    });

    const scopedToggles = await checksRepository.listRequirementSettingsForScope({
      scope: sourceScope,
      userId,
      teamId: sourceTeamId
    });

    const promotionRequest = await promotionRequestsRepository.createPromotionRequest({
      entityType: "checks",
      sourceScope,
      sourceUserId: sourceScope === "self" ? userId : null,
      sourceTeamId: sourceScope === "team" ? sourceTeamId : null,
      targetScope,
      targetTeamId,
      requestedBy: userId,
      payload: {
        toggles: mergeRequirementToggles(scopedToggles)
      }
    });

    response.status(201).json({
      promotion_request: serializePromotionRequest(promotionRequest)
    });
  });

  return router;
}
