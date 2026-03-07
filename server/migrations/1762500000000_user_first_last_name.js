export function up(pgm) {
  pgm.addColumn("users", {
    first_name: {
      type: "varchar(255)",
      notNull: false,
      default: null
    },
    last_name: {
      type: "varchar(255)",
      notNull: false,
      default: null
    }
  });
}
