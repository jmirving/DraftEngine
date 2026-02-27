export function up(pgm) {
  pgm.createTable("team_join_requests", {
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
    requester_user_id: {
      type: "bigint",
      notNull: true,
      references: "users",
      onDelete: "CASCADE"
    },
    requested_lane: {
      type: "text",
      notNull: true
    },
    status: {
      type: "text",
      notNull: true,
      default: "pending"
    },
    note: {
      type: "text",
      notNull: true,
      default: ""
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

  pgm.addConstraint("team_join_requests", "team_join_requests_status_check", {
    check: "status IN ('pending', 'approved', 'rejected')"
  });

  pgm.addConstraint("team_join_requests", "team_join_requests_lane_check", {
    check: "requested_lane IN ('Top', 'Jungle', 'Mid', 'ADC', 'Support')"
  });

  pgm.createIndex("team_join_requests", ["team_id", "status"]);
  pgm.createIndex("team_join_requests", ["requester_user_id", "status"]);
  pgm.createIndex("team_join_requests", ["team_id", "requester_user_id"], {
    unique: true,
    where: "status = 'pending'"
  });
}

export function down(pgm) {
  pgm.dropTable("team_join_requests");
}
