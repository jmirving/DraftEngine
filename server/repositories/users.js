export function createUsersRepository(pool) {
  return {
    async createUser({ email, passwordHash, gameName, tagline }) {
      const result = await pool.query(
        `
          INSERT INTO users (email, password_hash, game_name, tagline)
          VALUES ($1, $2, $3, $4)
          RETURNING id, email, game_name, tagline, created_at
        `,
        [email, passwordHash, gameName, tagline]
      );
      return result.rows[0] ?? null;
    },

    async findByEmail(email) {
      const result = await pool.query(
        `
          SELECT id, email, password_hash, game_name, tagline, created_at
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
          SELECT id, email, password_hash, game_name, tagline, created_at
          FROM users
          WHERE id = $1
        `,
        [userId]
      );
      return result.rows[0] ?? null;
    }
  };
}
