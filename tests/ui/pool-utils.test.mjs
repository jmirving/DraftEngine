import { expect, test } from "vitest";

import {
  buildNoneTeamPools,
  buildPlayerPoolsByTeam,
  buildTeamPlayersByRoleFromPlayerPools,
  buildTeamPoolsFromPlayerPools,
  clonePlayerPoolsByTeam,
  compareSlots,
  createEmptyRolePools,
  normalizePoolPlayerName
} from "../../public/app/pool-utils.js";

test("createEmptyRolePools builds empty arrays for every slot", () => {
  const pools = createEmptyRolePools();
  expect(Object.keys(pools)).toEqual(["Top", "Jungle", "Mid", "ADC", "Support"]);
  expect(pools.Top).toEqual([]);
  expect(pools.Jungle).toEqual([]);
});

test("buildNoneTeamPools deduplicates and sorts role pools", () => {
  const pools = buildNoneTeamPools([
    { name: "Pantheon", roles: ["Top", "Jungle"] },
    { name: "Aatrox", roles: ["Top"] },
    { name: "Pantheon", roles: ["Top", "Jungle"] }
  ]);

  expect(pools.Top).toEqual(["Aatrox", "Pantheon"]);
  expect(pools.Jungle).toEqual(["Pantheon"]);
});

test("compareSlots uses canonical slot order", () => {
  expect(compareSlots("Top", "Jungle")).toBeLessThan(0);
  expect(compareSlots("Support", "Mid")).toBeGreaterThan(0);
});

test("normalizePoolPlayerName defaults blank names to role player", () => {
  expect(normalizePoolPlayerName(" Faker ", "Mid")).toBe("Faker");
  expect(normalizePoolPlayerName("", "Top")).toBe("Top Player");
  expect(normalizePoolPlayerName(null, "ADC")).toBe("ADC Player");
});

test("buildPlayerPoolsByTeam deduplicates champions and sorts players", () => {
  const byTeam = buildPlayerPoolsByTeam([
    { team: "TTT", player: "Rin", role: "Jungle", champion: "Zac" },
    { team: "TTT", player: "Ari", role: "Top", champion: "Aatrox" },
    { team: "TTT", player: "Ari", role: "Top", champion: "Aatrox" },
    { team: "TTT", player: "Ari", role: "Top", champion: "Camille" }
  ]);

  expect(byTeam.TTT.length).toBe(2);
  expect(byTeam.TTT[0]).toMatchObject({
    player: "Ari",
    role: "Top",
    champions: ["Aatrox", "Camille"]
  });
  expect(byTeam.TTT[1]).toMatchObject({
    player: "Rin",
    role: "Jungle",
    champions: ["Zac"]
  });
});

test("clonePlayerPoolsByTeam deep clones nested player champion arrays", () => {
  const original = {
    TTT: [{ id: "Top::Ari", player: "Ari", role: "Top", champions: ["Aatrox"] }]
  };
  const clone = clonePlayerPoolsByTeam(original);
  clone.TTT[0].champions.push("Camille");

  expect(original.TTT[0].champions).toEqual(["Aatrox"]);
  expect(clone.TTT[0].champions).toEqual(["Aatrox", "Camille"]);
});

test("buildTeamPoolsFromPlayerPools merges role champions with dedupe and sorting", () => {
  const pools = buildTeamPoolsFromPlayerPools({
    TTT: [
      { id: "Top::Ari", player: "Ari", role: "Top", champions: ["Camille", "Aatrox"] },
      { id: "Top::Jin", player: "Jin", role: "Top", champions: ["Aatrox", "Gnar"] },
      { id: "Mid::Lux", player: "Lux", role: "Mid", champions: ["Azir"] }
    ]
  });

  expect(pools.TTT.Top).toEqual(["Aatrox", "Camille", "Gnar"]);
  expect(pools.TTT.Mid).toEqual(["Azir"]);
});

test("buildTeamPlayersByRoleFromPlayerPools maps the first player found per role", () => {
  const playersByRole = buildTeamPlayersByRoleFromPlayerPools({
    TTT: [
      { role: "Top", player: "Ari" },
      { role: "Top", player: "BackupTop" },
      { role: "Jungle", player: "Rin" }
    ]
  });

  expect(playersByRole.TTT.Top).toBe("Ari");
  expect(playersByRole.TTT.Jungle).toBe("Rin");
});
