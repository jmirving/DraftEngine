import path from "node:path";
import { fileURLToPath } from "node:url";

import { BOOLEAN_TAGS } from "../../src/domain/model.js";
import { loadConfig } from "../config.js";
import { createDbPool } from "../db/pool.js";

const DEFAULT_TAG_CATEGORY = "composition";

export function normalizeTagNameKey(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function isLegacyTagEnabled(value) {
  if (value === true || value === 1) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

export function buildTagIdByNormalizedName(tags) {
  const byName = new Map();
  for (const tag of Array.isArray(tags) ? tags : []) {
    const tagId = Number(tag?.id);
    const normalizedName = normalizeTagNameKey(tag?.name);
    if (!Number.isInteger(tagId) || tagId <= 0 || normalizedName === "") {
      continue;
    }
    const existing = byName.get(normalizedName);
    if (!Number.isInteger(existing) || tagId < existing) {
      byName.set(normalizedName, tagId);
    }
  }
  return byName;
}

export function collectLegacyTagIds(legacyTags, tagIdByNormalizedName) {
  const source = legacyTags && typeof legacyTags === "object" && !Array.isArray(legacyTags) ? legacyTags : {};
  const mappedTagIds = [];
  const missingTagNames = [];

  for (const legacyTagName of BOOLEAN_TAGS) {
    if (!isLegacyTagEnabled(source[legacyTagName])) {
      continue;
    }
    const normalizedName = normalizeTagNameKey(legacyTagName);
    const mappedTagId = tagIdByNormalizedName.get(normalizedName);
    if (Number.isInteger(mappedTagId) && mappedTagId > 0) {
      mappedTagIds.push(mappedTagId);
    } else {
      missingTagNames.push(legacyTagName);
    }
  }

  return {
    tagIds: [...new Set(mappedTagIds)].sort((left, right) => left - right),
    missingTagNames
  };
}

function parseCliArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run")
  };
}

async function queryAllTags(client) {
  const result = await client.query(
    `
      SELECT id, name, category
      FROM tags
      ORDER BY id ASC
    `
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    category: row.category
  }));
}

async function ensureLegacyTagsExist(client, { dryRun }) {
  const beforeTags = await queryAllTags(client);
  const beforeMap = buildTagIdByNormalizedName(beforeTags);
  const missingLegacyTagNames = BOOLEAN_TAGS.filter(
    (legacyTagName) => !beforeMap.has(normalizeTagNameKey(legacyTagName))
  );

  let createdCount = 0;
  if (!dryRun && missingLegacyTagNames.length > 0) {
    const categories = missingLegacyTagNames.map(() => DEFAULT_TAG_CATEGORY);
    const result = await client.query(
      `
        INSERT INTO tags (name, category)
        SELECT seeded.name, seeded.category
        FROM unnest($1::text[], $2::text[]) AS seeded(name, category)
        ON CONFLICT (name) DO NOTHING
      `,
      [missingLegacyTagNames, categories]
    );
    createdCount = result.rowCount ?? 0;
  }

  const tags = missingLegacyTagNames.length > 0 ? await queryAllTags(client) : beforeTags;
  const tagIdByNormalizedName = buildTagIdByNormalizedName(tags);

  return {
    tags,
    tagIdByNormalizedName,
    missingLegacyTagNames,
    createdCount
  };
}

async function queryChampionsWithMetadata(client) {
  const result = await client.query(
    `
      SELECT id, name, metadata_json
      FROM champions
      ORDER BY id ASC
    `
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    metadata: row.metadata_json && typeof row.metadata_json === "object" ? row.metadata_json : {}
  }));
}

async function insertChampionTagAssignments(client, championId, tagIds) {
  const result = await client.query(
    `
      INSERT INTO champion_tags (champion_id, tag_id)
      SELECT $1, x.tag_id
      FROM unnest($2::bigint[]) AS x(tag_id)
      ON CONFLICT (champion_id, tag_id) DO NOTHING
    `,
    [championId, tagIds]
  );
  return result.rowCount ?? 0;
}

export async function runLegacyTagBackfill({ dryRun = false } = {}) {
  const config = loadConfig();
  const pool = createDbPool(config);

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const {
        tagIdByNormalizedName,
        missingLegacyTagNames,
        createdCount
      } = await ensureLegacyTagsExist(client, { dryRun });
      const champions = await queryChampionsWithMetadata(client);

      let championsWithLegacyIndicators = 0;
      let championsWithMappedTags = 0;
      let candidateAssignments = 0;
      let insertedAssignments = 0;
      const unmatchedLegacyTags = new Set();

      for (const champion of champions) {
        const legacyTags = champion.metadata?.tags;
        const { tagIds, missingTagNames } = collectLegacyTagIds(legacyTags, tagIdByNormalizedName);
        if (tagIds.length === 0 && missingTagNames.length === 0) {
          continue;
        }

        championsWithLegacyIndicators += 1;
        if (tagIds.length > 0) {
          championsWithMappedTags += 1;
          candidateAssignments += tagIds.length;
          if (!dryRun) {
            insertedAssignments += await insertChampionTagAssignments(client, champion.id, tagIds);
          }
        }
        for (const missingTagName of missingTagNames) {
          unmatchedLegacyTags.add(missingTagName);
        }
      }

      if (dryRun) {
        await client.query("ROLLBACK");
      } else {
        await client.query("COMMIT");
      }

      return {
        dryRun,
        championsScanned: champions.length,
        championsWithLegacyIndicators,
        championsWithMappedTags,
        missingLegacyTagNamesCreated: dryRun ? 0 : createdCount,
        missingLegacyTagNamesDetected: missingLegacyTagNames.length,
        candidateAssignments,
        insertedAssignments,
        unmatchedLegacyTags: [...unmatchedLegacyTags].sort((left, right) => left.localeCompare(right))
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

function isDirectExecution() {
  const currentFilePath = fileURLToPath(import.meta.url);
  const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
  return invokedPath === currentFilePath;
}

async function main() {
  const { dryRun } = parseCliArgs(process.argv.slice(2));
  const summary = await runLegacyTagBackfill({ dryRun });

  console.log(
    `[legacy-tags-backfill] ${summary.dryRun ? "DRY RUN" : "APPLIED"} | ` +
      `champions=${summary.championsScanned}, ` +
      `withLegacy=${summary.championsWithLegacyIndicators}, ` +
      `mapped=${summary.championsWithMappedTags}, ` +
      `candidateAssignments=${summary.candidateAssignments}, ` +
      `insertedAssignments=${summary.insertedAssignments}, ` +
      `createdMissingTags=${summary.missingLegacyTagNamesCreated}, ` +
      `detectedMissingTags=${summary.missingLegacyTagNamesDetected}`
  );

  if (summary.unmatchedLegacyTags.length > 0) {
    console.log(`[legacy-tags-backfill] Unmatched legacy tags: ${summary.unmatchedLegacyTags.join(", ")}`);
  }
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(`Legacy tag backfill failed: ${error.message}`);
    process.exit(1);
  });
}
