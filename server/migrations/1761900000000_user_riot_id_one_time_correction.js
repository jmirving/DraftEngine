export function up(pgm) {
  pgm.addColumn("users", {
    riot_id_correction_count: {
      type: "integer",
      notNull: true,
      default: 0
    }
  });
}

export function down(pgm) {
  pgm.dropColumn("users", "riot_id_correction_count");
}
