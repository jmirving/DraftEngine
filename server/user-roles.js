export const USER_ROLE_MEMBER = "member";
export const USER_ROLE_GLOBAL = "global";
export const USER_ROLE_ADMIN = "admin";
export const USER_ROLES = Object.freeze([USER_ROLE_MEMBER, USER_ROLE_GLOBAL, USER_ROLE_ADMIN]);

export const OWNER_ADMIN_EMAILS = Object.freeze(new Set([
  "jirving0311@gmail.com",
  "tylerjtriplett@gmail.com"
]));

const USER_ROLE_SET = new Set(USER_ROLES);

export function normalizeUserRole(rawRole) {
  if (typeof rawRole !== "string") {
    return USER_ROLE_MEMBER;
  }
  const normalized = rawRole.trim().toLowerCase();
  return USER_ROLE_SET.has(normalized) ? normalized : USER_ROLE_MEMBER;
}

export function normalizeUserEmail(rawEmail) {
  if (typeof rawEmail !== "string") {
    return "";
  }
  return rawEmail.trim().toLowerCase();
}

export function isOwnerAdminEmail(rawEmail) {
  return OWNER_ADMIN_EMAILS.has(normalizeUserEmail(rawEmail));
}

export function resolveAuthorizationRole(user) {
  const normalizedRole = normalizeUserRole(user?.role);
  if (normalizedRole === USER_ROLE_ADMIN && isOwnerAdminEmail(user?.email)) {
    return USER_ROLE_ADMIN;
  }
  if (normalizedRole === USER_ROLE_GLOBAL) {
    return USER_ROLE_GLOBAL;
  }
  return USER_ROLE_MEMBER;
}
