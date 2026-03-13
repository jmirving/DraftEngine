import { USER_ROLE_ADMIN, USER_ROLE_GLOBAL, USER_ROLE_MEMBER } from "./user-roles.js";

const GLOBAL_ROLE_DEFINITIONS = Object.freeze([
  {
    id: USER_ROLE_MEMBER,
    label: "user",
    description: "Default authenticated user role. Can manage personal data and read shared data."
  },
  {
    id: USER_ROLE_GLOBAL,
    label: "global",
    description: "Global editor role. Includes user permissions plus global tag editing."
  },
  {
    id: USER_ROLE_ADMIN,
    label: "admin",
    description: "Administrator role. Includes global editor and user permissions plus admin-only endpoints."
  }
]);

const TEAM_MEMBERSHIP_ROLE_DEFINITIONS = Object.freeze([
  {
    id: "member",
    label: "team member",
    description: "Standard team membership. Can read team data in teams they belong to."
  },
  {
    id: "lead",
    label: "team lead",
    description: "Team management role. Can manage roster/settings for their team."
  }
]);

const TEAM_ROSTER_ROLE_DEFINITIONS = Object.freeze([
  {
    id: "primary",
    label: "primary",
    description: "Roster designation used for lineup context."
  },
  {
    id: "substitute",
    label: "substitute",
    description: "Roster designation used for substitute context."
  }
]);

const SCOPED_RESOURCE_DEFINITIONS = Object.freeze([
  {
    id: "tag_definitions",
    label: "tag definitions"
  },
  {
    id: "champion_tags",
    label: "champion-tag assignments"
  },
  {
    id: "champion_metadata",
    label: "champion role/damage/effectiveness metadata"
  },
  {
    id: "requirements",
    label: "requirement definitions"
  },
  {
    id: "compositions",
    label: "compositions"
  }
]);

function createScopedPermissionId(resourceId, action, scope) {
  return `${resourceId}.${action}.${scope}`;
}

function createScopedPermissions({ id, label }) {
  return [
    {
      id: createScopedPermissionId(id, "read", "self"),
      description: `Read your own ${label}.`
    },
    {
      id: createScopedPermissionId(id, "write", "self"),
      description: `Create/update/delete your own ${label}.`
    },
    {
      id: createScopedPermissionId(id, "read", "team"),
      description: `Read team-scoped ${label} for teams where you are a member.`
    },
    {
      id: createScopedPermissionId(id, "write", "team"),
      description: `Create/update/delete team-scoped ${label} where you are a lead.`
    },
    {
      id: createScopedPermissionId(id, "read", "global"),
      description: `Read all/global ${label}.`
    },
    {
      id: createScopedPermissionId(id, "write", "global"),
      description: `Create/update/delete all/global ${label}.`
    }
  ];
}

function createScopedGlobalAssignments(resourceId, { includeGlobalWrite = false } = {}) {
  const assignments = [
    createScopedPermissionId(resourceId, "read", "self"),
    createScopedPermissionId(resourceId, "write", "self"),
    createScopedPermissionId(resourceId, "read", "global")
  ];
  if (includeGlobalWrite) {
    assignments.push(createScopedPermissionId(resourceId, "write", "global"));
  }
  return assignments;
}

function createScopedTeamAssignments(resourceId, { includeTeamWrite = false } = {}) {
  const assignments = [createScopedPermissionId(resourceId, "read", "team")];
  if (includeTeamWrite) {
    assignments.push(createScopedPermissionId(resourceId, "write", "team"));
  }
  return assignments;
}

const PERMISSIONS = Object.freeze([
  {
    id: "profile.read.self",
    description: "Read your own profile."
  },
  {
    id: "profile.write.self",
    description: "Update your own profile roles."
  },
  {
    id: "team_context.read.self",
    description: "Read your own active team context."
  },
  {
    id: "team_context.write.self",
    description: "Update your own active team context."
  },
  {
    id: "pools.read.self",
    description: "Read your own champion pools."
  },
  {
    id: "pools.write.self",
    description: "Create/update/delete your own champion pools."
  },
  {
    id: "teams.create",
    description: "Create a new team."
  },
  {
    id: "teams.read.member",
    description: "Read teams and team-scoped resources where you are a member."
  },
  {
    id: "teams.manage.lead",
    description: "Update/delete team settings where you are a lead."
  },
  {
    id: "teams.members.manage.lead",
    description: "Manage team members where you are a lead."
  },
  {
    id: "teams.join_requests.create.self",
    description: "Create/cancel your own team join requests."
  },
  {
    id: "teams.join_requests.review.lead",
    description: "Approve/reject team join requests where you are a lead."
  },
  {
    id: "teams.invitations.respond.self",
    description: "Accept/reject invitations targeted to your account."
  },
  {
    id: "teams.invitations.manage.lead",
    description: "Send/cancel invitations where you are a lead."
  },
  {
    id: "champions.read",
    description: "Read champion catalog entries."
  },
  {
    id: "tags.catalog.read",
    description: "Read global tag catalog."
  },
  {
    id: "tags.catalog.write.global",
    description: "Create/update/delete global tag definitions."
  },
  ...SCOPED_RESOURCE_DEFINITIONS.flatMap(createScopedPermissions),
  {
    id: "admin.users.read",
    description: "Read admin users directory and per-user details."
  },
  {
    id: "admin.users.write",
    description: "Update user role and one-time Riot ID correction."
  },
  {
    id: "admin.users.delete",
    description: "Delete non-owner user accounts."
  }
]);

