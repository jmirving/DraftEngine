import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseChampionsCsv } from "../../src/data/loaders.js";
import { loadConfig } from "../config.js";
import { createDbPool } from "../db/pool.js";

const DEFAULT_CSV_PATH = "docs/champion-catalog/champions.full.csv";

function parseCsvPathFromArgs(argv) {
  const csvFlagIndex = argv.findIndex((arg) => arg === "--csv");
  if (csvFlagIndex >= 0 && argv[csvFlagIndex + 1]) {
    return argv[csvFlagIndex + 1];
  }
  return process.env.CHAMPIONS_CSV_PATH ?? DEFAULT_CSV_PATH;
}

function resolveAbsolutePath(filePath) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  const currentFile = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(currentFile), "..", "..");
  return path.resolve(repoRoot, filePath);
}

async function upsertChampion(client, champion) {
  const primaryRole = champion.roles[0];
  const metadata = {
    roles: champion.roles,
    damageType: champion.damageType,
    scaling: champion.scaling,
    tags: champion.tags
  };

  await client.query(
    `
      INSERT INTO champions (name, role, metadata_json)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (name) DO UPDATE
      SET role = EXCLUDED.role,
          metadata_json = EXCLUDED.metadata_json
    `,
    [champion.name, primaryRole, JSON.stringify(metadata)]
  );
}

async function run() {
  const config = loadConfig();
  const pool = createDbPool(config);
  try {
    const rawPath = parseCsvPathFromArgs(process.argv.slice(2));
    const csvPath = resolveAbsolutePath(rawPath);
    const csvText = await fs.readFile(csvPath, "utf8");
    const parsed = parseChampionsCsv(csvText);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const champion of parsed.champions) {
        await upsertChampion(client, champion);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    console.log(`Seeded ${parsed.champions.length} champions from ${rawPath}.`);
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(`Champion seed failed: ${error.message}`);
  process.exit(1);
});
