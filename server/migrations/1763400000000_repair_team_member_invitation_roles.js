export function up(pgm) {
  pgm.sql(`
    ALTER TABLE team_member_invitations
      ADD COLUMN IF NOT EXISTS role text,
      ADD COLUMN IF NOT EXISTS team_role text;

    UPDATE team_member_invitations
    SET role = COALESCE(role, 'member'),
        team_role = COALESCE(team_role, 'primary')
    WHERE role IS NULL
       OR team_role IS NULL;

    ALTER TABLE team_member_invitations
      ALTER COLUMN role SET DEFAULT 'member',
      ALTER COLUMN role SET NOT NULL,
      ALTER COLUMN team_role SET DEFAULT 'primary',
      ALTER COLUMN team_role SET NOT NULL;
  `);

  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'team_member_invitations_role_check'
      ) THEN
        ALTER TABLE team_member_invitations
          ADD CONSTRAINT team_member_invitations_role_check
          CHECK (role IN ('lead', 'member'));
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'team_member_invitations_team_role_check'
      ) THEN
        ALTER TABLE team_member_invitations
          ADD CONSTRAINT team_member_invitations_team_role_check
          CHECK (team_role IN ('primary', 'substitute'));
      END IF;
    END
    $$;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS team_member_invitations_team_id_status_idx
      ON team_member_invitations (team_id, status);
    CREATE INDEX IF NOT EXISTS team_member_invitations_target_user_id_status_idx
      ON team_member_invitations (target_user_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS team_member_invitations_team_id_target_user_id_pending_idx
      ON team_member_invitations (team_id, target_user_id)
      WHERE status = 'pending';
  `);
}

export function down() {}
