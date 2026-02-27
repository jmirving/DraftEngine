import { Router } from "express";

import { badRequest, forbidden, notFound } from "../errors.js";
import { parsePositiveInteger, requireNonEmptyString, requireObject } from "../http/validation.js";

function parsePoolFamiliarity(rawValue, fieldName = "familiarity") {
  const familiarity = parsePositiveInteger(rawValue, fieldName);
  if (familiarity < 1 || familiarity > 6) {
    throw badRequest(`Expected '${fieldName}' to be between 1 and 6.`);
  }
  return familiarity;
}

function parseOptionalPoolFamiliarity(rawValue, fieldName = "familiarity") {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return null;
  }
  return parsePoolFamiliarity(rawValue, fieldName);
}

function serializePool(pool, championRows = []) {
  const championIds = championRows.map((row) => Number(row.champion_id));
  const championFamiliarity = {};
  for (const row of championRows) {
    championFamiliarity[String(row.champion_id)] = Number(row.familiarity);
  }

  return {
    id: Number(pool.id),
    user_id: Number(pool.user_id),
    name: pool.name,
    champion_ids: championIds,
    champion_familiarity: championFamiliarity,
    created_at: pool.created_at
  };
}

async function assertPoolAccess(poolId, userId, poolsRepository) {
  const ownerId = await poolsRepository.getPoolOwner(poolId);
  if (ownerId === null) {
    throw notFound("Pool not found.");
  }
  if (Number(ownerId) !== userId) {
    throw forbidden("You do not have access to this pool.");
  }
}

export function createPoolsRouter({
  poolsRepository,
  championsRepository,
  requireAuth
}) {
  const router = Router();

  router.use("/me/pools", requireAuth);

  router.get("/me/pools", async (request, response) => {
    const userId = request.user.userId;
    const pools = await poolsRepository.listPoolsByUser(userId);
    const enriched = await Promise.all(
      pools.map(async (pool) => {
        const championRows = await poolsRepository.listPoolChampions(pool.id);
        return serializePool(pool, championRows);
      })
    );
    response.json({ pools: enriched });
  });

  router.post("/me/pools", async (request, response) => {
    const userId = request.user.userId;
    const body = requireObject(request.body);
    const name = requireNonEmptyString(body.name, "name");
    const pool = await poolsRepository.createPool(userId, name);
    response.status(201).json({ pool: serializePool(pool, []) });
  });

  router.put("/me/pools/:id", async (request, response) => {
    const userId = request.user.userId;
    const poolId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const name = requireNonEmptyString(body.name, "name");

    await assertPoolAccess(poolId, userId, poolsRepository);
    const updated = await poolsRepository.renamePool(poolId, userId, name);
    const championRows = await poolsRepository.listPoolChampions(poolId);
    response.json({ pool: serializePool(updated, championRows) });
  });

  router.delete("/me/pools/:id", async (request, response) => {
    const userId = request.user.userId;
    const poolId = parsePositiveInteger(request.params.id, "id");
    await assertPoolAccess(poolId, userId, poolsRepository);
    await poolsRepository.deletePool(poolId, userId);
    response.status(204).send();
  });

  router.post("/me/pools/:id/champions", async (request, response) => {
    const userId = request.user.userId;
    const poolId = parsePositiveInteger(request.params.id, "id");
    const body = requireObject(request.body);
    const championId = parsePositiveInteger(body.champion_id, "champion_id");
    const familiarity = parseOptionalPoolFamiliarity(body.familiarity);

    await assertPoolAccess(poolId, userId, poolsRepository);
    const championExists = await championsRepository.championExists(championId);
    if (!championExists) {
      throw notFound("Champion not found.");
    }

    await poolsRepository.addChampionToPool(poolId, championId);
    if (familiarity !== null) {
      await poolsRepository.setChampionFamiliarity(poolId, championId, familiarity);
    }
    const pools = await poolsRepository.listPoolsByUser(userId);
    const pool = pools.find((candidate) => Number(candidate.id) === poolId);
    const championRows = await poolsRepository.listPoolChampions(poolId);
    response.json({ pool: serializePool(pool, championRows) });
  });

  router.delete("/me/pools/:id/champions/:champion_id", async (request, response) => {
    const userId = request.user.userId;
    const poolId = parsePositiveInteger(request.params.id, "id");
    const championId = parsePositiveInteger(request.params.champion_id, "champion_id");

    await assertPoolAccess(poolId, userId, poolsRepository);
    await poolsRepository.removeChampionFromPool(poolId, championId);

    const pools = await poolsRepository.listPoolsByUser(userId);
    const pool = pools.find((candidate) => Number(candidate.id) === poolId);
    const championRows = await poolsRepository.listPoolChampions(poolId);
    response.json({ pool: serializePool(pool, championRows) });
  });

  router.put("/me/pools/:id/champions/:champion_id/familiarity", async (request, response) => {
    const userId = request.user.userId;
    const poolId = parsePositiveInteger(request.params.id, "id");
    const championId = parsePositiveInteger(request.params.champion_id, "champion_id");
    const body = requireObject(request.body);
    const familiarity = parsePoolFamiliarity(body.familiarity);

    await assertPoolAccess(poolId, userId, poolsRepository);
    const updated = await poolsRepository.setChampionFamiliarity(poolId, championId, familiarity);
    if (!updated) {
      throw notFound("Champion is not in this pool.");
    }

    const pools = await poolsRepository.listPoolsByUser(userId);
    const pool = pools.find((candidate) => Number(candidate.id) === poolId);
    const championRows = await poolsRepository.listPoolChampions(poolId);
    response.json({ pool: serializePool(pool, championRows) });
  });

  return router;
}
