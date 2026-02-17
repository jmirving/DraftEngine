import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DataValidationError, buildDraftflowData, parseChampionsCsv, parseConfigJson, parseTeamPoolsCsv } from "../src/data/loaders.js";

const championsCsv = readFileSync(resolve("docs/DraftFlow_champions.csv"), "utf8");
const teamPoolsCsv = readFileSync(resolve("docs/DraftFlow_team_pools.csv"), "utf8");
const configJson = readFileSync(resolve("docs/DraftFlow_config.json"), "utf8");

test("parseChampionsCsv parses champions and tag fields", () => {
  const parsed = parseChampionsCsv(championsCsv);
  assert.ok(parsed.champions.length > 0);
  assert.ok(parsed.championsByName.Ashe);
  assert.equal(parsed.championsByName.Ashe.tags.HardEngage, true);
  assert.equal(parsed.championsByName.Ashe.damageType, "AD");
});

test("parseTeamPoolsCsv builds role pools by team", () => {
  const parsed = parseTeamPoolsCsv(teamPoolsCsv);
  assert.ok(parsed.poolsByTeam.TTT);
  assert.ok(parsed.poolsByTeam.TTT.Top.includes("Aatrox"));
  assert.ok(parsed.poolsByTeam.TTT.ADC.includes("Ashe"));
});

test("parseConfigJson applies defaults and overrides", () => {
  const parsed = parseConfigJson(configJson);
  assert.equal(parsed.teamDefault, "TTT");
  assert.equal(parsed.treeDefaults.maxDepth, 4);
  assert.equal(parsed.treeDefaults.maxBranch, 8);
  assert.equal(parsed.recommendation.weights.HardEngage, 10);
  assert.equal(typeof parsed.recommendation.redundancyPenalty, "undefined");
});

test("buildDraftflowData validates team pool champion references", () => {
  const brokenPools = "Team,Player,PrimaryRole,Champion\nTTT,Top,Top,NotAChampion\n";
  assert.throws(
    () =>
      buildDraftflowData({
        championsCsvText: championsCsv,
        teamPoolsCsvText: brokenPools,
        configJsonText: configJson
      }),
    (error) => error instanceof DataValidationError
  );
});

test("parseChampionsCsv rejects invalid boolean tag value", () => {
  const invalidCsv =
    "Champion,Roles,DamageType,Scaling,HardEngage,FollowUpEngage,PickThreat,Frontline,Disengage,Waveclear,ZoneControl,ObjectiveSecure,AntiTank,FrontToBackDPS,DiveThreat,SideLaneThreat,Poke,FogThreat,EarlyPriority\n" +
    "Test,Top,AD,Early,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0\n";
  assert.throws(() => parseChampionsCsv(invalidCsv), (error) => error instanceof DataValidationError);
});
