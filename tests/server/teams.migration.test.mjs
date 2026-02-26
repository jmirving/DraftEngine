import { describe, expect, it } from "vitest";

import { up } from "../../server/migrations/1761000000000_teams_schema.js";

describe("teams schema migration", () => {
  it("creates teams and team_members with lead/member constraint", () => {
    const createTableCalls = [];
    const createIndexCalls = [];
    const pgm = {
      createTable(...args) {
        createTableCalls.push(args);
      },
      createIndex(...args) {
        createIndexCalls.push(args);
      },
      func(name) {
        return `FUNC:${name}`;
      }
    };

    up(pgm);

    const teamsCall = createTableCalls.find((call) => call[0] === "teams");
    const membersCall = createTableCalls.find((call) => call[0] === "team_members");

    expect(teamsCall).toBeTruthy();
    expect(membersCall).toBeTruthy();
    expect(membersCall[2]?.constraints?.check).toContain("role IN ('lead', 'member')");

    const indexTargets = createIndexCalls.map((call) => `${call[0]}:${JSON.stringify(call[1])}`);
    expect(indexTargets.some((value) => value.startsWith("teams:"))).toBe(true);
    expect(indexTargets.some((value) => value.startsWith("team_members:"))).toBe(true);
  });
});
