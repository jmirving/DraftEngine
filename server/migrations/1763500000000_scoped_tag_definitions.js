export function up(pgm) {
  pgm.createTable("tag_definitions", {
    id: "id",
    tag_id: {
      type: "bigint",
      notNull: true,
      references: "tags",
      onDelete: "CASCADE"
    },
    scope: {
      type: "text",
      notNull: true,
      default: "all"
    },
    user_id: {
      type: "bigint",
      references: "users",
      onDelete: "CASCADE"
    },
    team_id: {
      type: "bigint",
      references: "teams",
      onDelete: "CASCADE"
    },
    definition: {
      type: "text",
      notNull: true,
      default: ""
    },
    created_by_user_id: {
      type: "bigint",
      references: "users",
      onDelete: "SET NULL"
    },
    updated_by_user_id: {
      type: "bigint",
      references: "users",
      onDelete: "SET NULL"
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

  pgm.addConstraint("tag_definitions", "tag_definitions_scope_check", {
    check: "scope IN ('self', 'team', 'all')"
  });
  pgm.addConstraint("tag_definitions", "tag_definitions_scope_owner_check", {
    check: `
      (scope = 'all' AND user_id IS NULL AND team_id IS NULL) OR
      (scope = 'self' AND user_id IS NOT NULL AND team_id IS NULL) OR
      (scope = 'team' AND team_id IS NOT NULL AND user_id IS NULL)
    `
  });
  pgm.createIndex("tag_definitions", ["scope", "user_id", "team_id"]);
  pgm.sql(`
    CREATE UNIQUE INDEX tag_definitions_scope_unique_idx
    ON tag_definitions (
      tag_id,
      scope,
      COALESCE(user_id, 0),
      COALESCE(team_id, 0)
    )
  `);

  pgm.sql(`
    INSERT INTO tag_definitions (tag_id, scope, definition)
    SELECT id, 'all', definition
    FROM tags
  `);
}

export function down(pgm) {
  pgm.sql("DROP INDEX IF EXISTS tag_definitions_scope_unique_idx");
  pgm.dropIndex("tag_definitions", ["scope", "user_id", "team_id"], { ifExists: true });
  pgm.dropConstraint("tag_definitions", "tag_definitions_scope_owner_check", { ifExists: true });
  pgm.dropConstraint("tag_definitions", "tag_definitions_scope_check", { ifExists: true });
  pgm.dropTable("tag_definitions", { ifExists: true });
}
