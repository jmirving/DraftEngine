import { OWNER_ADMIN_EMAILS } from "../user-roles.js";

export function createUsersRepository(pool) {
  return {
    async createUser({ email, passwordHash, gameName, tagline, firstName = null, lastName = null, role = "member" }) {
      const result = await pool.query(
        `
          INSERT INTO users (email, password_hash, game_name, tagline, first_name, last_name, role)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, email, game_name, tagline, first_name, last_name, role, primary_role, secondary_roles, default_team_id, avatar_champion_id, riot_id_correction_count, created_at
        `,
        [email, passwordHash, gameName, tagline, firstName || null, lastName || null, role]
      );
      return result.rows[0] ?? null;
    },

    async findByEmail(email) {
      const result = await pool.query(
        `
          SELECT id, email, password_hash, game_name, tagline, first_name, last_name, role, primary_role, secondary_roles, default_team_id, avatar_champion_id, riot_id_correction_count, created_at
          FROM users
          WHERE email = $1
        `,
        [email]
      );
      return result.rows[0] ?? null;
    },

    async findById(userId) {
      const result = await pool.query(
        `
          SELECT id, email, password_hash, game_name, tagline, first_name, last_name, role, primary_role, secondary_roles, default_team_id, active_team_id, avatar_champion_id, riot_id_correction_count, created_at
          FROM users
          WHERE id = $1
        `,
        [userId]
      );
      return result.rows[0] ?? null;
    },

    async findByRiotId(gameName, tagline) {
      const result = await pool.query(
        `
          SELECT id, email, password_hash, game_name, tagline, first_name, last_name, role, primary_role, secondary_roles, default_team_id, avatar_champion_id, riot_id_correction_count, created_at
          FROM users
          WHERE lower(game_name) = lower($1)
            AND lower(tagline) = lower($2)
          ORDER BY id ASC
          LIMIT 1
        `,
        [gameName, tagline]
      );
      return result.rows[0] ?? null;
    },

    async countAdmins() {
      const emailList = [...OWNER_ADMIN_EMAILS].map((email) => email.toLowerCase());
      const result = await pool.query(
        `
          SELECT COUNT(*)::int AS admin_count
          FROM users
          WHERE lower(email) = ANY($1)
        `,
        [emailList]
      );
      return result.rows[0]?.admin_count ?? 0;
    },

    async listUsersForAdmin() {
      const result = await pool.query(
        `
          SELECT id, email, game_name, tagline, role, primary_role, secondary_roles, riot_id_correction_count, created_at
          FROM users
          ORDER BY lower(email) ASC, id ASC
        `
      );
      return result.rows;
    },

    async listIdentityByIds(userIds) {
      const normalizedIds = Array.isArray(userIds)
        ? [...new Set(userIds.map((value) => Number.parseInt(String(value), 10)).filter((value) => Number.isInteger(value) && value > 0))]
        : [];
      if (normalizedIds.length < 1) {
        return [];
      }

      const result = await pool.query(
        `
          SELECT id, email, game_name, tagline
          FROM users
          WHERE id = ANY($1::int[])
        `,
        [normalizedIds]
      );
      return result.rows;
    },

    async searchUsersForTeamMemberActions({ query, teamId, limit = 8 }) {
      const normalizedQuery = typeof query === "string" ? query.trim().toLowerCase() : "";
      const normalizedTeamId = Number.parseInt(String(teamId), 10);
      const normalizedLimit = Number.parseInt(String(limit), 10);
      if (!normalizedQuery || !Number.isInteger(normalizedTeamId) || normalizedTeamId <= 0) {
        return [];
      }

      const wildcard = `%${normalizedQuery}%`;
      const safeLimit = Number.isInteger(normalizedLimit) && normalizedLimit > 0
        ? Math.min(normalizedLimit, 12)
        : 8;
      const result = await pool.query(
        `
          SELECT u.id,
                 u.email,
                 u.game_name,
                 u.tagline,
                 u.primary_role
          FROM users u
          WHERE NOT EXISTS (
            SELECT 1
            FROM team_members tm
            WHERE tm.team_id = $2
              AND tm.user_id = u.id
          )
            AND (
              lower(u.email) LIKE $1
              OR lower(coalesce(u.game_name, '')) LIKE $1
              OR lower(coalesce(u.tagline, '')) LIKE $1
              OR lower(concat_ws('#', coalesce(u.game_name, ''), coalesce(u.tagline, ''))) LIKE $1
            )
          ORDER BY lower(coalesce(u.game_name, '')) ASC,
                   lower(coalesce(u.tagline, '')) ASC,
                   lower(u.email) ASC,
                   u.id ASC
          LIMIT $3
        `,
        [wildcard, normalizedTeamId, safeLimit]
      );
      return result.rows;
    },

    async updateUserRole(userId, role) {
      const result = await pool.query(
        `
          UPDATE users
          SET role = $2
          WHERE id = $1
          RETURNING id, email, game_name, tagline, role, primary_role, secondary_roles, default_team_id, avatar_champion_id, riot_id_correction_count, created_at
        `,
        [userId, role]
      );
      return result.rows[0] ?? null;
    },

    async updateUserRiotIdOneTime(userId, { gameName, tagline }) {
      const result = await pool.query(
        `
          UPDATE users
          SET game_name = $2,
              tagline = $3,
              riot_id_correction_count = riot_id_correction_count + 1
          WHERE id = $1
            AND riot_id_correction_count < 1
          RETURNING id, email, game_name, tagline, role, primary_role, secondary_roles, default_team_id, avatar_champion_id, riot_id_correction_count, created_at
        `,
        [userId, gameName, tagline]
      );
      return result.rows[0] ?? null;
    },

    async deleteUser(userId) {
      const result = await pool.query(
        `
          DELETE FROM users
          WHERE id = $1
        `,
        [userId]
      );
      return result.rowCount > 0;
    },

    async findProfileById(userId) {
      const result = await pool.query(
        `
          SELECT id, email, game_name, tagline, role, primary_role, secondary_roles, default_team_id, avatar_champion_id, riot_id_correction_count, created_at
          FROM users
          WHERE id = $1
        `,
        [userId]
      );
      return result.rows[0] ?? null;
    },

    async findTeamContextById(userId) {
      const result = await pool.query(
        `
          SELECT id, active_team_id
          FROM users
          WHERE id = $1
        `,
        [userId]
      );
      return result.rows[0] ?? null;
    },

    async updateAccountInfo(userId, { firstName, lastName }) {
      const result = await pool.query(
        `
          UPDATE users
          SET first_name = $2,
              last_name = $3
          WHERE id = $1
          RETURNING id, email, game_name, tagline, first_name, last_name, role, primary_role, secondary_roles, default_team_id, avatar_champion_id, riot_id_correction_count, created_at
        `,
        [userId, firstName || null, lastName || null]
      );
      return result.rows[0] ?? null;
    },

    async updateProfileRoles(userId, { primaryRole, secondaryRoles }) {
      const result = await pool.query(
        `
          UPDATE users
          SET primary_role = $2,
              secondary_roles = $3
          WHERE id = $1
          RETURNING id, email, game_name, tagline, primary_role, secondary_roles, default_team_id, avatar_champion_id, riot_id_correction_count, created_at
        `,
        [userId, primaryRole, secondaryRoles]
      );
      return result.rows[0] ?? null;
    },

    async updateProfileDisplayTeam(userId, { displayTeamId }) {
      const result = await pool.query(
        `
          UPDATE users
          SET default_team_id = $2
          WHERE id = $1
          RETURNING id, email, game_name, tagline, primary_role, secondary_roles, default_team_id, avatar_champion_id, riot_id_correction_count, created_at
        `,
        [userId, displayTeamId]
      );
      return result.rows[0] ?? null;
    },

    async updateProfileAvatar(userId, { avatarChampionId }) {
      const result = await pool.query(
        `
          UPDATE users
          SET avatar_champion_id = $2
          WHERE id = $1
          RETURNING id, email, game_name, tagline, primary_role, secondary_roles, default_team_id, avatar_champion_id, riot_id_correction_count, created_at
        `,
        [userId, avatarChampionId]
      );
      return result.rows[0] ?? null;
    },

    async updateTeamContext(userId, { activeTeamId }) {
      const result = await pool.query(
        `
          UPDATE users
          SET active_team_id = $2
          WHERE id = $1
          RETURNING id, active_team_id
        `,
        [userId, activeTeamId]
      );
      return result.rows[0] ?? null;
    },

    async createPasswordResetToken(userId, tokenHash, expiresAt) {
      await pool.query(
        `
          INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
          VALUES ($1, $2, $3)
        `,
        [userId, tokenHash, expiresAt]
      );
    },

    async findValidPasswordResetToken(tokenHash) {
      const result = await pool.query(
        `
          SELECT id, user_id, expires_at, used_at
          FROM password_reset_tokens
          WHERE token_hash = $1
            AND used_at IS NULL
            AND expires_at > current_timestamp
        `,
        [tokenHash]
      );
      return result.rows[0] ?? null;
    },

    async markResetTokenUsed(tokenId) {
      await pool.query(
        `
          UPDATE password_reset_tokens
          SET used_at = current_timestamp
          WHERE id = $1
        `,
        [tokenId]
      );
    },

    async updatePassword(userId, passwordHash) {
      const result = await pool.query(
        `
          UPDATE users
          SET password_hash = $2
          WHERE id = $1
        `,
        [userId, passwordHash]
      );
      return result.rowCount > 0;
    }
  };
}
