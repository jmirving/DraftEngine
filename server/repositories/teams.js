function toLogoDataUrl(row) {
  if (!row.logo_blob || typeof row.logo_mime_type !== "string" || row.logo_mime_type.trim() === "") {
    return null;
  }

  const logoBuffer = Buffer.isBuffer(row.logo_blob) ? row.logo_blob : Buffer.from(row.logo_blob);
  return `data:${row.logo_mime_type};base64,${logoBuffer.toString("base64")}`;
}

function buildIdentityDisplayName({ gameName, tagline, email, fallbackUserId = null }) {
  const normalizedGameName = typeof gameName === "string" ? gameName.trim() : "";
  const normalizedTagline = typeof tagline === "string" ? tagline.trim() : "";
  const normalizedEmail = typeof email === "string" ? email.trim() : "";

  if (normalizedGameName && normalizedTagline) {
    return `${normalizedGameName}#${normalizedTagline}`;
  }
  if (normalizedGameName) {
    return normalizedGameName;
  }
  if (normalizedEmail) {
    return normalizedEmail;
  }
  if (Number.isInteger(fallbackUserId) && fallbackUserId > 0) {
    return `User ${fallbackUserId}`;
  }
  return "Unknown Player";
}

function mapTeamRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    tag: row.tag,
    logo_data_url: toLogoDataUrl(row),
    created_by: Number(row.created_by),
    created_at: row.created_at
  };
}

function mapMembershipRow(row) {
  const userId = Number(row.user_id);
  return {
    team_id: Number(row.team_id),
    user_id: userId,
    role: row.role,
    team_role: row.team_role,
    email: row.email,
    game_name: row.game_name ?? "",
    tagline: row.tagline ?? "",
    primary_role: row.primary_role ?? null,
    display_name: buildIdentityDisplayName({
      gameName: row.game_name,
      tagline: row.tagline,
      email: row.email,
      fallbackUserId: userId
    }),
    created_at: row.created_at
  };
}

function mapJoinRequestRow(row) {
  const requesterUserId = Number(row.requester_user_id);
  const reviewerUserId = row.reviewed_by_user_id === null || row.reviewed_by_user_id === undefined
    ? null
    : Number(row.reviewed_by_user_id);

  return {
    id: Number(row.id),
    team_id: Number(row.team_id),
    requester_user_id: requesterUserId,
    requested_lane: row.requested_lane,
    status: row.status,
    note: row.note ?? "",
    reviewed_by_user_id: reviewerUserId,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    requester: {
      user_id: requesterUserId,
      email: row.requester_email ?? null,
      game_name: row.requester_game_name ?? "",
      tagline: row.requester_tagline ?? "",
      primary_role: row.requester_primary_role ?? null,
      display_name: buildIdentityDisplayName({
        gameName: row.requester_game_name,
        tagline: row.requester_tagline,
        email: row.requester_email,
        fallbackUserId: requesterUserId
      })
    }
  };
}

function mapDiscoverableTeamRow(row) {
  const mapped = mapTeamRow(row);
  return {
    ...mapped,
    membership_role: row.membership_role ?? null,
    membership_team_role: row.membership_team_role ?? null,
    membership_lane: row.membership_primary_role ?? null,
    pending_join_request_id: row.pending_join_request_id === null || row.pending_join_request_id === undefined
      ? null
      : Number(row.pending_join_request_id),
    pending_join_request_status: row.pending_join_request_status ?? null
  };
}

