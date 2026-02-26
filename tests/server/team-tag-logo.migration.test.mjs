import { describe, expect, it } from "vitest";

import { up } from "../../server/migrations/1761400000000_team_tag_and_logo.js";

describe("team tag/logo migration", () => {
  it("adds tag and logo_url columns to teams", () => {
    const calls = [];
    const pgm = {
      addColumn(table, columns) {
        calls.push({ table, columns });
      }
    };

    up(pgm);

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("teams");
    expect(Object.keys(calls[0].columns)).toEqual(expect.arrayContaining(["tag", "logo_url"]));
  });
});
