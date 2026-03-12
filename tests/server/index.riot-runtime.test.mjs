import { beforeEach, describe, expect, it, vi } from "vitest";

const createRiotApiClient = vi.fn();
const createRiotChampionStatsService = vi.fn();

vi.mock("../../server/riot/client.js", () => ({
  createRiotApiClient
}));

vi.mock("../../server/riot/champion-stats.js", () => ({
  createRiotChampionStatsService
}));

describe("createRiotChampionStatsServiceForRuntime", () => {
  beforeEach(() => {
    createRiotApiClient.mockReset();
    createRiotChampionStatsService.mockReset();
    createRiotApiClient.mockReturnValue({ isEnabled: () => true });
    createRiotChampionStatsService.mockImplementation((options) => options);
  });

  it("uses champion_core Riot id lookup when available", async () => {
    const championCoreRepository = {
      async getChampionCoreByRiotChampionId(riotChampionId) {
        return { riot_champion_id: riotChampionId, name: "Lux" };
      }
    };
    const championsRepository = {
      async getChampionById(championId) {
        return { id: championId, name: "Wrong path" };
      }
    };
    const { createRiotChampionStatsServiceForRuntime } = await import("../../server/index.js");

    const service = createRiotChampionStatsServiceForRuntime({
      env: {
        NEXUS_API_KEY: "nexus-key",
        RIOT_PROFILE_CHAMPION_STATS_LIMIT: "7"
      },
      championCoreRepository,
      championsRepository
    });

    expect(createRiotApiClient).toHaveBeenCalledWith({
      apiKey: "nexus-key",
      defaultPlatformRouting: undefined,
      defaultAccountRouting: undefined,
      requestTimeoutMs: undefined
    });
    expect(createRiotChampionStatsService).toHaveBeenCalled();
    const lookedUp = await service.lookupChampionById(99);
    expect(lookedUp).toEqual({ riot_champion_id: 99, name: "Lux" });
  });

  it("falls back to champions repository lookup when champion_core is unavailable", async () => {
    const championsRepository = {
      async getChampionById(championId) {
        return { id: championId, name: "Fallback" };
      }
    };
    const { createRiotChampionStatsServiceForRuntime } = await import("../../server/index.js");

    const service = createRiotChampionStatsServiceForRuntime({
      env: {
        RIOT_API_KEY: "riot-key"
      },
      championsRepository
    });

    const lookedUp = await service.lookupChampionById(11);
    expect(lookedUp).toEqual({ id: 11, name: "Fallback" });
  });
});
