import { RiotApiHttpError } from "./client.js";

function nowIsoString() {
  return new Date().toISOString();
}

function buildBaseResult(status) {
  return {
    provider: "riot",
    status,
    fetchedAt: nowIsoString(),
    topChampion: null,
    champions: []
  };
}

function normalizeChampionName(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

async function enrichChampionMasteries(championMasteries, lookupChampionById) {
  if (!Array.isArray(championMasteries) || championMasteries.length === 0) {
    return [];
  }

  if (typeof lookupChampionById !== "function") {
    return championMasteries.map((entry) => ({
      ...entry,
      championName: normalizeChampionName(entry?.championName)
    }));
  }

  const enriched = await Promise.all(
    championMasteries.map(async (entry) => {
      const championId = Number.parseInt(String(entry?.championId), 10);
      if (!Number.isInteger(championId) || championId <= 0) {
        return {
          ...entry,
          championName: normalizeChampionName(entry?.championName)
        };
      }

      const champion = await lookupChampionById(championId);
      return {
        ...entry,
        championName: normalizeChampionName(champion?.name) || normalizeChampionName(entry?.championName)
      };
    })
  );

  return enriched;
}

function mapHttpErrorMessage(error) {
  if (error.status === 401 || error.status === 403) {
    return "Riot API key is invalid or missing required permissions.";
  }
  if (error.status === 404) {
    return "No Riot account was found for the linked Riot ID.";
  }
  if (error.status === 429) {
    return "Riot API rate limit exceeded. Try again shortly.";
  }
  return "Riot champion stats are temporarily unavailable.";
}

export function createRiotChampionStatsService({
  riotApiClient,
  lookupChampionById = null
} = {}) {
  return {
    isEnabled() {
      return Boolean(riotApiClient?.isEnabled?.());
    },

    async getProfileChampionStats({ gameName, tagline } = {}) {
      if (!this.isEnabled()) {
        return {
          ...buildBaseResult("disabled"),
          message: "Riot integration is not configured on this deployment."
        };
      }

      const normalizedGameName = typeof gameName === "string" ? gameName.trim() : "";
      const normalizedTagline = typeof tagline === "string" ? tagline.trim() : "";
      if (!normalizedGameName || !normalizedTagline) {
        return {
          ...buildBaseResult("unlinked"),
          message: "Link a Riot game name and tagline to load champion stats."
        };
      }

      try {
        const platformRouting = riotApiClient.resolvePlatformRouting({ tagline: normalizedTagline });
        const accountRoutingCandidates = riotApiClient.resolveAccountRoutingCandidates({ platformRouting });
        const account = await riotApiClient.getAccountByRiotId({
          gameName: normalizedGameName,
          tagline: normalizedTagline,
          accountRoutingCandidates
        });

        if (!account?.puuid) {
          return {
            ...buildBaseResult("not_found"),
            platformRouting,
            message: "No Riot account found for the linked game name and tagline."
          };
        }

        const championMasteries = await riotApiClient.getAllChampionMasteries({
          puuid: account.puuid,
          platformRouting
        });
        const champions = await enrichChampionMasteries(championMasteries, lookupChampionById);
        const topChampion = champions[0] ?? null;

        return {
          ...buildBaseResult("ok"),
          platformRouting,
          accountRouting: account.accountRouting ?? null,
          topChampion,
          champions
        };
      } catch (error) {
        if (error instanceof RiotApiHttpError) {
          return {
            ...buildBaseResult("error"),
            message: mapHttpErrorMessage(error),
            code: "RIOT_API_ERROR",
            details: {
              status: error.status
            }
          };
        }

        return {
          ...buildBaseResult("error"),
          message: "Riot champion stats are temporarily unavailable.",
          code: "RIOT_API_ERROR"
        };
      }
    }
  };
}
