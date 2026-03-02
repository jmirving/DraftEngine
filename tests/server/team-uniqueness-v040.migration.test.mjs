import { describe, expect, it } from "vitest";

import { down, up } from "../../server/migrations/1762000000000_v040_team_uniqueness.js";

describe("v0.4.0 team uniqueness migration", () => {
  it("adds case-insensitive unique indexes for team name and tag", () => {
    const sqlCalls = [];
    const pgm = {
      sql(statement) {
        sqlCalls.push(statement);
      }
    };

    up(pgm);

    expect(sqlCalls).toHaveLength(6);
    expect(sqlCalls.some((statement) => statement.includes("teams_name_lower_unique_idx"))).toBe(true);
    expect(sqlCalls.some((statement) => statement.includes("teams_tag_lower_unique_idx"))).toBe(true);
    expect(sqlCalls.some((statement) => statement.includes("lower(name)"))).toBe(true);
    expect(sqlCalls.some((statement) => statement.includes("lower(tag)"))).toBe(true);
    expect(sqlCalls.some((statement) => statement.includes("trim(name)"))).toBe(true);
    expect(sqlCalls.some((statement) => statement.includes("trim(tag)"))).toBe(true);
  });

  it("drops the unique indexes on down migration", () => {
    const sqlCalls = [];
    const pgm = {
      sql(statement) {
        sqlCalls.push(statement);
      }
    };

    down(pgm);

    expect(sqlCalls).toEqual([
      "DROP INDEX IF EXISTS teams_tag_lower_unique_idx",
      "DROP INDEX IF EXISTS teams_name_lower_unique_idx"
    ]);
  });
});
