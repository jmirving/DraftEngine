export function up(pgm) {
  pgm.sql(`
    CREATE UNIQUE INDEX teams_name_lower_unique_idx
    ON teams (lower(name))
    WHERE name IS NOT NULL
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX teams_tag_lower_unique_idx
    ON teams (lower(tag))
    WHERE tag IS NOT NULL
  `);
}

export function down(pgm) {
  pgm.sql("DROP INDEX IF EXISTS teams_tag_lower_unique_idx");
  pgm.sql("DROP INDEX IF EXISTS teams_name_lower_unique_idx");
}
