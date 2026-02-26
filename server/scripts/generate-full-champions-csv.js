import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BOOLEAN_TAGS } from "../../src/domain/model.js";

const DEFAULT_OUT_PATH = "docs/champion-catalog/champions.full.csv";
const DEFAULT_MANIFEST_PATH = "docs/champion-catalog/manifest.json";

function parseFlag(argv, flag, fallback) {
  const index = argv.findIndex((item) => item === flag);
  if (index >= 0 && argv[index + 1]) {
    return argv[index + 1];
  }
  return fallback;
}

function resolveRepoPath(value) {
  if (path.isAbsolute(value)) {
    return value;
  }
  const scriptPath = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(scriptPath), "..", "..");
  return path.resolve(repoRoot, value);
}

function quoteCsv(value) {
  const raw = String(value ?? "");
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function normalizeRoles(tags) {
  const roles = new Set();

  if (tags.includes("Marksman")) {
    roles.add("ADC");
  }
  if (tags.includes("Support")) {
    roles.add("Support");
  }
  if (tags.includes("Tank")) {
    roles.add("Top");
    roles.add("Support");
  }
  if (tags.includes("Fighter")) {
    roles.add("Top");
    roles.add("Jungle");
  }
  if (tags.includes("Assassin")) {
    roles.add("Mid");
    roles.add("Jungle");
  }
  if (tags.includes("Mage")) {
    roles.add("Mid");
    roles.add("Support");
  }

  if (roles.size === 0) {
    roles.add("Mid");
  }

  return [...roles];
}

function normalizeDamageType(tags) {
  const hasMagic = tags.includes("Mage") || tags.includes("Support");
  const hasPhysical = tags.includes("Marksman") || tags.includes("Fighter") || tags.includes("Assassin") || tags.includes("Tank");

  if (hasMagic && hasPhysical) {
    return "Mixed";
  }
  if (hasMagic) {
    return "AP";
  }
  return "AD";
}

function normalizeScaling(tags) {
  if (tags.includes("Marksman") || tags.includes("Mage")) {
    return "Late";
  }
  if (tags.includes("Assassin")) {
    return "Early";
  }
  return "Mid";
}

function buildBooleanTags(tags, roles) {
  const set = new Set(tags);
  const roleSet = new Set(roles);

  const normalized = {
    HardEngage: set.has("Tank") || set.has("Fighter") || set.has("Assassin"),
    FollowUpEngage: set.has("Fighter") || set.has("Assassin") || set.has("Support"),
    PickThreat: set.has("Assassin") || set.has("Mage") || set.has("Support"),
    Frontline: set.has("Tank") || set.has("Fighter"),
    Disengage: set.has("Support") || set.has("Mage") || set.has("Tank"),
    Waveclear: set.has("Mage") || set.has("Marksman"),
    ZoneControl: set.has("Mage") || set.has("Support") || set.has("Tank"),
    ObjectiveSecure: set.has("Marksman") || set.has("Fighter") || set.has("Mage"),
    AntiTank: set.has("Marksman") || set.has("Fighter") || set.has("Mage"),
    FrontToBackDPS: set.has("Marksman") || set.has("Fighter") || set.has("Mage"),
    DiveThreat: set.has("Assassin") || set.has("Fighter"),
    SideLaneThreat: roleSet.has("Top") && (set.has("Fighter") || set.has("Assassin") || set.has("Marksman")),
    Poke: set.has("Mage") || set.has("Marksman"),
    FogThreat: set.has("Assassin") || set.has("Mage"),
    EarlyPriority: set.has("Assassin") || set.has("Fighter"),
    PrimaryCarry: set.has("Marksman") || set.has("Mage") || set.has("Assassin"),
    SustainedDPS: set.has("Marksman") || set.has("Fighter"),
    TurretSiege: set.has("Marksman") || set.has("Mage"),
    SelfPeel: set.has("Support") || set.has("Tank") || set.has("Marksman"),
    UtilityCarry: set.has("Support") || set.has("Mage")
  };

  return normalized;
}

function buildRow(name, championMeta) {
  const tags = Array.isArray(championMeta.tags) ? championMeta.tags : [];
  const roles = normalizeRoles(tags);
  const damageType = normalizeDamageType(tags);
  const scaling = normalizeScaling(tags);
  const boolTags = buildBooleanTags(tags, roles);

  const row = {
    Champion: name,
    Roles: roles.join("|"),
    DamageType: damageType,
    Scaling: scaling
  };

  for (const tag of BOOLEAN_TAGS) {
    row[tag] = boolTags[tag] ? "1" : "0";
  }

  return row;
}

function buildCsv(rows) {
  const headers = ["Champion", "Roles", "DamageType", "Scaling", ...BOOLEAN_TAGS];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map((header) => quoteCsv(row[header] ?? ""));
    lines.push(values.join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function fetchLatestVersion() {
  const response = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
  if (!response.ok) {
    throw new Error(`Failed to load Data Dragon versions (${response.status}).`);
  }
  const versions = await response.json();
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error("Data Dragon versions endpoint returned no versions.");
  }
  return versions[0];
}

async function fetchChampionSummary(version) {
  const response = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`);
  if (!response.ok) {
    throw new Error(`Failed to load champion summary for ${version} (${response.status}).`);
  }

  const payload = await response.json();
  if (!payload || typeof payload !== "object" || !payload.data || typeof payload.data !== "object") {
    throw new Error("Invalid champion summary payload.");
  }

  return payload.data;
}

async function run() {
  const argv = process.argv.slice(2);
  const forcedVersion = parseFlag(argv, "--version", "").trim();
  const version = forcedVersion || (await fetchLatestVersion());
  const outputPath = resolveRepoPath(parseFlag(argv, "--out", DEFAULT_OUT_PATH));
  const manifestPath = resolveRepoPath(parseFlag(argv, "--manifest", DEFAULT_MANIFEST_PATH));

  const championsData = await fetchChampionSummary(version);
  const rows = Object.entries(championsData)
    .map(([, meta]) => buildRow(meta.name, meta))
    .sort((left, right) => left.Champion.localeCompare(right.Champion));

  const csv = buildCsv(rows);
  const sha256 = crypto.createHash("sha256").update(csv).digest("hex");

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, csv, "utf8");

  const sourceUrl = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`;
  const manifest = {
    sourceIdentifier: `riot-ddragon:${version}:en_US:champion.json`,
    sourceUrl,
    generatedAt: new Date().toISOString(),
    expectedChampionCount: rows.length,
    sha256,
    requiredMetadata: {
      roles: true,
      damageType: true,
      scaling: true,
      booleanTags: [...BOOLEAN_TAGS]
    },
    outputPath: path.relative(process.cwd(), outputPath)
  };

  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log(`Generated ${rows.length} champions using ${sourceUrl}`);
  console.log(`CSV: ${path.relative(process.cwd(), outputPath)}`);
  console.log(`Manifest: ${path.relative(process.cwd(), manifestPath)}`);
  console.log(`SHA256: ${sha256}`);
}

run().catch((error) => {
  console.error(`Failed to generate full catalog: ${error.message}`);
  process.exit(1);
});
