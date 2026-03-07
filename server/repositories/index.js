import { createChampionsRepository } from "./champions.js";
import { createChecksRepository } from "./checks.js";
import { createCompositionsCatalogRepository } from "./compositions-catalog.js";
import { createCompositionRequirementsRepository } from "./composition-requirements.js";
import { createPoolsRepository } from "./pools.js";
import { createPromotionRequestsRepository } from "./promotion-requests.js";
import { createTeamsRepository } from "./teams.js";
import { createTagsRepository } from "./tags.js";
import { createUsersRepository } from "./users.js";

export function createRepositories(pool) {
  return {
    users: createUsersRepository(pool),
    champions: createChampionsRepository(pool),
    tags: createTagsRepository(pool),
    checks: createChecksRepository(pool),
    compositionsCatalog: createCompositionsCatalogRepository(pool),
    compositionRequirements: createCompositionRequirementsRepository(pool),
    promotionRequests: createPromotionRequestsRepository(pool),
    pools: createPoolsRepository(pool),
    teams: createTeamsRepository(pool)
  };
}
