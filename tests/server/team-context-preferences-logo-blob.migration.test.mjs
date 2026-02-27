import { describe, expect, it } from "vitest";

import { down, up } from "../../server/migrations/1761500000000_team_context_preferences_and_logo_blob.js";

describe("team context preferences/logo blob migration", () => {
  it("adds logo blob columns, drops logo_url, and adds user team-context FKs", () => {
    const calls = [];
    const pgm = {
      addColumn(table, columns) {
        calls.push({ type: "addColumn", table, columns });
      },
      dropColumn(table, column) {
        calls.push({ type: "dropColumn", table, column });
      }
    };

    up(pgm);

    const teamsAdd = calls.find((call) => call.type === "addColumn" && call.table === "teams");
    expect(teamsAdd).toBeTruthy();
    expect(Object.keys(teamsAdd.columns)).toEqual(expect.arrayContaining(["logo_blob", "logo_mime_type"]));

    const teamsDrop = calls.find((call) => call.type === "dropColumn" && call.table === "teams");
    expect(teamsDrop?.column).toBe("logo_url");

    const usersAdd = calls.find((call) => call.type === "addColumn" && call.table === "users");
    expect(usersAdd).toBeTruthy();
    expect(Object.keys(usersAdd.columns)).toEqual(expect.arrayContaining(["default_team_id", "active_team_id"]));
    expect(usersAdd.columns.default_team_id.references).toBe("teams");
    expect(usersAdd.columns.default_team_id.onDelete).toBe("SET NULL");
    expect(usersAdd.columns.active_team_id.references).toBe("teams");
    expect(usersAdd.columns.active_team_id.onDelete).toBe("SET NULL");
  });

  it("restores logo_url and drops new columns on down migration", () => {
    const calls = [];
    const pgm = {
      dropColumns(table, columns) {
        calls.push({ type: "dropColumns", table, columns });
      },
      addColumn(table, columns) {
        calls.push({ type: "addColumn", table, columns });
      }
    };

    down(pgm);

    const usersDrop = calls.find((call) => call.type === "dropColumns" && call.table === "users");
    expect(usersDrop?.columns).toEqual(["default_team_id", "active_team_id"]);

    const teamsAdd = calls.find((call) => call.type === "addColumn" && call.table === "teams");
    expect(teamsAdd).toBeTruthy();
    expect(Object.keys(teamsAdd.columns)).toContain("logo_url");

    const teamsDrop = calls.find((call) => call.type === "dropColumns" && call.table === "teams");
    expect(teamsDrop?.columns).toEqual(["logo_blob", "logo_mime_type"]);
  });
});
