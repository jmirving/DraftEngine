export function up(pgm) {
  pgm.sql(`
    UPDATE champions
    SET metadata_json = metadata_json - 'tags'
    WHERE metadata_json ? 'tags';
  `);

  pgm.sql(`
    UPDATE user_champion_metadata
    SET metadata_json = metadata_json - 'tags'
    WHERE metadata_json ? 'tags';
  `);

  pgm.sql(`
    UPDATE team_champion_metadata
    SET metadata_json = metadata_json - 'tags'
    WHERE metadata_json ? 'tags';
  `);
}

export function down(_pgm) {}
