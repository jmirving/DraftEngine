import { expect, test } from "vitest";

import {
  collectVisibleNodeIds,
  flattenTreeForMap,
  getParentNodeId,
  nodeMatchesTreeSearch,
  nodePassesTreeFilters
} from "../../public/app/tree-utils.js";

function makeTree() {
  return {
    score: 10,
    teamSlots: { Top: null, Jungle: null, Mid: null, ADC: null, Support: null },
    children: [
      {
        score: 30,
        addedRole: "Top",
        addedChampion: "Aatrox",
        teamSlots: { Top: "Aatrox", Jungle: null, Mid: null, ADC: null, Support: null },
        children: [
          {
            score: 40,
            addedRole: "Mid",
            addedChampion: "Azir",
            teamSlots: { Top: "Aatrox", Jungle: null, Mid: "Azir", ADC: null, Support: null },
            children: []
          }
        ]
      },
      {
        score: 5,
        addedRole: "Jungle",
        addedChampion: "Amumu",
        teamSlots: { Top: null, Jungle: "Amumu", Mid: null, ADC: null, Support: null },
        children: []
      }
    ]
  };
}

test("getParentNodeId resolves parent identifiers", () => {
  expect(getParentNodeId("0")).toBe(null);
  expect(getParentNodeId("0.2")).toBe("0");
  expect(getParentNodeId("0.2.1")).toBe("0.2");
});

test("flattenTreeForMap returns depth and parent relationships", () => {
  const flat = flattenTreeForMap(makeTree());
  expect(flat).toHaveLength(4);
  expect(flat[0]).toMatchObject({ id: "0", depth: 0, parentId: null });
  expect(flat[3]).toMatchObject({ id: "0.1", depth: 1, parentId: "0" });
});

test("nodeMatchesTreeSearch scans added role/champion and slot values", () => {
  const tree = makeTree();
  const topNode = tree.children[0];
  const deepNode = topNode.children[0];

  expect(nodeMatchesTreeSearch(topNode, "aatrox")).toBe(true);
  expect(nodeMatchesTreeSearch(deepNode, "azir")).toBe(true);
  expect(nodeMatchesTreeSearch(topNode, "amumu")).toBe(false);
});

test("nodePassesTreeFilters applies min score and query together", () => {
  const topNode = makeTree().children[0];
  expect(nodePassesTreeFilters(topNode, 25, "aatrox")).toBe(true);
  expect(nodePassesTreeFilters(topNode, 35, "aatrox")).toBe(false);
  expect(nodePassesTreeFilters(topNode, 25, "amumu")).toBe(false);
});

test("collectVisibleNodeIds preserves context path for matching descendants", () => {
  const visible = new Set();
  collectVisibleNodeIds(makeTree(), "0", visible, 0, "azir");

  expect(visible.has("0")).toBe(true);
  expect(visible.has("0.0")).toBe(true);
  expect(visible.has("0.0.0")).toBe(true);
  expect(visible.has("0.1")).toBe(false);
});
