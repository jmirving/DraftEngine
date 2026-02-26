import { describe, expect, it } from "vitest";

import { up } from "../../server/migrations/1761300000000_profile_and_team_member_roles.js";

describe("profile and team role migration", () => {
  it("adds user role columns and team member team_role constraints", () => {
    const calls = [];
    const pgm = {
      addColumn(table, columns) {
        calls.push({ type: "addColumn", table, columns });
      },
      addConstraint(table, name, definition) {
        calls.push({ type: "addConstraint", table, name, definition });
      },
      createIndex(table, columns) {
        calls.push({ type: "createIndex", table, columns });
      },
      func(value) {
        return value;
      }
    };

    up(pgm);

    const userColumns = calls.find((call) => call.type === "addColumn" && call.table === "users");
    expect(userColumns).toBeTruthy();
    expect(Object.keys(userColumns.columns)).toEqual(expect.arrayContaining(["primary_role", "secondary_roles"]));

    const teamMemberColumns = calls.find((call) => call.type === "addColumn" && call.table === "team_members");
    expect(teamMemberColumns).toBeTruthy();
    expect(Object.keys(teamMemberColumns.columns)).toContain("team_role");

    const constraints = calls.filter((call) => call.type === "addConstraint").map((call) => call.name);
    expect(constraints).toEqual(
      expect.arrayContaining(["users_primary_role_check", "users_secondary_roles_check", "team_members_team_role_check"])
    );

    const teamRoleIndex = calls.find(
      (call) => call.type === "createIndex" && call.table === "team_members" && Array.isArray(call.columns)
    );
    expect(teamRoleIndex?.columns).toEqual(["team_id", "team_role"]);
  });
});
