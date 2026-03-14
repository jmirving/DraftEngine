function mapDraftSetupRow(row) {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    name: row.name,
    description: row.description ?? "",
    state_json: row.state_json ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function createDraftSetupsRepository(pool) {
  return {
    async listDraftSetupsByUser(userId) {
      const result = await pool.query(
        `
          SELECT id, user_id, name, description, state_json, created_at, updated_at
          FROM user_draft_setups
          WHERE user_id = $1
          ORDER BY lower(name) ASC, updated_at DESC, id ASC
        `,
        [userId]
      );
      return result.rows.map(mapDraftSetupRow);
    },

    async getDraftSetupById(setupId, userId) {
      const result = await pool.query(
        `
          SELECT id, user_id, name, description, state_json, created_at, updated_at
          FROM user_draft_setups
          WHERE id = $1
            AND user_id = $2
          LIMIT 1
        `,
        [setupId, userId]
      );
      return result.rowCount > 0 ? mapDraftSetupRow(result.rows[0]) : null;
    },

    async createDraftSetup({ userId, name, description, stateJson }) {
      const result = await pool.query(
        `
          INSERT INTO user_draft_setups (user_id, name, description, state_json)
          VALUES ($1, $2, $3, $4::jsonb)
          RETURNING id, user_id, name, description, state_json, created_at, updated_at
        `,
        [userId, name, description ?? "", stateJson]
      );
      return result.rows[0] ? mapDraftSetupRow(result.rows[0]) : null;
    },

    async updateDraftSetup(setupId, { userId, name, description, stateJson }) {
      const result = await pool.query(
        `
          UPDATE user_draft_setups
          SET name = $3,
              description = $4,
              state_json = $5::jsonb,
              updated_at = current_timestamp
          WHERE id = $1
            AND user_id = $2
          RETURNING id, user_id, name, description, state_json, created_at, updated_at
        `,
        [setupId, userId, name, description ?? "", stateJson]
      );
      return result.rows[0] ? mapDraftSetupRow(result.rows[0]) : null;
    },

    async deleteDraftSetup(setupId, userId) {
      const result = await pool.query(
        `
          DELETE FROM user_draft_setups
          WHERE id = $1
            AND user_id = $2
        `,
        [setupId, userId]
      );
      return result.rowCount > 0;
    }
  };
}
