import { describe, expect, it } from "vitest";

import { up } from "../../server/migrations/1762400000000_tag_definitions_and_role_profiles.js";

describe("tag definition + role profile migration", () => {
  it("replaces tag category with definition", () => {
    const calls = [];
    const pgm = {
      addColumn(table, columns) {
        calls.push({ type: "addColumn", table, columns });
      },
      dropColumn(table, column) {
        calls.push({ type: "dropColumn", table, column });
      },
      sql(statement) {
        calls.push({ type: "sql", statement });
      }
    };

    up(pgm);

    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "addColumn",
          table: "tags"
        }),
        expect.objectContaining({
          type: "dropColumn",
          table: "tags",
          column: "category"
        })
      ])
    );

    const sqlCall = calls.find((call) => call.type === "sql");
    expect(sqlCall?.statement).toContain("UPDATE tags");
    expect(sqlCall?.statement).toContain("definition");
  });
});
