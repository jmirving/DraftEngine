import { DEFAULT_REQUIREMENT_TOGGLES } from "../../src/domain/model.js";
import { REQUIREMENT_TOGGLE_KEYS } from "./checks.js";

const REQUIREMENT_TOGGLE_KEY_SET = new Set(REQUIREMENT_TOGGLE_KEYS);

function normalizeStoredToggles(rawValue) {
  const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const normalized = {
    ...DEFAULT_REQUIREMENT_TOGGLES
  };
  for (const key of REQUIREMENT_TOGGLE_KEYS) {
    if (typeof source[key] === "boolean") {
      normalized[key] = source[key];
    }
  }
  return normalized;
}

function sanitizeToggleOverrides(rawValue) {
  const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const sanitized = {};
  for (const [key, value] of Object.entries(source)) {
    if (!REQUIREMENT_TOGGLE_KEY_SET.has(key)) {
      continue;
    }
    if (typeof value !== "boolean") {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitizeTogglesForStorage(sanitized);
}

function sanitizeTogglesForStorage(toggles) {
  const merged = normalizeStoredToggles(toggles);
  return Object.fromEntries(REQUIREMENT_TOGGLE_KEYS.map((key) => [key, merged[key]]));
}

function mapRequirementRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    toggles: normalizeStoredToggles(row.toggles_json),
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

export function createCompositionRequirementsRepository(pool) {
  return {
    async listRequirements() {
      const result = await pool.query(
        `
          SELECT
            id,
            name,
            toggles_json,
            is_active,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
          FROM composition_requirements
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
            toggles_json,
            is_active,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
          FROM composition_requirements
          WHERE id = $1
          LIMIT 1
        `,
        [requirementId]
      );
      return result.rowCount > 0 ? mapRequirementRow(result.rows[0]) : null;
    },

    async getActiveRequirement() {
      const result = await pool.query(
        `
          SELECT
            id,
            name,
            toggles_json,
            is_active,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
          FROM composition_requirements
          WHERE is_active = true
          ORDER BY id ASC
          LIMIT 1
        `
      );
      return result.rowCount > 0 ? mapRequirementRow(result.rows[0]) : null;
    },

    async createRequirement({ name, toggles = {}, isActive = false, actorUserId = null }) {
      return withTransaction(pool, async (client) => {
        const sanitizedToggles = sanitizeToggleOverrides(toggles);
        if (isActive) {
          await client.query(
            `
              UPDATE composition_requirements
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
            INSERT INTO composition_requirements (
              name,
              toggles_json,
              is_active,
              created_by_user_id,
              updated_by_user_id
            )
            VALUES ($1, $2::jsonb, $3, $4, $4)
            RETURNING
              id,
              name,
              toggles_json,
              is_active,
              created_by_user_id,
              updated_by_user_id,
              created_at,
              updated_at
          `,
          [name, JSON.stringify(sanitizedToggles), Boolean(isActive), actorUserId]
        );
        return result.rowCount > 0 ? mapRequirementRow(result.rows[0]) : null;
      });
    },

    async updateRequirement(requirementId, { name, toggles, isActive, actorUserId = null }) {
      return withTransaction(pool, async (client) => {
        const existingResult = await client.query(
          `
            SELECT
              id,
              name,
              toggles_json,
              is_active,
              created_by_user_id,
              updated_by_user_id,
              created_at,
              updated_at
            FROM composition_requirements
            WHERE id = $1
            LIMIT 1
          `,
          [requirementId]
        );
        if (existingResult.rowCount < 1) {
          return null;
        }

        const existing = mapRequirementRow(existingResult.rows[0]);
        const nextName = typeof name === "string" && name.trim() !== "" ? name.trim() : existing.name;
        const nextToggles = toggles === undefined ? existing.toggles : sanitizeToggleOverrides(toggles);
        const nextIsActive = typeof isActive === "boolean" ? isActive : existing.is_active;

        if (nextIsActive) {
          await client.query(
            `
              UPDATE composition_requirements
              SET is_active = false,
                  updated_by_user_id = $1,
                  updated_at = current_timestamp
              WHERE is_active = true
                AND id <> $2
            `,
            [actorUserId, requirementId]
          );
        }

        const updatedResult = await client.query(
          `
            UPDATE composition_requirements
            SET name = $2,
                toggles_json = $3::jsonb,
                is_active = $4,
                updated_by_user_id = $5,
                updated_at = current_timestamp
            WHERE id = $1
            RETURNING
              id,
              name,
              toggles_json,
              is_active,
              created_by_user_id,
              updated_by_user_id,
              created_at,
              updated_at
          `,
          [requirementId, nextName, JSON.stringify(nextToggles), nextIsActive, actorUserId]
        );

        return updatedResult.rowCount > 0 ? mapRequirementRow(updatedResult.rows[0]) : null;
      });
    },

    async deleteRequirement(requirementId) {
      const result = await pool.query(
        `
          DELETE FROM composition_requirements
          WHERE id = $1
          RETURNING
            id,
            name,
            toggles_json,
            is_active,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
        `,
        [requirementId]
      );
      return result.rowCount > 0 ? mapRequirementRow(result.rows[0]) : null;
    }
  };
}
