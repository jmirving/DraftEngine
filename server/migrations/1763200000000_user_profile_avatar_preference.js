export function up(pgm) {
  pgm.addColumn("users", {
    avatar_champion_id: {
      type: "bigint",
      references: "champions",
      onDelete: "SET NULL"
    }
  });
}

export function down(pgm) {
  pgm.dropColumns("users", ["avatar_champion_id"]);
}
