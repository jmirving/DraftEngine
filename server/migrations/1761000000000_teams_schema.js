export function up(pgm) {
  pgm.createTable("teams", {
    id: {
      type: "bigserial",
      primaryKey: true
    },
    name: {
      type: "text",
      notNull: true
    },
    created_by: {
      type: "bigint",
      notNull: true,
      references: "users",
      onDelete: "CASCADE"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });

  pgm.createTable(
    "team_members",
    {
      team_id: {
        type: "bigint",
        notNull: true,
        references: "teams",
        onDelete: "CASCADE"
      },
      user_id: {
        type: "bigint",
        notNull: true,
        references: "users",
        onDelete: "CASCADE"
      },
      role: {
        type: "text",
        notNull: true,
        default: "member"
      },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("current_timestamp")
      }
    },
    {
      constraints: {
        primaryKey: ["team_id", "user_id"],
        check: "role IN ('lead', 'member')"
      }
    }
  );

  pgm.createIndex("teams", "created_by");
  pgm.createIndex("team_members", "user_id");
  pgm.createIndex("team_members", ["team_id", "role"]);
}

export function down(pgm) {
  pgm.dropTable("team_members");
  pgm.dropTable("teams");
}
