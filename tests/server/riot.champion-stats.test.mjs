import { describe, expect, it, vi } from "vitest";

import { createRiotChampionStatsService } from "../../server/riot/champion-stats.js";
import { RiotApiHttpError } from "../../server/riot/client.js";

describe("createRiotChampionStatsService", () => {
  it("returns disabled when Riot integration is not enabled", async () => {
    const service = createRiotChampionStatsService({
      riotApiClient: {
        isEnabled() {
          return false;
        }
      }
    });

    const stats = await service.getProfileChampionStats({
      gameName: "LeadPlayer",
      tagline: "NA1"
    });
    expect(stats.status).toBe("disabled");
    expect(stats.champions).toEqual([]);
  });

  it("returns champion mastery data for linked Riot IDs", async () => {
    const riotApiClient = {
      isEnabled() {
        return true;
      },
      resolvePlatformRouting: vi.fn(() => "na1"),
      resolveAccountRoutingCandidates: vi.fn(() => ["americas"]),
      getAccountByRiotId: vi.fn(async () => ({
        puuid: "puuid-1",
        accountRouting: "americas"
      })),
      getTopChampionMasteries: vi.fn(async () => [
        {
          championId: 99,
          championLevel: 7,
          championPoints: 123456,
          lastPlayedAt: "2026-02-24T10:00:00.000Z"
        }
      ])
    };
    const service = createRiotChampionStatsService({ riotApiClient, topChampionCount: 7 });

    const stats = await service.getProfileChampionStats({
      gameName: "LeadPlayer",
      tagline: "NA1"
    });

    expect(riotApiClient.getAccountByRiotId).toHaveBeenCalledWith({
      gameName: "LeadPlayer",
      tagline: "NA1",
      accountRoutingCandidates: ["americas"]
    });
    expect(riotApiClient.getTopChampionMasteries).toHaveBeenCalledWith({
      puuid: "puuid-1",
      platformRouting: "na1",
      count: 7
    });
    expect(stats.status).toBe("ok");
    expect(stats.champions).toHaveLength(1);
  });

  it("maps Riot API errors to an error status without throwing", async () => {
    const riotApiClient = {
      isEnabled() {
        return true;
      },
      resolvePlatformRouting() {
        return "na1";
      },
      resolveAccountRoutingCandidates() {
        return ["americas"];
      },
      async getAccountByRiotId() {
        throw new RiotApiHttpError(429, "Rate limit");
      },
      async getTopChampionMasteries() {
        return [];
      }
    };
    const service = createRiotChampionStatsService({ riotApiClient });

    const stats = await service.getProfileChampionStats({
      gameName: "LeadPlayer",
      tagline: "NA1"
    });

    expect(stats.status).toBe("error");
    expect(stats.message).toContain("rate limit");
    expect(stats.code).toBe("RIOT_API_ERROR");
  });
});
