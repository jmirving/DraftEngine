const DEFAULT_REQUEST_TIMEOUT_MS = 6000;
const DEFAULT_PLATFORM_ROUTING = "na1";
const DEFAULT_ACCOUNT_ROUTINGS = Object.freeze(["americas", "europe", "asia", "sea"]);

const PLATFORM_ROUTING_ALIASES = Object.freeze({
  NA: "na1",
  NA1: "na1",
  BR: "br1",
  BR1: "br1",
  EUNE: "eun1",
  EUN1: "eun1",
  EUW: "euw1",
  EUW1: "euw1",
  JP: "jp1",
  JP1: "jp1",
  KR: "kr",
  LAN: "la1",
  LA1: "la1",
  LAS: "la2",
  LA2: "la2",
  OCE: "oc1",
  OC1: "oc1",
  TR: "tr1",
  TR1: "tr1",
  RU: "ru",
  PH: "ph2",
  PH2: "ph2",
  SG: "sg2",
  SG2: "sg2",
  TH: "th2",
  TH2: "th2",
  TW: "tw2",
  TW2: "tw2",
  VN: "vn2",
  VN2: "vn2"
});

const ACCOUNT_ROUTING_BY_PLATFORM = Object.freeze({
  na1: "americas",
  br1: "americas",
  la1: "americas",
  la2: "americas",
  oc1: "americas",
  euw1: "europe",
  eun1: "europe",
  tr1: "europe",
  ru: "europe",
  kr: "asia",
  jp1: "asia",
  ph2: "sea",
  sg2: "sea",
  th2: "sea",
  tw2: "sea",
  vn2: "sea"
});

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

function normalizeTimeoutMs(value, fallback = DEFAULT_REQUEST_TIMEOUT_MS) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 60000) {
    return fallback;
  }
  return parsed;
}

function normalizePlatformRouting(value, fallback = DEFAULT_PLATFORM_ROUTING) {
  const normalized = normalizeNonEmptyString(value).toLowerCase();
  return normalized || fallback;
}

function normalizeAccountRouting(value) {
  const normalized = normalizeNonEmptyString(value).toLowerCase();
  return normalized || null;
}

function safeToIsoDate(value) {
  const asNumber = Number.parseInt(String(value), 10);
  if (!Number.isInteger(asNumber) || asNumber <= 0) {
    return null;
  }
  const asDate = new Date(asNumber);
  if (Number.isNaN(asDate.getTime())) {
    return null;
  }
  return asDate.toISOString();
}

function normalizeMasteryEntry(rawEntry) {
  const championId = Number.parseInt(String(rawEntry?.championId), 10);
  const championLevel = Number.parseInt(String(rawEntry?.championLevel), 10);
  const championPoints = Number.parseInt(String(rawEntry?.championPoints), 10);
  return {
    championId: Number.isInteger(championId) ? championId : 0,
    championLevel: Number.isInteger(championLevel) ? championLevel : 0,
    championPoints: Number.isInteger(championPoints) ? championPoints : 0,
    lastPlayedAt: safeToIsoDate(rawEntry?.lastPlayTime)
  };
}

function dedupe(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

async function readResponseBody(response) {
  try {
    return await response.json();
  } catch (_error) {
    try {
      return { message: await response.text() };
    } catch (_innerError) {
      return {};
    }
  }
}

async function requestRiotApi({ fetchImpl, apiKey, timeoutMs, url }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        "X-Riot-Token": apiKey,
        Accept: "application/json"
      },
      signal: controller.signal
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      throw new RiotApiHttpError(response.status, body?.status?.message ?? body?.message ?? "Riot API request failed.", {
        body,
        url
      });
    }
    return body;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Riot API request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export class RiotApiHttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = "RiotApiHttpError";
    this.status = status;
    this.details = details;
  }
}

