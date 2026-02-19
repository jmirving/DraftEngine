import { expect, test } from "vitest";

import {
  getActiveNextRole,
  getTeamCompletionInfo,
  normalizeNoFilterMultiSelection,
  resolveTagMutualExclusion,
  teamStateKey,
  validateSlotSelection
} from "../../public/app/workflow-utils.js";

test("normalizeNoFilterMultiSelection clears sentinel when other values exist", () => {
  expect(normalizeNoFilterMultiSelection(["__NO_FILTER__", "Top"])).toEqual(["Top"]);
  expect(normalizeNoFilterMultiSelection(["__NO_FILTER__"])).toEqual([]);
});

test("getTeamCompletionInfo reports empty/partial/full states", () => {
  expect(getTeamCompletionInfo({ Top: null, Jungle: null, Mid: null, ADC: null, Support: null }).completionState).toBe("empty");
  expect(getTeamCompletionInfo({ Top: "Aatrox", Jungle: null, Mid: null, ADC: null, Support: null }).completionState).toBe("partial");
  expect(getTeamCompletionInfo({ Top: "A", Jungle: "B", Mid: "C", ADC: "D", Support: "E" }).completionState).toBe("full");
});

test("getActiveNextRole returns first unfilled role in draft order", () => {
  const draftOrder = ["Support", "Top", "ADC", "Jungle", "Mid"];
  const teamState = { Top: null, Jungle: "Hecarim", Mid: "Azir", ADC: null, Support: "Nami" };
  expect(getActiveNextRole(draftOrder, teamState)).toBe("Top");
});

test("teamStateKey produces stable slot serialization", () => {
  expect(teamStateKey({ Top: "Aatrox", Jungle: null, Mid: "Azir", ADC: null, Support: "Nami" })).toBe("Aatrox|-|Azir|-|Nami");
});

test("resolveTagMutualExclusion removes overlap from opposite side", () => {
  expect(
    resolveTagMutualExclusion("include", ["HardEngage", "Frontline"], ["Frontline", "Disengage"])
  ).toEqual({
    includeValues: ["HardEngage", "Frontline"],
    excludeValues: ["Disengage"]
  });

  expect(
    resolveTagMutualExclusion("exclude", ["HardEngage", "Frontline"], ["Frontline", "Disengage"])
  ).toEqual({
    includeValues: ["HardEngage"],
    excludeValues: ["Frontline", "Disengage"]
  });
});

test("validateSlotSelection enforces pool, exclusion, duplicate, and clear behaviors", () => {
  const teamState = { Top: "Pantheon", Jungle: null, Mid: null, ADC: null, Support: null };
  const pools = {
    Top: ["Pantheon", "Aatrox"],
    Jungle: ["Pantheon", "Zac"],
    Mid: ["Azir"],
    ADC: ["Ashe"],
    Support: ["Nami"]
  };

  expect(
    validateSlotSelection({
      slot: "Jungle",
      championName: "Aatrox",
      teamState,
      excludedChampions: [],
      pools
    }).ok
  ).toBe(false);

  expect(
    validateSlotSelection({
      slot: "Jungle",
      championName: "Zac",
      teamState,
      excludedChampions: ["Zac"],
      pools
    }).message
  ).toContain("excluded");

  expect(
    validateSlotSelection({
      slot: "Jungle",
      championName: "Pantheon",
      teamState,
      excludedChampions: [],
      pools
    }).message
  ).toContain("already selected");

  expect(
    validateSlotSelection({
      slot: "Jungle",
      championName: "Zac",
      teamState,
      excludedChampions: [],
      pools
    })
  ).toMatchObject({ ok: true, nextChampionName: "Zac" });

  expect(
    validateSlotSelection({
      slot: "Jungle",
      championName: null,
      teamState,
      excludedChampions: [],
      pools
    })
  ).toMatchObject({ ok: true, nextChampionName: null });
});
