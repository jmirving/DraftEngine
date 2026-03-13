import { Pool } from "pg";

const REQUIRED_INVITATION_COLUMNS = [
  "id",
  "team_id",
  "target_user_id",
  "invited_by_user_id",
  "requested_lane",
  "note",
  "role",
  "team_role",
  "status",
  "reviewed_by_user_id",
  "reviewed_at",
  "created_at"
];

export function createDbPool(config) {
  return new Pool({
    connectionString: config.databaseUrl
  });
}

export async function assertDbConnection(pool) {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}

export async function assertInvitationSchema(pool) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'team_member_invitations'
      `
    );
    const presentColumns = new Set(result.rows.map((row) => row.column_name));
    const missingColumns = REQUIRED_INVITATION_COLUMNS.filter((columnName) => !presentColumns.has(columnName));

    if (missingColumns.length > 0) {
      const error = new Error(
        `Database schema mismatch: public.team_member_invitations is missing required columns: ${missingColumns.join(", ")}.`
      );
      error.code = "SCHEMA_MISMATCH";
      throw error;
    }
  } finally {
    client.release();
  }
}
