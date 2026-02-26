export function up(pgm) {
  pgm.addColumn("users", {
    primary_role: {
      type: "text",
      notNull: true,
      default: "Mid"
    },
    secondary_roles: {
      type: "text[]",
      notNull: true,
      default: pgm.func("ARRAY[]::text[]")
    }
  });

  pgm.addConstraint("users", "users_primary_role_check", {
    check: "primary_role IN ('Top', 'Jungle', 'Mid', 'ADC', 'Support')"
  });

  pgm.addConstraint("users", "users_secondary_roles_check", {
    check:
      "secondary_roles <@ ARRAY['Top', 'Jungle', 'Mid', 'ADC', 'Support']::text[] AND NOT (primary_role = ANY(secondary_roles))"
  });

  pgm.addColumn("team_members", {
    team_role: {
      type: "text",
      notNull: true,
      default: "primary"
    }
  });

  pgm.addConstraint("team_members", "team_members_team_role_check", {
    check: "team_role IN ('primary', 'substitute')"
  });

  pgm.createIndex("team_members", ["team_id", "team_role"]);
}

export function down(pgm) {
  pgm.dropIndex("team_members", ["team_id", "team_role"]);
  pgm.dropConstraint("team_members", "team_members_team_role_check");
  pgm.dropColumn("team_members", "team_role");

  pgm.dropConstraint("users", "users_secondary_roles_check");
  pgm.dropConstraint("users", "users_primary_role_check");
  pgm.dropColumns("users", ["primary_role", "secondary_roles"]);
}
