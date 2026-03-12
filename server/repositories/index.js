import { createChampionCoreRepository } from "./champion-core.js";
import { createChampionsRepository } from "./champions.js";
import { createCompositionsCatalogRepository } from "./compositions-catalog.js";
import { createPoolsRepository } from "./pools.js";
import { createPromotionRequestsRepository } from "./promotion-requests.js";
import { createTeamsRepository } from "./teams.js";
import { createTagsRepository } from "./tags.js";
import { createUsersRepository } from "./users.js";

export function createRepositories(pool) {
  return {
    championCore: createChampionCoreRepository(pool),
    users: createUsersRepository(pool),
    champions: createChampionsRepository(pool),
    tags: createTagsRepository(pool),
    compositionsCatalog: createCompositionsCatalogRepository(pool),
    promotionRequests: createPromotionRequestsRepository(pool),
    pools: createPoolsRepository(pool),
    teams: createTeamsRepository(pool)
  };
}
