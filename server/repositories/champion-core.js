function mapChampionCoreRow(row) {
  return {
    id: Number(row.id),
    normalized_name: row.normalized_name,
    name: row.name,
    ddragon_id: row.ddragon_id,
    riot_champion_id: Number(row.riot_champion_id),
    riot_tags: Array.isArray(row.riot_tags) ? row.riot_tags : [],
    resource_type: row.resource_type,
    info_attack: row.info_attack === null ? null : Number(row.info_attack),
    info_defense: row.info_defense === null ? null : Number(row.info_defense),
    info_magic: row.info_magic === null ? null : Number(row.info_magic),
    info_difficulty: row.info_difficulty === null ? null : Number(row.info_difficulty),
    hp: row.hp === null ? null : Number(row.hp),
    hpperlevel: row.hpperlevel === null ? null : Number(row.hpperlevel),
    mp: row.mp === null ? null : Number(row.mp),
    mpperlevel: row.mpperlevel === null ? null : Number(row.mpperlevel),
    movespeed: row.movespeed === null ? null : Number(row.movespeed),
    armor: row.armor === null ? null : Number(row.armor),
    armorperlevel: row.armorperlevel === null ? null : Number(row.armorperlevel),
    spellblock: row.spellblock === null ? null : Number(row.spellblock),
    spellblockperlevel: row.spellblockperlevel === null ? null : Number(row.spellblockperlevel),
    attackrange: row.attackrange === null ? null : Number(row.attackrange),
    hpregen: row.hpregen === null ? null : Number(row.hpregen),
    hpregenperlevel: row.hpregenperlevel === null ? null : Number(row.hpregenperlevel),
    mpregen: row.mpregen === null ? null : Number(row.mpregen),
    mpregenperlevel: row.mpregenperlevel === null ? null : Number(row.mpregenperlevel),
    crit: row.crit === null ? null : Number(row.crit),
    critperlevel: row.critperlevel === null ? null : Number(row.critperlevel),
    attackdamage: row.attackdamage === null ? null : Number(row.attackdamage),
    attackdamageperlevel: row.attackdamageperlevel === null ? null : Number(row.attackdamageperlevel),
    attackspeedperlevel: row.attackspeedperlevel === null ? null : Number(row.attackspeedperlevel),
    attackspeed: row.attackspeed === null ? null : Number(row.attackspeed),
    imported_at: row.imported_at,
    updated_at: row.updated_at
  };
}

export function createChampionCoreRepository(pool) {
  return {
    async listChampionCore() {
      const result = await pool.query(
        `
          SELECT
            id,
            normalized_name,
            name,
            ddragon_id,
            riot_champion_id,
            riot_tags,
            resource_type,
            info_attack,
            info_defense,
            info_magic,
            info_difficulty,
            hp,
            hpperlevel,
            mp,
            mpperlevel,
            movespeed,
            armor,
            armorperlevel,
            spellblock,
            spellblockperlevel,
            attackrange,
            hpregen,
            hpregenperlevel,
            mpregen,
            mpregenperlevel,
            crit,
            critperlevel,
            attackdamage,
            attackdamageperlevel,
            attackspeedperlevel,
            attackspeed,
            imported_at,
            updated_at
          FROM champion_core
          ORDER BY name ASC
        `
      );

      return result.rows.map(mapChampionCoreRow);
    },

    async getChampionCoreByRiotChampionId(riotChampionId) {
      const result = await pool.query(
        `
          SELECT
            id,
            normalized_name,
            name,
            ddragon_id,
            riot_champion_id,
            riot_tags,
            resource_type,
            info_attack,
            info_defense,
            info_magic,
            info_difficulty,
            hp,
            hpperlevel,
            mp,
            mpperlevel,
            movespeed,
            armor,
            armorperlevel,
            spellblock,
            spellblockperlevel,
            attackrange,
            hpregen,
            hpregenperlevel,
            mpregen,
            mpregenperlevel,
            crit,
            critperlevel,
            attackdamage,
            attackdamageperlevel,
            attackspeedperlevel,
            attackspeed,
            imported_at,
            updated_at
          FROM champion_core
          WHERE riot_champion_id = $1
        `,
        [riotChampionId]
      );

      return result.rows[0] ? mapChampionCoreRow(result.rows[0]) : null;
    }
  };
}
