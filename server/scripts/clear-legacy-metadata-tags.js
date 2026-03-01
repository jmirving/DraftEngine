import dotenv from "dotenv";

import { createDbPool } from "../db/pool.js";

dotenv.config({ quiet: true });

function readDatabaseUrl(env = process.env) {
  const value = env.DATABASE_URL;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }
  return value.trim();
}

function parseCliArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run")
  };
}

async function countChampionsWithLegacyTags(client) {
  const result = await client.query(
    `
      SELECT COUNT(*)::int AS champion_count
      FROM champions
      WHERE metadata_json ? 'tags'
    `
  );
  return result.rows[0]?.champion_count ?? 0;
}

async function clearLegacyMetadataTags({ dryRun = false } = {}) {
  const pool = createDbPool({
    databaseUrl: readDatabaseUrl()
  });

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const beforeCount = await countChampionsWithLegacyTags(client);
      let updatedCount = 0;

      if (!dryRun) {
        const updateResult = await client.query(
          `
            UPDATE champions
            SET metadata_json = metadata_json - 'tags'
            WHERE metadata_json ? 'tags'
          `
        );
        updatedCount = updateResult.rowCount ?? 0;
      }

      const afterCount = dryRun ? beforeCount : await countChampionsWithLegacyTags(client);
      if (dryRun) {
        await client.query("ROLLBACK");
      } else {
        await client.query("COMMIT");
      }

      return {
        dryRun,
        beforeCount,
        updatedCount,
        afterCount
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  const { dryRun } = parseCliArgs(process.argv.slice(2));
  const summary = await clearLegacyMetadataTags({ dryRun });
  console.log(
    `[clear-legacy-metadata-tags] ${summary.dryRun ? "DRY RUN" : "APPLIED"} | ` +
      `before=${summary.beforeCount}, updated=${summary.updatedCount}, after=${summary.afterCount}`
  );
}

main().catch((error) => {
  console.error(`Clearing legacy metadata tags failed: ${error.message}`);
  process.exit(1);
});
