import { Router } from "express";

import { assertAdminAuthorization } from "../scope-authorization.js";

export function createAdminChampionCoreRouter({
  championCoreRepository,
  usersRepository,
  requireAuth
}) {
  const router = Router();
  router.use("/admin/champion-core", requireAuth);

  router.get("/admin/champion-core", async (request, response) => {
    const userId = request.user.userId;
    await assertAdminAuthorization({
      userId,
      usersRepository,
      message: "Only admins can view champion core data."
    });

    const champions = await championCoreRepository.listChampionCore();
    response.json({
      count: champions.length,
      champions
    });
  });

  return router;
}
