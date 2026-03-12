export function up(pgm) {
  pgm.createTable("champion_core", {
    id: {
      type: "bigserial",
      primaryKey: true
    },
    normalized_name: {
      type: "text",
      notNull: true,
      unique: true
    },
    name: {
      type: "text",
      notNull: true
    },
    ddragon_id: {
      type: "text",
      notNull: true,
      unique: true
    },
    riot_champion_id: {
      type: "integer",
      notNull: true,
      unique: true
    },
    riot_tags: {
      type: "text[]",
      notNull: true,
      default: "{}"
    },
    resource_type: {
      type: "text"
    },
    info_attack: {
      type: "integer"
    },
    info_defense: {
      type: "integer"
    },
    info_magic: {
      type: "integer"
    },
    info_difficulty: {
      type: "integer"
    },
    hp: {
      type: "double precision"
    },
    hpperlevel: {
      type: "double precision"
    },
    mp: {
      type: "double precision"
    },
    mpperlevel: {
      type: "double precision"
    },
    movespeed: {
      type: "double precision"
    },
    armor: {
      type: "double precision"
    },
    armorperlevel: {
      type: "double precision"
    },
    spellblock: {
      type: "double precision"
    },
    spellblockperlevel: {
      type: "double precision"
    },
    attackrange: {
      type: "double precision"
    },
    hpregen: {
      type: "double precision"
    },
    hpregenperlevel: {
      type: "double precision"
    },
    mpregen: {
      type: "double precision"
    },
    mpregenperlevel: {
      type: "double precision"
    },
    crit: {
      type: "double precision"
    },
    critperlevel: {
      type: "double precision"
    },
    attackdamage: {
      type: "double precision"
    },
    attackdamageperlevel: {
      type: "double precision"
    },
    attackspeedperlevel: {
      type: "double precision"
    },
    attackspeed: {
      type: "double precision"
    },
    imported_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp")
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });

  pgm.createIndex("champion_core", "name");
  pgm.createIndex("champion_core", "riot_champion_id");
}

export function down(pgm) {
  pgm.dropIndex("champion_core", "riot_champion_id");
  pgm.dropIndex("champion_core", "name");
  pgm.dropTable("champion_core");
}
