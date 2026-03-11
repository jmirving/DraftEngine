import { describe, expect, it } from "vitest";

import { down, up } from "../../server/migrations/1762900000000_remove_legacy_metadata_tags.js";

describe("remove legacy metadata tags migration", () => {
  it("strips metadata_json.tags from champion metadata tables", () => {
    const calls = [];
    const pgm = {
      sql(statement) {
        calls.push(statement);
      }
    };

    up(pgm);

    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain("UPDATE champions");
    expect(calls[0]).toContain("metadata_json - 'tags'");
    expect(calls[1]).toContain("UPDATE user_champion_metadata");
    expect(calls[2]).toContain("UPDATE team_champion_metadata");
  });

  it("is irreversible and leaves down as a no-op", () => {
    expect(() => down({})).not.toThrow();
  });
});
