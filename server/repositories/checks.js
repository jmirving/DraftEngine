import { DEFAULT_REQUIREMENT_TOGGLES } from "../../src/domain/model.js";

export const REQUIREMENT_TOGGLE_KEYS = Object.freeze(Object.keys(DEFAULT_REQUIREMENT_TOGGLES));
const REQUIREMENT_TOGGLE_KEY_SET = new Set(REQUIREMENT_TOGGLE_KEYS);

function normalizeStoredToggles(rawValue) {
  const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const normalized = {};
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
  return sanitized;
}

function buildScopeConfig(scope) {
  switch (scope) {
    case "all":
      return {
        listQuery: `
          SELECT toggles_json
          FROM global_required_check_settings
          WHERE setting_key = 'global'
          LIMIT 1
        `,
        listValues: () => [],
        replaceQuery: `
          INSERT INTO global_required_check_settings (setting_key, toggles_json)
          VALUES ('global', $1::jsonb)
          ON CONFLICT (setting_key)
          DO UPDATE SET toggles_json = EXCLUDED.toggles_json
        `,
        replaceValues: ({ toggles }) => [toggles]
      };
    case "self":
      return {
        listQuery: `
          SELECT toggles_json
          FROM user_required_check_settings
          WHERE user_id = $1
          LIMIT 1
        `,
        listValues: ({ userId }) => [userId],
        replaceQuery: `
          INSERT INTO user_required_check_settings (user_id, toggles_json)
          VALUES ($1, $2::jsonb)
          ON CONFLICT (user_id)
          DO UPDATE SET toggles_json = EXCLUDED.toggles_json
        `,
        replaceValues: ({ userId, toggles }) => [userId, toggles]
      };
    case "team":
      return {
        listQuery: `
          SELECT toggles_json
          FROM team_required_check_settings
          WHERE team_id = $1
          LIMIT 1
        `,
        listValues: ({ teamId }) => [teamId],
        replaceQuery: `
          INSERT INTO team_required_check_settings (team_id, toggles_json)
          VALUES ($1, $2::jsonb)
          ON CONFLICT (team_id)
          DO UPDATE SET toggles_json = EXCLUDED.toggles_json
        `,
        replaceValues: ({ teamId, toggles }) => [teamId, toggles]
      };
    default:
      throw new Error(`Unsupported check scope '${scope}'.`);
  }
}

export function createChecksRepository(pool) {
  return {
    async listRequirementSettingsForScope({ scope = "all", userId = null, teamId = null } = {}) {
      const scopeConfig = buildScopeConfig(scope);
      const result = await pool.query(scopeConfig.listQuery, scopeConfig.listValues({ userId, teamId }));
      if (result.rowCount < 1) {
        return null;
      }
      return normalizeStoredToggles(result.rows[0]?.toggles_json);
    },

    async replaceRequirementSettingsForScope({ scope = "all", toggles = {}, userId = null, teamId = null } = {}) {
      const scopeConfig = buildScopeConfig(scope);
      const sanitized = sanitizeToggleOverrides(toggles);
      await pool.query(scopeConfig.replaceQuery, scopeConfig.replaceValues({ userId, teamId, toggles: sanitized }));
      return sanitized;
    }
  };
}
