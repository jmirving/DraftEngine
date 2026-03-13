function mapPromotionRequest(row) {
  return {
    id: Number(row.id),
    entity_type: row.entity_type,
    resource_id: row.resource_id === null || row.resource_id === undefined ? null : Number(row.resource_id),
    source_scope: row.source_scope,
    source_user_id:
      row.source_user_id === null || row.source_user_id === undefined ? null : Number(row.source_user_id),
    source_team_id:
      row.source_team_id === null || row.source_team_id === undefined ? null : Number(row.source_team_id),
    target_scope: row.target_scope,
    target_team_id:
      row.target_team_id === null || row.target_team_id === undefined ? null : Number(row.target_team_id),
    requested_by: Number(row.requested_by),
    status: row.status,
    payload_json: row.payload_json ?? {},
    request_comment: typeof row.request_comment === "string" ? row.request_comment : "",
    review_comment: typeof row.review_comment === "string" ? row.review_comment : "",
    reviewed_by_user_id:
      row.reviewed_by_user_id === null || row.reviewed_by_user_id === undefined
        ? null
        : Number(row.reviewed_by_user_id),
    reviewed_at: row.reviewed_at ?? null,
    created_at: row.created_at
  };
}

export function createPromotionRequestsRepository(pool) {
  return {
    async createPromotionRequest({
      entityType,
      resourceId = null,
      sourceScope,
      sourceUserId = null,
      sourceTeamId = null,
      targetScope,
      targetTeamId = null,
      requestedBy,
      requestComment = "",
      payload = {}
    }) {
      const result = await pool.query(
        `
          INSERT INTO scope_promotion_requests (
            entity_type,
            resource_id,
            source_scope,
            source_user_id,
            source_team_id,
            target_scope,
            target_team_id,
            requested_by,
            request_comment,
            payload_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
          RETURNING id,
                    entity_type,
                    resource_id,
                    source_scope,
                    source_user_id,
                    source_team_id,
                    target_scope,
                    target_team_id,
                    requested_by,
                    status,
                    request_comment,
                    review_comment,
                    reviewed_by_user_id,
                    reviewed_at,
                    payload_json,
                    created_at
        `,
        [
          entityType,
          resourceId,
          sourceScope,
          sourceUserId,
          sourceTeamId,
          targetScope,
          targetTeamId,
          requestedBy,
          requestComment,
          payload
        ]
      );

      return result.rows[0] ? mapPromotionRequest(result.rows[0]) : null;
    },
    async countChampionTagPromotionsByRequester(requestedBy) {
      const result = await pool.query(
        `
          SELECT status, COUNT(*)::int AS count
          FROM scope_promotion_requests
          WHERE requested_by = $1
            AND entity_type = 'champion_tags'
          GROUP BY status
        `,
        [requestedBy]
      );
      const counts = {
        pending: 0,
        approved: 0,
        rejected: 0
      };
      for (const row of result.rows) {
        const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
        if (status && Object.prototype.hasOwnProperty.call(counts, status)) {
          counts[status] = Number(row.count ?? 0);
        }
      }
      return counts;
    },

    async getPromotionRequestById(requestId) {
      const result = await pool.query(
        `
          SELECT id,
                 entity_type,
                 resource_id,
                 source_scope,
                 source_user_id,
                 source_team_id,
                 target_scope,
                 target_team_id,
                 requested_by,
                 status,
                 request_comment,
                 review_comment,
                 reviewed_by_user_id,
                 reviewed_at,
                 payload_json,
                 created_at
          FROM scope_promotion_requests
          WHERE id = $1
          LIMIT 1
        `,
        [requestId]
      );
      return result.rowCount > 0 ? mapPromotionRequest(result.rows[0]) : null;
    },

    async listPromotionRequests({
      entityType = null,
      status = null,
      requestedBy = null,
      targetScope = null,
      targetTeamId = null
    } = {}) {
      const clauses = [];
      const values = [];

      if (entityType) {
        values.push(entityType);
        clauses.push(`entity_type = $${values.length}`);
      }
      if (status) {
        values.push(status);
        clauses.push(`status = $${values.length}`);
      }
      if (Number.isInteger(requestedBy)) {
        values.push(requestedBy);
        clauses.push(`requested_by = $${values.length}`);
      }
      if (targetScope) {
        values.push(targetScope);
        clauses.push(`target_scope = $${values.length}`);
      }
      if (Number.isInteger(targetTeamId)) {
        values.push(targetTeamId);
        clauses.push(`target_team_id = $${values.length}`);
      }

      const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const result = await pool.query(
        `
          SELECT id,
                 entity_type,
                 resource_id,
                 source_scope,
                 source_user_id,
                 source_team_id,
                 target_scope,
                 target_team_id,
                 requested_by,
                 status,
                 request_comment,
                 review_comment,
                 reviewed_by_user_id,
                 reviewed_at,
                 payload_json,
                 created_at
          FROM scope_promotion_requests
          ${whereClause}
          ORDER BY created_at DESC, id DESC
        `,
        values
      );
      return result.rows.map(mapPromotionRequest);
    },

    async reviewPromotionRequest(requestId, { status, reviewedByUserId, reviewComment = "" }) {
      const result = await pool.query(
        `
          UPDATE scope_promotion_requests
          SET status = $2,
              review_comment = $3,
              reviewed_by_user_id = $4,
              reviewed_at = current_timestamp
          WHERE id = $1
            AND status = 'pending'
          RETURNING id,
                    entity_type,
                    resource_id,
                    source_scope,
                    source_user_id,
                    source_team_id,
                    target_scope,
                    target_team_id,
                    requested_by,
                    status,
                    request_comment,
                    review_comment,
                    reviewed_by_user_id,
                    reviewed_at,
                    payload_json,
                    created_at
        `,
        [requestId, status, reviewComment, reviewedByUserId]
      );
      return result.rowCount > 0 ? mapPromotionRequest(result.rows[0]) : null;
    }
  };
}
