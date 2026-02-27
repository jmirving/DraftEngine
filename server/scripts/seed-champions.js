import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseChampionsCsv } from "../../src/data/loaders.js";
import { loadConfig } from "../config.js";
import { createDbPool } from "../db/pool.js";

const DEFAULT_CSV_PATH = "docs/champion-catalog/champions.full.csv";
const LEGACY_CHAMPION_KEY_ALIASES = Object.freeze({
  monkeyking: "wukong",
  nunu: "nunuwillump",
  renata: "renataglasc"
});

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

function normalizeChampionKey(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function resolveChampionKey(name) {
  const normalized = normalizeChampionKey(name);
  return LEGACY_CHAMPION_KEY_ALIASES[normalized] ?? normalized;
}

function buildCanonicalNameByKey(champions) {
  const byKey = new Map();
  for (const champion of champions) {
    const key = resolveChampionKey(champion.name);
    const existing = byKey.get(key);
    if (existing && existing !== champion.name) {
      throw new Error(
        `Champion CSV has conflicting canonical names for key '${key}': '${existing}' and '${champion.name}'.`
      );
    }
    byKey.set(key, champion.name);
  }
  return byKey;
}

async function tableExists(client, tableName) {
  const result = await client.query("SELECT to_regclass($1) IS NOT NULL AS exists", [`public.${tableName}`]);
  return result.rows[0]?.exists === true;
}

async function columnExists(client, tableName, columnName) {
  const result = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
      ) AS exists
    `,
    [tableName, columnName]
  );
  return result.rows[0]?.exists === true;
}

async function mergeChampionReferences(client, fromChampionId, toChampionId) {
  if (fromChampionId === toChampionId) {
    return;
  }

  if (await tableExists(client, "champion_tags")) {
    await client.query(
      `
        INSERT INTO champion_tags (champion_id, tag_id)
        SELECT $2, tag_id
        FROM champion_tags
        WHERE champion_id = $1
        ON CONFLICT (champion_id, tag_id) DO NOTHING
      `,
      [fromChampionId, toChampionId]
    );
    await client.query("DELETE FROM champion_tags WHERE champion_id = $1", [fromChampionId]);
  }

  if (await tableExists(client, "user_pool_champions")) {
    const hasFamiliarity = await columnExists(client, "user_pool_champions", "familiarity");
    if (hasFamiliarity) {
      await client.query(
        `
          INSERT INTO user_pool_champions (pool_id, champion_id, familiarity)
          SELECT pool_id, $2, familiarity
          FROM user_pool_champions
          WHERE champion_id = $1
          ON CONFLICT (pool_id, champion_id) DO UPDATE
          SET familiarity = LEAST(user_pool_champions.familiarity, EXCLUDED.familiarity)
        `,
        [fromChampionId, toChampionId]
      );
    } else {
      await client.query(
        `
          INSERT INTO user_pool_champions (pool_id, champion_id)
          SELECT pool_id, $2
          FROM user_pool_champions
          WHERE champion_id = $1
          ON CONFLICT (pool_id, champion_id) DO NOTHING
        `,
        [fromChampionId, toChampionId]
      );
    }
    await client.query("DELETE FROM user_pool_champions WHERE champion_id = $1", [fromChampionId]);
  }

  if (await tableExists(client, "user_champion_tags")) {
    await client.query(
      `
        INSERT INTO user_champion_tags (user_id, champion_id, tag_id)
        SELECT user_id, $2, tag_id
        FROM user_champion_tags
        WHERE champion_id = $1
        ON CONFLICT (user_id, champion_id, tag_id) DO NOTHING
      `,
      [fromChampionId, toChampionId]
    );
    await client.query("DELETE FROM user_champion_tags WHERE champion_id = $1", [fromChampionId]);
  }

  if (await tableExists(client, "team_champion_tags")) {
    await client.query(
      `
        INSERT INTO team_champion_tags (team_id, champion_id, tag_id)
        SELECT team_id, $2, tag_id
        FROM team_champion_tags
        WHERE champion_id = $1
        ON CONFLICT (team_id, champion_id, tag_id) DO NOTHING
      `,
      [fromChampionId, toChampionId]
    );
    await client.query("DELETE FROM team_champion_tags WHERE champion_id = $1", [fromChampionId]);
  }

  if (await tableExists(client, "scope_promotion_requests")) {
    await client.query(
      `
        UPDATE scope_promotion_requests
        SET resource_id = $2
        WHERE entity_type = 'champion_tags'
          AND resource_id = $1
      `,
      [fromChampionId, toChampionId]
    );
  }
}

async function mergeChampionAliases(client, canonicalNameByKey) {
  const existingResult = await client.query(
    `
      SELECT id, name
      FROM champions
      ORDER BY id ASC
    `
  );

  const groups = new Map();
  for (const row of existingResult.rows) {
    const key = resolveChampionKey(row.name);
    const existing = groups.get(key) ?? [];
    existing.push({
      id: Number(row.id),
      name: row.name
    });
    groups.set(key, existing);
  }

  const merges = [];
  for (const [key, champions] of groups.entries()) {
    const canonicalName = canonicalNameByKey.get(key);
    if (!canonicalName) {
      continue;
    }

    const target = champions.find((champion) => champion.name === canonicalName);
    if (!target) {
      throw new Error(`Missing canonical champion '${canonicalName}' while processing key '${key}'.`);
    }

    for (const source of champions) {
      if (source.id === target.id) {
        continue;
      }
      await mergeChampionReferences(client, source.id, target.id);
      await client.query("DELETE FROM champions WHERE id = $1", [source.id]);
      merges.push(`${source.name} -> ${target.name}`);
    }
  }

  return merges;
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
    const canonicalNameByKey = buildCanonicalNameByKey(parsed.champions);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const champion of parsed.champions) {
        await upsertChampion(client, champion);
      }
      const aliasMerges = await mergeChampionAliases(client, canonicalNameByKey);
      await client.query("COMMIT");
      if (aliasMerges.length > 0) {
        console.log(`Merged ${aliasMerges.length} legacy champion aliases.`);
        for (const merge of aliasMerges) {
          console.log(`- ${merge}`);
        }
      }
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
