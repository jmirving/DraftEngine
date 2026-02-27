import { describe, expect, it } from "vitest";

import { up } from "../../server/migrations/1761700000000_team_join_requests.js";

describe("team join request migration", () => {
  it("creates request table with status and lane constraints", () => {
    const calls = [];
    const pgm = {
      createTable(name, columns) {
        calls.push({ type: "createTable", name, columns });
      },
      addConstraint(table, name, definition) {
        calls.push({ type: "addConstraint", table, name, definition });
      },
      createIndex(table, columns, options = {}) {
        calls.push({ type: "createIndex", table, columns, options });
      },
      func(name) {
        return `FUNC:${name}`;
      }
    };

    up(pgm);

    const tableCall = calls.find((call) => call.type === "createTable" && call.name === "team_join_requests");
    expect(tableCall).toBeTruthy();
    expect(Object.keys(tableCall.columns)).toEqual(
      expect.arrayContaining(["team_id", "requester_user_id", "requested_lane", "status", "reviewed_by_user_id"])
    );

    const constraintNames = calls.filter((call) => call.type === "addConstraint").map((call) => call.name);
    expect(constraintNames).toEqual(
      expect.arrayContaining(["team_join_requests_status_check", "team_join_requests_lane_check"])
    );

    const pendingUniqueIndex = calls.find(
      (call) =>
        call.type === "createIndex" &&
        call.table === "team_join_requests" &&
        call.options?.unique === true &&
        call.options?.where === "status = 'pending'"
    );
    expect(pendingUniqueIndex).toBeTruthy();
  });
});
