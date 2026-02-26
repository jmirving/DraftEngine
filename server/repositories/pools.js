export function createPoolsRepository(pool) {
  return {
    async listPoolsByUser(userId) {
      const result = await pool.query(
        `
          SELECT id, user_id, name, created_at
          FROM user_champion_pools
          WHERE user_id = $1
          ORDER BY id ASC
        `,
        [userId]
      );
      return result.rows;
    },

    async getPoolOwner(poolId) {
      const result = await pool.query(
        `
          SELECT user_id
          FROM user_champion_pools
          WHERE id = $1
        `,
        [poolId]
      );
      return result.rows[0]?.user_id ?? null;
    },

    async createPool(userId, name) {
      const result = await pool.query(
        `
          INSERT INTO user_champion_pools (user_id, name)
          VALUES ($1, $2)
          RETURNING id, user_id, name, created_at
        `,
        [userId, name]
      );
      return result.rows[0] ?? null;
    },

    async renamePool(poolId, userId, name) {
      const result = await pool.query(
        `
          UPDATE user_champion_pools
          SET name = $3
          WHERE id = $1 AND user_id = $2
          RETURNING id, user_id, name, created_at
        `,
        [poolId, userId, name]
      );
      return result.rows[0] ?? null;
    },

    async deletePool(poolId, userId) {
      const result = await pool.query(
        `
          DELETE FROM user_champion_pools
          WHERE id = $1 AND user_id = $2
        `,
        [poolId, userId]
      );
      return result.rowCount > 0;
    },

    async addChampionToPool(poolId, championId) {
      await pool.query(
        `
          INSERT INTO user_pool_champions (pool_id, champion_id)
          VALUES ($1, $2)
          ON CONFLICT (pool_id, champion_id) DO NOTHING
        `,
        [poolId, championId]
      );
    },

    async removeChampionFromPool(poolId, championId) {
      await pool.query(
        `
          DELETE FROM user_pool_champions
          WHERE pool_id = $1 AND champion_id = $2
        `,
        [poolId, championId]
      );
    },

    async listPoolChampionIds(poolId) {
      const result = await pool.query(
        `
          SELECT champion_id
          FROM user_pool_champions
          WHERE pool_id = $1
          ORDER BY champion_id ASC
        `,
        [poolId]
      );
      return result.rows.map((row) => Number(row.champion_id));
    }
  };
}

