import { describe, expect, it } from "vitest";

import { down, up } from "../../server/migrations/1763000000000_champion_core.js";

describe("champion core migration", () => {
  it("creates champion_core with stable Riot identity fields and indexes", () => {
    const createTableCalls = [];
    const createIndexCalls = [];
    const pgm = {
      createTable(...args) {
        createTableCalls.push(args);
      },
      createIndex(...args) {
        createIndexCalls.push(args);
      },
      func(value) {
        return value;
      }
    };

    up(pgm);

    const championCore = createTableCalls.find((call) => call[0] === "champion_core");
    expect(championCore).toBeTruthy();
    expect(championCore[1].normalized_name.unique).toBe(true);
    expect(championCore[1].ddragon_id.unique).toBe(true);
    expect(championCore[1].riot_champion_id.unique).toBe(true);
    expect(championCore[1].riot_tags.type).toBe("text[]");
    expect(championCore[1].attackrange.type).toBe("double precision");

    const indexTargets = createIndexCalls.map((call) => `${call[0]}:${JSON.stringify(call[1])}`);
    expect(indexTargets).toContain("champion_core:\"name\"");
    expect(indexTargets).toContain("champion_core:\"riot_champion_id\"");
  });

  it("drops champion_core on down", () => {
    const calls = [];
    const pgm = {
      dropIndex(...args) {
        calls.push({ type: "dropIndex", args });
      },
      dropTable(...args) {
        calls.push({ type: "dropTable", args });
      }
    };

    down(pgm);

    expect(calls).toEqual([
      { type: "dropIndex", args: ["champion_core", "riot_champion_id"] },
      { type: "dropIndex", args: ["champion_core", "name"] },
      { type: "dropTable", args: ["champion_core"] }
    ]);
  });
});
