import { describe, expect, it } from "vitest";

import { down, up } from "../../server/migrations/1762700000000_pool_familiarity_grade_scale.js";

describe("pool familiarity grade-scale migration", () => {
  it("normalizes legacy values and tightens the familiarity range", () => {
    const sqlCalls = [];
    const dropConstraintCalls = [];
    const addConstraintCalls = [];
    const pgm = {
      sql(...args) {
        sqlCalls.push(args);
      },
      dropConstraint(...args) {
        dropConstraintCalls.push(args);
      },
      addConstraint(...args) {
        addConstraintCalls.push(args);
      }
    };

    up(pgm);

    expect(sqlCalls).toEqual([
      [
        `
    UPDATE user_pool_champions
    SET familiarity = 4
    WHERE familiarity > 4
  `
      ]
    ]);
    expect(dropConstraintCalls).toEqual([["user_pool_champions", "user_pool_champions_familiarity_range"]]);
    expect(addConstraintCalls).toEqual([
      [
        "user_pool_champions",
        "user_pool_champions_familiarity_range",
        { check: "familiarity BETWEEN 1 AND 4" }
      ]
    ]);
  });

  it("restores the legacy 1-6 range on rollback", () => {
    const dropConstraintCalls = [];
    const addConstraintCalls = [];
    const pgm = {
      dropConstraint(...args) {
        dropConstraintCalls.push(args);
      },
      addConstraint(...args) {
        addConstraintCalls.push(args);
      }
    };

    down(pgm);

    expect(dropConstraintCalls).toEqual([["user_pool_champions", "user_pool_champions_familiarity_range"]]);
    expect(addConstraintCalls).toEqual([
      [
        "user_pool_champions",
        "user_pool_champions_familiarity_range",
        { check: "familiarity BETWEEN 1 AND 6" }
      ]
    ]);
  });
});
