import { describe, expect, it } from "vitest";

import { up } from "../../server/migrations/1763100000000_scoped_composition_catalog.js";

describe("scoped composition catalog migration", () => {
  it("adds scope ownership columns and scoped unique indexes for requirements and compositions", () => {
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
      sql(statement) {
        calls.push({ type: "sql", statement });
      }
    };

    up(pgm);

    const requirementColumns = calls.find(
      (call) => call.type === "addColumn" && call.table === "composition_rule_definitions"
    );
    expect(requirementColumns).toBeTruthy();
    expect(Object.keys(requirementColumns.columns)).toEqual(expect.arrayContaining(["scope", "user_id", "team_id"]));

    const compositionColumns = calls.find((call) => call.type === "addColumn" && call.table === "compositions");
    expect(compositionColumns).toBeTruthy();
    expect(Object.keys(compositionColumns.columns)).toEqual(expect.arrayContaining(["scope", "user_id", "team_id"]));

    const requirementConstraints = calls
      .filter((call) => call.type === "addConstraint" && call.table === "composition_rule_definitions")
      .map((call) => call.name);
    expect(requirementConstraints).toEqual(
      expect.arrayContaining([
        "composition_rule_definitions_scope_check",
        "composition_rule_definitions_scope_owner_check"
      ])
    );

    const compositionConstraints = calls
      .filter((call) => call.type === "addConstraint" && call.table === "compositions")
      .map((call) => call.name);
    expect(compositionConstraints).toEqual(
      expect.arrayContaining(["compositions_scope_check", "compositions_scope_owner_check"])
    );

    const sqlStatements = calls.filter((call) => call.type === "sql").map((call) => call.statement);
    expect(sqlStatements.some((statement) => statement.includes("composition_rule_definitions_scope_name_unique_idx"))).toBe(
      true
    );
    expect(sqlStatements.some((statement) => statement.includes("compositions_scope_name_unique_idx"))).toBe(true);
    expect(sqlStatements.some((statement) => statement.includes("compositions_single_global_active_idx"))).toBe(true);
    expect(sqlStatements.some((statement) => statement.includes("compositions_single_self_active_idx"))).toBe(true);
    expect(sqlStatements.some((statement) => statement.includes("compositions_single_team_active_idx"))).toBe(true);
  });
});
