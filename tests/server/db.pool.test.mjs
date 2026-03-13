import { describe, expect, it, vi } from "vitest";

import { assertInvitationSchema } from "../../server/db/pool.js";

describe("db pool schema checks", () => {
  it("passes when invitation schema columns are present", async () => {
    const query = vi.fn(async () => ({
      rows: [
        { column_name: "id" },
        { column_name: "team_id" },
        { column_name: "target_user_id" },
        { column_name: "invited_by_user_id" },
        { column_name: "requested_lane" },
        { column_name: "note" },
        { column_name: "role" },
        { column_name: "team_role" },
        { column_name: "status" },
        { column_name: "reviewed_by_user_id" },
        { column_name: "reviewed_at" },
        { column_name: "created_at" }
      ]
    }));
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({ query, release }))
    };

    await expect(assertInvitationSchema(pool)).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("fails with a clear error when invitation schema columns are missing", async () => {
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({
        query: vi.fn(async () => ({
          rows: [{ column_name: "id" }, { column_name: "team_id" }]
        })),
        release
      }))
    };

    const error = await assertInvitationSchema(pool).catch((caught) => caught);
    expect(error).toMatchObject({ code: "SCHEMA_MISMATCH" });
    expect(error.message).toContain("public.team_member_invitations");
    expect(release).toHaveBeenCalled();
  });
});