export function createTeamsRepository(pool) {
  return {
    async teamExists(teamId) {
      const result = await pool.query(
        `
          SELECT 1
          FROM teams
          WHERE id = $1
        `,
        [teamId]
      );
      return result.rowCount > 0;
    },

    async createTeam({ name, tag, logoBlob, logoMimeType, creatorUserId }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const teamResult = await client.query(
          `
            INSERT INTO teams (name, tag, logo_blob, logo_mime_type, created_by)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, name, tag, logo_blob, logo_mime_type, created_by, created_at
          `,
          [name, tag, logoBlob ?? null, logoMimeType ?? null, creatorUserId]
        );

        const team = teamResult.rows[0] ?? null;
        if (!team) {
          throw new Error("Failed to create team.");
        }

        await client.query(
          `
            INSERT INTO team_members (team_id, user_id, role, team_role)
            VALUES ($1, $2, 'lead', 'primary')
          `,
          [team.id, creatorUserId]
        );

        await client.query("COMMIT");
        return mapTeamRow(team);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async listTeamsByUser(userId) {
      const result = await pool.query(
        `
          SELECT t.id,
                 t.name,
                 t.tag,
                 t.logo_blob,
                 t.logo_mime_type,
                 t.created_by,
                 t.created_at,
                 tm.role,
                 tm.team_role,
                 u.primary_role
          FROM teams t
          INNER JOIN team_members tm
            ON tm.team_id = t.id
          INNER JOIN users u
            ON u.id = tm.user_id
          WHERE tm.user_id = $1
          ORDER BY t.id ASC
        `,
        [userId]
      );

      return result.rows.map((row) => ({
        ...mapTeamRow(row),
        membership_role: row.role,
        membership_team_role: row.team_role,
        membership_lane: row.primary_role ?? null
      }));
    },

    async listDiscoverableTeams(userId) {
      const result = await pool.query(
        `
          SELECT t.id,
                 t.name,
                 t.tag,
                 t.logo_blob,
                 t.logo_mime_type,
                 t.created_by,
                 t.created_at,
                 tm.role AS membership_role,
                 tm.team_role AS membership_team_role,
                 u.primary_role AS membership_primary_role,
                 req.id AS pending_join_request_id,
                 req.status AS pending_join_request_status
          FROM teams t
          LEFT JOIN team_members tm
            ON tm.team_id = t.id
           AND tm.user_id = $1
          LEFT JOIN users u
            ON u.id = tm.user_id
          LEFT JOIN team_join_requests req
            ON req.team_id = t.id
           AND req.requester_user_id = $1
           AND req.status = 'pending'
          ORDER BY LOWER(t.name) ASC, t.id ASC
        `,
        [userId]
      );

      return result.rows.map(mapDiscoverableTeamRow);
    },

    async getTeamById(teamId) {
      const result = await pool.query(
        `
          SELECT id, name, tag, logo_blob, logo_mime_type, created_by, created_at
          FROM teams
          WHERE id = $1
        `,
        [teamId]
      );

      return result.rows[0] ? mapTeamRow(result.rows[0]) : null;
    },

    async getMembership(teamId, userId) {
      const result = await pool.query(
        `
          SELECT tm.team_id,
                 tm.user_id,
                 tm.role,
                 tm.team_role,
                 u.email,
                 u.game_name,
                 u.tagline,
                 u.primary_role,
                 tm.created_at
          FROM team_members tm
          INNER JOIN users u
            ON u.id = tm.user_id
          WHERE tm.team_id = $1 AND tm.user_id = $2
        `,
        [teamId, userId]
      );

      return result.rows[0] ? mapMembershipRow(result.rows[0]) : null;
    },

    async countLeads(teamId) {
      const result = await pool.query(
        `
          SELECT COUNT(*)::int AS count
          FROM team_members
          WHERE team_id = $1 AND role = 'lead'
        `,
        [teamId]
      );

      return Number(result.rows[0]?.count ?? 0);
    },

    async updateTeam(teamId, { name, tag, logoBlob, logoMimeType, removeLogo = false }) {
      const result = await pool.query(
        `
          UPDATE teams
          SET name = $2,
              tag = $3,
              logo_blob = CASE
                WHEN $6::boolean THEN NULL
                WHEN $4::bytea IS NULL THEN logo_blob
                ELSE $4::bytea
              END,
              logo_mime_type = CASE
                WHEN $6::boolean THEN NULL
                WHEN $5::text IS NULL THEN logo_mime_type
                ELSE $5::text
              END
          WHERE id = $1
          RETURNING id, name, tag, logo_blob, logo_mime_type, created_by, created_at
        `,
        [teamId, name, tag, logoBlob ?? null, logoMimeType ?? null, Boolean(removeLogo)]
      );

      return result.rows[0] ? mapTeamRow(result.rows[0]) : null;
    },

    async deleteTeam(teamId) {
      const result = await pool.query(
        `
          DELETE FROM teams
          WHERE id = $1
        `,
        [teamId]
      );

      return result.rowCount > 0;
    },

    async listMembers(teamId) {
      const result = await pool.query(
        `
          SELECT tm.team_id,
                 tm.user_id,
                 tm.role,
                 tm.team_role,
                 u.email,
                 u.game_name,
                 u.tagline,
                 u.primary_role,
                 tm.created_at
          FROM team_members tm
          INNER JOIN users u
            ON u.id = tm.user_id
          WHERE tm.team_id = $1
          ORDER BY CASE u.primary_role
                     WHEN 'Top' THEN 0
                     WHEN 'Jungle' THEN 1
                     WHEN 'Mid' THEN 2
                     WHEN 'ADC' THEN 3
                     WHEN 'Support' THEN 4
                     ELSE 9
                   END,
                   CASE tm.role WHEN 'lead' THEN 0 ELSE 1 END,
                   LOWER(COALESCE(NULLIF(u.game_name, ''), u.email)) ASC,
                   tm.user_id ASC
        `,
        [teamId]
      );

      return result.rows.map(mapMembershipRow);
    },

    async addMember(teamId, userId, role, teamRole) {
      const result = await pool.query(
        `
          INSERT INTO team_members (team_id, user_id, role, team_role)
          VALUES ($1, $2, $3, $4)
          RETURNING team_id, user_id, role, team_role, created_at
        `,
        [teamId, userId, role, teamRole]
      );

      return result.rows[0]
        ? {
            team_id: Number(result.rows[0].team_id),
            user_id: Number(result.rows[0].user_id),
            role: result.rows[0].role,
            team_role: result.rows[0].team_role,
            created_at: result.rows[0].created_at
          }
        : null;
    },

    async removeMember(teamId, userId) {
      const result = await pool.query(
        `
          DELETE FROM team_members
          WHERE team_id = $1 AND user_id = $2
        `,
        [teamId, userId]
      );

      return result.rowCount > 0;
    },

    async setMemberRole(teamId, userId, role) {
      const result = await pool.query(
        `
          UPDATE team_members
          SET role = $3
          WHERE team_id = $1 AND user_id = $2
          RETURNING team_id, user_id, role, team_role, created_at
        `,
        [teamId, userId, role]
      );

      return result.rows[0]
        ? {
            team_id: Number(result.rows[0].team_id),
            user_id: Number(result.rows[0].user_id),
            role: result.rows[0].role,
            team_role: result.rows[0].team_role,
            created_at: result.rows[0].created_at
          }
        : null;
    },

    async setMemberTeamRole(teamId, userId, teamRole) {
      const result = await pool.query(
        `
          UPDATE team_members
          SET team_role = $3
          WHERE team_id = $1 AND user_id = $2
          RETURNING team_id, user_id, role, team_role, created_at
        `,
        [teamId, userId, teamRole]
      );

      return result.rows[0]
        ? {
            team_id: Number(result.rows[0].team_id),
            user_id: Number(result.rows[0].user_id),
            role: result.rows[0].role,
            team_role: result.rows[0].team_role,
            created_at: result.rows[0].created_at
          }
        : null;
    },

    async createJoinRequest({ teamId, requesterUserId, requestedLane, note = "" }) {
      const result = await pool.query(
        `
          INSERT INTO team_join_requests (team_id, requester_user_id, requested_lane, note)
          VALUES ($1, $2, $3, $4)
          RETURNING id,
                    team_id,
                    requester_user_id,
                    requested_lane,
                    status,
                    note,
                    reviewed_by_user_id,
                    reviewed_at,
                    created_at
        `,
        [teamId, requesterUserId, requestedLane, note]
      );

      return result.rows[0]
        ? {
            id: Number(result.rows[0].id),
            team_id: Number(result.rows[0].team_id),
            requester_user_id: Number(result.rows[0].requester_user_id),
            requested_lane: result.rows[0].requested_lane,
            status: result.rows[0].status,
            note: result.rows[0].note ?? "",
            reviewed_by_user_id: result.rows[0].reviewed_by_user_id,
            reviewed_at: result.rows[0].reviewed_at,
            created_at: result.rows[0].created_at
          }
        : null;
    },

    async listJoinRequests(teamId, { status = null } = {}) {
      const parameters = [teamId];
      let whereClause = "WHERE req.team_id = $1";
      if (status) {
        parameters.push(status);
        whereClause += " AND req.status = $2";
      }

      const result = await pool.query(
        `
          SELECT req.id,
                 req.team_id,
                 req.requester_user_id,
                 req.requested_lane,
                 req.status,
                 req.note,
                 req.reviewed_by_user_id,
                 req.reviewed_at,
                 req.created_at,
                 requester.email AS requester_email,
                 requester.game_name AS requester_game_name,
                 requester.tagline AS requester_tagline,
                 requester.primary_role AS requester_primary_role
          FROM team_join_requests req
          INNER JOIN users requester
            ON requester.id = req.requester_user_id
          ${whereClause}
          ORDER BY CASE req.status
                     WHEN 'pending' THEN 0
                     WHEN 'approved' THEN 1
                     ELSE 2
                   END,
                   req.created_at ASC,
                   req.id ASC
        `,
        parameters
      );

      return result.rows.map(mapJoinRequestRow);
    },

    async getJoinRequestById(teamId, requestId) {
      const result = await pool.query(
        `
          SELECT req.id,
                 req.team_id,
                 req.requester_user_id,
                 req.requested_lane,
                 req.status,
                 req.note,
                 req.reviewed_by_user_id,
                 req.reviewed_at,
                 req.created_at,
                 requester.email AS requester_email,
                 requester.game_name AS requester_game_name,
                 requester.tagline AS requester_tagline,
                 requester.primary_role AS requester_primary_role
          FROM team_join_requests req
          INNER JOIN users requester
            ON requester.id = req.requester_user_id
          WHERE req.team_id = $1 AND req.id = $2
        `,
        [teamId, requestId]
      );

      return result.rows[0] ? mapJoinRequestRow(result.rows[0]) : null;
    },

    async setJoinRequestStatus(teamId, requestId, { status, reviewedByUserId }) {
      const result = await pool.query(
        `
          UPDATE team_join_requests
          SET status = $3,
              reviewed_by_user_id = $4,
              reviewed_at = current_timestamp
          WHERE team_id = $1
            AND id = $2
            AND status = 'pending'
          RETURNING id,
                    team_id,
                    requester_user_id,
                    requested_lane,
                    status,
                    note,
                    reviewed_by_user_id,
                    reviewed_at,
                    created_at
        `,
        [teamId, requestId, status, reviewedByUserId]
      );

      return result.rows[0]
        ? {
            id: Number(result.rows[0].id),
            team_id: Number(result.rows[0].team_id),
            requester_user_id: Number(result.rows[0].requester_user_id),
            requested_lane: result.rows[0].requested_lane,
            status: result.rows[0].status,
            note: result.rows[0].note ?? "",
            reviewed_by_user_id:
              result.rows[0].reviewed_by_user_id === null || result.rows[0].reviewed_by_user_id === undefined
                ? null
                : Number(result.rows[0].reviewed_by_user_id),
            reviewed_at: result.rows[0].reviewed_at,
            created_at: result.rows[0].created_at
          }
        : null;
    },

    async deletePendingJoinRequest(teamId, requestId, requesterUserId) {
      const result = await pool.query(
        `
          DELETE FROM team_join_requests
          WHERE team_id = $1
            AND id = $2
            AND requester_user_id = $3
            AND status = 'pending'
        `,
        [teamId, requestId, requesterUserId]
      );

      return result.rowCount > 0;
    },

    async clearPendingJoinRequestsForUser(teamId, requesterUserId) {
      await pool.query(
        `
          DELETE FROM team_join_requests
          WHERE team_id = $1
            AND requester_user_id = $2
            AND status = 'pending'
        `,
        [teamId, requesterUserId]
      );
    }
  };
}
