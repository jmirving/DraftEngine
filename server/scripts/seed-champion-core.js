import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../config.js";
import { createDbPool } from "../db/pool.js";

const DEFAULT_SEED_PATH = "server/data/champion-core.seed.json";

function resolveRepoPath(filePath) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  const currentFile = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(currentFile), "..", "..");
  return path.resolve(repoRoot, filePath);
}

function parseSeedPath(argv) {
  const seedIndex = argv.findIndex((arg) => arg === "--seed");
  if (seedIndex >= 0 && argv[seedIndex + 1]) {
    return argv[seedIndex + 1];
  }
  return process.env.CHAMPION_CORE_SEED_PATH ?? DEFAULT_SEED_PATH;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function normalizeRequiredString(value, fieldName) {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`Champion core seed row is missing required field '${fieldName}'.`);
  }
  return normalized;
}

function normalizeInteger(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Champion core seed field '${fieldName}' must be an integer.`);
  }
  return parsed;
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Champion core seed contains a non-numeric stat value '${value}'.`);
  }
  return parsed;
}

function normalizeSeedRow(rawRow) {
  if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
    throw new Error("Champion core seed must contain object rows.");
  }

  return {
    normalized_name: normalizeRequiredString(rawRow.normalized_name, "normalized_name"),
    name: normalizeRequiredString(rawRow.name, "name"),
    ddragon_id: normalizeRequiredString(rawRow.ddragon_id, "ddragon_id"),
    riot_champion_id: normalizeInteger(rawRow.riot_champion_id, "riot_champion_id"),
    riot_tags: Array.isArray(rawRow.riot_tags)
      ? rawRow.riot_tags.map((value) => normalizeRequiredString(value, "riot_tags"))
      : [],
    resource_type: normalizeString(rawRow.resource_type),
    info_attack: normalizeNumber(rawRow.info_attack),
    info_defense: normalizeNumber(rawRow.info_defense),
    info_magic: normalizeNumber(rawRow.info_magic),
    info_difficulty: normalizeNumber(rawRow.info_difficulty),
    hp: normalizeNumber(rawRow.hp),
    hpperlevel: normalizeNumber(rawRow.hpperlevel),
    mp: normalizeNumber(rawRow.mp),
    mpperlevel: normalizeNumber(rawRow.mpperlevel),
    movespeed: normalizeNumber(rawRow.movespeed),
    armor: normalizeNumber(rawRow.armor),
    armorperlevel: normalizeNumber(rawRow.armorperlevel),
    spellblock: normalizeNumber(rawRow.spellblock),
    spellblockperlevel: normalizeNumber(rawRow.spellblockperlevel),
    attackrange: normalizeNumber(rawRow.attackrange),
    hpregen: normalizeNumber(rawRow.hpregen),
    hpregenperlevel: normalizeNumber(rawRow.hpregenperlevel),
    mpregen: normalizeNumber(rawRow.mpregen),
    mpregenperlevel: normalizeNumber(rawRow.mpregenperlevel),
    crit: normalizeNumber(rawRow.crit),
    critperlevel: normalizeNumber(rawRow.critperlevel),
    attackdamage: normalizeNumber(rawRow.attackdamage),
    attackdamageperlevel: normalizeNumber(rawRow.attackdamageperlevel),
    attackspeedperlevel: normalizeNumber(rawRow.attackspeedperlevel),
    attackspeed: normalizeNumber(rawRow.attackspeed)
  };
}

async function upsertChampionCore(client, row) {
  await client.query(
    `
      INSERT INTO champion_core (
        normalized_name,
        name,
        ddragon_id,
        riot_champion_id,
        riot_tags,
        resource_type,
        info_attack,
        info_defense,
        info_magic,
        info_difficulty,
        hp,
        hpperlevel,
        mp,
        mpperlevel,
        movespeed,
        armor,
        armorperlevel,
        spellblock,
        spellblockperlevel,
        attackrange,
        hpregen,
        hpregenperlevel,
        mpregen,
        mpregenperlevel,
        crit,
        critperlevel,
        attackdamage,
        attackdamageperlevel,
        attackspeedperlevel,
        attackspeed
      )
      VALUES (
        $1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
      )
      ON CONFLICT (riot_champion_id) DO UPDATE
      SET normalized_name = EXCLUDED.normalized_name,
          name = EXCLUDED.name,
          ddragon_id = EXCLUDED.ddragon_id,
          riot_tags = EXCLUDED.riot_tags,
          resource_type = EXCLUDED.resource_type,
          info_attack = EXCLUDED.info_attack,
          info_defense = EXCLUDED.info_defense,
          info_magic = EXCLUDED.info_magic,
          info_difficulty = EXCLUDED.info_difficulty,
          hp = EXCLUDED.hp,
          hpperlevel = EXCLUDED.hpperlevel,
          mp = EXCLUDED.mp,
          mpperlevel = EXCLUDED.mpperlevel,
          movespeed = EXCLUDED.movespeed,
          armor = EXCLUDED.armor,
          armorperlevel = EXCLUDED.armorperlevel,
          spellblock = EXCLUDED.spellblock,
          spellblockperlevel = EXCLUDED.spellblockperlevel,
          attackrange = EXCLUDED.attackrange,
          hpregen = EXCLUDED.hpregen,
          hpregenperlevel = EXCLUDED.hpregenperlevel,
          mpregen = EXCLUDED.mpregen,
          mpregenperlevel = EXCLUDED.mpregenperlevel,
          crit = EXCLUDED.crit,
          critperlevel = EXCLUDED.critperlevel,
          attackdamage = EXCLUDED.attackdamage,
          attackdamageperlevel = EXCLUDED.attackdamageperlevel,
          attackspeedperlevel = EXCLUDED.attackspeedperlevel,
          attackspeed = EXCLUDED.attackspeed,
          updated_at = current_timestamp
    `,
    [
      row.normalized_name,
      row.name,
      row.ddragon_id,
      row.riot_champion_id,
      row.riot_tags,
      row.resource_type,
      row.info_attack,
      row.info_defense,
      row.info_magic,
      row.info_difficulty,
      row.hp,
      row.hpperlevel,
      row.mp,
      row.mpperlevel,
      row.movespeed,
      row.armor,
      row.armorperlevel,
      row.spellblock,
      row.spellblockperlevel,
      row.attackrange,
      row.hpregen,
      row.hpregenperlevel,
      row.mpregen,
      row.mpregenperlevel,
      row.crit,
      row.critperlevel,
      row.attackdamage,
      row.attackdamageperlevel,
      row.attackspeedperlevel,
      row.attackspeed
    ]
  );
}

async function run() {
  const config = loadConfig();
  const pool = createDbPool(config);
  try {
    const seedPath = resolveRepoPath(parseSeedPath(process.argv.slice(2)));
    const raw = JSON.parse(await fs.readFile(seedPath, "utf8"));
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error("Champion core seed file must contain a non-empty array.");
    }

    const rows = raw.map(normalizeSeedRow);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const row of rows) {
        await upsertChampionCore(client, row);
      }
      await client.query("COMMIT");
      console.log(`Seeded ${rows.length} champion_core rows from ${path.relative(process.cwd(), seedPath)}`);
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

run().catch((error) => {
  console.error(`Failed to seed champion core: ${error.message}`);
  process.exit(1);
});
