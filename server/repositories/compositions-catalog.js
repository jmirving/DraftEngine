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

function mapRequirementRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    definition: typeof row.definition === "string" ? row.definition : "",
    rules: normalizeRulesJson(row.rules_json),
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

export function createCompositionsCatalogRepository(pool) {
  return {
    async listRequirements() {
      const result = await pool.query(
        `
          SELECT
            id,
            name,
            definition,
            rules_json,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
          FROM composition_rule_definitions
          ORDER BY lower(name) ASC, id ASC
        `
      );
      return result.rows.map(mapRequirementRow);
    },

    async getRequirementById(requirementId) {
      const result = await pool.query(
        `
          SELECT
            id,
            name,
            definition,
            rules_json,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
          FROM composition_rule_definitions
          WHERE id = $1
          LIMIT 1
        `,
        [requirementId]
      );
      return result.rowCount > 0 ? mapRequirementRow(result.rows[0]) : null;
    },

    async listMissingRequirementIds(requirementIds = []) {
      const normalizedIds = normalizeRequirementIdArray(requirementIds);
      if (normalizedIds.length < 1) {
        return [];
      }

      const result = await pool.query(
        `
          SELECT id
          FROM composition_rule_definitions
          WHERE id = ANY($1::bigint[])
        `,
        [normalizedIds]
      );
      const existingIdSet = new Set(result.rows.map((row) => Number(row.id)));
      return normalizedIds.filter((id) => !existingIdSet.has(id));
    },

    async createRequirement({ name, definition = "", rules = [], actorUserId = null }) {
      const result = await pool.query(
        `
          INSERT INTO composition_rule_definitions (
            name,
            definition,
            rules_json,
            created_by_user_id,
            updated_by_user_id
          )
          VALUES ($1, $2, $3::jsonb, $4, $4)
          RETURNING
            id,
            name,
            definition,
            rules_json,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
        `,
        [name, definition, JSON.stringify(rules), actorUserId]
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
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
        `,
        [requirementId]
      );
      return result.rowCount > 0 ? mapRequirementRow(result.rows[0]) : null;
    },

    async removeRequirementFromCompositions(requirementId, actorUserId = null) {
      return withTransaction(pool, async (client) => {
        const result = await client.query(
          `
            SELECT
              id,
              requirement_ids_json
            FROM compositions
          `
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

    async listCompositions() {
      const result = await pool.query(
        `
          SELECT
            id,
            name,
            description,
            requirement_ids_json,
            is_active,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
          FROM compositions
          ORDER BY lower(name) ASC, id ASC
        `
      );
      return result.rows.map(mapCompositionRow);
    },

    async getCompositionById(compositionId) {
      const result = await pool.query(
        `
          SELECT
            id,
            name,
            description,
            requirement_ids_json,
            is_active,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
          FROM compositions
          WHERE id = $1
          LIMIT 1
        `,
        [compositionId]
      );
      return result.rowCount > 0 ? mapCompositionRow(result.rows[0]) : null;
    },

    async getActiveComposition() {
      const result = await pool.query(
        `
          SELECT
            id,
            name,
            description,
            requirement_ids_json,
            is_active,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
          FROM compositions
          WHERE is_active = true
          ORDER BY id ASC
          LIMIT 1
        `
      );
      return result.rowCount > 0 ? mapCompositionRow(result.rows[0]) : null;
    },

    async createComposition({
      name,
      description = "",
      requirementIds = [],
      isActive = false,
      actorUserId = null
    }) {
      return withTransaction(pool, async (client) => {
        if (isActive) {
          await client.query(
            `
              UPDATE compositions
              SET is_active = false,
                  updated_by_user_id = $1,
                  updated_at = current_timestamp
              WHERE is_active = true
            `,
            [actorUserId]
          );
        }

        const result = await client.query(
          `
            INSERT INTO compositions (
              name,
              description,
              requirement_ids_json,
              is_active,
              created_by_user_id,
              updated_by_user_id
            )
            VALUES ($1, $2, $3::jsonb, $4, $5, $5)
            RETURNING
              id,
              name,
              description,
              requirement_ids_json,
              is_active,
              created_by_user_id,
              updated_by_user_id,
              created_at,
              updated_at
          `,
          [name, description, JSON.stringify(normalizeRequirementIdArray(requirementIds)), Boolean(isActive), actorUserId]
        );
        return result.rowCount > 0 ? mapCompositionRow(result.rows[0]) : null;
      });
    },

    async updateComposition(compositionId, {
      name,
      description,
      requirementIds,
      isActive,
      actorUserId = null
    }) {
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
          await client.query(
            `
              UPDATE compositions
              SET is_active = false,
                  updated_by_user_id = $1,
                  updated_at = current_timestamp
              WHERE is_active = true
                AND id <> $2
            `,
            [actorUserId, compositionId]
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
