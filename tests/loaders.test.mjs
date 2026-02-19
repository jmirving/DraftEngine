import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DataValidationError, buildDraftflowData, parseChampionsCsv, parseConfigJson, parseTeamPoolsCsv } from "../src/data/loaders.js";
import { BOOLEAN_TAGS } from "../src/domain/model.js";

const championsCsv = readFileSync(resolve("docs/DraftFlow_champions.csv"), "utf8");
const teamPoolsCsv = readFileSync(resolve("docs/DraftFlow_team_pools.csv"), "utf8");
const configJson = readFileSync(resolve("docs/DraftFlow_config.json"), "utf8");

test("parseChampionsCsv parses champions and tag fields", () => {
  const parsed = parseChampionsCsv(championsCsv);
  expect(parsed.champions.length).toBeGreaterThan(0);
  expect(parsed.championsByName.Ashe).toBeTruthy();
  expect(parsed.championsByName.Ashe.tags.HardEngage).toBe(true);
  expect(parsed.championsByName.Ashe.damageType).toBe("AD");
});

test("parseTeamPoolsCsv builds role pools by team", () => {
  const parsed = parseTeamPoolsCsv(teamPoolsCsv);
  expect(parsed.poolsByTeam.TTT).toBeTruthy();
  expect(parsed.poolsByTeam.TTT.Top.includes("Aatrox")).toBe(true);
  expect(parsed.poolsByTeam.TTT.ADC.includes("Ashe")).toBe(true);
});

test("parseConfigJson applies defaults and overrides", () => {
  const parsed = parseConfigJson(configJson);
  expect(parsed.teamDefault).toBe("TTT");
  expect(parsed.treeDefaults.maxDepth).toBe(4);
  expect(parsed.treeDefaults.maxBranch).toBe(8);
  expect(parsed.recommendation.weights.HardEngage).toBe(10);
  expect(typeof parsed.recommendation.redundancyPenalty).toBe("undefined");
});

test("buildDraftflowData validates team pool champion references", () => {
  const brokenPools = "Team,Player,PrimaryRole,Champion\nTTT,Top,Top,NotAChampion\n";
  expect(
    () =>
      buildDraftflowData({
        championsCsvText: championsCsv,
        teamPoolsCsvText: brokenPools,
        configJsonText: configJson
      })
  ).toThrow(DataValidationError);
});

test("parseChampionsCsv rejects invalid boolean tag value", () => {
  const header = ["Champion", "Roles", "DamageType", "Scaling", ...BOOLEAN_TAGS].join(",");
  const values = ["Test", "Top", "AD", "Early", "2", ...Array(BOOLEAN_TAGS.length - 1).fill("0")].join(",");
  const invalidCsv =
    `${header}\n` +
    `${values}\n`;
  expect(() => parseChampionsCsv(invalidCsv)).toThrow(DataValidationError);
});
