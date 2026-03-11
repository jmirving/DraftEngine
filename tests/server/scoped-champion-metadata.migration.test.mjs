import { describe, expect, it } from "vitest";

import { up } from "../../server/migrations/1762800000000_scoped_champion_metadata.js";

describe("scoped champion metadata migration", () => {
  it("creates user/team scoped champion metadata tables and indexes", () => {
    const createTableCalls = [];
    const createIndexCalls = [];
    const pgm = {
      createTable(...args) {
        createTableCalls.push(args);
      },
      createIndex(...args) {
        createIndexCalls.push(args);
      },
      func(value) {
        return value;
      }
    };

    up(pgm);

    const userScoped = createTableCalls.find((call) => call[0] === "user_champion_metadata");
    const teamScoped = createTableCalls.find((call) => call[0] === "team_champion_metadata");

    expect(userScoped).toBeTruthy();
    expect(userScoped[2]?.constraints?.primaryKey).toEqual(["user_id", "champion_id"]);
    expect(teamScoped).toBeTruthy();
    expect(teamScoped[2]?.constraints?.primaryKey).toEqual(["team_id", "champion_id"]);

    const indexTargets = createIndexCalls.map((call) => `${call[0]}:${JSON.stringify(call[1])}`);
    expect(indexTargets).toContain("user_champion_metadata:[\"champion_id\",\"user_id\"]");
    expect(indexTargets).toContain("team_champion_metadata:[\"champion_id\",\"team_id\"]");
  });
});
