import { describe, expect, test } from "vitest";

import { evaluateCompositionRequirements } from "../src/engine/requirements.js";
import { buildRequirementScoreBreakdown } from "../src/engine/scoring.js";

describe("buildRequirementScoreBreakdown", () => {
  const championsByName = {
    Alpha: {
      name: "Alpha",
      tagIds: [1],
      roles: ["Top"],
      roleProfiles: {
        Top: {
          primaryDamageType: "ad",
          effectiveness: {
            early: "strong",
            mid: "neutral",
            late: "weak"
          }
        }
      }
    },
    Beta: {
      name: "Beta",
      tagIds: [2],
      roles: ["Mid"],
      roleProfiles: {
        Mid: {
          primaryDamageType: "ap",
          effectiveness: {
            early: "weak",
            mid: "strong",
            late: "neutral"
          }
        }
      }
    }
  };

  const tagById = {
    "1": { id: 1, name: "Frontline" },
    "2": { id: 2, name: "Follow Up" }
  };

  test("uses only the best active OR branch for requirement totals", () => {
    const evaluation = evaluateCompositionRequirements({
      teamState: {
        Top: null,
        Jungle: null,
        Mid: "Beta",
        ADC: null,
        Support: null
      },
      championsByName,
      tagById,
      requirements: [
        {
          id: 12,
          name: "Top frontline or mid follow-up",
          rules: [
            {
              id: "top-frontline",
              expr: { tag: "Frontline" },
              minCount: 1,
              roleFilter: ["Top"]
            },
            {
              id: "mid-follow-up",
              clauseJoiner: "or",
              expr: { tag: "Follow Up" },
              minCount: 1,
              roleFilter: ["Mid"]
            }
          ]
        }
      ]
    });

    const breakdown = buildRequirementScoreBreakdown(evaluation, 1);
    expect(breakdown.totalUnderBy).toBe(0);
    expect(breakdown.totalOverBy).toBe(0);
    expect(breakdown.totalScore).toBe(0);
    expect(breakdown.requirements[0].clauses).toMatchObject([
      {
        id: "top-frontline",
        countsTowardAggregate: false,
        effectiveUnderBy: 0
      },
      {
        id: "mid-follow-up",
        countsTowardAggregate: true,
        effectiveUnderBy: 0
      }
    ]);
  });
});