export function resolvePlatformRoutingFromTagline(tagline, fallback = DEFAULT_PLATFORM_ROUTING) {
  const normalizedTagline = normalizeNonEmptyString(tagline).toUpperCase();
  return PLATFORM_ROUTING_ALIASES[normalizedTagline] ?? normalizePlatformRouting(fallback);
}

export function resolveDefaultAccountRoutingFromPlatform(platformRouting) {
  const normalized = normalizePlatformRouting(platformRouting);
  return ACCOUNT_ROUTING_BY_PLATFORM[normalized] ?? "americas";
}

export function createRiotApiClient({
  apiKey,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  defaultPlatformRouting = DEFAULT_PLATFORM_ROUTING,
  defaultAccountRouting = null
} = {}) {
  const normalizedApiKey = normalizeNonEmptyString(apiKey);
  const normalizedPlatformRouting = normalizePlatformRouting(defaultPlatformRouting);
  const normalizedAccountRouting = normalizeAccountRouting(defaultAccountRouting);
  const timeoutMs = normalizeTimeoutMs(requestTimeoutMs);

  return {
    isEnabled() {
      return Boolean(normalizedApiKey && typeof fetchImpl === "function");
    },

    resolvePlatformRouting({ tagline } = {}) {
      return resolvePlatformRoutingFromTagline(tagline, normalizedPlatformRouting);
    },

    resolveAccountRoutingCandidates({ platformRouting } = {}) {
      const resolvedPlatform = normalizePlatformRouting(platformRouting, normalizedPlatformRouting);
      const platformDefault = resolveDefaultAccountRoutingFromPlatform(resolvedPlatform);
      return dedupe([normalizedAccountRouting, platformDefault, ...DEFAULT_ACCOUNT_ROUTINGS]);
    },

    async getAccountByRiotId({ gameName, tagline, accountRoutingCandidates } = {}) {
      if (!this.isEnabled()) {
        return null;
      }

      const normalizedGameName = normalizeNonEmptyString(gameName);
      const normalizedTagline = normalizeNonEmptyString(tagline);
      if (!normalizedGameName || !normalizedTagline) {
        return null;
      }

      const candidates = dedupe(
        Array.isArray(accountRoutingCandidates) && accountRoutingCandidates.length > 0
          ? accountRoutingCandidates
          : this.resolveAccountRoutingCandidates({})
      );
      for (const accountRouting of candidates) {
        const url = new URL(
          `https://${accountRouting}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
            normalizedGameName
          )}/${encodeURIComponent(normalizedTagline)}`
        );
        try {
          const account = await requestRiotApi({
            fetchImpl,
            apiKey: normalizedApiKey,
            timeoutMs,
            url
          });
          if (account && typeof account === "object" && typeof account.puuid === "string" && account.puuid.trim() !== "") {
            return {
              puuid: account.puuid,
              gameName: account.gameName ?? normalizedGameName,
              tagline: account.tagLine ?? normalizedTagline,
              accountRouting
            };
          }
          return null;
        } catch (error) {
          if (error instanceof RiotApiHttpError && error.status === 404) {
            continue;
          }
          throw error;
        }
      }
      return null;
    },

    async getTopChampionMasteries({ puuid, platformRouting, count = 5 } = {}) {
      if (!this.isEnabled()) {
        return [];
      }

      const normalizedPuuid = normalizeNonEmptyString(puuid);
      if (!normalizedPuuid) {
        return [];
      }

      const resolvedPlatform = normalizePlatformRouting(platformRouting, normalizedPlatformRouting);
      const normalizedCount = Number.isInteger(count) && count > 0 && count <= 20 ? count : 5;
      const url = new URL(
        `https://${resolvedPlatform}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(
          normalizedPuuid
        )}/top`
      );
      url.searchParams.set("count", String(normalizedCount));

      const payload = await requestRiotApi({
        fetchImpl,
        apiKey: normalizedApiKey,
        timeoutMs,
        url
      });

      if (!Array.isArray(payload)) {
        return [];
      }
      return payload.map((entry) => normalizeMasteryEntry(entry));
    }
  };
}
