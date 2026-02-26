import { Router } from "express";

import { badRequest, notFound } from "../errors.js";
import {
  parsePositiveInteger,
  requireArrayOfPositiveIntegers,
  requireObject
} from "../http/validation.js";

export function createChampionsRouter({
  championsRepository,
  tagsRepository,
  requireAuth
}) {
  const router = Router();

  router.get("/champions", async (_request, response) => {
    const champions = await championsRepository.listChampions();
    response.json({ champions });
  });

  router.get("/champions/:id", async (request, response) => {
    const championId = parsePositiveInteger(request.params.id, "id");
    const champion = await championsRepository.getChampionById(championId);
    if (!champion) {
      throw notFound("Champion not found.");
    }
    response.json({ champion });
  });

  router.get("/tags", async (_request, response) => {
    const tags = await tagsRepository.listTags();
    response.json({ tags });
  });

  router.put("/champions/:id/tags", requireAuth, async (request, response) => {
    const championId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const tagIds = requireArrayOfPositiveIntegers(body.tag_ids, "tag_ids");

    const championExists = await championsRepository.championExists(championId);
    if (!championExists) {
      throw notFound("Champion not found.");
    }

    const allTagsExist = await tagsRepository.allTagIdsExist(tagIds);
    if (!allTagsExist) {
      throw badRequest("One or more tag IDs do not exist.");
    }

    await tagsRepository.replaceChampionTags(championId, tagIds);
    const champion = await championsRepository.getChampionById(championId);
    response.json({ champion });
  });

  return router;
}

