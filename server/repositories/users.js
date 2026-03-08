import { OWNER_ADMIN_EMAILS } from "../user-roles.js";

export function createUsersRepository(pool) {
  return {
    async createUser({ email, passwordHash, gameName, tagline, firstName = null, lastName = null, role = "member" }) {
      const result = await pool.query(
        `
          INSERT INTO users (email, password_hash, game_name, tagline, first_name, last_name, role)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, email, game_name, tagline, first_name, last_name, role, primary_role, secondary_roles, riot_id_correction_count, created_at
        `,
        [email, passwordHash, gameName, tagline, firstName || null, lastName || null, role]
      );
      return result.rows[0] ?? null;
    },

    async findByEmail(email) {
      const result = await pool.query(
        `
          SELECT id, email, password_hash, game_name, tagline, first_name, last_name, role, primary_role, secondary_roles, riot_id_correction_count, created_at
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
          SELECT id, email, password_hash, game_name, tagline, first_name, last_name, role, primary_role, secondary_roles, riot_id_correction_count, created_at
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
          SELECT id, email, password_hash, game_name, tagline, first_name, last_name, role, primary_role, secondary_roles, riot_id_correction_count, created_at
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
          WHERE lower(role) = 'admin'
            AND lower(email) = ANY($1)
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

    async updateUserRole(userId, role) {
      const result = await pool.query(
        `
          UPDATE users
          SET role = $2
          WHERE id = $1
          RETURNING id, email, game_name, tagline, role, primary_role, secondary_roles, riot_id_correction_count, created_at
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
          RETURNING id, email, game_name, tagline, role, primary_role, secondary_roles, riot_id_correction_count, created_at
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
          SELECT id, email, game_name, tagline, role, primary_role, secondary_roles, riot_id_correction_count, created_at
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
          SELECT id, default_team_id, active_team_id
          FROM users
          WHERE id = $1
        `,
        [userId]
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
          RETURNING id, email, game_name, tagline, primary_role, secondary_roles, riot_id_correction_count, created_at
        `,
        [userId, primaryRole, secondaryRoles]
      );
      return result.rows[0] ?? null;
    },

    async updateTeamContext(userId, { defaultTeamId, activeTeamId }) {
      const result = await pool.query(
        `
          UPDATE users
          SET default_team_id = $2,
              active_team_id = $3
          WHERE id = $1
          RETURNING id, default_team_id, active_team_id
        `,
        [userId, defaultTeamId, activeTeamId]
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
