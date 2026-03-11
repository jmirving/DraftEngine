function normalizeStoredMetadata(rawValue) {
  const normalized =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? rawValue
      : {};
  const { tags: _legacyTags, ...withoutLegacyTags } = normalized;
  return withoutLegacyTags;
}

function mapChampionRow(row) {
  const metadata = normalizeStoredMetadata(row.metadata_json);
  const reviewed = metadata.reviewed === true;
  const reviewedByUserId = Number.isInteger(metadata.reviewedByUserId)
    ? metadata.reviewedByUserId
    : (metadata.reviewedByUserId === null ? null : null);
  const reviewedAt = typeof metadata.reviewedAt === "string" ? metadata.reviewedAt : null;

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    metadata,
    tagIds: Array.isArray(row.tag_ids) ? row.tag_ids.map((value) => Number(value)) : [],
    reviewed,
    reviewed_by_user_id: reviewedByUserId,
    reviewed_at: reviewedAt
  };
}

function mapPrimaryDamageTypeToLegacyValue(primaryDamageType) {
  if (primaryDamageType === "ad") {
    return "AD";
  }
  if (primaryDamageType === "ap") {
    return "AP";
  }
  if (primaryDamageType === "mixed") {
    return "Mixed";
  }
  if (primaryDamageType === "utility") {
    return "Utility";
  }
  return "Mixed";
}

function deriveLegacyScalingFromEffectiveness(effectiveness = {}) {
  const levels = {
    weak: 1,
    neutral: 2,
    strong: 3
  };
  const phases = ["early", "mid", "late"];
  let bestPhase = "mid";
  let bestLevel = 0;
  for (const phase of phases) {
    const level = levels[String(effectiveness?.[phase] ?? "").toLowerCase()] ?? 0;
    if (level > bestLevel) {
      bestLevel = level;
      bestPhase = phase;
    }
  }
  if (bestPhase === "early") {
    return "Early";
  }
  if (bestPhase === "late") {
    return "Late";
  }
  return "Mid";
}

function buildScopedMetadataConfig(scope) {
  switch (scope) {
    case "self":
      return {
        table: "user_champion_metadata",
        ownerColumn: "user_id",
        ownerValueName: "userId"
      };
    case "team":
      return {
        table: "team_champion_metadata",
        ownerColumn: "team_id",
        ownerValueName: "teamId"
      };
    default:
      throw new Error(`Unsupported metadata scope '${scope}'.`);
  }
}

function buildNextMetadata(currentMetadata, roles, roleProfiles) {
  const normalizedCurrentMetadata = normalizeStoredMetadata(currentMetadata);

  const normalizedRoleProfiles =
    roleProfiles && typeof roleProfiles === "object" && !Array.isArray(roleProfiles)
      ? roleProfiles
      : {};
  const primaryRole = roles[0];
  const primaryRoleProfile =
    primaryRole &&
    normalizedRoleProfiles[primaryRole] &&
    typeof normalizedRoleProfiles[primaryRole] === "object" &&
    !Array.isArray(normalizedRoleProfiles[primaryRole])
      ? normalizedRoleProfiles[primaryRole]
      : null;

  return {
    ...normalizedCurrentMetadata,
    roles: [...roles],
    roleProfiles: normalizedRoleProfiles,
    damageType: mapPrimaryDamageTypeToLegacyValue(primaryRoleProfile?.primaryDamageType),
    scaling: deriveLegacyScalingFromEffectiveness(primaryRoleProfile?.effectiveness)
  };
}

async function listScopedMetadataChampionIds(pool, championIds, scope, ownerId) {
  if (!Array.isArray(championIds) || championIds.length === 0 || !Number.isInteger(ownerId)) {
    return new Set();
  }
  const config = buildScopedMetadataConfig(scope);
  const result = await pool.query(
    `
      SELECT champion_id
      FROM ${config.table}
      WHERE champion_id = ANY($1::bigint[])
        AND ${config.ownerColumn} = $2
    `,
    [championIds, ownerId]
  );
  return new Set(result.rows.map((row) => Number(row.champion_id)));
}

