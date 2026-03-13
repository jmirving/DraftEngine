import { loadConfig } from "../config.js";
import { assertDbConnection, assertInvitationSchema, createDbPool } from "../db/pool.js";

async function run() {
  const config = loadConfig();
  const pool = createDbPool(config);
  try {
    await assertDbConnection(pool);
    await assertInvitationSchema(pool);
    console.log("Database connection check passed.");
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(`Database connection check failed: ${error.message}`);
  process.exit(1);
});
