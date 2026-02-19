import { SLOTS } from "../../src/index.js";

export function getParentNodeId(nodeId = "0") {
  if (nodeId === "0") {
    return null;
  }
  const parts = nodeId.split(".");
  parts.pop();
  return parts.join(".") || "0";
}

export function flattenTreeForMap(node, nodeId = "0", depth = 0, parentId = null, acc = []) {
  acc.push({
    id: nodeId,
    parentId,
    depth,
    node
  });

  for (let index = 0; index < node.children.length; index += 1) {
    flattenTreeForMap(node.children[index], `${nodeId}.${index}`, depth + 1, nodeId, acc);
  }
  return acc;
}

export function nodeMatchesTreeSearch(node, query = "", slots = SLOTS) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const parts = [
    node.addedRole ?? "",
    node.addedChampion ?? "",
    ...slots.map((slot) => node.teamSlots[slot] ?? "")
  ];
  return parts.join(" ").toLowerCase().includes(normalized);
}

function nodePassesViabilityFilter(node, validLeavesOnly = false) {
  if (!validLeavesOnly) {
    return true;
  }
  if (node.viability?.isTerminalValid) {
    return true;
  }
  return (node.branchPotential?.validLeafCount ?? 0) > 0;
}

export function nodePassesTreeFilters(node, minScore = 0, query = "", slots = SLOTS, validLeavesOnly = false) {
  return (
    nodePassesViabilityFilter(node, validLeavesOnly) &&
    node.score >= minScore &&
    nodeMatchesTreeSearch(node, query, slots)
  );
}

export function collectVisibleNodeIds(
  node,
  nodeId = "0",
  acc = new Set(),
  minScore = 0,
  query = "",
  slots = SLOTS,
  validLeavesOnly = false
) {
  let hasVisibleChild = false;
  for (let index = 0; index < node.children.length; index += 1) {
    const childVisible = collectVisibleNodeIds(
      node.children[index],
      `${nodeId}.${index}`,
      acc,
      minScore,
      query,
      slots,
      validLeavesOnly
    );
    hasVisibleChild = hasVisibleChild || childVisible;
  }

  const selfVisible = nodePassesTreeFilters(node, minScore, query, slots, validLeavesOnly);
  const visible = nodeId === "0" || selfVisible || hasVisibleChild;
  if (visible) {
    acc.add(nodeId);
  }
  return visible;
}
