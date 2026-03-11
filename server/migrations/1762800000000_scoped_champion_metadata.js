export function up(pgm) {
  pgm.createTable(
    "user_champion_metadata",
    {
      user_id: {
        type: "bigint",
        notNull: true,
        references: "users",
        onDelete: "CASCADE"
      },
      champion_id: {
        type: "bigint",
        notNull: true,
        references: "champions",
        onDelete: "CASCADE"
      },
      metadata_json: {
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
    },
    {
      constraints: {
        primaryKey: ["user_id", "champion_id"]
      }
    }
  );

  pgm.createTable(
    "team_champion_metadata",
    {
      team_id: {
        type: "bigint",
        notNull: true,
        references: "teams",
        onDelete: "CASCADE"
      },
      champion_id: {
        type: "bigint",
        notNull: true,
        references: "champions",
        onDelete: "CASCADE"
      },
      metadata_json: {
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
    },
    {
      constraints: {
        primaryKey: ["team_id", "champion_id"]
      }
    }
  );

  pgm.createIndex("user_champion_metadata", ["champion_id", "user_id"]);
  pgm.createIndex("team_champion_metadata", ["champion_id", "team_id"]);
}

export function down(pgm) {
  pgm.dropIndex("team_champion_metadata", ["champion_id", "team_id"]);
  pgm.dropIndex("user_champion_metadata", ["champion_id", "user_id"]);

  pgm.dropTable("team_champion_metadata");
  pgm.dropTable("user_champion_metadata");
}
