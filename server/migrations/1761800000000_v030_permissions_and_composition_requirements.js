import { OWNER_ADMIN_EMAIL } from "../user-roles.js";

export function up(pgm) {
  pgm.dropConstraint("users", "users_role_check", { ifExists: true });
  pgm.addConstraint("users", "users_role_check", {
    check: "role IN ('member', 'global', 'admin')"
  });

  pgm.sql(
    `
      UPDATE users
      SET role = 'member'
      WHERE lower(role) = 'admin'
        AND lower(email) <> lower('${OWNER_ADMIN_EMAIL}')
    `
  );
  pgm.sql(
    `
      UPDATE users
      SET role = 'admin'
      WHERE lower(email) = lower('${OWNER_ADMIN_EMAIL}')
    `
  );

  pgm.createTable("composition_requirements", {
    id: {
      type: "bigserial",
      primaryKey: true
    },
    name: {
      type: "text",
      notNull: true,
      unique: true
    },
    toggles_json: {
      type: "jsonb",
      notNull: true,
      default: "{}"
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

  pgm.addConstraint("composition_requirements", "composition_requirements_name_nonempty_check", {
    check: "length(trim(name)) > 0"
  });
  pgm.createIndex("composition_requirements", "is_active");
  pgm.sql(
    `
      CREATE UNIQUE INDEX composition_requirements_single_active_idx
      ON composition_requirements (is_active)
      WHERE is_active = true
    `
  );
}

export function down(pgm) {
  pgm.sql("DROP INDEX IF EXISTS composition_requirements_single_active_idx");
  pgm.dropIndex("composition_requirements", "is_active", { ifExists: true });
  pgm.dropConstraint("composition_requirements", "composition_requirements_name_nonempty_check", { ifExists: true });
  pgm.dropTable("composition_requirements", { ifExists: true });

  pgm.sql("UPDATE users SET role = 'member' WHERE lower(role) = 'global'");
  pgm.dropConstraint("users", "users_role_check", { ifExists: true });
  pgm.addConstraint("users", "users_role_check", {
    check: "role IN ('member', 'admin')"
  });
}
