function mapChampionRow(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    metadata: row.metadata_json ?? null,
    tagIds: Array.isArray(row.tag_ids) ? row.tag_ids.map((value) => Number(value)) : []
  };
}

export function createChampionsRepository(pool) {
  return {
    async listChampions() {
      const result = await pool.query(
        `
          SELECT
            c.id,
            c.name,
            c.role,
            c.metadata_json,
            COALESCE(
              json_agg(ct.tag_id ORDER BY ct.tag_id)
                FILTER (WHERE ct.tag_id IS NOT NULL),
              '[]'::json
            ) AS tag_ids
          FROM champions c
          LEFT JOIN champion_tags ct
            ON ct.champion_id = c.id
          GROUP BY c.id
          ORDER BY c.name ASC
        `
      );
      return result.rows.map(mapChampionRow);
    },

    async getChampionById(championId) {
      const result = await pool.query(
        `
          SELECT
            c.id,
            c.name,
            c.role,
            c.metadata_json,
            COALESCE(
              json_agg(ct.tag_id ORDER BY ct.tag_id)
                FILTER (WHERE ct.tag_id IS NOT NULL),
              '[]'::json
            ) AS tag_ids
          FROM champions c
          LEFT JOIN champion_tags ct
            ON ct.champion_id = c.id
          WHERE c.id = $1
          GROUP BY c.id
        `,
        [championId]
      );

      return result.rows[0] ? mapChampionRow(result.rows[0]) : null;
    },

    async championExists(championId) {
      const result = await pool.query(
        `
          SELECT 1
          FROM champions
          WHERE id = $1
        `,
        [championId]
      );
      return result.rowCount > 0;
    },

    async updateChampionMetadata(championId, { roles, damageType, scaling }) {
      const currentResult = await pool.query(
        `
          SELECT metadata_json
          FROM champions
          WHERE id = $1
        `,
        [championId]
      );
      if (currentResult.rowCount === 0) {
        return null;
      }

      const currentMetadata =
        currentResult.rows[0]?.metadata_json && typeof currentResult.rows[0].metadata_json === "object"
          ? currentResult.rows[0].metadata_json
          : {};
      const currentTags =
        currentMetadata.tags && typeof currentMetadata.tags === "object" && !Array.isArray(currentMetadata.tags)
          ? currentMetadata.tags
          : {};

      const nextMetadata = {
        ...currentMetadata,
        roles: [...roles],
        damageType,
        scaling,
        tags: currentTags
      };

      await pool.query(
        `
          UPDATE champions
          SET role = $2,
              metadata_json = $3::jsonb
          WHERE id = $1
        `,
        [championId, roles[0], JSON.stringify(nextMetadata)]
      );

      return this.getChampionById(championId);
    }
  };
}
