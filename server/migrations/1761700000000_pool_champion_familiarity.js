export function up(pgm) {
  pgm.addColumn("user_pool_champions", {
    familiarity: {
      type: "smallint",
      notNull: true,
      default: 3
    }
  });

  pgm.addConstraint("user_pool_champions", "user_pool_champions_familiarity_range", {
    check: "familiarity BETWEEN 1 AND 6"
  });
}

export function down(pgm) {
  pgm.dropConstraint("user_pool_champions", "user_pool_champions_familiarity_range");
  pgm.dropColumn("user_pool_champions", "familiarity");
}
