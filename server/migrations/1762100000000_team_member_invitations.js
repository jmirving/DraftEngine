export function up(pgm) {
  pgm.createTable("team_member_invitations", {
    id: {
      type: "bigserial",
      primaryKey: true
    },
    team_id: {
      type: "bigint",
      notNull: true,
      references: "teams",
      onDelete: "CASCADE"
    },
    target_user_id: {
      type: "bigint",
      notNull: true,
      references: "users",
      onDelete: "CASCADE"
    },
    invited_by_user_id: {
      type: "bigint",
      notNull: true,
      references: "users",
      onDelete: "CASCADE"
    },
    requested_lane: {
      type: "text",
      notNull: true
    },
    note: {
      type: "text",
      notNull: true,
      default: ""
    },
    status: {
      type: "text",
      notNull: true,
      default: "pending"
    },
    reviewed_by_user_id: {
      type: "bigint",
      references: "users",
      onDelete: "SET NULL"
    },
    reviewed_at: {
      type: "timestamptz"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });

  pgm.addConstraint("team_member_invitations", "team_member_invitations_status_check", {
    check: "status IN ('pending', 'accepted', 'rejected', 'canceled')"
  });

  pgm.addConstraint("team_member_invitations", "team_member_invitations_lane_check", {
    check: "requested_lane IN ('Top', 'Jungle', 'Mid', 'ADC', 'Support')"
  });

  pgm.createIndex("team_member_invitations", ["team_id", "status"]);
  pgm.createIndex("team_member_invitations", ["target_user_id", "status"]);
  pgm.createIndex("team_member_invitations", ["team_id", "target_user_id"], {
    unique: true,
    where: "status = 'pending'"
  });
}

export function down(pgm) {
  pgm.dropIndex("team_member_invitations", ["team_id", "target_user_id"]);
  pgm.dropIndex("team_member_invitations", ["target_user_id", "status"]);
  pgm.dropIndex("team_member_invitations", ["team_id", "status"]);
  pgm.dropConstraint("team_member_invitations", "team_member_invitations_lane_check");
  pgm.dropConstraint("team_member_invitations", "team_member_invitations_status_check");
  pgm.dropTable("team_member_invitations");
}
