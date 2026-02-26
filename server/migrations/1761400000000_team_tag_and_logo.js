export function up(pgm) {
  pgm.addColumn("teams", {
    tag: {
      type: "text"
    },
    logo_url: {
      type: "text"
    }
  });
}

export function down(pgm) {
  pgm.dropColumns("teams", ["tag", "logo_url"]);
}
