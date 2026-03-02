import { describe, expect, it } from "vitest";

import { down, up } from "../../server/migrations/1761900000000_user_riot_id_one_time_correction.js";

describe("user riot-id one-time correction migration", () => {
  it("adds riot_id_correction_count on users", () => {
    const calls = [];
    const pgm = {
      addColumn(table, columns) {
        calls.push({ type: "addColumn", table, columns });
      }
    };

    up(pgm);

    const usersAdd = calls.find((call) => call.type === "addColumn" && call.table === "users");
    expect(usersAdd).toBeTruthy();
    expect(usersAdd.columns.riot_id_correction_count).toEqual({
      type: "integer",
      notNull: true,
      default: 0
    });
  });

  it("drops riot_id_correction_count on down", () => {
    const calls = [];
    const pgm = {
      dropColumn(table, column) {
        calls.push({ type: "dropColumn", table, column });
      }
    };

    down(pgm);

    expect(calls).toEqual([
      { type: "dropColumn", table: "users", column: "riot_id_correction_count" }
    ]);
  });
});
