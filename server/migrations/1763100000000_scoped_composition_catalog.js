export function up(pgm) {
  pgm.addColumn("composition_rule_definitions", {
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
    }
  });

  pgm.addConstraint("composition_rule_definitions", "composition_rule_definitions_scope_check", {
    check: "scope IN ('self', 'team', 'all')"
  });
  pgm.addConstraint("composition_rule_definitions", "composition_rule_definitions_scope_owner_check", {
    check: `
      (scope = 'all' AND user_id IS NULL AND team_id IS NULL) OR
      (scope = 'self' AND user_id IS NOT NULL AND team_id IS NULL) OR
      (scope = 'team' AND team_id IS NOT NULL AND user_id IS NULL)
    `
  });
  pgm.createIndex("composition_rule_definitions", ["scope", "user_id", "team_id"]);
  pgm.sql(`
    CREATE UNIQUE INDEX composition_rule_definitions_scope_name_unique_idx
    ON composition_rule_definitions (
      lower(name),
      scope,
      COALESCE(user_id, 0),
      COALESCE(team_id, 0)
    )
  `);

  pgm.addColumn("compositions", {
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
    }
  });

  pgm.addConstraint("compositions", "compositions_scope_check", {
    check: "scope IN ('self', 'team', 'all')"
  });
  pgm.addConstraint("compositions", "compositions_scope_owner_check", {
    check: `
      (scope = 'all' AND user_id IS NULL AND team_id IS NULL) OR
      (scope = 'self' AND user_id IS NOT NULL AND team_id IS NULL) OR
      (scope = 'team' AND team_id IS NOT NULL AND user_id IS NULL)
    `
  });
  pgm.createIndex("compositions", ["scope", "user_id", "team_id"]);
  pgm.sql(`
    CREATE UNIQUE INDEX compositions_scope_name_unique_idx
    ON compositions (
      lower(name),
      scope,
      COALESCE(user_id, 0),
      COALESCE(team_id, 0)
    )
  `);
  pgm.sql("DROP INDEX IF EXISTS compositions_single_active_idx");
  pgm.sql(`
    CREATE UNIQUE INDEX compositions_single_global_active_idx
    ON compositions ((1))
    WHERE is_active = true AND scope = 'all'
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX compositions_single_self_active_idx
    ON compositions (user_id)
    WHERE is_active = true AND scope = 'self'
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX compositions_single_team_active_idx
    ON compositions (team_id)
    WHERE is_active = true AND scope = 'team'
  `);
}

export function down(pgm) {
  pgm.sql("DROP INDEX IF EXISTS compositions_single_team_active_idx");
  pgm.sql("DROP INDEX IF EXISTS compositions_single_self_active_idx");
  pgm.sql("DROP INDEX IF EXISTS compositions_single_global_active_idx");
  pgm.sql("DROP INDEX IF EXISTS compositions_scope_name_unique_idx");
  pgm.dropIndex("compositions", ["scope", "user_id", "team_id"], { ifExists: true });
  pgm.dropConstraint("compositions", "compositions_scope_owner_check", { ifExists: true });
  pgm.dropConstraint("compositions", "compositions_scope_check", { ifExists: true });
  pgm.dropColumns("compositions", ["scope", "user_id", "team_id"], { ifExists: true });
  pgm.sql(
    `
      CREATE UNIQUE INDEX compositions_single_active_idx
      ON compositions (is_active)
      WHERE is_active = true
    `
  );

  pgm.sql("DROP INDEX IF EXISTS composition_rule_definitions_scope_name_unique_idx");
  pgm.dropIndex("composition_rule_definitions", ["scope", "user_id", "team_id"], { ifExists: true });
  pgm.dropConstraint("composition_rule_definitions", "composition_rule_definitions_scope_owner_check", {
    ifExists: true
  });
  pgm.dropConstraint("composition_rule_definitions", "composition_rule_definitions_scope_check", {
    ifExists: true
  });
  pgm.dropColumns("composition_rule_definitions", ["scope", "user_id", "team_id"], { ifExists: true });
}
