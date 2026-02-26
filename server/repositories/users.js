export function createUsersRepository(pool) {
  return {
    async createUser({ email, passwordHash }) {
      const result = await pool.query(
        `
          INSERT INTO users (email, password_hash)
          VALUES ($1, $2)
          RETURNING id, email, created_at
        `,
        [email, passwordHash]
      );
      return result.rows[0] ?? null;
    },

    async findByEmail(email) {
      const result = await pool.query(
        `
          SELECT id, email, password_hash, created_at
          FROM users
          WHERE email = $1
        `,
        [email]
      );
      return result.rows[0] ?? null;
    }
  };
}

