import { Router } from "express";

import { forbidden, notFound } from "../errors.js";
import { parsePositiveInteger, requireNonEmptyString, requireObject } from "../http/validation.js";

function serializePool(pool, championIds = []) {
  return {
    id: Number(pool.id),
    user_id: Number(pool.user_id),
    name: pool.name,
    champion_ids: championIds,
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
        const championIds = await poolsRepository.listPoolChampionIds(pool.id);
        return serializePool(pool, championIds);
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
    const championIds = await poolsRepository.listPoolChampionIds(poolId);
    response.json({ pool: serializePool(updated, championIds) });
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

    await assertPoolAccess(poolId, userId, poolsRepository);
    const championExists = await championsRepository.championExists(championId);
    if (!championExists) {
      throw notFound("Champion not found.");
    }

    await poolsRepository.addChampionToPool(poolId, championId);
    const pools = await poolsRepository.listPoolsByUser(userId);
    const pool = pools.find((candidate) => Number(candidate.id) === poolId);
    const championIds = await poolsRepository.listPoolChampionIds(poolId);
    response.json({ pool: serializePool(pool, championIds) });
  });

  router.delete("/me/pools/:id/champions/:champion_id", async (request, response) => {
    const userId = request.user.userId;
    const poolId = parsePositiveInteger(request.params.id, "id");
    const championId = parsePositiveInteger(request.params.champion_id, "champion_id");

    await assertPoolAccess(poolId, userId, poolsRepository);
    await poolsRepository.removeChampionFromPool(poolId, championId);

    const pools = await poolsRepository.listPoolsByUser(userId);
    const pool = pools.find((candidate) => Number(candidate.id) === poolId);
    const championIds = await poolsRepository.listPoolChampionIds(poolId);
    response.json({ pool: serializePool(pool, championIds) });
  });

  return router;
}
