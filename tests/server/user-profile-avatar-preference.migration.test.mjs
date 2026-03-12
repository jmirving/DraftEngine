import { describe, expect, it } from "vitest";

import { down, up } from "../../server/migrations/1763200000000_user_profile_avatar_preference.js";

describe("user profile avatar preference migration", () => {
  it("adds avatar_champion_id to users with a champion FK", () => {
    const calls = [];
    const pgm = {
      addColumn(table, columns) {
        calls.push({ table, columns });
      }
    };

    up(pgm);

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("users");
    expect(calls[0].columns.avatar_champion_id.references).toBe("champions");
    expect(calls[0].columns.avatar_champion_id.onDelete).toBe("SET NULL");
  });

  it("drops avatar_champion_id on down migration", () => {
    const calls = [];
    const pgm = {
      dropColumns(table, columns) {
        calls.push({ table, columns });
      }
    };

    down(pgm);

    expect(calls).toEqual([
      {
        table: "users",
        columns: ["avatar_champion_id"]
      }
    ]);
  });
});
