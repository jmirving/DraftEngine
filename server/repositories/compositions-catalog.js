const CATALOG_SCOPE_SET = new Set(["self", "team", "all"]);

function normalizeRulesJson(rawValue) {
  return Array.isArray(rawValue) ? rawValue : [];
}

function normalizeRequirementIdArray(rawValue) {
  const source = Array.isArray(rawValue) ? rawValue : [];
  const deduped = new Set();
  for (const value of source) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      continue;
    }
    deduped.add(parsed);
  }
  return [...deduped].sort((left, right) => left - right);
}

function normalizeCatalogScope(scope) {
  return CATALOG_SCOPE_SET.has(scope) ? scope : "all";
}

function normalizeCatalogOwner({ scope = "all", userId = null, teamId = null } = {}) {
  const normalizedScope = normalizeCatalogScope(scope);
  const normalizedUserId =
    Number.isInteger(userId) && userId > 0 ? userId : Number.parseInt(String(userId ?? ""), 10);
  const normalizedTeamId =
    Number.isInteger(teamId) && teamId > 0 ? teamId : Number.parseInt(String(teamId ?? ""), 10);

  if (normalizedScope === "self") {
    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
      throw new Error("Missing user id for self-scoped composition catalog access.");
    }
    return {
      scope: normalizedScope,
      userId: normalizedUserId,
      teamId: null
    };
  }

  if (normalizedScope === "team") {
    if (!Number.isInteger(normalizedTeamId) || normalizedTeamId <= 0) {
      throw new Error("Missing team id for team-scoped composition catalog access.");
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

function buildScopePredicate(options, startIndex = 1) {
  const normalized = normalizeCatalogOwner(options);
  if (normalized.scope === "self") {
    return {
      clause: `scope = $${startIndex} AND user_id = $${startIndex + 1}`,
      values: [normalized.scope, normalized.userId],
      scope: normalized.scope,
      userId: normalized.userId,
      teamId: null
    };
  }
  if (normalized.scope === "team") {
    return {
      clause: `scope = $${startIndex} AND team_id = $${startIndex + 1}`,
      values: [normalized.scope, normalized.teamId],
      scope: normalized.scope,
      userId: null,
      teamId: normalized.teamId
    };
  }
  return {
    clause: `scope = $${startIndex}`,
    values: [normalized.scope],
    scope: normalized.scope,
    userId: null,
    teamId: null
  };
}

function mapRequirementRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    definition: typeof row.definition === "string" ? row.definition : "",
    rules: normalizeRulesJson(row.rules_json),
    scope: normalizeCatalogScope(row.scope),
    user_id: row.user_id === null || row.user_id === undefined ? null : Number(row.user_id),
    team_id: row.team_id === null || row.team_id === undefined ? null : Number(row.team_id),
    created_by_user_id:
      row.created_by_user_id === null || row.created_by_user_id === undefined ? null : Number(row.created_by_user_id),
    updated_by_user_id:
      row.updated_by_user_id === null || row.updated_by_user_id === undefined ? null : Number(row.updated_by_user_id),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapCompositionRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: typeof row.description === "string" ? row.description : "",
    requirement_ids: normalizeRequirementIdArray(row.requirement_ids_json),
    is_active: row.is_active === true,
    scope: normalizeCatalogScope(row.scope),
    user_id: row.user_id === null || row.user_id === undefined ? null : Number(row.user_id),
    team_id: row.team_id === null || row.team_id === undefined ? null : Number(row.team_id),
    created_by_user_id:
      row.created_by_user_id === null || row.created_by_user_id === undefined ? null : Number(row.created_by_user_id),
    updated_by_user_id:
      row.updated_by_user_id === null || row.updated_by_user_id === undefined ? null : Number(row.updated_by_user_id),
    created_at: row.created_at,
    updated_at: row.updated_at
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

function buildRequirementSelectSql(whereClause = "", orderClause = "ORDER BY lower(name) ASC, id ASC") {
  return `
    SELECT
      id,
      name,
      definition,
      rules_json,
      scope,
      user_id,
      team_id,
      created_by_user_id,
      updated_by_user_id,
      created_at,
      updated_at
    FROM composition_rule_definitions
    ${whereClause}
    ${orderClause}
  `;
}

function buildCompositionSelectSql(whereClause = "", orderClause = "ORDER BY lower(name) ASC, id ASC") {
  return `
    SELECT
      id,
      name,
      description,
      requirement_ids_json,
      is_active,
      scope,
      user_id,
      team_id,
      created_by_user_id,
      updated_by_user_id,
      created_at,
      updated_at
    FROM compositions
    ${whereClause}
    ${orderClause}
  `;
}

export function createCompositionsCatalogRepository(pool) {
  return {
    async listRequirements({ scope = "all", userId = null, teamId = null } = {}) {
      const predicate = buildScopePredicate({ scope, userId, teamId });
      const result = await pool.query(
        buildRequirementSelectSql(`WHERE ${predicate.clause}`),
        predicate.values
      );
      return result.rows.map(mapRequirementRow);
    },

    async getRequirementById(requirementId, filters = null) {
      const values = [requirementId];
      let whereClause = "WHERE id = $1";
      if (filters && typeof filters === "object") {
        const predicate = buildScopePredicate(filters, 2);
        whereClause += ` AND ${predicate.clause}`;
        values.push(...predicate.values);
      }
      const result = await pool.query(buildRequirementSelectSql(whereClause, "LIMIT 1"), values);
      return result.rowCount > 0 ? mapRequirementRow(result.rows[0]) : null;
    },

    async listMissingRequirementIds(requirementIds = [], { scope = "all", userId = null, teamId = null } = {}) {
      const normalizedIds = normalizeRequirementIdArray(requirementIds);
      if (normalizedIds.length < 1) {
        return [];
      }

      const predicate = buildScopePredicate({ scope, userId, teamId }, 2);
      const result = await pool.query(
        `
          SELECT id
          FROM composition_rule_definitions
          WHERE id = ANY($1::bigint[])
            AND ${predicate.clause}
        `,
        [normalizedIds, ...predicate.values]
      );
      const existingIdSet = new Set(result.rows.map((row) => Number(row.id)));
      return normalizedIds.filter((id) => !existingIdSet.has(id));
    },

    async createRequirement({
      name,
      definition = "",
      rules = [],
      scope = "all",
      userId = null,
      teamId = null,
      actorUserId = null
    }) {
      const owner = normalizeCatalogOwner({ scope, userId, teamId });
      const result = await pool.query(
        `
          INSERT INTO composition_rule_definitions (
            name,
            definition,
            rules_json,
            scope,
            user_id,
            team_id,
            created_by_user_id,
            updated_by_user_id
          )
          VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $7)
          RETURNING
            id,
            name,
            definition,
            rules_json,
            scope,
            user_id,
            team_id,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
        `,
        [name, definition, JSON.stringify(rules), owner.scope, owner.userId, owner.teamId, actorUserId]
      );

      return result.rowCount > 0 ? mapRequirementRow(result.rows[0]) : null;
    },

    async updateRequirement(requirementId, { name, definition, rules, actorUserId = null }) {
      const existing = await this.getRequirementById(requirementId);
      if (!existing) {
        return null;
      }

      const nextName = typeof name === "string" && name.trim() !== "" ? name.trim() : existing.name;
      const nextDefinition = typeof definition === "string" ? definition : existing.definition;
      const nextRules = Array.isArray(rules) ? rules : existing.rules;

      const result = await pool.query(
        `
          UPDATE composition_rule_definitions
          SET name = $2,
              definition = $3,
              rules_json = $4::jsonb,
              updated_by_user_id = $5,
              updated_at = current_timestamp
          WHERE id = $1
          RETURNING
            id,
            name,
            definition,
            rules_json,
            scope,
            user_id,
            team_id,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
        `,
        [requirementId, nextName, nextDefinition, JSON.stringify(nextRules), actorUserId]
      );

      return result.rowCount > 0 ? mapRequirementRow(result.rows[0]) : null;
    },

    async deleteRequirement(requirementId) {
      const result = await pool.query(
        `
          DELETE FROM composition_rule_definitions
          WHERE id = $1
          RETURNING
            id,
            name,
            definition,
            rules_json,
            scope,
            user_id,
            team_id,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
        `,
        [requirementId]
      );
      return result.rowCount > 0 ? mapRequirementRow(result.rows[0]) : null;
    },

    async removeRequirementFromCompositions(
      requirementId,
      { actorUserId = null, scope = "all", userId = null, teamId = null } = {}
    ) {
      return withTransaction(pool, async (client) => {
        const predicate = buildScopePredicate({ scope, userId, teamId });
        const result = await client.query(
          `
            SELECT
              id,
              requirement_ids_json
            FROM compositions
            WHERE ${predicate.clause}
          `,
          predicate.values
        );

        for (const row of result.rows) {
          const compositionId = Number(row.id);
          const existingIds = normalizeRequirementIdArray(row.requirement_ids_json);
          if (!existingIds.includes(requirementId)) {
            continue;
          }
          const nextIds = existingIds.filter((id) => id !== requirementId);
          await client.query(
            `
              UPDATE compositions
              SET requirement_ids_json = $2::jsonb,
                  updated_by_user_id = $3,
                  updated_at = current_timestamp
              WHERE id = $1
            `,
            [compositionId, JSON.stringify(nextIds), actorUserId]
          );
        }
      });
    },

    async listCompositions({ scope = "all", userId = null, teamId = null } = {}) {
      const predicate = buildScopePredicate({ scope, userId, teamId });
      const result = await pool.query(
        buildCompositionSelectSql(`WHERE ${predicate.clause}`),
        predicate.values
      );
      return result.rows.map(mapCompositionRow);
    },

    async getCompositionById(compositionId, filters = null) {
      const values = [compositionId];
      let whereClause = "WHERE id = $1";
      if (filters && typeof filters === "object") {
        const predicate = buildScopePredicate(filters, 2);
        whereClause += ` AND ${predicate.clause}`;
        values.push(...predicate.values);
      }
      const result = await pool.query(buildCompositionSelectSql(whereClause, "LIMIT 1"), values);
      return result.rowCount > 0 ? mapCompositionRow(result.rows[0]) : null;
    },

    async getActiveComposition({ scope = "all", userId = null, teamId = null } = {}) {
      const predicate = buildScopePredicate({ scope, userId, teamId });
      const result = await pool.query(
        buildCompositionSelectSql(
          `WHERE is_active = true AND ${predicate.clause}`,
          "ORDER BY id ASC LIMIT 1"
        ),
        predicate.values
      );
      return result.rowCount > 0 ? mapCompositionRow(result.rows[0]) : null;
    },

    async createComposition({
      name,
      description = "",
      requirementIds = [],
      isActive = false,
      scope = "all",
      userId = null,
      teamId = null,
      actorUserId = null
    }) {
      return withTransaction(pool, async (client) => {
        const owner = normalizeCatalogOwner({ scope, userId, teamId });
        const predicate = buildScopePredicate(owner);
        if (isActive) {
          await client.query(
            `
              UPDATE compositions
              SET is_active = false,
                  updated_by_user_id = $1,
                  updated_at = current_timestamp
              WHERE is_active = true
                AND ${predicate.clause}
            `,
            [actorUserId, ...predicate.values]
          );
        }

        const result = await client.query(
          `
            INSERT INTO compositions (
              name,
              description,
              requirement_ids_json,
              is_active,
              scope,
              user_id,
              team_id,
              created_by_user_id,
              updated_by_user_id
            )
            VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $8)
            RETURNING
              id,
              name,
              description,
              requirement_ids_json,
              is_active,
              scope,
              user_id,
              team_id,
              created_by_user_id,
              updated_by_user_id,
              created_at,
              updated_at
          `,
          [
            name,
            description,
            JSON.stringify(normalizeRequirementIdArray(requirementIds)),
            Boolean(isActive),
            owner.scope,
            owner.userId,
            owner.teamId,
            actorUserId
          ]
        );
        return result.rowCount > 0 ? mapCompositionRow(result.rows[0]) : null;
      });
    },

    async updateComposition(
      compositionId,
      {
        name,
        description,
        requirementIds,
        isActive,
        actorUserId = null
      }
    ) {
      return withTransaction(pool, async (client) => {
        const existing = await this.getCompositionById(compositionId);
        if (!existing) {
          return null;
        }

        const nextName = typeof name === "string" && name.trim() !== "" ? name.trim() : existing.name;
        const nextDescription = typeof description === "string" ? description : existing.description;
        const nextRequirementIds = Array.isArray(requirementIds)
          ? normalizeRequirementIdArray(requirementIds)
          : existing.requirement_ids;
        const nextIsActive = typeof isActive === "boolean" ? isActive : existing.is_active;

        if (nextIsActive) {
          const predicate = buildScopePredicate({
            scope: existing.scope,
            userId: existing.user_id,
            teamId: existing.team_id
          }, 3);
          await client.query(
            `
              UPDATE compositions
              SET is_active = false,
                  updated_by_user_id = $1,
                  updated_at = current_timestamp
              WHERE is_active = true
                AND id <> $2
                AND ${predicate.clause}
            `,
            [actorUserId, compositionId, ...predicate.values]
          );
        }

        const result = await client.query(
          `
            UPDATE compositions
            SET name = $2,
                description = $3,
                requirement_ids_json = $4::jsonb,
                is_active = $5,
                updated_by_user_id = $6,
                updated_at = current_timestamp
            WHERE id = $1
            RETURNING
              id,
              name,
              description,
              requirement_ids_json,
              is_active,
              scope,
              user_id,
              team_id,
              created_by_user_id,
              updated_by_user_id,
              created_at,
              updated_at
          `,
          [
            compositionId,
            nextName,
            nextDescription,
            JSON.stringify(nextRequirementIds),
            nextIsActive,
            actorUserId
          ]
        );

        return result.rowCount > 0 ? mapCompositionRow(result.rows[0]) : null;
      });
    },

    async deleteComposition(compositionId) {
      const result = await pool.query(
        `
          DELETE FROM compositions
          WHERE id = $1
          RETURNING
            id,
            name,
            description,
            requirement_ids_json,
            is_active,
            scope,
            user_id,
            team_id,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
        `,
        [compositionId]
      );
      return result.rowCount > 0 ? mapCompositionRow(result.rows[0]) : null;
    }
  };
}
