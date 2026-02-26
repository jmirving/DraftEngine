export function createTagsRepository(pool) {
  return {
    async listTags() {
      const result = await pool.query(
        `
          SELECT id, name, category
          FROM tags
          ORDER BY category ASC, name ASC
        `
      );
      return result.rows;
    },

    async allTagIdsExist(tagIds) {
      if (tagIds.length === 0) {
        return true;
      }

      const result = await pool.query(
        `
          SELECT id
          FROM tags
          WHERE id = ANY($1::bigint[])
        `,
        [tagIds]
      );

      return result.rowCount === new Set(tagIds).size;
    },

    async replaceChampionTags(championId, tagIds) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM champion_tags WHERE champion_id = $1", [championId]);
        if (tagIds.length > 0) {
          await client.query(
            `
              INSERT INTO champion_tags (champion_id, tag_id)
              SELECT $1, x.tag_id
              FROM unnest($2::bigint[]) AS x(tag_id)
              ON CONFLICT (champion_id, tag_id) DO NOTHING
            `,
            [championId, tagIds]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

