export function up(pgm) {
  pgm.addColumn("users", {
    game_name: {
      type: "text"
    },
    tagline: {
      type: "text"
    }
  });
}

export function down(pgm) {
  pgm.dropColumns("users", ["game_name", "tagline"]);
}
