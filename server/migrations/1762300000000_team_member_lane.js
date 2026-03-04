export function up(pgm) {
  pgm.addColumn("team_members", {
    lane: {
      type: "text",
      notNull: false
    }
  });

  pgm.addConstraint("team_members", "team_members_lane_check", {
    check: "lane IS NULL OR lane IN ('Top', 'Jungle', 'Mid', 'ADC', 'Support')"
  });

  // Backfill lane from the accepted invitation for existing members
  pgm.sql(`
    UPDATE team_members tm
    SET lane = inv.requested_lane
    FROM team_member_invitations inv
    WHERE inv.team_id = tm.team_id
      AND inv.target_user_id = tm.user_id
      AND inv.status = 'accepted'
      AND inv.requested_lane IS NOT NULL
  `);
}

export function down(pgm) {
  pgm.dropConstraint("team_members", "team_members_lane_check");
  pgm.dropColumn("team_members", "lane");
}
