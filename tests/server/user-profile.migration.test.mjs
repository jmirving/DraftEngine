import { describe, expect, it } from "vitest";

import { up } from "../../server/migrations/1761200000000_user_profile_fields.js";

describe("user profile migration", () => {
  it("adds game_name and tagline columns to users", () => {
    const calls = [];
    const pgm = {
      addColumn(table, columns) {
        calls.push({ table, columns });
      }
    };

    up(pgm);

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("users");
    expect(Object.keys(calls[0].columns)).toEqual(expect.arrayContaining(["game_name", "tagline"]));
  });
});
