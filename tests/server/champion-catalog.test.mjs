import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseChampionsCsv } from "../../src/data/loaders.js";

describe("full champion catalog artifact", () => {
  it("matches manifest checksum/count and includes required metadata", () => {
    const manifestPath = resolve("docs/champion-catalog/manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

    const csvPath = resolve(manifest.outputPath);
    const csvText = readFileSync(csvPath, "utf8");
    const digest = crypto.createHash("sha256").update(csvText).digest("hex");

    expect(digest).toBe(manifest.sha256);

    const parsed = parseChampionsCsv(csvText);
    expect(parsed.champions.length).toBe(manifest.expectedChampionCount);

    for (const champion of parsed.champions) {
      expect(champion.roles.length).toBeGreaterThan(0);
      expect(["AD", "AP", "Mixed"]).toContain(champion.damageType);
      expect(["Early", "Mid", "Late"]).toContain(champion.scaling);
      for (const tagName of manifest.requiredMetadata.booleanTags) {
        expect(typeof champion.tags[tagName]).toBe("boolean");
      }
    }
  });

  it("keeps the visible public champion dataset aligned with the full catalog", () => {
    const manifestPath = resolve("docs/champion-catalog/manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

    const fullCatalog = parseChampionsCsv(readFileSync(resolve(manifest.outputPath), "utf8"));
    const publicCatalog = parseChampionsCsv(readFileSync(resolve("public/data/champions.csv"), "utf8"));

    expect(publicCatalog.champions.length).toBe(manifest.expectedChampionCount);
    expect(publicCatalog.champions.map((champion) => champion.name)).toEqual(
      fullCatalog.champions.map((champion) => champion.name)
    );
  });
});
