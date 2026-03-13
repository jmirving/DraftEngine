export function up(pgm) {
  // Reset all role profile powerSpikes/effectiveness to empty arrays
  // so users can re-enter power spikes from scratch with the new UI.
  // This updates the roleProfiles JSONB for every role key in every metadata row.

  const tables = ["champions", "user_champion_metadata", "team_champion_metadata"];
  for (const table of tables) {
    pgm.sql(`
      UPDATE ${table}
      SET metadata_json = (
        SELECT jsonb_set(
          metadata_json,
          '{roleProfiles}',
          COALESCE(
            (
              SELECT jsonb_object_agg(
                role_key,
                (role_value - 'effectiveness' - 'powerSpikes' - 'power_spikes') || '{"powerSpikes": []}'::jsonb
              )
              FROM jsonb_each(metadata_json -> 'roleProfiles') AS kv(role_key, role_value)
            ),
            '{}'::jsonb
          )
        )
      )
      WHERE metadata_json ? 'roleProfiles';
    `);
  }
}

export function down(_pgm) {}