const GLOBAL_ROLE_ASSIGNMENTS = Object.freeze({
  [USER_ROLE_MEMBER]: Object.freeze([
    "profile.read.self",
    "profile.write.self",
    "team_context.read.self",
    "team_context.write.self",
    "pools.read.self",
    "pools.write.self",
    "teams.create",
    "teams.read.member",
    "teams.join_requests.create.self",
    "teams.invitations.respond.self",
    "champions.read",
    "tags.catalog.read",
    ...SCOPED_RESOURCE_DEFINITIONS.flatMap(({ id }) => createScopedGlobalAssignments(id))
  ]),
  [USER_ROLE_GLOBAL]: Object.freeze([
    "profile.read.self",
    "profile.write.self",
    "team_context.read.self",
    "team_context.write.self",
    "pools.read.self",
    "pools.write.self",
    "teams.create",
    "teams.read.member",
    "teams.join_requests.create.self",
    "teams.invitations.respond.self",
    "champions.read",
    "tags.catalog.read",
    "tags.catalog.write.global",
    ...SCOPED_RESOURCE_DEFINITIONS.flatMap(({ id }) =>
      createScopedGlobalAssignments(id, {
        includeGlobalWrite: true
      })
    )
  ]),
  [USER_ROLE_ADMIN]: Object.freeze([
    "profile.read.self",
    "profile.write.self",
    "team_context.read.self",
    "team_context.write.self",
    "pools.read.self",
    "pools.write.self",
    "teams.create",
    "teams.read.member",
    "teams.join_requests.create.self",
    "teams.invitations.respond.self",
    "champions.read",
    "tags.catalog.read",
    "tags.catalog.write.global",
    ...SCOPED_RESOURCE_DEFINITIONS.flatMap(({ id }) =>
      createScopedGlobalAssignments(id, {
        includeGlobalWrite: true
      })
    ),
    "admin.users.read",
    "admin.users.write",
    "admin.users.delete"
  ])
});

const TEAM_MEMBERSHIP_ROLE_ASSIGNMENTS = Object.freeze({
  member: Object.freeze([
    "teams.read.member",
    ...SCOPED_RESOURCE_DEFINITIONS.flatMap(({ id }) => createScopedTeamAssignments(id))
  ]),
  lead: Object.freeze([
    "teams.read.member",
    "teams.manage.lead",
    "teams.members.manage.lead",
    "teams.join_requests.review.lead",
    "teams.invitations.manage.lead",
    ...SCOPED_RESOURCE_DEFINITIONS.flatMap(({ id }) =>
      createScopedTeamAssignments(id, {
        includeTeamWrite: true
      })
    )
  ])
});

function cloneRoleDefinitions(definitions) {
  return definitions.map((role) => ({
    id: role.id,
    label: role.label,
    description: role.description
  }));
}

function clonePermissions() {
  return PERMISSIONS.map((permission) => ({
    id: permission.id,
    description: permission.description
  }));
}

function cloneAssignments(assignments) {
  return Object.fromEntries(
    Object.entries(assignments).map(([roleId, permissionIds]) => [roleId, [...permissionIds]])
  );
}

export function getAuthorizationMatrix() {
  return {
    global_roles: cloneRoleDefinitions(GLOBAL_ROLE_DEFINITIONS),
    team_membership_roles: cloneRoleDefinitions(TEAM_MEMBERSHIP_ROLE_DEFINITIONS),
    team_roster_roles: cloneRoleDefinitions(TEAM_ROSTER_ROLE_DEFINITIONS),
    permissions: clonePermissions(),
    assignments: {
      global_roles: cloneAssignments(GLOBAL_ROLE_ASSIGNMENTS),
      team_membership_roles: cloneAssignments(TEAM_MEMBERSHIP_ROLE_ASSIGNMENTS)
    }
  };
}