export function createChampionsRepository(pool) {
  return {
    async listChampions() {
      const result = await pool.query(
        `
          SELECT
            c.id,
            c.name,
            c.role,
            c.metadata_json,
            COALESCE(
              json_agg(ct.tag_id ORDER BY ct.tag_id)
                FILTER (WHERE ct.tag_id IS NOT NULL),
              '[]'::json
            ) AS tag_ids
          FROM champions c
          LEFT JOIN champion_tags ct
            ON ct.champion_id = c.id
          GROUP BY c.id
          ORDER BY c.name ASC
        `
      );
      return result.rows.map(mapChampionRow);
    },

    async getChampionById(championId) {
      const result = await pool.query(
        `
          SELECT
            c.id,
            c.name,
            c.role,
            c.metadata_json,
            COALESCE(
              json_agg(ct.tag_id ORDER BY ct.tag_id)
                FILTER (WHERE ct.tag_id IS NOT NULL),
              '[]'::json
            ) AS tag_ids
          FROM champions c
          LEFT JOIN champion_tags ct
            ON ct.champion_id = c.id
          WHERE c.id = $1
          GROUP BY c.id
        `,
        [championId]
      );

      return result.rows[0] ? mapChampionRow(result.rows[0]) : null;
    },

    async championExists(championId) {
      const result = await pool.query(
        `
          SELECT 1
          FROM champions
          WHERE id = $1
        `,
        [championId]
      );
      return result.rowCount > 0;
    },

    async listMetadataScopeFlagsByChampionIds({ championIds, userId = null, teamId = null }) {
      const normalizedChampionIds = Array.from(
        new Set(
          (Array.isArray(championIds) ? championIds : [])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
        )
      );
      const flagsByChampionId = Object.fromEntries(
        normalizedChampionIds.map((championId) => [
          championId,
          {
            self: false,
            team: false,
            all: true
          }
        ])
      );
      if (normalizedChampionIds.length === 0) {
        return flagsByChampionId;
      }

      const selfIds = await listScopedMetadataChampionIds(pool, normalizedChampionIds, "self", userId);
      const teamIds = await listScopedMetadataChampionIds(pool, normalizedChampionIds, "team", teamId);

      for (const championId of selfIds) {
        if (flagsByChampionId[championId]) {
          flagsByChampionId[championId].self = true;
        }
      }
      for (const championId of teamIds) {
        if (flagsByChampionId[championId]) {
          flagsByChampionId[championId].team = true;
        }
      }

      return flagsByChampionId;
    },

    async getResolvedChampionMetadataForScope({
      championId,
      scope = "all",
      userId = null,
      teamId = null
    }) {
      const champion = await this.getChampionById(championId);
      if (!champion) {
        return null;
      }

      if (scope === "all") {
        return {
          champion,
          metadata: normalizeStoredMetadata(champion.metadata),
          hasCustomMetadata: true,
          resolvedScope: "all"
        };
      }

      const config = buildScopedMetadataConfig(scope);
      const ownerValue = config.ownerValueName === "userId" ? userId : teamId;
      if (!Number.isInteger(ownerValue)) {
        return {
          champion,
          metadata: normalizeStoredMetadata(champion.metadata),
          hasCustomMetadata: false,
          resolvedScope: "all"
        };
      }

      const result = await pool.query(
        `
          SELECT metadata_json
          FROM ${config.table}
          WHERE champion_id = $1
            AND ${config.ownerColumn} = $2
        `,
        [championId, ownerValue]
      );
      if (result.rowCount === 0) {
        return {
          champion,
          metadata: normalizeStoredMetadata(champion.metadata),
          hasCustomMetadata: false,
          resolvedScope: "all"
        };
      }

      return {
        champion,
        metadata: normalizeStoredMetadata(result.rows[0]?.metadata_json),
        hasCustomMetadata: true,
        resolvedScope: scope
      };
    },

    async updateChampionMetadataForScope({
      championId,
      scope = "all",
      userId = null,
      teamId = null,
      roles,
      roleProfiles
    }) {
      if (scope === "all") {
        const currentResult = await pool.query(
          `
            SELECT metadata_json
            FROM champions
            WHERE id = $1
          `,
          [championId]
        );
        if (currentResult.rowCount === 0) {
          return null;
        }

        const nextMetadata = buildNextMetadata(currentResult.rows[0]?.metadata_json, roles, roleProfiles);
        await pool.query(
          `
            UPDATE champions
            SET role = $2,
                metadata_json = $3::jsonb
            WHERE id = $1
          `,
          [championId, roles[0], JSON.stringify(nextMetadata)]
        );
      } else {
        const config = buildScopedMetadataConfig(scope);
        const ownerValue = config.ownerValueName === "userId" ? userId : teamId;
        if (!Number.isInteger(ownerValue)) {
          throw new Error(`Missing owner value for metadata scope '${scope}'.`);
        }

        const currentScopedResult = await pool.query(
          `
            SELECT metadata_json
            FROM ${config.table}
            WHERE champion_id = $1
              AND ${config.ownerColumn} = $2
          `,
          [championId, ownerValue]
        );
        const fallbackChampion = await this.getChampionById(championId);
        if (!fallbackChampion) {
          return null;
        }
        const baseMetadata =
          currentScopedResult.rowCount > 0
            ? currentScopedResult.rows[0]?.metadata_json
            : fallbackChampion.metadata;
        const nextMetadata = buildNextMetadata(baseMetadata, roles, roleProfiles);

        await pool.query(
          `
            INSERT INTO ${config.table} (${config.ownerColumn}, champion_id, metadata_json)
            VALUES ($1, $2, $3::jsonb)
            ON CONFLICT (${config.ownerColumn}, champion_id)
            DO UPDATE SET metadata_json = EXCLUDED.metadata_json,
                          updated_at = current_timestamp
          `,
          [ownerValue, championId, JSON.stringify(nextMetadata)]
        );
      }

      return this.getResolvedChampionMetadataForScope({
        championId,
        scope,
        userId,
        teamId
      });
    },

    async updateChampionReviewState(championId, { reviewed, reviewedByUserId = null }) {
      const currentResult = await pool.query(
        `
          SELECT metadata_json
          FROM champions
          WHERE id = $1
        `,
        [championId]
      );
      if (currentResult.rowCount === 0) {
        return null;
      }

      const currentMetadata = normalizeStoredMetadata(currentResult.rows[0]?.metadata_json);
      const nextReviewed = reviewed === true;
      const nextMetadata = {
        ...currentMetadata,
        reviewed: nextReviewed,
        reviewedByUserId: nextReviewed && Number.isInteger(reviewedByUserId) ? reviewedByUserId : null,
        reviewedAt: nextReviewed ? new Date().toISOString() : null
      };

      await pool.query(
        `
          UPDATE champions
          SET metadata_json = $2::jsonb
          WHERE id = $1
        `,
        [championId, JSON.stringify(nextMetadata)]
      );

      return this.getChampionById(championId);
    }
  };
}
