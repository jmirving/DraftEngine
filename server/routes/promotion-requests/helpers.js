import { badRequest } from "../../errors.js";
import { parsePositiveInteger } from "../../http/validation.js";

const ALLOWED_PROMOTION_DECISIONS = new Set(["approved", "rejected"]);

export function parsePromotionTargetTeamId(rawTeamId) {
  if (rawTeamId === undefined || rawTeamId === null || rawTeamId === "") {
    return null;
  }
  return parsePositiveInteger(rawTeamId, "target_team_id");
}

export function parsePromotionDecision(rawStatus) {
  if (typeof rawStatus !== "string" || rawStatus.trim() === "") {
    throw badRequest("Expected 'status' to be one of: approved, rejected.");
  }
  const normalized = rawStatus.trim().toLowerCase();
  if (!ALLOWED_PROMOTION_DECISIONS.has(normalized)) {
    throw badRequest("Expected 'status' to be one of: approved, rejected.");
  }
  return normalized;
}

export function serializePromotionRequest(request) {
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
    payload: request.payload_json ?? {},
    created_at: request.created_at
  };
}
