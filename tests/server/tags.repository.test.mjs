import { describe, expect, it, vi } from "vitest";

import { BOOLEAN_TAGS } from "../../src/domain/model.js";
import { createTagsRepository } from "../../server/repositories/tags.js";

describe("tags repository bootstrap", () => {
  it("bootstraps default tag catalog before listTags", async () => {
    const queries = [];
    const pool = {
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes("SELECT COUNT(*) AS tag_count")) {
          return {
            rows: [{ tag_count: "0" }],
            rowCount: 1
          };
        }
        if (sql.includes("SELECT id, name, category")) {
          return {
            rows: [{ id: 1, name: "HardEngage", category: "composition" }]
          };
        }
        return { rows: [], rowCount: 0 };
      }
    };

    const repository = createTagsRepository(pool);
    const tags = await repository.listTags();

    expect(tags).toHaveLength(1);
    expect(queries[0].sql).toContain("SELECT COUNT(*) AS tag_count");
    expect(queries[1].sql).toContain("INSERT INTO tags");
    expect(queries[1].params[0]).toHaveLength(BOOLEAN_TAGS.length);
    expect(queries[1].params[1]).toHaveLength(BOOLEAN_TAGS.length);
    expect(queries[2].sql).toContain("SELECT id, name, category");
  });

  it("bootstraps default tag catalog before allTagIdsExist checks", async () => {
    const query = vi.fn(async (sql) => {
      if (sql.includes("SELECT COUNT(*) AS tag_count")) {
        return { rows: [{ tag_count: "0" }], rowCount: 1 };
      }
      if (sql.includes("SELECT id")) {
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const pool = { query };

    const repository = createTagsRepository(pool);
    const allExist = await repository.allTagIdsExist([1]);

    expect(allExist).toBe(true);
    expect(query.mock.calls[0][0]).toContain("SELECT COUNT(*) AS tag_count");
    expect(query.mock.calls[1][0]).toContain("INSERT INTO tags");
    expect(query.mock.calls[2][0]).toContain("SELECT id");
  });

  it("skips default bootstrap when tag table is already populated", async () => {
    const query = vi.fn(async (sql) => {
      if (sql.includes("SELECT COUNT(*) AS tag_count")) {
        return { rows: [{ tag_count: "2" }], rowCount: 1 };
      }
      if (sql.includes("SELECT id, name, category")) {
        return { rows: [{ id: 9, name: "my-tag", category: "custom" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const pool = { query };

    const repository = createTagsRepository(pool);
    const tags = await repository.listTags();

    expect(tags).toHaveLength(1);
    expect(query.mock.calls).toHaveLength(2);
    expect(query.mock.calls[0][0]).toContain("SELECT COUNT(*) AS tag_count");
    expect(query.mock.calls[1][0]).toContain("SELECT id, name, category");
  });
});
