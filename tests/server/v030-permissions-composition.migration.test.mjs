import { describe, expect, it } from "vitest";

import { up } from "../../server/migrations/1761800000000_v030_permissions_and_composition_requirements.js";

describe("v0.3.0 permissions and composition requirements migration", () => {
  it("extends user roles and creates composition requirements table", () => {
    const calls = [];
    const pgm = {
      dropConstraint(table, name) {
        calls.push({ type: "dropConstraint", table, name });
      },
      addConstraint(table, name, definition) {
        calls.push({ type: "addConstraint", table, name, definition });
      },
      sql(statement) {
        calls.push({ type: "sql", statement });
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

    const usersRoleConstraint = calls.find(
      (call) => call.type === "addConstraint" && call.table === "users" && call.name === "users_role_check"
    );
    expect(usersRoleConstraint).toBeTruthy();
    expect(usersRoleConstraint.definition.check).toContain("'global'");

    const compositionTable = calls.find(
      (call) => call.type === "createTable" && call.table === "composition_requirements"
    );
    expect(compositionTable).toBeTruthy();
    expect(Object.keys(compositionTable.columns)).toEqual(
      expect.arrayContaining(["name", "toggles_json", "is_active", "created_by_user_id", "updated_by_user_id"])
    );

    const uniqueActiveIndex = calls.find(
      (call) =>
        call.type === "sql" &&
        typeof call.statement === "string" &&
        call.statement.includes("composition_requirements_single_active_idx")
    );
    expect(uniqueActiveIndex).toBeTruthy();
  });
});
