import { SLOTS, createEmptyTeamState } from "../../src/index.js";

export function createEmptyRolePools() {
  const pools = createEmptyTeamState();
  for (const slot of SLOTS) {
    pools[slot] = [];
  }
  return pools;
}

export function buildNoneTeamPools(champions) {
  const pools = createEmptyRolePools();
  for (const champion of champions) {
    for (const role of champion.roles) {
      if (pools[role]) {
        pools[role].push(champion.name);
      }
    }
  }

  for (const slot of SLOTS) {
    pools[slot] = Array.from(new Set(pools[slot])).sort((left, right) => left.localeCompare(right));
  }
  return pools;
}

export function compareSlots(left, right) {
  return SLOTS.indexOf(left) - SLOTS.indexOf(right);
}

export function normalizePoolPlayerName(playerName, role) {
  const normalizedName = typeof playerName === "string" ? playerName.trim() : "";
  return normalizedName || `${role} Player`;
}

export function buildPlayerPoolsByTeam(teamPoolEntries) {
  const byTeam = {};
  for (const entry of teamPoolEntries) {
    if (!byTeam[entry.team]) {
      byTeam[entry.team] = {};
    }

    const playerName = normalizePoolPlayerName(entry.player, entry.role);
    const playerKey = `${entry.role}::${playerName}`;
    if (!byTeam[entry.team][playerKey]) {
      byTeam[entry.team][playerKey] = {
        id: playerKey,
        player: playerName,
        role: entry.role,
        champions: [],
        familiarityByChampion: {}
      };
    }

    if (!byTeam[entry.team][playerKey].champions.includes(entry.champion)) {
      byTeam[entry.team][playerKey].champions.push(entry.champion);
    }
  }

  const normalized = {};
  for (const [teamId, playersByKey] of Object.entries(byTeam)) {
    const players = Object.values(playersByKey);
    for (const player of players) {
      player.champions.sort((left, right) => left.localeCompare(right));
    }
    players.sort((left, right) => {
      const roleCmp = compareSlots(left.role, right.role);
      if (roleCmp !== 0) {
        return roleCmp;
      }
      return left.player.localeCompare(right.player);
    });
    normalized[teamId] = players;
  }
  return normalized;
}

export function clonePlayerPoolsByTeam(playerPoolsByTeam) {
  const clone = {};
  for (const [teamId, players] of Object.entries(playerPoolsByTeam)) {
    clone[teamId] = players.map((player) => ({
      id: player.id,
      player: player.player,
      role: player.role,
      champions: [...player.champions],
      familiarityByChampion:
        player.familiarityByChampion && typeof player.familiarityByChampion === "object"
          ? { ...player.familiarityByChampion }
          : {}
    }));
  }
  return clone;
}

export function buildTeamPoolsFromPlayerPools(playerPoolsByTeam) {
  const poolsByTeam = {};
  for (const [teamId, players] of Object.entries(playerPoolsByTeam)) {
    const pools = createEmptyRolePools();
    for (const player of players) {
      const slot = player.role;
      for (const champion of player.champions) {
        if (!pools[slot].includes(champion)) {
          pools[slot].push(champion);
        }
      }
    }
    for (const slot of SLOTS) {
      pools[slot].sort((left, right) => left.localeCompare(right));
    }
    poolsByTeam[teamId] = pools;
  }
  return poolsByTeam;
}

export function buildTeamPlayersByRoleFromPlayerPools(playerPoolsByTeam) {
  const mapping = {};
  for (const [teamId, players] of Object.entries(playerPoolsByTeam)) {
    mapping[teamId] = {};
    for (const player of players) {
      if (!mapping[teamId][player.role]) {
        mapping[teamId][player.role] = player.player;
      }
    }
  }
  return mapping;
}
