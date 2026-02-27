export function up(pgm) {
  pgm.addColumn("users", {
    role: {
      type: "text",
      notNull: true,
      default: "member"
    }
  });

  pgm.addConstraint("users", "users_role_check", {
    check: "role IN ('member', 'admin')"
  });

  pgm.createTable("global_required_check_settings", {
    setting_key: {
      type: "text",
      primaryKey: true
    },
    toggles_json: {
      type: "jsonb",
      notNull: true,
      default: "{}"
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });

  pgm.createTable("user_required_check_settings", {
    user_id: {
      type: "bigint",
      primaryKey: true,
      references: "users",
      onDelete: "CASCADE"
    },
    toggles_json: {
      type: "jsonb",
      notNull: true,
      default: "{}"
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });

  pgm.createTable("team_required_check_settings", {
    team_id: {
      type: "bigint",
      primaryKey: true,
      references: "teams",
      onDelete: "CASCADE"
    },
    toggles_json: {
      type: "jsonb",
      notNull: true,
      default: "{}"
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });

  pgm.createTable("scope_promotion_requests", {
    id: {
      type: "bigserial",
      primaryKey: true
    },
    entity_type: {
      type: "text",
      notNull: true
    },
    resource_id: {
      type: "bigint"
    },
    source_scope: {
      type: "text",
      notNull: true
    },
    source_user_id: {
      type: "bigint",
      references: "users",
      onDelete: "SET NULL"
    },
    source_team_id: {
      type: "bigint",
      references: "teams",
      onDelete: "SET NULL"
    },
    target_scope: {
      type: "text",
      notNull: true
    },
    target_team_id: {
      type: "bigint",
      references: "teams",
      onDelete: "SET NULL"
    },
    requested_by: {
      type: "bigint",
      notNull: true,
      references: "users",
      onDelete: "CASCADE"
    },
    status: {
      type: "text",
      notNull: true,
      default: "pending"
    },
    payload_json: {
      type: "jsonb",
      notNull: true,
      default: "{}"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });

  pgm.addConstraint("scope_promotion_requests", "scope_promotion_requests_entity_type_check", {
    check: "entity_type IN ('checks', 'champion_tags')"
  });
  pgm.addConstraint("scope_promotion_requests", "scope_promotion_requests_source_scope_check", {
    check: "source_scope IN ('self', 'team')"
  });
  pgm.addConstraint("scope_promotion_requests", "scope_promotion_requests_target_scope_check", {
    check: "target_scope IN ('team', 'all')"
  });
  pgm.addConstraint("scope_promotion_requests", "scope_promotion_requests_status_check", {
    check: "status IN ('pending', 'approved', 'rejected')"
  });

  pgm.createIndex("scope_promotion_requests", ["requested_by", "created_at"]);
  pgm.createIndex("scope_promotion_requests", ["entity_type", "status"]);
}

export function down(pgm) {
  pgm.dropIndex("scope_promotion_requests", ["entity_type", "status"]);
  pgm.dropIndex("scope_promotion_requests", ["requested_by", "created_at"]);

  pgm.dropConstraint("scope_promotion_requests", "scope_promotion_requests_status_check");
  pgm.dropConstraint("scope_promotion_requests", "scope_promotion_requests_target_scope_check");
  pgm.dropConstraint("scope_promotion_requests", "scope_promotion_requests_source_scope_check");
  pgm.dropConstraint("scope_promotion_requests", "scope_promotion_requests_entity_type_check");

  pgm.dropTable("scope_promotion_requests");
  pgm.dropTable("team_required_check_settings");
  pgm.dropTable("user_required_check_settings");
  pgm.dropTable("global_required_check_settings");

  pgm.dropConstraint("users", "users_role_check");
  pgm.dropColumn("users", "role");
}
