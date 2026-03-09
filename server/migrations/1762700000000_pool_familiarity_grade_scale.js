export function up(pgm) {
  pgm.sql(`
    UPDATE user_pool_champions
    SET familiarity = 4
    WHERE familiarity > 4
  `);

  pgm.dropConstraint("user_pool_champions", "user_pool_champions_familiarity_range");
  pgm.addConstraint("user_pool_champions", "user_pool_champions_familiarity_range", {
    check: "familiarity BETWEEN 1 AND 4"
  });
}

export function down(pgm) {
  pgm.dropConstraint("user_pool_champions", "user_pool_champions_familiarity_range");
  pgm.addConstraint("user_pool_champions", "user_pool_champions_familiarity_range", {
    check: "familiarity BETWEEN 1 AND 6"
  });
}
