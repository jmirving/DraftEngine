export function up(pgm) {
  pgm.createTable("password_reset_tokens", {
    id: {
      type: "bigserial",
      primaryKey: true
    },
    user_id: {
      type: "bigint",
      notNull: true,
      references: '"users"',
      onDelete: "CASCADE"
    },
    token_hash: {
      type: "text",
      notNull: true,
      unique: true
    },
    expires_at: {
      type: "timestamptz",
      notNull: true
    },
    used_at: {
      type: "timestamptz"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });

  pgm.createIndex("password_reset_tokens", "user_id");
}

export function down(pgm) {
  pgm.dropTable("password_reset_tokens");
}
