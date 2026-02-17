import test from "node:test";
import assert from "node:assert/strict";

import { evaluateCompositionChecks } from "../src/engine/checks.js";

const championsByName = {
  ThreatTop: {
    name: "ThreatTop",
    roles: ["Top"],
    damageType: "AD",
    scaling: "Mid",
    tags: {
      HardEngage: false,
      FollowUpEngage: false,
      PickThreat: false,
      Frontline: true,
      Disengage: false,
      Waveclear: true,
      ZoneControl: false,
      ObjectiveSecure: false,
      AntiTank: false,
      FrontToBackDPS: false,
      DiveThreat: true,
      SideLaneThreat: false,
      Poke: false,
      FogThreat: false,
      EarlyPriority: false
    }
  },
  APMid: {
    name: "APMid",
    roles: ["Mid"],
    damageType: "AP",
    scaling: "Mid",
    tags: {
      HardEngage: true,
      FollowUpEngage: false,
      PickThreat: false,
      Frontline: false,
      Disengage: false,
      Waveclear: true,
      ZoneControl: false,
      ObjectiveSecure: false,
      AntiTank: false,
      FrontToBackDPS: false,
      DiveThreat: false,
      SideLaneThreat: false,
      Poke: false,
      FogThreat: false,
      EarlyPriority: false
    }
  }
};

test("evaluateCompositionChecks computes missing requirements on partial team", () => {
  const result = evaluateCompositionChecks(
    {
      Top: "ThreatTop"
    },
    championsByName
  );

  assert.equal(result.checks.HasFrontline.satisfied, true);
  assert.equal(result.checks.HasHardEngage.satisfied, false);
  assert.equal(result.checks.DamageMix.satisfied, false);
  assert.equal(result.checks.TopMustBeThreat.satisfied, true);
  assert.equal(result.missingNeeds.needsAP, true);
  assert.ok(result.missingNeeds.tags.includes("HardEngage"));
});

test("evaluateCompositionChecks marks top threat as warn when Top is non-threat and enforcement enabled", () => {
  const result = evaluateCompositionChecks(
    {
      Top: "APMid"
    },
    championsByName,
    {
      topMustBeThreat: true
    }
  );

  assert.equal(result.checks.TopMustBeThreat.status, "warn");
  assert.equal(result.checks.TopMustBeThreat.satisfied, false);
  assert.equal(result.checks.TopMustBeThreat.applicable, true);
});
