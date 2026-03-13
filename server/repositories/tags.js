import { BOOLEAN_TAGS } from "../../src/domain/model.js";

const DEFAULT_TAG_NAMES = Object.freeze([...BOOLEAN_TAGS]);
const DEFAULT_TAG_DEFINITION = "Definition pending.";
const TAG_SCOPE_SET = new Set(["self", "team", "all"]);

function normalizeTagIds(rows) {
  return rows.map((row) => Number(row.tag_id));
}

function normalizeTagScope(scope) {
  return TAG_SCOPE_SET.has(scope) ? scope : "all";
}

function normalizeTagOwner({ scope = "all", userId = null, teamId = null } = {}) {
  const normalizedScope = normalizeTagScope(scope);
  const normalizedUserId =
    Number.isInteger(userId) && userId > 0 ? userId : Number.parseInt(String(userId ?? ""), 10);
  const normalizedTeamId =
    Number.isInteger(teamId) && teamId > 0 ? teamId : Number.parseInt(String(teamId ?? ""), 10);

  if (normalizedScope === "self") {
    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
      throw new Error("Missing user id for self-scoped tag definitions.");
    }
    return {
      scope: normalizedScope,
      userId: normalizedUserId,
      teamId: null
    };
  }

  if (normalizedScope === "team") {
    if (!Number.isInteger(normalizedTeamId) || normalizedTeamId <= 0) {
      throw new Error("Missing team id for team-scoped tag definitions.");
    }
    return {
      scope: normalizedScope,
      userId: null,
      teamId: normalizedTeamId
    };
  }

  return {
    scope: normalizedScope,
    userId: null,
    teamId: null
  };
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

function buildDefinitionPredicate(options, startIndex = 1, alias = "td") {
  const normalized = normalizeTagOwner(options);
  if (normalized.scope === "self") {
    return {
      clause: `${alias}.scope = $${startIndex} AND ${alias}.user_id = $${startIndex + 1}`,
      values: [normalized.scope, normalized.userId],
      scope: normalized.scope,
      userId: normalized.userId,
      teamId: null
    };
  }
  if (normalized.scope === "team") {
    return {
      clause: `${alias}.scope = $${startIndex} AND ${alias}.team_id = $${startIndex + 1}`,
      values: [normalized.scope, normalized.teamId],
      scope: normalized.scope,
      userId: null,
      teamId: normalized.teamId
    };
  }
  return {
    clause: `${alias}.scope = $${startIndex}`,
    values: [normalized.scope],
    scope: normalized.scope,
    userId: null,
    teamId: null
  };
}

function mapTagRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    definition: typeof row.definition === "string" ? row.definition : "",
    resolved_scope: normalizeTagScope(row.resolved_scope ?? row.scope),
    has_custom_definition: row.has_custom_definition === true,
    user_id: row.user_id === null || row.user_id === undefined ? null : Number(row.user_id),
    team_id: row.team_id === null || row.team_id === undefined ? null : Number(row.team_id),
    updated_by_user_id:
      row.updated_by_user_id === null || row.updated_by_user_id === undefined
        ? null
        : Number(row.updated_by_user_id),
    updated_at: row.updated_at ?? null
  };
}

