import { createChampionsRepository } from "./champions.js";
import { createPoolsRepository } from "./pools.js";
import { createTagsRepository } from "./tags.js";
import { createUsersRepository } from "./users.js";

export function createRepositories(pool) {
  return {
    users: createUsersRepository(pool),
    champions: createChampionsRepository(pool),
    tags: createTagsRepository(pool),
    pools: createPoolsRepository(pool)
  };
}

