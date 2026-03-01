export function createUsersRepository(pool) {
  return {
    async createUser({ email, passwordHash, gameName, tagline }) {
      const result = await pool.query(
        `
          INSERT INTO users (email, password_hash, game_name, tagline)
          VALUES ($1, $2, $3, $4)
          RETURNING id, email, game_name, tagline, role, primary_role, secondary_roles, created_at
        `,
        [email, passwordHash, gameName, tagline]
      );
      return result.rows[0] ?? null;
    },

    async findByEmail(email) {
      const result = await pool.query(
        `
          SELECT id, email, password_hash, game_name, tagline, role, primary_role, secondary_roles, created_at
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
          SELECT id, email, password_hash, game_name, tagline, role, primary_role, secondary_roles, created_at
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
          SELECT id, email, password_hash, game_name, tagline, role, primary_role, secondary_roles, created_at
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
      const result = await pool.query(
        `
          SELECT COUNT(*)::int AS admin_count
          FROM users
          WHERE lower(role) = 'admin'
        `
      );
      return result.rows[0]?.admin_count ?? 0;
    },

    async findProfileById(userId) {
      const result = await pool.query(
        `
          SELECT id, email, game_name, tagline, role, primary_role, secondary_roles, created_at
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
          RETURNING id, email, game_name, tagline, primary_role, secondary_roles, created_at
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
    }
  };
}
