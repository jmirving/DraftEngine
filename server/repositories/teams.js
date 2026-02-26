function mapTeamRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    tag: row.tag,
    logo_url: row.logo_url,
    created_by: Number(row.created_by),
    created_at: row.created_at
  };
}

function mapMembershipRow(row) {
  return {
    team_id: Number(row.team_id),
    user_id: Number(row.user_id),
    role: row.role,
    team_role: row.team_role,
    email: row.email,
    created_at: row.created_at
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

    async createTeam({ name, tag, logoUrl, creatorUserId }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const teamResult = await client.query(
          `
            INSERT INTO teams (name, tag, logo_url, created_by)
            VALUES ($1, $2, $3, $4)
            RETURNING id, name, tag, logo_url, created_by, created_at
          `,
          [name, tag, logoUrl, creatorUserId]
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
          SELECT t.id, t.name, t.tag, t.logo_url, t.created_by, t.created_at, tm.role, tm.team_role
          FROM teams t
          INNER JOIN team_members tm
            ON tm.team_id = t.id
          WHERE tm.user_id = $1
          ORDER BY t.id ASC
        `,
        [userId]
      );

      return result.rows.map((row) => ({
        ...mapTeamRow(row),
        membership_role: row.role,
        membership_team_role: row.team_role
      }));
    },

    async getTeamById(teamId) {
      const result = await pool.query(
        `
          SELECT id, name, tag, logo_url, created_by, created_at
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
          SELECT tm.team_id, tm.user_id, tm.role, tm.team_role, u.email, tm.created_at
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

    async updateTeam(teamId, { name, tag, logoUrl }) {
      const result = await pool.query(
        `
          UPDATE teams
          SET name = $2,
              tag = $3,
              logo_url = $4
          WHERE id = $1
          RETURNING id, name, tag, logo_url, created_by, created_at
        `,
        [teamId, name, tag, logoUrl]
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
          SELECT tm.team_id, tm.user_id, tm.role, tm.team_role, u.email, tm.created_at
          FROM team_members tm
          INNER JOIN users u
            ON u.id = tm.user_id
          WHERE tm.team_id = $1
          ORDER BY CASE tm.role WHEN 'lead' THEN 0 ELSE 1 END, CASE tm.team_role WHEN 'primary' THEN 0 ELSE 1 END, u.email ASC
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
    }
  };
}
