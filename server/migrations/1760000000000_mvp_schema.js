export function up(pgm) {
  pgm.createTable("users", {
    id: {
      type: "bigserial",
      primaryKey: true
    },
    email: {
      type: "text",
      notNull: true,
      unique: true
    },
    password_hash: {
      type: "text",
      notNull: true
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });

  pgm.createTable("champions", {
    id: {
      type: "bigserial",
      primaryKey: true
    },
    name: {
      type: "text",
      notNull: true,
      unique: true
    },
    role: {
      type: "text",
      notNull: true
    },
    metadata_json: {
      type: "jsonb"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });

  pgm.createTable("tags", {
    id: {
      type: "bigserial",
      primaryKey: true
    },
    name: {
      type: "text",
      notNull: true,
      unique: true
    },
    category: {
      type: "text",
      notNull: true
    }
  });

  pgm.createTable(
    "champion_tags",
    {
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
        primaryKey: ["champion_id", "tag_id"]
      }
    }
  );

  pgm.createTable("user_champion_pools", {
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
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });

  pgm.createTable(
    "user_pool_champions",
    {
      pool_id: {
        type: "bigint",
        notNull: true,
        references: "user_champion_pools",
        onDelete: "CASCADE"
      },
      champion_id: {
        type: "bigint",
        notNull: true,
        references: "champions",
        onDelete: "CASCADE"
      }
    },
    {
      constraints: {
        primaryKey: ["pool_id", "champion_id"]
      }
    }
  );

  pgm.createIndex("user_champion_pools", "user_id");
  pgm.createIndex("user_pool_champions", "champion_id");
  pgm.createIndex("champions", "role");
}

export function down(pgm) {
  pgm.dropTable("user_pool_champions");
  pgm.dropTable("user_champion_pools");
  pgm.dropTable("champion_tags");
  pgm.dropTable("tags");
  pgm.dropTable("champions");
  pgm.dropTable("users");
}

