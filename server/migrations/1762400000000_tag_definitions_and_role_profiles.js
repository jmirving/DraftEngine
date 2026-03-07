export function up(pgm) {
  pgm.addColumn("tags", {
    definition: {
      type: "text",
      notNull: true,
      default: ""
    }
  });

  pgm.sql(`
    UPDATE tags
    SET definition = CASE
      WHEN trim(definition) <> '' THEN definition
      WHEN trim(name) <> '' THEN concat(name, ' definition pending.')
      ELSE 'Definition pending.'
    END
  `);

  pgm.dropColumn("tags", "category");
}

export function down(pgm) {
  pgm.addColumn("tags", {
    category: {
      type: "text",
      notNull: true,
      default: "composition"
    }
  });

  pgm.dropColumn("tags", "definition");
}