async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
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
        FROM tag_definitions
        WHERE scope = 'all'
      `
    );
    const tagCount = Number.parseInt(String(countResult.rows[0]?.tag_count ?? "0"), 10);
    if (Number.isInteger(tagCount) && tagCount > 0) {
      return;
    }

    const defaultDefinitions = DEFAULT_TAG_NAMES.map(() => DEFAULT_TAG_DEFINITION);
    await pool.query(
      `
        INSERT INTO tags (name, definition)
        SELECT seeded.name, seeded.definition
        FROM unnest($1::text[], $2::text[]) AS seeded(name, definition)
        WHERE NOT EXISTS (
          SELECT 1
          FROM tags existing
          WHERE lower(existing.name) = lower(seeded.name)
        )
      `,
      [DEFAULT_TAG_NAMES, defaultDefinitions]
    );

    await pool.query(
      `
        INSERT INTO tag_definitions (tag_id, scope, definition)
        SELECT
          t.id,
          'all',
          COALESCE(NULLIF(trim(t.definition), ''), seeded.definition)
        FROM tags t
        JOIN unnest($1::text[], $2::text[]) AS seeded(name, definition)
          ON lower(t.name) = lower(seeded.name)
        WHERE NOT EXISTS (
          SELECT 1
          FROM tag_definitions existing
          WHERE existing.tag_id = t.id
            AND existing.scope = 'all'
            AND existing.user_id IS NULL
            AND existing.team_id IS NULL
        )
      `,
      [DEFAULT_TAG_NAMES, defaultDefinitions]
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

  async function listTagsExact(options = {}) {
    const predicate = buildDefinitionPredicate(options);
    const result = await pool.query(
      `
        SELECT
          t.id,
          t.name,
          td.definition,
          td.scope AS resolved_scope,
          td.user_id,
          td.team_id,
          td.updated_by_user_id,
          td.updated_at,
          true AS has_custom_definition
        FROM tag_definitions td
        JOIN tags t
          ON t.id = td.tag_id
        WHERE ${predicate.clause}
        ORDER BY lower(t.name) ASC, t.id ASC
      `,
      predicate.values
    );
    return result.rows.map(mapTagRow);
  }

  async function listTagsResolved(options = {}) {
    const owner = normalizeTagOwner(options);
    if (owner.scope === "all") {
      return listTagsExact(owner);
    }

    const predicate = buildDefinitionPredicate(owner, 1, "exact");
    const result = await pool.query(
      `
        WITH visible AS (
          SELECT
            t.id,
            t.name,
            td.definition,
            td.scope AS resolved_scope,
            td.user_id,
            td.team_id,
            td.updated_by_user_id,
            td.updated_at,
            CASE
              WHEN ${predicate.clause.replaceAll("exact.", "td.")}
              THEN 0
              ELSE 1
            END AS resolution_priority
          FROM tag_definitions td
          JOIN tags t
            ON t.id = td.tag_id
          WHERE td.scope = 'all' OR ${predicate.clause.replaceAll("exact.", "td.")}
        ),
        resolved AS (
          SELECT DISTINCT ON (id)
            id,
            name,
            definition,
            resolved_scope,
            user_id,
            team_id,
            updated_by_user_id,
            updated_at
          FROM visible
          ORDER BY id ASC, resolution_priority ASC, updated_at DESC, name ASC
        )
        SELECT
          resolved.*,
          EXISTS (
            SELECT 1
            FROM tag_definitions exact
            WHERE exact.tag_id = resolved.id
              AND ${predicate.clause}
          ) AS has_custom_definition
        FROM resolved
        ORDER BY lower(name) ASC, id ASC
      `,
      predicate.values
    );
    return result.rows.map(mapTagRow);
  }

  async function getCanonicalTagById(client, tagId) {
    const result = await client.query(
      `
        SELECT id, name, definition
        FROM tags
        WHERE id = $1
        LIMIT 1
      `,
      [tagId]
    );
    return result.rowCount > 0 ? result.rows[0] : null;
  }

  async function getCanonicalTagByName(client, name) {
    const result = await client.query(
      `
        SELECT id, name, definition
        FROM tags
        WHERE lower(name) = lower($1)
        LIMIT 1
      `,
      [name]
    );
    return result.rowCount > 0 ? result.rows[0] : null;
  }

  async function createCanonicalTag(client, { name, definition = "" }) {
    const result = await client.query(
      `
        INSERT INTO tags (name, definition)
        VALUES ($1, $2)
        RETURNING id, name, definition
      `,
      [name, definition]
    );
    return result.rows[0] ?? null;
  }

  async function updateCanonicalTag(client, tagId, { name, definition }) {
    const result = await client.query(
      `
        UPDATE tags
        SET name = $2,
            definition = $3
        WHERE id = $1
        RETURNING id, name, definition
      `,
      [tagId, name, definition]
    );
    return result.rows[0] ?? null;
  }

  async function getExactDefinitionRow(client, tagId, options = {}) {
    const predicate = buildDefinitionPredicate(options, 2, "td");
    const result = await client.query(
      `
        SELECT
          td.id,
          td.tag_id,
          td.scope,
          td.user_id,
          td.team_id,
          td.definition
        FROM tag_definitions td
        WHERE td.tag_id = $1
          AND ${predicate.clause}
        LIMIT 1
      `,
      [tagId, ...predicate.values]
    );
    return result.rowCount > 0 ? result.rows[0] : null;
  }

  async function insertDefinitionRow(client, { tagId, scope, userId = null, teamId = null, definition, actorUserId = null }) {
    const owner = normalizeTagOwner({ scope, userId, teamId });
    const result = await client.query(
      `
        INSERT INTO tag_definitions (
          tag_id,
          scope,
          user_id,
          team_id,
          definition,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $6)
        RETURNING id
      `,
      [tagId, owner.scope, owner.userId, owner.teamId, definition, actorUserId]
    );
    return result.rows[0] ?? null;
  }

  async function updateDefinitionRow(client, definitionId, { tagId, definition, actorUserId = null }) {
    const result = await client.query(
      `
        UPDATE tag_definitions
        SET tag_id = $2,
            definition = $3,
            updated_by_user_id = $4,
            updated_at = current_timestamp
        WHERE id = $1
        RETURNING id
      `,
      [definitionId, tagId, definition, actorUserId]
    );
    return result.rows[0] ?? null;
  }

  async function hasAnyDefinitionRows(client, tagId) {
    const result = await client.query(
      `
        SELECT 1
        FROM tag_definitions
        WHERE tag_id = $1
        LIMIT 1
      `,
      [tagId]
    );
    return result.rowCount > 0;
  }

  async function countTagAssignmentsExact(client, tagId, { scope = "all", userId = null, teamId = null } = {}) {
    const owner = normalizeTagOwner({ scope, userId, teamId });
    if (owner.scope === "self") {
      const result = await client.query(
        `
          SELECT COUNT(*) AS assignment_count
          FROM user_champion_tags
          WHERE tag_id = $1 AND user_id = $2
        `,
        [tagId, owner.userId]
      );
      return Number.parseInt(String(result.rows[0]?.assignment_count ?? "0"), 10) || 0;
    }
    if (owner.scope === "team") {
      const result = await client.query(
        `
          SELECT COUNT(*) AS assignment_count
          FROM team_champion_tags
          WHERE tag_id = $1 AND team_id = $2
        `,
        [tagId, owner.teamId]
      );
      return Number.parseInt(String(result.rows[0]?.assignment_count ?? "0"), 10) || 0;
    }
    const result = await client.query(
      `
        SELECT COUNT(*) AS assignment_count
        FROM champion_tags
        WHERE tag_id = $1
      `,
      [tagId]
    );
    return Number.parseInt(String(result.rows[0]?.assignment_count ?? "0"), 10) || 0;
  }

  async function countTagAssignmentsAll(client, tagId) {
    const result = await client.query(
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
  }

  async function cleanupTagIdentityIfUnused(client, tagId) {
    const hasDefinitions = await hasAnyDefinitionRows(client, tagId);
    if (hasDefinitions) {
      return;
    }
    const assignmentCount = await countTagAssignmentsAll(client, tagId);
    if (assignmentCount > 0) {
      return;
    }
    await client.query(
      `
        DELETE FROM tags
        WHERE id = $1
      `,
      [tagId]
    );
  }

  async function moveScopedAssignments(client, oldTagId, newTagId, owner) {
    if (oldTagId === newTagId) {
      return;
    }
    if (owner.scope === "self") {
      await client.query(
        `
          INSERT INTO user_champion_tags (user_id, champion_id, tag_id)
          SELECT user_id, champion_id, $2
          FROM user_champion_tags
          WHERE user_id = $3 AND tag_id = $1
          ON CONFLICT (user_id, champion_id, tag_id) DO NOTHING
        `,
        [oldTagId, newTagId, owner.userId]
      );
      await client.query(
        `
          DELETE FROM user_champion_tags
          WHERE user_id = $2 AND tag_id = $1
        `,
        [oldTagId, owner.userId]
      );
      return;
    }
    if (owner.scope === "team") {
      await client.query(
        `
          INSERT INTO team_champion_tags (team_id, champion_id, tag_id)
          SELECT team_id, champion_id, $2
          FROM team_champion_tags
          WHERE team_id = $3 AND tag_id = $1
          ON CONFLICT (team_id, champion_id, tag_id) DO NOTHING
        `,
        [oldTagId, newTagId, owner.teamId]
      );
      await client.query(
        `
          DELETE FROM team_champion_tags
          WHERE team_id = $2 AND tag_id = $1
        `,
        [oldTagId, owner.teamId]
      );
    }
  }

  async function getOrCreateCanonicalTag(client, { name, definition = "" }) {
    const existing = await getCanonicalTagByName(client, name);
    if (existing) {
      return existing;
    }
    return createCanonicalTag(client, { name, definition });
  }

  async function getResolvedTagById(tagId, options = {}) {
    const tags = await listTagsResolved(options);
    return tags.find((tag) => tag.id === Number(tagId)) ?? null;
  }

  return {
    async listTags({ scope = "all", userId = null, teamId = null, includeFallback = true } = {}) {
      await ensureDefaultTagCatalog();
      if (includeFallback === false) {
        return listTagsExact({ scope, userId, teamId });
      }
      return listTagsResolved({ scope, userId, teamId });
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

    async createTag({ name, definition, scope = "all", userId = null, teamId = null, actorUserId = null }) {
      await ensureDefaultTagCatalog();
      const owner = normalizeTagOwner({ scope, userId, teamId });
      await withTransaction(pool, async (client) => {
        let canonical = await getCanonicalTagByName(client, name);
        if (!canonical) {
          canonical = await createCanonicalTag(client, {
            name,
            definition: owner.scope === "all" ? definition : ""
          });
        } else if (owner.scope === "all") {
          await updateCanonicalTag(client, Number(canonical.id), { name, definition });
        }
        await insertDefinitionRow(client, {
          tagId: Number(canonical.id),
          scope: owner.scope,
          userId: owner.userId,
          teamId: owner.teamId,
          definition,
          actorUserId
        });
      });
      return getResolvedTagById(await (async () => {
        const existing = await pool.query(`SELECT id FROM tags WHERE lower(name) = lower($1) LIMIT 1`, [name]);
        return Number(existing.rows[0]?.id ?? 0);
      })(), owner);
    },

    async updateTag(tagId, { name, definition, scope = "all", userId = null, teamId = null, actorUserId = null }) {
      await ensureDefaultTagCatalog();
      const owner = normalizeTagOwner({ scope, userId, teamId });
      const updatedTagId = await withTransaction(pool, async (client) => {
        const canonical = await getCanonicalTagById(client, tagId);
        if (!canonical) {
          return null;
        }

        const exactDefinition = await getExactDefinitionRow(client, tagId, owner);
        if (owner.scope === "all") {
          await updateCanonicalTag(client, tagId, { name, definition });
          if (!exactDefinition) {
            await insertDefinitionRow(client, {
              tagId,
              scope: owner.scope,
              definition,
              actorUserId
            });
          } else {
            await updateDefinitionRow(client, Number(exactDefinition.id), {
              tagId,
              definition,
              actorUserId
            });
          }
          return tagId;
        }

        const currentName = typeof canonical.name === "string" ? canonical.name : "";
        const nameChanged = currentName.localeCompare(name, undefined, { sensitivity: "accent" }) !== 0;
        if (!exactDefinition) {
          const targetCanonical = nameChanged
            ? await getOrCreateCanonicalTag(client, { name })
            : canonical;
          await insertDefinitionRow(client, {
            tagId: Number(targetCanonical.id),
            scope: owner.scope,
            userId: owner.userId,
            teamId: owner.teamId,
            definition,
            actorUserId
          });
          return Number(targetCanonical.id);
        }

        if (!nameChanged) {
          await updateDefinitionRow(client, Number(exactDefinition.id), {
            tagId,
            definition,
            actorUserId
          });
          return tagId;
        }

        const targetCanonical = await getOrCreateCanonicalTag(client, { name });
        const conflictingDefinition = await getExactDefinitionRow(client, Number(targetCanonical.id), owner);
        if (conflictingDefinition) {
          const error = new Error("duplicate");
          error.code = "23505";
          throw error;
        }

        await updateDefinitionRow(client, Number(exactDefinition.id), {
          tagId: Number(targetCanonical.id),
          definition,
          actorUserId
        });
        await moveScopedAssignments(client, tagId, Number(targetCanonical.id), owner);
        await cleanupTagIdentityIfUnused(client, tagId);
        return Number(targetCanonical.id);
      });

      if (!updatedTagId) {
        return null;
      }
      return getResolvedTagById(updatedTagId, owner);
    },

    async countTagAssignments(tagId, options = null) {
      await ensureDefaultTagCatalog();
      if (!options || typeof options !== "object") {
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
      }

      return withTransaction(pool, (client) => countTagAssignmentsExact(client, tagId, options));
    },

    async deleteTag(tagId, { scope = "all", userId = null, teamId = null } = {}) {
      await ensureDefaultTagCatalog();
      const owner = normalizeTagOwner({ scope, userId, teamId });
      return withTransaction(pool, async (client) => {
        const exactDefinition = await getExactDefinitionRow(client, tagId, owner);
        if (!exactDefinition) {
          return null;
        }

        await client.query(
          `
            DELETE FROM tag_definitions
            WHERE id = $1
          `,
          [exactDefinition.id]
        );

        if (owner.scope === "all") {
          await client.query(
            `
              UPDATE tags
              SET definition = ''
              WHERE id = $1
            `,
            [tagId]
          );
        }

        await cleanupTagIdentityIfUnused(client, tagId);
        return {
          id: Number(tagId),
          name: null,
          definition: null
        };
      });
    }
  };
}
