import { describe, expect, it } from "vitest";

import { down, up } from "../../server/migrations/1763700000000_draft_setup_descriptions.js";

describe("draft setup descriptions migration", () => {
  it("adds description to user_draft_setups", () => {
    const calls = [];
    const pgm = {
      addColumn(table, columns) {
        calls.push({ table, columns });
      }
    };

    up(pgm);

    expect(calls).toEqual([
      {
        table: "user_draft_setups",
        columns: {
          description: {
            type: "text",
            notNull: true,
            default: ""
          }
        }
      }
    ]);
  });

  it("drops description on down migration", () => {
    const calls = [];
    const pgm = {
      dropColumns(table, columns) {
        calls.push({ table, columns });
      }
    };

    down(pgm);

    expect(calls).toEqual([
      {
        table: "user_draft_setups",
        columns: ["description"]
      }
    ]);
  });
});
