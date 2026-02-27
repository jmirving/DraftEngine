export function up(pgm) {
  pgm.addColumn("teams", {
    logo_blob: {
      type: "bytea"
    },
    logo_mime_type: {
      type: "text"
    }
  });

  pgm.dropColumn("teams", "logo_url");

  pgm.addColumn("users", {
    default_team_id: {
      type: "bigint",
      references: "teams",
      onDelete: "SET NULL"
    },
    active_team_id: {
      type: "bigint",
      references: "teams",
      onDelete: "SET NULL"
    }
  });
}

export function down(pgm) {
  pgm.dropColumns("users", ["default_team_id", "active_team_id"]);

  pgm.addColumn("teams", {
    logo_url: {
      type: "text"
    }
  });

  pgm.dropColumns("teams", ["logo_blob", "logo_mime_type"]);
}
