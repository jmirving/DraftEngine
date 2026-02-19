import { expect, test } from "vitest";

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

  expect(result.checks.HasFrontline.satisfied).toBe(true);
  expect(result.checks.HasHardEngage.satisfied).toBe(false);
  expect(result.checks.HasHardEngage.requirementType).toBe("tag");
  expect(result.checks.HasHardEngage.requirementTag).toBe("HardEngage");
  expect(result.checks.DamageMix.satisfied).toBe(false);
  expect(result.checks.DamageMix.requirementType).toBe("damage_mix");
  expect(result.checks.TopMustBeThreat.satisfied).toBe(true);
  expect(result.checks.TopMustBeThreat.requirementType).toBe("top_threat");
  expect(result.missingNeeds.needsAP).toBe(true);
  expect(result.missingNeeds.tags.includes("HardEngage")).toBe(true);
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

  expect(result.checks.TopMustBeThreat.status).toBe("warn");
  expect(result.checks.TopMustBeThreat.satisfied).toBe(false);
  expect(result.checks.TopMustBeThreat.applicable).toBe(true);
});
