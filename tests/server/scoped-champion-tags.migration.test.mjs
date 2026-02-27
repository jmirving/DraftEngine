import { describe, expect, it } from "vitest";

import { up } from "../../server/migrations/1761600000000_scoped_champion_tags.js";

describe("scoped champion tags migration", () => {
  it("creates user/team scoped champion tag tables and indexes", () => {
    const createTableCalls = [];
    const createIndexCalls = [];
    const pgm = {
      createTable(...args) {
        createTableCalls.push(args);
      },
      createIndex(...args) {
        createIndexCalls.push(args);
      }
    };

    up(pgm);

    const userScoped = createTableCalls.find((call) => call[0] === "user_champion_tags");
    const teamScoped = createTableCalls.find((call) => call[0] === "team_champion_tags");

    expect(userScoped).toBeTruthy();
    expect(userScoped[2]?.constraints?.primaryKey).toEqual(["user_id", "champion_id", "tag_id"]);
    expect(teamScoped).toBeTruthy();
    expect(teamScoped[2]?.constraints?.primaryKey).toEqual(["team_id", "champion_id", "tag_id"]);

    const indexTargets = createIndexCalls.map((call) => `${call[0]}:${JSON.stringify(call[1])}`);
    expect(indexTargets).toContain("user_champion_tags:[\"champion_id\",\"user_id\"]");
    expect(indexTargets).toContain("team_champion_tags:[\"champion_id\",\"team_id\"]");
  });
});
