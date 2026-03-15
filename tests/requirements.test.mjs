import { describe, expect, test } from "vitest";

import { evaluateCompositionRequirements } from "../src/engine/requirements.js";
import { generatePossibilityTree } from "../src/engine/tree.js";

describe("evaluateCompositionRequirements", () => {
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
    },
    Gamma: {
      name: "Gamma",
      tagIds: [],
      roles: ["Jungle"],
      roleProfiles: {
        Jungle: {
          primaryDamageType: "mixed",
          effectiveness: {
            early: "neutral",
            mid: "neutral",
            late: "neutral"
          }
        }
      }
    }
  };

  const tagById = {
    "1": { id: 1, name: "Frontline", definition: "Can initiate and absorb pressure." },
    "2": { id: 2, name: "Follow Up", definition: "Can capitalize after engage starts." }
  };

  test("evaluates mixed condition kinds and clause joiners", () => {
    const result = evaluateCompositionRequirements({
      teamState: {
        Top: "Alpha",
        Jungle: null,
        Mid: "Beta",
        ADC: null,
        Support: null
      },
      championsByName,
      tagById,
      requirements: [
        {
          id: 11,
          name: "Top frontline AD",
          definition: "",
          rules: [
            {
              id: "c-1",
              expr: {
                and: [{ tag: "Frontline" }, { damageType: "ad" }]
              },
              minCount: 1,
              roleFilter: ["Top"]
            }
          ]
        },
        {
          id: 12,
          name: "Mid focus or follow-up",
          definition: "",
          rules: [
            {
              id: "c-1",
              expr: { effectivenessFocus: "mid" },
              minCount: 1,
              roleFilter: ["Mid"]
            },
            {
              id: "c-2",
              clauseJoiner: "or",
              expr: { tag: "Follow Up" },
              minCount: 1,
              roleFilter: ["Mid"]
            }
          ]
        }
      ]
    });

    expect(result.requiredSummary).toEqual({
      requiredTotal: 2,
      requiredPassed: 2,
      requiredGaps: 0
    });
    expect(result.unreachableRequirements).toEqual([]);
    expect(result.requirements.map((entry) => entry.status)).toEqual(["pass", "pass"]);
  });

  test("marks requirement unreachable when clause separation cannot be satisfied", () => {
    const result = evaluateCompositionRequirements({
      teamState: {
        Top: null,
        Jungle: null,
        Mid: null,
        ADC: null,
        Support: null
      },
      championsByName,
      tagById,
      teamId: "team-a",
      teamPools: {
        "team-a": {
          Top: ["Alpha"],
          Jungle: [],
          Mid: [],
          ADC: [],
          Support: []
        }
      },
      requirements: [
        {
          id: 20,
          name: "Separated clauses",
          rules: [
            {
              id: "frontline",
              expr: { tag: "Frontline" },
              minCount: 1,
              roleFilter: ["Top"],
              separateFrom: ["followup"]
            },
            {
              id: "followup",
              clauseJoiner: "and",
              expr: { tag: "Frontline" },
              minCount: 1,
              roleFilter: ["Top"]
            }
          ]
        }
      ]
    });

    expect(result.requiredSummary.requiredGaps).toBe(1);
    expect(result.unreachableRequirements).toEqual(["Separated clauses"]);
    expect(result.requirements[0].status).toBe("fail");
    expect(result.requirements[0].clauses[0].failType).toBe("separation_unreachable");
  });

  test("treats max overflow as redundancy instead of hard failure", () => {
    const result = evaluateCompositionRequirements({
      teamState: {
        Top: "Alpha",
        Jungle: "Gamma",
        Mid: "Beta",
        ADC: null,
        Support: null
      },
      championsByName,
      tagById,
      requirements: [
        {
          id: 25,
          name: "Single frontline source preferred",
          rules: [
            {
              id: "frontline-cap",
              expr: { or: [{ tag: "Frontline" }, { tag: "Follow Up" }] },
              minCount: 1,
              maxCount: 1,
              roleFilter: ["Top", "Mid"]
            }
          ]
        }
      ]
    });

    expect(result.requiredSummary).toEqual({
      requiredTotal: 1,
      requiredPassed: 1,
      requiredGaps: 0
    });
    expect(result.unreachableRequirements).toEqual([]);
    expect(result.requirements[0].status).toBe("pass");
    expect(result.requirements[0].clauses[0]).toMatchObject({
      currentMatches: 2,
      minCount: 1,
      maxCount: 1,
      overBy: 1,
      underBy: 0,
      inRange: false,
      canStillReachMin: true
    });
  });

  test("drives tree expansion in requirement mode from requirement gaps", () => {
    const tree = generatePossibilityTree({
      teamState: {
        Top: null,
        Jungle: null,
        Mid: null,
        ADC: null,
        Support: null
      },
      teamId: "team-a",
      nextRole: "Top",
      roleOrder: ["Top", "Jungle", "Mid", "ADC", "Support"],
      teamPools: {
        "team-a": {
          Top: ["Alpha"],
          Jungle: [],
          Mid: [],
          ADC: [],
          Support: []
        }
      },
      championsByName,
      requirements: [
        {
          id: 30,
          name: "Need frontline",
          rules: [
            {
              id: "frontline",
              expr: { tag: "Frontline" },
              minCount: 1,
              roleFilter: ["Top"]
            }
          ]
        }
      ],
      tagById,
      maxDepth: 1,
      maxBranch: 3,
      minCandidateScore: 0
    });

    expect(tree.children.length).toBe(1);
    expect(tree.children[0].addedRole).toBe("Top");
    expect(tree.children[0].addedChampion).toBe("Alpha");
    expect(tree.requiredSummary.requiredGaps).toBe(1);
    expect(tree.children[0].requiredSummary.requiredGaps).toBe(0);
  });

  test("empty team generation starts from first role in pick order", () => {
    const tree = generatePossibilityTree({
      teamState: {
        Top: null,
        Jungle: null,
        Mid: null,
        ADC: null,
        Support: null
      },
      teamId: "team-a",
      roleOrder: ["Jungle", "Top", "Mid", "ADC", "Support"],
      teamPools: {
        "team-a": {
          Top: ["Alpha"],
          Jungle: ["Beta", "Gamma"],
          Mid: [],
          ADC: [],
          Support: []
        }
      },
      championsByName,
      requirements: [],
      tagById,
      maxDepth: 1,
      maxBranch: 10,
      minCandidateScore: 0
    });

    expect(tree.children.length).toBe(2);
    expect(new Set(tree.children.map((child) => child.addedRole))).toEqual(new Set(["Jungle"]));
    expect(new Set(tree.children.map((child) => child.addedChampion))).toEqual(new Set(["Beta", "Gamma"]));
  });

  test("champion composition synergies evaluate against the surrounding team instead of the champion itself", () => {
    const championsWithSynergy = {
      ...championsByName,
      Beta: {
        ...championsByName.Beta,
        compositionSynergies: {
          definition: "Needs frontline or engage around the pick.",
          rules: [
            {
              id: "frontline-support",
              expr: { tag: "Frontline" },
              minCount: 1,
              roleFilter: ["Top", "Jungle", "Support"]
            }
          ]
        }
      }
    };

    const failResult = evaluateCompositionRequirements({
      teamState: {
        Top: null,
        Jungle: null,
        Mid: "Beta",
        ADC: null,
        Support: null
      },
      championsByName: championsWithSynergy,
      tagById,
      requirements: []
    });

    expect(failResult.requirements).toHaveLength(1);
    expect(failResult.requirements[0].name).toContain("Beta");
    expect(failResult.requirements[0].status).toBe("pending");

    const passResult = evaluateCompositionRequirements({
      teamState: {
        Top: "Alpha",
        Jungle: null,
        Mid: "Beta",
        ADC: null,
        Support: null
      },
      championsByName: championsWithSynergy,
      tagById,
      requirements: []
    });

    expect(passResult.requirements).toHaveLength(1);
    expect(passResult.requirements[0].status).toBe("pass");
    expect(passResult.requirements[0].clauses[0].currentMatchSlots).toEqual(["Top"]);
  });

  test("tree scoring accounts for picked champion composition synergies", () => {
    const championsWithSynergy = {
      ...championsByName,
      Beta: {
        ...championsByName.Beta,
        compositionSynergies: {
          definition: "Needs frontline beside the pick.",
          rules: [
            {
              id: "frontline-top",
              expr: { tag: "Frontline" },
              minCount: 1,
              roleFilter: ["Top"]
            }
          ]
        }
      }
    };

    const tree = generatePossibilityTree({
      teamState: {
        Top: null,
        Jungle: null,
        Mid: "Beta",
        ADC: null,
        Support: null
      },
      teamId: "team-a",
      nextRole: "Top",
      roleOrder: ["Top", "Jungle", "ADC", "Support"],
      teamPools: {
        "team-a": {
          Top: ["Alpha"],
          Jungle: [],
          Mid: ["Beta"],
          ADC: [],
          Support: []
        }
      },
      championsByName: championsWithSynergy,
      requirements: [],
      tagById,
      maxDepth: 1,
      maxBranch: 3,
      minCandidateScore: 0
    });

    expect(tree.requiredSummary.requiredGaps).toBe(1);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].addedChampion).toBe("Alpha");
    expect(tree.children[0].requiredSummary.requiredGaps).toBe(0);
  });
});
