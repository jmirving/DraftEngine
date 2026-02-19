import { SLOTS } from "../../src/index.js";

export function normalizeNoFilterMultiSelection(values, noFilterValue = "__NO_FILTER__") {
  let normalized = [...new Set(values)];
  if (normalized.includes(noFilterValue) && normalized.length > 1) {
    normalized = normalized.filter((value) => value !== noFilterValue);
  }
  return normalized.includes(noFilterValue) ? [] : normalized;
}

export function getTeamCompletionInfo(teamState, slots = SLOTS) {
  const filledSlots = slots.filter((slot) => Boolean(teamState[slot])).length;
  if (filledSlots === 0) {
    return { filledSlots, totalSlots: slots.length, completionState: "empty" };
  }
  if (filledSlots === slots.length) {
    return { filledSlots, totalSlots: slots.length, completionState: "full" };
  }
  return { filledSlots, totalSlots: slots.length, completionState: "partial" };
}

export function getActiveNextRole(draftOrder, teamState) {
  return draftOrder.find((slot) => !teamState[slot]) ?? null;
}

export function teamStateKey(teamSlots, slots = SLOTS) {
  return slots.map((slot) => teamSlots[slot] ?? "-").join("|");
}

export function resolveTagMutualExclusion(changed, includeValuesInput, excludeValuesInput) {
  let includeValues = [...includeValuesInput];
  let excludeValues = [...excludeValuesInput];

  const overlap = includeValues.filter((tag) => excludeValues.includes(tag));
  if (overlap.length > 0) {
    if (changed === "include") {
      excludeValues = excludeValues.filter((tag) => !overlap.includes(tag));
    } else {
      includeValues = includeValues.filter((tag) => !overlap.includes(tag));
    }
  }

  return {
    includeValues,
    excludeValues
  };
}

export function validateSlotSelection({
  slot,
  championName,
  teamState,
  excludedChampions,
  pools,
  slots = SLOTS
}) {
  if (!championName) {
    return { ok: true, message: "", nextChampionName: null };
  }

  if (!pools[slot]?.includes(championName)) {
    return { ok: false, message: `${championName} is not in ${slot}'s allowed pool.` };
  }
  if (excludedChampions.includes(championName)) {
    return { ok: false, message: `${championName} is excluded and cannot be selected.` };
  }

  const inOtherSlot = slots.some((otherSlot) => {
    if (otherSlot === slot) {
      return false;
    }
    return teamState[otherSlot] === championName;
  });
  if (inOtherSlot) {
    return { ok: false, message: `${championName} is already selected in another slot.` };
  }

  return { ok: true, message: "", nextChampionName: championName };
}
