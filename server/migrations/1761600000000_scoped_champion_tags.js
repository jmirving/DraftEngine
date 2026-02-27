export function up(pgm) {
  pgm.createTable(
    "user_champion_tags",
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
      tag_id: {
        type: "bigint",
        notNull: true,
        references: "tags",
        onDelete: "CASCADE"
      }
    },
    {
      constraints: {
        primaryKey: ["user_id", "champion_id", "tag_id"]
      }
    }
  );

  pgm.createTable(
    "team_champion_tags",
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
      tag_id: {
        type: "bigint",
        notNull: true,
        references: "tags",
        onDelete: "CASCADE"
      }
    },
    {
      constraints: {
        primaryKey: ["team_id", "champion_id", "tag_id"]
      }
    }
  );

  pgm.createIndex("user_champion_tags", ["champion_id", "user_id"]);
  pgm.createIndex("team_champion_tags", ["champion_id", "team_id"]);
}

export function down(pgm) {
  pgm.dropIndex("team_champion_tags", ["champion_id", "team_id"]);
  pgm.dropIndex("user_champion_tags", ["champion_id", "user_id"]);

  pgm.dropTable("team_champion_tags");
  pgm.dropTable("user_champion_tags");
}
