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
            payload_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
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
          payload
        ]
      );

      return result.rows[0] ? mapPromotionRequest(result.rows[0]) : null;
    }
  };
}
