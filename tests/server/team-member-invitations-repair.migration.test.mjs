import { describe, expect, it } from "vitest";

import { down, up } from "../../server/migrations/1763400000000_repair_team_member_invitation_roles.js";

describe("team member invitations repair migration", () => {
  it("repairs missing invitation role columns, constraints, and indexes", () => {
    const calls = [];
    const pgm = {
      sql(statement) {
        calls.push(statement);
      }
    };

    up(pgm);

    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain("ADD COLUMN IF NOT EXISTS role text");
    expect(calls[0]).toContain("ADD COLUMN IF NOT EXISTS team_role text");
    expect(calls[0]).toContain("ALTER COLUMN role SET DEFAULT 'member'");
    expect(calls[1]).toContain("team_member_invitations_role_check");
    expect(calls[1]).toContain("team_member_invitations_team_role_check");
    expect(calls[2]).toContain("CREATE INDEX IF NOT EXISTS team_member_invitations_team_id_status_idx");
    expect(calls[2]).toContain("CREATE UNIQUE INDEX IF NOT EXISTS team_member_invitations_team_id_target_user_id_pending_idx");
  });

  it("uses a no-op down migration", () => {
    expect(down()).toBeUndefined();
  });
});
