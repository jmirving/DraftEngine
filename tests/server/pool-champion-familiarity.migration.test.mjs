import { describe, expect, it } from "vitest";

import { down, up } from "../../server/migrations/1761700000000_pool_champion_familiarity.js";

describe("pool champion familiarity migration", () => {
  it("adds familiarity column and range constraint", () => {
    const addColumnCalls = [];
    const addConstraintCalls = [];
    const pgm = {
      addColumn(...args) {
        addColumnCalls.push(args);
      },
      addConstraint(...args) {
        addConstraintCalls.push(args);
      }
    };

    up(pgm);

    expect(addColumnCalls).toEqual([
      [
        "user_pool_champions",
        {
          familiarity: {
            type: "smallint",
            notNull: true,
            default: 3
          }
        }
      ]
    ]);
    expect(addConstraintCalls).toEqual([
      [
        "user_pool_champions",
        "user_pool_champions_familiarity_range",
        { check: "familiarity BETWEEN 1 AND 6" }
      ]
    ]);
  });

  it("removes familiarity constraint and column on rollback", () => {
    const dropConstraintCalls = [];
    const dropColumnCalls = [];
    const pgm = {
      dropConstraint(...args) {
        dropConstraintCalls.push(args);
      },
      dropColumn(...args) {
        dropColumnCalls.push(args);
      }
    };

    down(pgm);

    expect(dropConstraintCalls).toEqual([["user_pool_champions", "user_pool_champions_familiarity_range"]]);
    expect(dropColumnCalls).toEqual([["user_pool_champions", "familiarity"]]);
  });
});
