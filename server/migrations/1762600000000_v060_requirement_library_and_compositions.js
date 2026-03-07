export function up(pgm) {
  pgm.createTable("composition_rule_definitions", {
    id: {
      type: "bigserial",
      primaryKey: true
    },
    name: {
      type: "text",
      notNull: true,
      unique: true
    },
    definition: {
      type: "text",
      notNull: true,
      default: ""
    },
    rules_json: {
      type: "jsonb",
      notNull: true,
      default: "[]"
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

  pgm.addConstraint("composition_rule_definitions", "composition_rule_definitions_name_nonempty_check", {
    check: "length(trim(name)) > 0"
  });

  pgm.createTable("compositions", {
    id: {
      type: "bigserial",
      primaryKey: true
    },
    name: {
      type: "text",
      notNull: true,
      unique: true
    },
    description: {
      type: "text",
      notNull: true,
      default: ""
    },
    requirement_ids_json: {
      type: "jsonb",
      notNull: true,
      default: "[]"
    },
    is_active: {
      type: "boolean",
      notNull: true,
      default: false
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

  pgm.addConstraint("compositions", "compositions_name_nonempty_check", {
    check: "length(trim(name)) > 0"
  });

  pgm.createIndex("compositions", "is_active");
  pgm.sql(
    `
      CREATE UNIQUE INDEX compositions_single_active_idx
      ON compositions (is_active)
      WHERE is_active = true
    `
  );
}

export function down(pgm) {
  pgm.sql("DROP INDEX IF EXISTS compositions_single_active_idx");
  pgm.dropIndex("compositions", "is_active", { ifExists: true });
  pgm.dropConstraint("compositions", "compositions_name_nonempty_check", { ifExists: true });
  pgm.dropTable("compositions", { ifExists: true });

  pgm.dropConstraint("composition_rule_definitions", "composition_rule_definitions_name_nonempty_check", {
    ifExists: true
  });
  pgm.dropTable("composition_rule_definitions", { ifExists: true });
}
