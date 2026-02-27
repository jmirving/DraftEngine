import { describe, expect, it } from "vitest";

import { up } from "../../server/migrations/1761700000000_scoped_checks_and_promotions.js";

describe("scoped checks and promotions migration", () => {
  it("creates scoped check settings and promotion request tables", () => {
    const calls = [];
    const pgm = {
      addColumn(table, columns) {
        calls.push({ type: "addColumn", table, columns });
      },
      addConstraint(table, name, definition) {
        calls.push({ type: "addConstraint", table, name, definition });
      },
      createTable(table, columns) {
        calls.push({ type: "createTable", table, columns });
      },
      createIndex(table, columns) {
        calls.push({ type: "createIndex", table, columns });
      },
      func(value) {
        return value;
      }
    };

    up(pgm);

    const usersRoleColumn = calls.find((call) => call.type === "addColumn" && call.table === "users");
    expect(usersRoleColumn).toBeTruthy();
    expect(Object.keys(usersRoleColumn.columns)).toContain("role");

    const checkTables = calls
      .filter((call) => call.type === "createTable")
      .map((call) => call.table);
    expect(checkTables).toEqual(
      expect.arrayContaining([
        "global_required_check_settings",
        "user_required_check_settings",
        "team_required_check_settings",
        "scope_promotion_requests"
      ])
    );

    const promotionConstraints = calls
      .filter((call) => call.type === "addConstraint" && call.table === "scope_promotion_requests")
      .map((call) => call.name);
    expect(promotionConstraints).toEqual(
      expect.arrayContaining([
        "scope_promotion_requests_entity_type_check",
        "scope_promotion_requests_source_scope_check",
        "scope_promotion_requests_target_scope_check",
        "scope_promotion_requests_status_check"
      ])
    );

    const promotionIndexes = calls
      .filter((call) => call.type === "createIndex" && call.table === "scope_promotion_requests")
      .map((call) => JSON.stringify(call.columns));
    expect(promotionIndexes).toEqual(
      expect.arrayContaining([JSON.stringify(["requested_by", "created_at"]), JSON.stringify(["entity_type", "status"])])
    );
  });
});
