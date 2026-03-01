import { describe, expect, it } from "vitest";

import {
  buildTagIdByNormalizedName,
  collectLegacyTagIds,
  isLegacyTagEnabled,
  normalizeTagNameKey
} from "../../server/scripts/backfill-legacy-tags.js";

describe("legacy tag backfill helpers", () => {
  it("normalizes tag names for loose matching", () => {
    expect(normalizeTagNameKey("Hard Engage")).toBe("hardengage");
    expect(normalizeTagNameKey(" hard-engage ")).toBe("hardengage");
    expect(normalizeTagNameKey("FrontToBackDPS")).toBe("fronttobackdps");
  });

  it("detects enabled legacy flags from booleans and common truthy strings", () => {
    expect(isLegacyTagEnabled(true)).toBe(true);
    expect(isLegacyTagEnabled(1)).toBe(true);
    expect(isLegacyTagEnabled("1")).toBe(true);
    expect(isLegacyTagEnabled("true")).toBe(true);
    expect(isLegacyTagEnabled(false)).toBe(false);
    expect(isLegacyTagEnabled(0)).toBe(false);
    expect(isLegacyTagEnabled("0")).toBe(false);
    expect(isLegacyTagEnabled("false")).toBe(false);
  });

  it("maps normalized names to tag IDs and keeps the smallest ID on collisions", () => {
    const byName = buildTagIdByNormalizedName([
      { id: 30, name: "Hard Engage" },
      { id: 7, name: "hardengage" },
      { id: 8, name: "Frontline" }
    ]);

    expect(byName.get("hardengage")).toBe(7);
    expect(byName.get("frontline")).toBe(8);
  });

  it("collects mapped modern tag IDs from legacy metadata tags", () => {
    const { tagIds, missingTagNames } = collectLegacyTagIds(
      {
        HardEngage: true,
        Frontline: "1",
        Disengage: false
      },
      new Map([
        ["hardengage", 1],
        ["frontline", 2]
      ])
    );

    expect(tagIds).toEqual([1, 2]);
    expect(missingTagNames).toEqual([]);
  });

  it("reports missing modern mappings for enabled legacy tags", () => {
    const { tagIds, missingTagNames } = collectLegacyTagIds(
      {
        HardEngage: true,
        TurretSiege: true
      },
      new Map([["hardengage", 1]])
    );

    expect(tagIds).toEqual([1]);
    expect(missingTagNames).toEqual(["TurretSiege"]);
  });
});
