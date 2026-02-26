import { Pool } from "pg";

export function createDbPool(config) {
  return new Pool({
    connectionString: config.databaseUrl
  });
}

export async function assertDbConnection(pool) {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}

