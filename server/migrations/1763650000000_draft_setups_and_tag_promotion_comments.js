export function up(pgm) {
  pgm.addColumn("scope_promotion_requests", {
    request_comment: {
      type: "text"
    },
    review_comment: {
      type: "text"
    },
    reviewed_by_user_id: {
      type: "bigint",
      references: "users",
      onDelete: "SET NULL"
    },
    reviewed_at: {
      type: "timestamptz"
    }
  });

  pgm.dropConstraint("scope_promotion_requests", "scope_promotion_requests_entity_type_check");
  pgm.addConstraint("scope_promotion_requests", "scope_promotion_requests_entity_type_check", {
    check: "entity_type IN ('checks', 'champion_tags', 'tag_definitions')"
  });

  pgm.createTable("user_draft_setups", {
    id: {
      type: "bigserial",
      primaryKey: true
    },
    user_id: {
      type: "bigint",
      notNull: true,
      references: "users",
      onDelete: "CASCADE"
    },
    name: {
      type: "text",
      notNull: true
    },
    state_json: {
      type: "jsonb",
      notNull: true,
      default: "{}"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp")
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });

  pgm.createIndex("user_draft_setups", ["user_id", "updated_at"]);
}

export function down(pgm) {
  pgm.dropIndex("user_draft_setups", ["user_id", "updated_at"]);
  pgm.dropTable("user_draft_setups");

  pgm.dropConstraint("scope_promotion_requests", "scope_promotion_requests_entity_type_check");
  pgm.addConstraint("scope_promotion_requests", "scope_promotion_requests_entity_type_check", {
    check: "entity_type IN ('checks', 'champion_tags')"
  });

  pgm.dropColumn("scope_promotion_requests", [
    "request_comment",
    "review_comment",
    "reviewed_by_user_id",
    "reviewed_at"
  ]);
}
