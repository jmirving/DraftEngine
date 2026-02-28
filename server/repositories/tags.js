import { BOOLEAN_TAGS } from "../../src/domain/model.js";

const DEFAULT_TAG_CATEGORY = "composition";
const DEFAULT_TAG_NAMES = Object.freeze([...BOOLEAN_TAGS]);

function normalizeTagIds(rows) {
  return rows.map((row) => Number(row.tag_id));
}

function buildScopeConfig(scope) {
  switch (scope) {
    case "all":
      return {
        listQuery: `
          SELECT tag_id
          FROM champion_tags
          WHERE champion_id = $1
          ORDER BY tag_id ASC
        `,
        listValues: ({ championId }) => [championId],
        deleteQuery: `
          DELETE FROM champion_tags
          WHERE champion_id = $1
        `,
        deleteValues: ({ championId }) => [championId],
        insertQuery: `
          INSERT INTO champion_tags (champion_id, tag_id)
          SELECT $1, x.tag_id
          FROM unnest($2::bigint[]) AS x(tag_id)
          ON CONFLICT (champion_id, tag_id) DO NOTHING
        `,
        insertValues: ({ championId, tagIds }) => [championId, tagIds]
      };
    case "self":
      return {
        listQuery: `
          SELECT tag_id
          FROM user_champion_tags
          WHERE champion_id = $1 AND user_id = $2
          ORDER BY tag_id ASC
        `,
        listValues: ({ championId, userId }) => [championId, userId],
        deleteQuery: `
          DELETE FROM user_champion_tags
          WHERE champion_id = $1 AND user_id = $2
        `,
        deleteValues: ({ championId, userId }) => [championId, userId],
        insertQuery: `
          INSERT INTO user_champion_tags (user_id, champion_id, tag_id)
          SELECT $1, $2, x.tag_id
          FROM unnest($3::bigint[]) AS x(tag_id)
          ON CONFLICT (user_id, champion_id, tag_id) DO NOTHING
        `,
        insertValues: ({ championId, userId, tagIds }) => [userId, championId, tagIds]
      };
    case "team":
      return {
        listQuery: `
          SELECT tag_id
          FROM team_champion_tags
          WHERE champion_id = $1 AND team_id = $2
          ORDER BY tag_id ASC
        `,
        listValues: ({ championId, teamId }) => [championId, teamId],
        deleteQuery: `
          DELETE FROM team_champion_tags
          WHERE champion_id = $1 AND team_id = $2
        `,
        deleteValues: ({ championId, teamId }) => [championId, teamId],
        insertQuery: `
          INSERT INTO team_champion_tags (team_id, champion_id, tag_id)
          SELECT $1, $2, x.tag_id
          FROM unnest($3::bigint[]) AS x(tag_id)
          ON CONFLICT (team_id, champion_id, tag_id) DO NOTHING
        `,
        insertValues: ({ championId, teamId, tagIds }) => [teamId, championId, tagIds]
      };
    default:
      throw new Error(`Unsupported tag scope '${scope}'.`);
  }
}

export function createTagsRepository(pool) {
  async function ensureDefaultTagCatalog() {
    if (DEFAULT_TAG_NAMES.length === 0) {
      return;
    }
    const countResult = await pool.query(
      `
        SELECT COUNT(*) AS tag_count
        FROM tags
      `
    );
    const tagCount = Number.parseInt(String(countResult.rows[0]?.tag_count ?? "0"), 10);
    if (Number.isInteger(tagCount) && tagCount > 0) {
      return;
    }
    const defaultCategories = DEFAULT_TAG_NAMES.map(() => DEFAULT_TAG_CATEGORY);
    await pool.query(
      `
        INSERT INTO tags (name, category)
        SELECT seeded.name, seeded.category
        FROM unnest($1::text[], $2::text[]) AS seeded(name, category)
        ON CONFLICT (name) DO NOTHING
      `,
      [DEFAULT_TAG_NAMES, defaultCategories]
    );
  }

  async function listChampionTagIdsForScope({
    championId,
    scope = "all",
    userId = null,
    teamId = null
  }) {
    const scopeConfig = buildScopeConfig(scope);
    const result = await pool.query(scopeConfig.listQuery, scopeConfig.listValues({ championId, userId, teamId }));
    return normalizeTagIds(result.rows);
  }

  async function replaceChampionTagsForScope({
    championId,
    tagIds,
    scope = "all",
    userId = null,
    teamId = null
  }) {
    const scopeConfig = buildScopeConfig(scope);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(scopeConfig.deleteQuery, scopeConfig.deleteValues({ championId, userId, teamId }));
      if (tagIds.length > 0) {
        await client.query(
          scopeConfig.insertQuery,
          scopeConfig.insertValues({ championId, userId, teamId, tagIds })
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

  return {
    async listTags() {
      await ensureDefaultTagCatalog();
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
      await ensureDefaultTagCatalog();
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

    async listChampionTagIdsForScope(options) {
      return listChampionTagIdsForScope(options);
    },

    async replaceChampionTagsForScope(options) {
      await replaceChampionTagsForScope(options);
    },

    async replaceChampionTags(championId, tagIds) {
      await replaceChampionTagsForScope({
        championId,
        tagIds,
        scope: "all"
      });
    },

    async createTag({ name, category }) {
      const result = await pool.query(
        `
          INSERT INTO tags (name, category)
          VALUES ($1, $2)
          RETURNING id, name, category
        `,
        [name, category]
      );
      return result.rows[0] ?? null;
    },

    async updateTag(tagId, { name, category }) {
      const result = await pool.query(
        `
          UPDATE tags
          SET name = $2,
              category = $3
          WHERE id = $1
          RETURNING id, name, category
        `,
        [tagId, name, category]
      );
      return result.rows[0] ?? null;
    },

    async countTagAssignments(tagId) {
      const result = await pool.query(
        `
          SELECT (
            (SELECT COUNT(*) FROM champion_tags WHERE tag_id = $1) +
            (SELECT COUNT(*) FROM user_champion_tags WHERE tag_id = $1) +
            (SELECT COUNT(*) FROM team_champion_tags WHERE tag_id = $1)
          )::bigint AS assignment_count
        `,
        [tagId]
      );
      return Number.parseInt(String(result.rows[0]?.assignment_count ?? "0"), 10) || 0;
    },

    async deleteTag(tagId) {
      const result = await pool.query(
        `
          DELETE FROM tags
          WHERE id = $1
          RETURNING id, name, category
        `,
        [tagId]
      );
      return result.rows[0] ?? null;
    }
  };
}
