export function up(pgm) {
  pgm.sql(`
    WITH duplicates AS (
      SELECT id, name,
        ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY id) AS rn
      FROM teams
      WHERE name IS NOT NULL
    )
    UPDATE teams
    SET name = CONCAT(name, ' (dup ', id, ')')
    FROM duplicates
    WHERE teams.id = duplicates.id AND duplicates.rn > 1
  `);

  pgm.sql(`
    WITH duplicates AS (
      SELECT id, tag,
        ROW_NUMBER() OVER (PARTITION BY lower(tag) ORDER BY id) AS rn
      FROM teams
      WHERE tag IS NOT NULL
    )
    UPDATE teams
    SET tag = CONCAT(tag, '_', id)
    FROM duplicates
    WHERE teams.id = duplicates.id AND duplicates.rn > 1
  `);

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
