export function up(pgm) {
  pgm.addColumn("user_draft_setups", {
    description: {
      type: "text",
      notNull: true,
      default: ""
    }
  });
}

export function down(pgm) {
  pgm.dropColumns("user_draft_setups", ["description"]);
}
