import {
  BOOLEAN_TAGS,
  DAMAGE_TYPES,
  DEFAULT_RECOMMENDATION_WEIGHTS,
  SCALING_VALUES,
  SLOTS,
  DataValidationError,
  createEmptyTeamState,
  isDamageType,
  isScaling,
  isSlot,
  buildRequirementScoreBreakdown,
  evaluateCompositionRequirements,
  generatePossibilityTree,
  normalizeTeamState
} from "../../src/index.js";
import {
  buildNoneTeamPools,
  buildPlayerPoolsByTeam,
  buildTeamPlayersByRoleFromPlayerPools,
  buildTeamPoolsFromPlayerPools,
  createEmptyRolePools,
  clonePlayerPoolsByTeam,
  compareSlots,
  normalizePoolPlayerName
} from "./pool-utils.js";
import {
  getActiveNextRole,
  getTeamCompletionInfo,
  normalizeNoFilterMultiSelection,
  resolveTagMutualExclusion,
  teamStateKey,
  validateSlotSelection
} from "./workflow-utils.js";
import {
  collectVisibleNodeIds,
  flattenTreeForMap,
  getParentNodeId,
  nodePassesTreeFilters
} from "./tree-utils.js";

const NO_FILTER = "__NO_FILTER__";
const NONE_TEAM_ID = "__NONE_TEAM__";
const TEAM_CONFIG_STORAGE_KEY = "draftflow.teamConfig.v1";
const PLAYER_CONFIG_STORAGE_KEY = "draftflow.playerConfig.v1";
const AUTH_SESSION_STORAGE_KEY = "draftflow.authSession.v1";
const UI_STATE_STORAGE_KEY = "draftflow.ui.v1";
const TEAM_WORKSPACE_TAB_MEMBER = "member";
const TEAM_WORKSPACE_TAB_MANAGE = "manage";
const TEAM_WORKSPACE_TAB_CREATE = "create";
const TEAM_WORKSPACE_TAB_SET = new Set([
  TEAM_WORKSPACE_TAB_MEMBER,
  TEAM_WORKSPACE_TAB_MANAGE,
  TEAM_WORKSPACE_TAB_CREATE
]);
const TEAM_WORKSPACE_TAB_DEFAULT = TEAM_WORKSPACE_TAB_MEMBER;
const UPDATES_RELEASE_TAB_WHATS_NEW = "whats-new";
const UPDATES_RELEASE_TAB_COMING_SOON = "coming-soon";
const UPDATES_RELEASE_TAB_PREVIOUS = "previous";
const UPDATES_RELEASE_TAB_SET = new Set([
  UPDATES_RELEASE_TAB_WHATS_NEW,
  UPDATES_RELEASE_TAB_COMING_SOON,
  UPDATES_RELEASE_TAB_PREVIOUS
]);
const UPDATES_RELEASE_TAB_DEFAULT = UPDATES_RELEASE_TAB_WHATS_NEW;
const BUILDER_PROFILE_POOL_CONTEXT_ID = "__PROFILE_POOL_CONTEXT__";
const TEAM_MANAGE_ACTION_TEAM_SETTINGS = "team-settings";
const TEAM_MANAGE_ACTION_ADD_MEMBER = "add-member";
const TEAM_MANAGE_ACTION_UPDATE_MEMBER_ROLE = "update-member-role";
const TEAM_MANAGE_ACTION_UPDATE_TEAM_ROLE = "update-team-role";
const TEAM_MANAGE_ACTION_REMOVE_MEMBER = "remove-member";
const TEAM_MANAGE_ACTION_SET = new Set([
  TEAM_MANAGE_ACTION_TEAM_SETTINGS,
  TEAM_MANAGE_ACTION_ADD_MEMBER,
  TEAM_MANAGE_ACTION_UPDATE_MEMBER_ROLE,
  TEAM_MANAGE_ACTION_UPDATE_TEAM_ROLE,
  TEAM_MANAGE_ACTION_REMOVE_MEMBER
]);
const DEFAULT_MEMBER_ROLE = "member";
const MEMBER_ROLE_OPTIONS = Object.freeze(["lead", "member"]);
const DEFAULT_TEAM_MEMBER_TYPE = "substitute";
const TEAM_MEMBER_TYPE_OPTIONS = Object.freeze(["primary", "substitute"]);
const CHAMPION_TAG_SCOPES = Object.freeze(["all", "team"]);
const CHAMPION_EDITOR_TAB_COMPOSITION = "composition";
const CHAMPION_EDITOR_TAB_ROLES = "roles";
const CHAMPION_EDITOR_TAB_DAMAGE = "damage";
const CHAMPION_EDITOR_TAB_SCALING = "scaling";
const CHAMPION_EDITOR_TABS = Object.freeze([
  CHAMPION_EDITOR_TAB_COMPOSITION,
  CHAMPION_EDITOR_TAB_ROLES,
  CHAMPION_EDITOR_TAB_DAMAGE,
  CHAMPION_EDITOR_TAB_SCALING
]);
const CHAMPION_EDITOR_TAB_SET = new Set(CHAMPION_EDITOR_TABS);
const DEFAULT_PRIMARY_ROLE = "Mid";
const DEFAULT_FAMILIARITY_LEVEL = 3;
const FAMILIARITY_GRADES = Object.freeze(["S", "A", "B", "C"]);
const ALLOWED_TEAM_LOGO_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_TEAM_LOGO_BYTES = 512 * 1024;
const PREFILLED_RECOMMENDATION_LIMIT = 3;
const HIGH_SIGNAL_MASTERY_LEVEL = 6;
const HIGH_SIGNAL_CHAMPION_POINTS = 100000;
const OWNER_ADMIN_EMAIL_SET = new Set(["jirving0311@gmail.com", "tylerjtriplett@gmail.com"]);

const FAMILIARITY_GRADE_BY_LEVEL = Object.freeze({
  1: "S",
  2: "A",
  3: "B",
  4: "C",
  5: "C",
  6: "C"
});

const FAMILIARITY_LEVEL_BY_GRADE = Object.freeze({
  S: 1,
  A: 2,
  B: 3,
  C: 4
});

const FAMILIARITY_GRADE_LABELS = Object.freeze({
  S: "I know and can utilize every detail of this champion, including one-trick combo tech.",
  A: "I can execute this champion consistently at a high level.",
  B: "I can play this champion well but still miss some nuanced details.",
  C: "I have a basic understanding of this champion."
});

const CHAMPION_IMAGE_OVERRIDES = Object.freeze({
  "Bel'Veth": "Belveth",
  "Cho'Gath": "Chogath",
  "Kai'Sa": "Kaisa",
  "Kha'Zix": "Khazix",
  LeBlanc: "Leblanc",
  "Nunu & Willump": "Nunu",
  "Renata Glasc": "Renata",
  VelKoz: "Velkoz",
  Wukong: "MonkeyKing"
});

const DEFAULT_APP_CONFIG = Object.freeze({
  teamDefault: null,
  recommendation: {
    weights: {
      ...DEFAULT_RECOMMENDATION_WEIGHTS
    }
  },
  treeDefaults: {
    maxBranch: 8
  }
});

const BUILDER_DEFAULTS = Object.freeze({
  defaultTreeDensity: "summary",
  showOptionalChecksByDefault: false
});
const BUILDER_RANK_GOAL_VALID_END_STATES = "valid_end_states";
const BUILDER_RANK_GOAL_CANDIDATE_SCORE = "candidate_score";
const BUILDER_RANK_GOAL_VALUES = new Set([
  BUILDER_RANK_GOAL_VALID_END_STATES,
  BUILDER_RANK_GOAL_CANDIDATE_SCORE
]);
const BUILDER_DEFAULT_CANDIDATE_SCORING_WEIGHTS = Object.freeze({
  redundancyPenalty: 1
});

function normalizeBuilderRankGoal(value) {
  return BUILDER_RANK_GOAL_VALUES.has(value)
    ? value
    : BUILDER_RANK_GOAL_VALID_END_STATES;
}

function normalizeBuilderFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBuilderCandidateScoringWeights(weights = BUILDER_DEFAULT_CANDIDATE_SCORING_WEIGHTS) {
  const source = weights && typeof weights === "object" && !Array.isArray(weights)
    ? weights
    : BUILDER_DEFAULT_CANDIDATE_SCORING_WEIGHTS;
  return {
    redundancyPenalty: Math.max(
      0,
      normalizeBuilderFiniteNumber(
        source.redundancyPenalty,
        BUILDER_DEFAULT_CANDIDATE_SCORING_WEIGHTS.redundancyPenalty
      )
    )
  };
}

const UI_COPY = Object.freeze({
  hero: {
    kicker: "DraftEngine",
    tabs: {
      workflow: {
        title: "Composer",
        subtitle: "Plan picks, run checks, and inspect deterministic next-pick trees."
      },
      "team-config": {
        title: "Teams",
        subtitle: "Create teams, manage rosters, and maintain team settings."
      },
      profile: {
        title: "Profile",
        subtitle: "Manage your roles, champion pools, and Riot champion stats."
      },
      explorer: {
        title: "Champions",
        subtitle: "Search champions and edit global champion metadata."
      },
      tags: {
        title: "Tags",
        subtitle: "Manage shared tag definitions and champion coverage."
      },
      users: {
        title: "Users",
        subtitle: "Admin-only directory for permissions and one-time Riot ID corrections."
      },
      requirements: {
        title: "Requirements",
        subtitle: "Manage reusable requirement definitions and clause rules."
      },
      compositions: {
        title: "Compositions",
        subtitle: "Build named bundles from requirement definitions."
      },
      "coming-soon": {
        title: "Updates & Roadmap",
        subtitle: "Review latest shipped changes and track known gaps grouped by workspace page."
      }
    }
  },
  nav: {
    title: "DraftEngine",
    meta: "Jump between Composer, Teams, Profile, Champions, Tags, Users, Requirements, Compositions, and Updates.",
    toggleClosed: "Menu",
    toggleOpen: "Close Menu",
    desktopCollapseIcon: "◀",
    desktopExpandIcon: "▶",
    desktopCollapseLabel: "Collapse sidebar",
    desktopExpandLabel: "Expand sidebar",
    adminLabel: "Admin Tools",
    items: {
      workflow: "Composer",
      "team-config": "Teams",
      profile: "Profile",
      explorer: "Champions",
      tags: "Tags",
      users: "Users",
      requirements: "Requirements",
      compositions: "Compositions",
      "coming-soon": "Updates"
    }
  },
  panels: {
    explorerTitle: "Champions",
    explorerMeta: "Filter and sort champion cards.",
    tagsTitle: "Tags",
    tagsMeta: "Manage shared tag definitions and current champion coverage.",
    usersTitle: "Users",
    usersMeta: "Admin-only user directory, permission management, one-time Riot ID corrections, and authorization matrix visibility.",
    requirementsTitle: "Requirements",
    requirementsMeta: "Define reusable requirement rules and clause logic.",
    compositionsTitle: "Compositions",
    compositionsMeta: "Group requirement definitions into named composition bundles.",
    teamConfigTitle: "Teams",
    teamConfigMeta: "Lead-only controls are grouped by Create and Manage modes.",
    playerConfigTitle: "Profile",
    playerConfigMeta: "Manage your roles, champion pools, and teams.",
    comingSoonTitle: "Updates & Roadmap",
    comingSoonMeta: "Latest shipped changes plus known gaps and planned follow-up grouped by workspace page."
  },
  builder: {
    workflowTitle: "Composer",
    stages: [
      {
        key: "setup",
        panelTitle: "Setup",
        panelMeta: "Choose team context and lock known picks."
      },
      {
        key: "inspect",
        panelTitle: "Review",
        panelMeta: "Run checks and inspect generated branches."
      }
    ],
    continueLabel: "Review Composition",
    generateLabel: "Generate Tree",
    setupGateMessage: "Go to Review before generating the tree."
  }
});

const COMPACT_NAV_MEDIA_QUERY = "(max-width: 1099px)";
const DEFAULT_TAB_ROUTE = "workflow";
const TAB_ROUTES = Object.freeze([
  "workflow",
  "team-config",
  "profile",
  "explorer",
  "tags",
  "users",
  "requirements",
  "compositions",
  "coming-soon"
]);
const TAB_ROUTE_SET = new Set(TAB_ROUTES);
const LANE_ORDER = Object.freeze(["Top", "Jungle", "Mid", "ADC", "Support"]);

let runtimeWindow = null;
let runtimeDocument = null;
let runtimeFetch = null;
let runtimeStorage = null;
let runtimeMatchMedia = null;
let runtimeApiBaseUrl = "";

const ROLE_ALIASES = Object.freeze({
  TOP: "Top",
  JUNGLE: "Jungle",
  MID: "Mid",
  ADC: "ADC",
  SUPPORT: "Support",
  SUP: "Support"
});

const SCALING_ALIASES = Object.freeze({
  EARLY: "Early",
  MID: "Mid",
  LATE: "Late"
});
const PRIMARY_DAMAGE_TYPE_OPTIONS = Object.freeze([
  { value: "ad", label: "AD" },
  { value: "ap", label: "AP" },
  { value: "mixed", label: "Mixed" },
  { value: "utility", label: "Utility" }
]);
const PRIMARY_DAMAGE_TYPE_VALUE_SET = new Set(PRIMARY_DAMAGE_TYPE_OPTIONS.map((option) => option.value));
const EFFECTIVENESS_LEVEL_OPTIONS = Object.freeze([
  { value: "weak", label: "Weak" },
  { value: "neutral", label: "Neutral" },
  { value: "strong", label: "Strong" }
]);
const EFFECTIVENESS_LEVEL_VALUE_SET = new Set(EFFECTIVENESS_LEVEL_OPTIONS.map((option) => option.value));
const EFFECTIVENESS_PHASES = Object.freeze(["early", "mid", "late"]);

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");
const REQUIREMENT_JOINER_MODES = Object.freeze(["and", "or"]);
const REQUIREMENT_TERM_KIND_OPTIONS = Object.freeze([
  { value: "tag", label: "Tag" },
  { value: "damage_type", label: "Damage Type" },
  { value: "effectiveness_focus", label: "Effectiveness Focus" }
]);
const REQUIREMENT_TERM_KIND_VALUE_SET = new Set(REQUIREMENT_TERM_KIND_OPTIONS.map((option) => option.value));
const REQUIREMENT_DAMAGE_TYPE_OPTIONS = Object.freeze(
  [...PRIMARY_DAMAGE_TYPE_OPTIONS]
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((option) => ({
      ...option,
      description: `Champion primary damage profile is ${option.label}.`
    }))
);
const REQUIREMENT_EFFECTIVENESS_FOCUS_OPTIONS = Object.freeze(
  EFFECTIVENESS_PHASES.map((phase) => ({
    value: phase,
    label: SCALING_ALIASES[phase.toUpperCase()] ?? phase,
    description: `Champion effectiveness profile peaks in ${SCALING_ALIASES[phase.toUpperCase()] ?? phase} game stages.`
  }))
);
let requirementClauseDraftIdSeed = 0;

function createRequirementClauseDraftId() {
  requirementClauseDraftIdSeed += 1;
  return `clause-${Date.now().toString(36)}-${requirementClauseDraftIdSeed.toString(36)}`;
}

function createEmptyRequirementClauseTerm() {
  return {
    kind: "tag",
    value: ""
  };
}

function createDefaultRequirementRuleClauseDraft() {
  return {
    clauseId: createRequirementClauseDraftId(),
    clauseJoiner: "and",
    terms: [createEmptyRequirementClauseTerm()],
    termJoiners: [],
    activeTermIndex: 0,
    termSearchByKind: {},
    isOpen: true,
    minCount: 1,
    maxCount: "",
    roleFilter: [],
    separateFrom: []
  };
}

function createEmptyChampionMetadataDraft() {
  return {
    roles: [],
    roleProfiles: {},
    useSharedRoleProfile: false
  };
}

function createEmptyRequirementDefinitionDraft() {
  return {
    name: "",
    definition: "",
    rules: [createDefaultRequirementRuleClauseDraft()]
  };
}

function createEmptyCompositionBundleDraft() {
  return {
    name: "",
    description: "",
    requirementIds: [],
    isActive: false
  };
}

function createInitialState() {
  return {
    data: null,
    activeTab: DEFAULT_TAB_ROUTE,
    ui: {
      isNavOpen: false,
      isNavCollapsed: false,
      teamWorkspaceTab: TEAM_WORKSPACE_TAB_DEFAULT,
      updatesReleaseTab: UPDATES_RELEASE_TAB_DEFAULT,
      teamManageAction: null,
      teamManageActionContext: null
    },
    auth: {
      token: null,
      user: null,
      feedback: "",
      mode: "login"
    },
    profile: {
      primaryRole: DEFAULT_PRIMARY_ROLE,
      secondaryRoles: [],
      isSavingRoles: false,
      championStats: createEmptyChampionStatsState(),
      openSetting: null,
      avatarChampionId: null,
      pendingAvatarId: null,
      displayTeamId: null,
      avatarFilter: ""
    },
    api: {
      pools: [],
      poolByTeamId: {},
      teams: [],
      discoverTeams: [],
      membersByTeamId: {},
      joinRequestsByTeamId: {},
      invitationsByTeamId: {},
      userInvitations: [],
      isLoadingTeamInvitations: false,
      isLoadingUserInvitations: false,
      selectedTeamId: "",
      selectedDiscoverTeamId: "",
      isCreatingTeam: false,
      tags: [],
      tagById: {},
      selectedChampionTagEditorId: null,
      selectedChampionTagIds: [],
      championTagScope: "all",
      championTagTeamId: "",
      championEditorTab: CHAMPION_EDITOR_TAB_COMPOSITION,
      championMetadataDraft: createEmptyChampionMetadataDraft(),
      championReviewedDraft: false,
      championEditorSavedSnapshot: null,
      championProfileActiveRole: null,
      isLoadingChampionTags: false,
      isSavingChampionTags: false,
      selectedTagManagerId: null,
      isSavingTagCatalog: false,
      users: [],
      isLoadingUsers: false,
      authorizationMatrix: null,
      isLoadingAuthorizationMatrix: false,
      savingUserRoleId: null,
      savingUserRiotIdId: null,
      deletingUserId: null,
      requirementDefinitions: [],
      selectedRequirementDefinitionId: null,
      requirementDefinitionDraft: createEmptyRequirementDefinitionDraft(),
      isRequirementDefinitionEditorOpen: true,
      isLoadingRequirementDefinitions: false,
      isSavingRequirementDefinition: false,
      compositionBundles: [],
      selectedCompositionBundleId: null,
      compositionBundleDraft: createEmptyCompositionBundleDraft(),
      isLoadingCompositionBundles: false,
      isSavingCompositionBundle: false,
      userDetailsById: {},
      userDetailLoadingIds: new Set(),
      userDetailErrors: {}
    },
    explorer: {
      search: "",
      roles: [],
      damageTypes: [],
      scaling: "",
      includeTags: [],
      excludeTags: [],
      sortBy: "alpha-asc",
      filtersOpen: true,
      activeCardRole: {},
      subTab: "my-champions"
    },
    teamConfig: {
      activeTeamId: null
    },
    playerConfig: {
      teamId: null,
      byTeam: {},
      dirtyPoolByTeamId: {},
      isSavingPool: false
    },
    builder: {
      stage: "setup",
      showOptionalChecks: BUILDER_DEFAULTS.showOptionalChecksByDefault,
      teamId: "",
      activeCompositionId: null,
      draftContext: null,
      teamState: createEmptyTeamState(),
      draftOrder: [...SLOTS],
      slotPoolRole: Object.fromEntries(SLOTS.map((s) => [s, s])),
      excludedChampions: [],
      excludedSearch: "",
      maxBranch: 8,
      tree: null,
      treeDensity: "summary",
      treeSearch: "",
      treeMinScore: 0,
      treeMinCandidateScore: 1,
      treeRankGoal: BUILDER_RANK_GOAL_VALID_END_STATES,
      candidateScoringWeights: {
        ...BUILDER_DEFAULT_CANDIDATE_SCORING_WEIGHTS
      },
      treeValidLeavesOnly: true,
      focusNodeId: "0",
      selectedNodeId: null,
      selectedNodeTitle: "Root Composition"
    }
  };
}

function createElements() {
  return {
    appShell: runtimeDocument.querySelector("#app-shell"),
    authScreen: runtimeDocument.querySelector("#auth-screen"),
    authCardTitle: runtimeDocument.querySelector("#auth-card-title"),
    authSignupLink: runtimeDocument.querySelector("#auth-signup-link"),
    authLoginLinkWrap: runtimeDocument.querySelector("#auth-login-link-wrap"),
    authToLogin: runtimeDocument.querySelector("#auth-to-login"),
    updatesNavLink: runtimeDocument.querySelector(".updates-nav-link"),
    siteHero: runtimeDocument.querySelector("#site-hero"),
    navToggle: runtimeDocument.querySelector("#nav-toggle"),
    navDesktopToggle: runtimeDocument.querySelector("#nav-desktop-toggle"),
    navDrawer: runtimeDocument.querySelector("#nav-drawer"),
    navOverlay: runtimeDocument.querySelector("#nav-overlay"),
    tabTriggers: Array.from(runtimeDocument.querySelectorAll("button[data-tab]")),
    sideMenuLinks: Array.from(runtimeDocument.querySelectorAll(".side-menu-link")),
    heroKicker: runtimeDocument.querySelector("#hero-kicker"),
    heroTitle: runtimeDocument.querySelector("#hero-title"),
    heroSubtitle: runtimeDocument.querySelector("#hero-subtitle"),
    navTitle: runtimeDocument.querySelector("#nav-title"),
    navMeta: runtimeDocument.querySelector("#nav-meta"),
    authEmail: runtimeDocument.querySelector("#auth-email"),
    authEmailGroup: runtimeDocument.querySelector("#auth-email-group"),
    authGameName: runtimeDocument.querySelector("#auth-game-name"),
    authGameNameGroup: runtimeDocument.querySelector("#auth-game-name-group"),
    authTagline: runtimeDocument.querySelector("#auth-tagline"),
    authTaglineGroup: runtimeDocument.querySelector("#auth-tagline-group"),
    authFirstName: runtimeDocument.querySelector("#auth-first-name"),
    authFirstNameGroup: runtimeDocument.querySelector("#auth-first-name-group"),
    authLastName: runtimeDocument.querySelector("#auth-last-name"),
    authLastNameGroup: runtimeDocument.querySelector("#auth-last-name-group"),
    authRetypePassword: runtimeDocument.querySelector("#auth-retype-password"),
    authRetypePasswordGroup: runtimeDocument.querySelector("#auth-retype-password-group"),
    authConfirmNewPassword: runtimeDocument.querySelector("#auth-confirm-new-password"),
    authConfirmNewPasswordGroup: runtimeDocument.querySelector("#auth-confirm-new-password-group"),
    authChangePassword: runtimeDocument.querySelector("#auth-change-password"),
    authCancelChange: runtimeDocument.querySelector("#auth-cancel-change"),
    profileChangePassword: runtimeDocument.querySelector("#profile-change-password"),
    authPassword: runtimeDocument.querySelector("#auth-password"),
    authPasswordGroup: runtimeDocument.querySelector("#auth-password-group"),
    authRegister: runtimeDocument.querySelector("#auth-register"),
    authLogin: runtimeDocument.querySelector("#auth-login"),
    authLogout: runtimeDocument.querySelector("#auth-logout"),
    authStatus: runtimeDocument.querySelector("#auth-status"),
    authFeedback: runtimeDocument.querySelector("#auth-feedback"),
    authForgotLink: runtimeDocument.querySelector("#auth-forgot-link"),
    authResetTokenGroup: runtimeDocument.querySelector("#auth-reset-token-group"),
    authResetToken: runtimeDocument.querySelector("#auth-reset-token"),
    authNewPasswordGroup: runtimeDocument.querySelector("#auth-new-password-group"),
    authNewPassword: runtimeDocument.querySelector("#auth-new-password"),
    authRequestReset: runtimeDocument.querySelector("#auth-request-reset"),
    authSubmitReset: runtimeDocument.querySelector("#auth-submit-reset"),
    authBackToLogin: runtimeDocument.querySelector("#auth-back-to-login"),
    explorerTitle: runtimeDocument.querySelector("#explorer-title"),
    explorerMeta: runtimeDocument.querySelector("#explorer-meta"),
    teamConfigTitle: runtimeDocument.querySelector("#team-config-title"),
    teamConfigMeta: runtimeDocument.querySelector("#team-config-meta"),
    tagsTitle: runtimeDocument.querySelector("#tags-title"),
    tagsMeta: runtimeDocument.querySelector("#tags-meta"),
    tagsManageAccess: runtimeDocument.querySelector("#tags-manage-access"),
    tagsManageName: runtimeDocument.querySelector("#tags-manage-name"),
    tagsManageDefinition: runtimeDocument.querySelector("#tags-manage-definition"),
    tagsManageSave: runtimeDocument.querySelector("#tags-manage-save"),
    tagsManageCancel: runtimeDocument.querySelector("#tags-manage-cancel"),
    tagsManageFeedback: runtimeDocument.querySelector("#tags-manage-feedback"),
    usersTitle: runtimeDocument.querySelector("#users-title"),
    usersMeta: runtimeDocument.querySelector("#users-meta"),
    usersAccess: runtimeDocument.querySelector("#users-access"),
    usersList: runtimeDocument.querySelector("#users-list"),
    usersAuthorizationAccess: runtimeDocument.querySelector("#users-authorization-access"),
    usersAuthorizationRoles: runtimeDocument.querySelector("#users-authorization-roles"),
    usersAuthorizationPermissions: runtimeDocument.querySelector("#users-authorization-permissions"),
    usersAuthorizationAssignments: runtimeDocument.querySelector("#users-authorization-assignments"),
    usersFeedback: runtimeDocument.querySelector("#users-feedback"),
    requirementsTitle: runtimeDocument.querySelector("#requirements-title"),
    requirementsMeta: runtimeDocument.querySelector("#requirements-meta"),
    compositionsTitle: runtimeDocument.querySelector("#compositions-title"),
    compositionsMeta: runtimeDocument.querySelector("#compositions-meta"),
    compositionsSummary: runtimeDocument.querySelector("#compositions-summary"),
    requirementsName: runtimeDocument.querySelector("#requirements-name"),
    requirementsDefinition: runtimeDocument.querySelector("#requirements-definition"),
    requirementsEditor: runtimeDocument.querySelector("#requirements-editor"),
    requirementsOpenEditor: runtimeDocument.querySelector("#requirements-open-editor"),
    requirementsClauses: runtimeDocument.querySelector("#requirements-clauses"),
    requirementsAddClause: runtimeDocument.querySelector("#requirements-add-clause"),
    requirementsSave: runtimeDocument.querySelector("#requirements-save"),
    requirementsCancel: runtimeDocument.querySelector("#requirements-cancel"),
    requirementsDelete: runtimeDocument.querySelector("#requirements-delete"),
    requirementsFeedback: runtimeDocument.querySelector("#requirements-feedback"),
    requirementsList: runtimeDocument.querySelector("#requirements-list"),
    compositionsName: runtimeDocument.querySelector("#compositions-name"),
    compositionsDescription: runtimeDocument.querySelector("#compositions-description"),
    compositionsIsActive: runtimeDocument.querySelector("#compositions-is-active"),
    compositionsRequirementOptions: runtimeDocument.querySelector("#compositions-requirement-options"),
    compositionsSave: runtimeDocument.querySelector("#compositions-save"),
    compositionsCancel: runtimeDocument.querySelector("#compositions-cancel"),
    compositionsDelete: runtimeDocument.querySelector("#compositions-delete"),
    compositionsFeedback: runtimeDocument.querySelector("#compositions-feedback"),
    compositionsList: runtimeDocument.querySelector("#compositions-list"),
    comingSoonTitle: runtimeDocument.querySelector("#coming-soon-title"),
    comingSoonMeta: runtimeDocument.querySelector("#coming-soon-meta"),
    tabExplorer: runtimeDocument.querySelector("#tab-explorer"),
    tabWorkflow: runtimeDocument.querySelector("#tab-workflow"),
    tabTags: runtimeDocument.querySelector("#tab-tags"),
    tabUsers: runtimeDocument.querySelector("#tab-users"),
    tabRequirements: runtimeDocument.querySelector("#tab-requirements"),
    tabCompositions: runtimeDocument.querySelector("#tab-compositions"),
    tabTeamConfig: runtimeDocument.querySelector("#tab-team-config"),
    tabProfile: runtimeDocument.querySelector("#tab-profile"),
    tabComingSoon: runtimeDocument.querySelector("#tab-coming-soon"),
    myChampionsPanel: runtimeDocument.querySelector("#my-champions-panel"),
    explorerSubNavBtns: Array.from(runtimeDocument.querySelectorAll(".explorer-sub-nav-btn")),
    explorerSearch: runtimeDocument.querySelector("#explorer-search"),
    explorerRole: runtimeDocument.querySelector("#explorer-role"),
    explorerDamage: runtimeDocument.querySelector("#explorer-damage"),
    explorerScaling: runtimeDocument.querySelector("#explorer-scaling"),
    explorerSort: runtimeDocument.querySelector("#explorer-sort"),
    explorerIncludeTags: runtimeDocument.querySelector("#explorer-include-tags"),
    explorerExcludeTags: runtimeDocument.querySelector("#explorer-exclude-tags"),
    explorerFilterToggle: runtimeDocument.querySelector("#explorer-filter-toggle"),
    explorerFilterBody: runtimeDocument.querySelector("#explorer-filter-body"),
    explorerActivePills: runtimeDocument.querySelector("#explorer-active-pills"),
    explorerClearAll: runtimeDocument.querySelector("#explorer-clear-all"),
    explorerClearSearch: runtimeDocument.querySelector("#explorer-clear-search"),
    explorerClearRole: runtimeDocument.querySelector("#explorer-clear-role"),
    explorerClearDamage: runtimeDocument.querySelector("#explorer-clear-damage"),
    explorerClearScaling: runtimeDocument.querySelector("#explorer-clear-scaling"),
    explorerClearSort: runtimeDocument.querySelector("#explorer-clear-sort"),
    explorerClearInclude: runtimeDocument.querySelector("#explorer-clear-include"),
    explorerClearExclude: runtimeDocument.querySelector("#explorer-clear-exclude"),
    explorerCatalogField: runtimeDocument.querySelector("#explorer-catalog-field"),
    explorerCatalogToggle: runtimeDocument.querySelector("#explorer-catalog-toggle"),
    explorerCatalogPanel: runtimeDocument.querySelector("#explorer-catalog-panel"),
    explorerCatalogSearch: runtimeDocument.querySelector("#explorer-catalog-search"),
    explorerCount: runtimeDocument.querySelector("#explorer-count"),
    explorerResults: runtimeDocument.querySelector("#explorer-results"),
    championGridPanel: runtimeDocument.querySelector("#champion-grid-panel"),
    championTagCatalogMeta: runtimeDocument.querySelector("#champion-tag-catalog-meta"),
    championTagCatalogList: runtimeDocument.querySelector("#champion-tag-catalog-list"),
    championTagEditor: runtimeDocument.querySelector("#champion-tag-editor"),
    championTagEditorTitle: runtimeDocument.querySelector("#champion-tag-editor-title"),
    championTagEditorMeta: runtimeDocument.querySelector("#champion-tag-editor-meta"),
    championTagEditorScope: runtimeDocument.querySelector("#champion-tag-editor-scope"),
    championTagEditorTeamGroup: runtimeDocument.querySelector("#champion-tag-editor-team-group"),
    championTagEditorTeam: runtimeDocument.querySelector("#champion-tag-editor-team"),
    cedChampImage: runtimeDocument.querySelector("#ced-champ-image"),
    cedChampRoles: runtimeDocument.querySelector("#ced-champ-roles"),
    cedTagsAvailableFilter: runtimeDocument.querySelector("#ced-tags-available-filter"),
    cedTagsSelectedFilter: runtimeDocument.querySelector("#ced-tags-selected-filter"),
    cedTagsAvailable: runtimeDocument.querySelector("#ced-tags-available"),
    cedTagsSelected: runtimeDocument.querySelector("#ced-tags-selected"),
    championTagEditorReviewed: runtimeDocument.querySelector("#champion-tag-editor-reviewed"),
    championMetadataEditorRoles: runtimeDocument.querySelector("#champion-metadata-editor-roles"),
    championMetadataRoleProfiles: runtimeDocument.querySelector("#champion-metadata-role-profiles"),
    cedDamageSlot: runtimeDocument.querySelector("#ced-damage-slot"),
    cedEffectivenessSlot: runtimeDocument.querySelector("#ced-effectiveness-slot"),
    cedShareToggleSlot: runtimeDocument.querySelector("#ced-share-toggle-slot"),
    championTagEditorSave: runtimeDocument.querySelector("#champion-tag-editor-save"),
    championTagEditorClear: runtimeDocument.querySelector("#champion-tag-editor-clear"),
    championTagEditorFeedback: runtimeDocument.querySelector("#champion-tag-editor-feedback"),
    tagsWorkspaceSummary: runtimeDocument.querySelector("#tags-workspace-summary"),
    tagsWorkspaceCategories: runtimeDocument.querySelector("#tags-workspace-categories"),
    builderWorkflowTitle: runtimeDocument.querySelector("#builder-workflow-title"),
    builderStageGuide: runtimeDocument.querySelector("#builder-stage-guide"),
    builderStageGuideMeta: runtimeDocument.querySelector("#builder-stage-guide-meta"),
    builderSetupFeedback: runtimeDocument.querySelector("#builder-setup-feedback"),
    builderInspectFeedback: runtimeDocument.querySelector("#builder-inspect-feedback"),
    builderActiveTeam: runtimeDocument.querySelector("#builder-active-team"),
    builderActiveComposition: runtimeDocument.querySelector("#builder-active-composition"),
    builderCompositionHelp: runtimeDocument.querySelector("#builder-composition-help"),
    builderTeamHelp: runtimeDocument.querySelector("#builder-team-help"),
    builderStageSetupTitle: runtimeDocument.querySelector("#builder-stage-setup-title"),
    builderStageSetupMeta: runtimeDocument.querySelector("#builder-stage-setup-meta"),
    builderStageInspectTitle: runtimeDocument.querySelector("#builder-stage-inspect-title"),
    builderStageInspectMeta: runtimeDocument.querySelector("#builder-stage-inspect-meta"),
    builderChecksReadiness: runtimeDocument.querySelector("#builder-checks-readiness"),
    builderStageSetup: runtimeDocument.querySelector("#builder-stage-setup"),
    builderStageInspect: runtimeDocument.querySelector("#builder-stage-inspect"),
    builderAdvancedControls: runtimeDocument.querySelector("#builder-advanced-controls"),
    builderExcludedSearch: runtimeDocument.querySelector("#builder-excluded-search"),
    builderExcludedOptions: runtimeDocument.querySelector("#builder-excluded-options"),
    builderExcludedPills: runtimeDocument.querySelector("#builder-excluded-pills"),
    builderExcludedClear: runtimeDocument.querySelector("#builder-excluded-clear"),
    builderMaxBranch: runtimeDocument.querySelector("#builder-max-branch"),
    builderContinueValidate: runtimeDocument.querySelector("#builder-continue-validate"),
    builderGenerate: runtimeDocument.querySelector("#builder-generate"),
    builderClear: runtimeDocument.querySelector("#builder-clear"),
    builderNextRoleReadout: runtimeDocument.querySelector("#builder-next-role-readout"),
    builderTeamContext: runtimeDocument.querySelector("#builder-team-context"),
    builderRequiredChecks: runtimeDocument.querySelector("#builder-required-checks"),
    builderOptionalChecks: runtimeDocument.querySelector("#builder-optional-checks"),
    builderTreeSummary: runtimeDocument.querySelector("#builder-tree-summary"),
    builderTree: runtimeDocument.querySelector("#builder-tree"),
    builderTreeMap: runtimeDocument.querySelector("#builder-tree-map"),
    treeDensity: runtimeDocument.querySelector("#tree-density"),
    treeSearch: runtimeDocument.querySelector("#tree-search"),
    treeMinScore: runtimeDocument.querySelector("#tree-min-score"),
    treeMinCandidateScore: runtimeDocument.querySelector("#tree-min-candidate-score"),
    treeRankGoal: runtimeDocument.querySelector("#tree-rank-goal"),
    treeCandidateRedundancyPenalty: runtimeDocument.querySelector("#tree-candidate-redundancy-penalty"),
    treeValidLeavesOnly: runtimeDocument.querySelector("#tree-valid-leaves-only"),
    treeMapLegend: runtimeDocument.querySelector("#tree-map-legend"),
    treeExpandAll: runtimeDocument.querySelector("#tree-expand-all"),
    treeCollapseAll: runtimeDocument.querySelector("#tree-collapse-all"),
    teamConfigActiveTeam: runtimeDocument.querySelector("#team-config-active-team"),
    teamConfigContextHelp: runtimeDocument.querySelector("#team-config-context-help"),
    teamConfigActiveHelp: runtimeDocument.querySelector("#team-config-active-help"),
    teamConfigPoolSummary: runtimeDocument.querySelector("#team-config-pool-summary"),
    teamConfigPoolGrid: runtimeDocument.querySelector("#team-config-pool-grid"),
    teamWorkspaceTabButtons: Array.from(runtimeDocument.querySelectorAll("button[data-team-workspace-tab]")),
    teamWorkspaceMemberPanel: runtimeDocument.querySelector("#team-workspace-member"),
    teamWorkspaceManagePanel: runtimeDocument.querySelector("#team-workspace-manage"),
    teamWorkspaceCreatePanel: runtimeDocument.querySelector("#team-workspace-create"),
    updatesReleaseTabButtons: Array.from(runtimeDocument.querySelectorAll("button[data-updates-release-tab]")),
    updatesReleaseWhatsNewPanel: runtimeDocument.querySelector("#updates-release-panel-whats-new"),
    updatesReleaseComingSoonPanel: runtimeDocument.querySelector("#updates-release-panel-coming-soon"),
    updatesReleasePreviousPanel: runtimeDocument.querySelector("#updates-release-panel-previous"),
    teamManageActionButtons: Array.from(runtimeDocument.querySelectorAll("button[data-team-manage-action]")),
    teamManageActionPanels: Array.from(runtimeDocument.querySelectorAll("[data-team-manage-panel]")),
    teamManageActionHelp: runtimeDocument.querySelector("#team-manage-action-help"),
    teamAdminCreateName: runtimeDocument.querySelector("#team-admin-create-name"),
    teamAdminCreateTag: runtimeDocument.querySelector("#team-admin-create-tag"),
    teamAdminCreateLogoUrl: runtimeDocument.querySelector("#team-admin-create-logo-url"),
    teamAdminCreate: runtimeDocument.querySelector("#team-admin-create"),
    teamAdminTeamSelect: runtimeDocument.querySelector("#team-admin-team-select"),
    teamAdminOpenEdit: runtimeDocument.querySelector("#team-admin-open-edit"),
    teamAdminRefresh: runtimeDocument.querySelector("#team-admin-refresh"),
    teamJoinDiscoverSelect: runtimeDocument.querySelector("#team-join-discover-select"),
    teamJoinNote: runtimeDocument.querySelector("#team-join-note"),
    teamJoinLoadDiscover: runtimeDocument.querySelector("#team-join-load-discover"),
    teamJoinRequest: runtimeDocument.querySelector("#team-join-request"),
    teamJoinCancel: runtimeDocument.querySelector("#team-join-cancel"),
    teamJoinDiscoverMeta: runtimeDocument.querySelector("#team-join-discover-meta"),
    teamJoinLoadReview: runtimeDocument.querySelector("#team-join-load-review"),
    teamJoinReviewList: runtimeDocument.querySelector("#team-join-review-list"),
    teamJoinFeedback: runtimeDocument.querySelector("#team-join-feedback"),
    teamInviteRiotId: runtimeDocument.querySelector("#team-invite-riot-id"),
    teamInviteLane: runtimeDocument.querySelector("#team-invite-lane"),
    teamInviteNote: runtimeDocument.querySelector("#team-invite-note"),
    teamInviteRole: runtimeDocument.querySelector("#team-invite-role"),
    teamInviteTeamRole: runtimeDocument.querySelector("#team-invite-team-role"),
    teamInviteSend: runtimeDocument.querySelector("#team-invite-send"),
    teamInviteClear: runtimeDocument.querySelector("#team-invite-clear"),
    teamInviteFeedback: runtimeDocument.querySelector("#team-invite-feedback"),
    teamInviteLoad: runtimeDocument.querySelector("#team-invite-load"),
    teamInviteList: runtimeDocument.querySelector("#team-invite-list"),
    teamInviteListMeta: runtimeDocument.querySelector("#team-invite-list-meta"),
    teamInviteUserLoad: runtimeDocument.querySelector("#team-invite-user-load"),
    teamInviteUserList: runtimeDocument.querySelector("#team-invite-user-list"),
    teamInviteUserFeedback: runtimeDocument.querySelector("#team-invite-user-feedback"),
    teamActivityTeamsSummary: runtimeDocument.querySelector("#team-activity-teams-summary"),
    teamActivityTeamsList: runtimeDocument.querySelector("#team-activity-teams-list"),
    teamAdminRenameName: runtimeDocument.querySelector("#team-admin-rename-name"),
    teamAdminRenameTag: runtimeDocument.querySelector("#team-admin-rename-tag"),
    teamAdminRenameLogoUrl: runtimeDocument.querySelector("#team-admin-rename-logo-url"),
    teamAdminRenameRemoveLogo: runtimeDocument.querySelector("#team-admin-rename-remove-logo"),
    teamAdminCurrentLogo: runtimeDocument.querySelector("#team-admin-current-logo"),
    teamAdminCurrentLogoOpen: runtimeDocument.querySelector("#team-admin-current-logo-open"),
    teamAdminCurrentLogoImage: runtimeDocument.querySelector("#team-admin-current-logo-image"),
    teamAdminCurrentLogoHelp: runtimeDocument.querySelector("#team-admin-current-logo-help"),
    teamAdminRename: runtimeDocument.querySelector("#team-admin-rename"),
    teamAdminDelete: runtimeDocument.querySelector("#team-admin-delete"),
    teamAdminMembers: runtimeDocument.querySelector("#team-admin-members"),
    teamAdminAddTitle: runtimeDocument.querySelector("#team-admin-add-title"),
    teamAdminAddRiotId: runtimeDocument.querySelector("#team-admin-add-riot-id"),
    teamAdminAddRole: runtimeDocument.querySelector("#team-admin-add-role"),
    teamAdminAddTeamRole: runtimeDocument.querySelector("#team-admin-add-team-role"),
    teamAdminAddMember: runtimeDocument.querySelector("#team-admin-add-member"),
    teamAdminUpdateRoleTitle: runtimeDocument.querySelector("#team-admin-update-role-title"),
    teamAdminRoleRiotId: runtimeDocument.querySelector("#team-admin-role-riot-id"),
    teamAdminRole: runtimeDocument.querySelector("#team-admin-role"),
    teamAdminUpdateRole: runtimeDocument.querySelector("#team-admin-update-role"),
    teamAdminUpdateTeamRoleTitle: runtimeDocument.querySelector("#team-admin-update-team-role-title"),
    teamAdminTeamRoleRiotId: runtimeDocument.querySelector("#team-admin-team-role-riot-id"),
    teamAdminTeamRole: runtimeDocument.querySelector("#team-admin-team-role"),
    teamAdminUpdateTeamRole: runtimeDocument.querySelector("#team-admin-update-team-role"),
    teamAdminRemoveTitle: runtimeDocument.querySelector("#team-admin-remove-title"),
    teamAdminRemoveRiotId: runtimeDocument.querySelector("#team-admin-remove-riot-id"),
    teamAdminRemoveMember: runtimeDocument.querySelector("#team-admin-remove-member"),
    teamManageCancelButtons: Array.from(runtimeDocument.querySelectorAll("button[data-team-manage-cancel]")),
    teamAdminFeedback: runtimeDocument.querySelector("#team-admin-feedback"),
    poolApiFeedback: runtimeDocument.querySelector("#pool-api-feedback"),
    playerConfigTeam: runtimeDocument.querySelector("#player-config-team"),
    profilePrimaryRole: runtimeDocument.querySelector("#profile-primary-role"),
    profileSecondaryRoles: runtimeDocument.querySelector("#profile-secondary-roles"),
    profileSaveRoles: runtimeDocument.querySelector("#profile-save-roles"),
    profileRolesFeedback: runtimeDocument.querySelector("#profile-roles-feedback"),
    profileRiotStatsSummary: runtimeDocument.querySelector("#profile-riot-stats-summary"),
    profileRiotStatsList: runtimeDocument.querySelector("#profile-riot-stats-list"),
    profileIdentity: runtimeDocument.querySelector("#profile-identity"),
    profileAvatarDisplay: runtimeDocument.querySelector("#profile-avatar-display"),
    profileSummonerName: runtimeDocument.querySelector("#profile-summoner-name"),
    profileRolesDisplay: runtimeDocument.querySelector("#profile-roles-display"),
    profileTeamDisplay: runtimeDocument.querySelector("#profile-team-display"),
    profileSettingsList: runtimeDocument.querySelector("#profile-settings-list"),
    profileSettingRolesValue: runtimeDocument.querySelector("#profile-setting-roles-value"),
    profileSettingAccountValue: runtimeDocument.querySelector("#profile-setting-account-value"),
    profileSettingRolesEditor: runtimeDocument.querySelector("#profile-setting-roles-editor"),
    profileSettingAccountEditor: runtimeDocument.querySelector("#profile-setting-account-editor"),
    profileSetPrimaryRole: runtimeDocument.querySelector("#profile-set-primary-role"),
    profileSetOtherRoles: runtimeDocument.querySelector("#profile-set-other-roles"),
    primaryRoleModal: runtimeDocument.querySelector("#primary-role-modal"),
    primaryRoleModalOptions: runtimeDocument.querySelector("#primary-role-modal-options"),
    primaryRoleModalFeedback: runtimeDocument.querySelector("#primary-role-modal-feedback"),
    otherRolesModal: runtimeDocument.querySelector("#other-roles-modal"),
    otherRolesModalFeedback: runtimeDocument.querySelector("#other-roles-modal-feedback"),
    myChampionsSetPrimary: runtimeDocument.querySelector("#my-champions-set-primary"),
    myChampionsSetOthers: runtimeDocument.querySelector("#my-champions-set-others"),
    avatarModalCancel: runtimeDocument.querySelector("#avatar-modal-cancel"),
    avatarModalSave: runtimeDocument.querySelector("#avatar-modal-save"),
    profileAccountFields: runtimeDocument.querySelector("#profile-account-fields"),
    profileSaveAccount: runtimeDocument.querySelector("#profile-save-account"),
    profileAccountFeedback: runtimeDocument.querySelector("#profile-account-feedback"),
    profileAdminLink: runtimeDocument.querySelector("#profile-admin-link"),
    avatarModal: runtimeDocument.querySelector("#avatar-modal"),
    avatarModalSearch: runtimeDocument.querySelector("#avatar-modal-search"),
    avatarModalGrid: runtimeDocument.querySelector("#avatar-modal-grid"),
    playerConfigSavePool: runtimeDocument.querySelector("#player-config-save-pool"),
    playerConfigFeedback: runtimeDocument.querySelector("#player-config-feedback"),
    playerConfigGrid: runtimeDocument.querySelector("#player-config-grid"),
    logoLightbox: runtimeDocument.querySelector("#logo-lightbox"),
    logoLightboxClose: runtimeDocument.querySelector("#logo-lightbox-close"),
    logoLightboxImage: runtimeDocument.querySelector("#logo-lightbox-image"),
    logoLightboxCaption: runtimeDocument.querySelector("#logo-lightbox-caption"),
  };
}

let state = null;
let elements = null;

const multiSelectControls = {};
const checkboxMultiDetailsRegistry = new Set();

function closeCheckboxMultiDetails(keepOpenDetails = null) {
  const stale = [];
  for (const candidate of checkboxMultiDetailsRegistry) {
    if (!candidate.isConnected) {
      stale.push(candidate);
      continue;
    }
    if (candidate !== keepOpenDetails) {
      candidate.open = false;
    }
  }
  for (const staleNode of stale) {
    checkboxMultiDetailsRegistry.delete(staleNode);
  }
}

function syncDropdownPanelLayering(details, isOpen) {
  const panel = details.closest(".draft-board-panel");
  if (!panel) {
    return;
  }

  if (isOpen) {
    panel.classList.add("has-open-dropdown");
    return;
  }

  const hasOpenDropdown = Boolean(panel.querySelector(".checkbox-multi-details[open]"));
  panel.classList.toggle("has-open-dropdown", hasOpenDropdown);
}

function setInlineFeedback(target, message) {
  if (!target) {
    return;
  }
  target.textContent = message;
  target.hidden = !message;
}

function setSetupFeedback(message) {
  setInlineFeedback(elements.builderSetupFeedback, message);
}

function setInspectFeedback(message) {
  setInlineFeedback(elements.builderInspectFeedback, message);
}

function clearBuilderFeedback() {
  setSetupFeedback("");
  setInspectFeedback("");
}

function setAuthFeedback(message) {
  state.auth.feedback = message;
  setInlineFeedback(elements.authFeedback, message);
}

function setPoolApiFeedback(message) {
  if (elements.poolApiFeedback) {
    elements.poolApiFeedback.textContent = message;
  }
}

function setTeamAdminFeedback(message) {
  if (elements.teamAdminFeedback) {
    elements.teamAdminFeedback.textContent = message;
  }
}

function setTeamJoinFeedback(message) {
  if (elements.teamJoinFeedback) {
    elements.teamJoinFeedback.textContent = message;
  }
}

function setTeamInviteFeedback(message) {
  if (elements.teamInviteFeedback) {
    elements.teamInviteFeedback.textContent = message;
  }
}

function setTeamInviteUserFeedback(message) {
  if (elements.teamInviteUserFeedback) {
    elements.teamInviteUserFeedback.textContent = message;
  }
}

function setChampionTagEditorFeedback(message) {
  if (elements.championTagEditorFeedback) {
    elements.championTagEditorFeedback.textContent = message;
  }
}

function setTagsManageFeedback(message) {
  if (elements.tagsManageFeedback) {
    elements.tagsManageFeedback.textContent = message;
  }
}

function setUsersFeedback(message) {
  if (elements.usersFeedback) {
    elements.usersFeedback.textContent = message;
  }
}

function setRequirementsFeedback(message) {
  if (elements.requirementsFeedback) {
    elements.requirementsFeedback.textContent = message;
  }
}

function setCompositionsFeedback(message) {
  if (elements.compositionsFeedback) {
    elements.compositionsFeedback.textContent = message;
  }
}

function isAdminUser() {
  return String(state.auth.user?.role ?? "").trim().toLowerCase() === "admin";
}

function isGlobalTagEditorUser() {
  const role = String(state.auth.user?.role ?? "").trim().toLowerCase();
  if (role === "admin" || role === "global") {
    return true;
  }
  // Backward-compatible fallback for legacy stored sessions that predate role persistence.
  return role === "";
}

function normalizeChampionTagScope(scope) {
  return CHAMPION_TAG_SCOPES.includes(scope) ? scope : "all";
}

function getChampionTagLeadTeams() {
  return Array.isArray(state.api.teams)
    ? state.api.teams.filter((team) => String(team.membership_role ?? "").toLowerCase() === "lead")
    : [];
}

function getChampionTagLeadTeamOptions() {
  return getChampionTagLeadTeams().map((team) => ({
    value: String(team.id),
    label: formatTeamCardTitle(team)
  }));
}

function normalizeChampionEditorTab(tab) {
  return CHAMPION_EDITOR_TAB_SET.has(tab) ? tab : CHAMPION_EDITOR_TAB_COMPOSITION;
}

function normalizeChampionMetadataRoles(roles) {
  const normalized = Array.isArray(roles)
    ? roles.map((value) => normalizeApiSlot(value)).filter(Boolean)
    : [];
  return SLOTS.filter((slot) => normalized.includes(slot));
}

function createDefaultRoleProfileDraft() {
  return {
    primaryDamageType: "mixed",
    effectiveness: {
      early: "neutral",
      mid: "neutral",
      late: "neutral"
    }
  };
}

function normalizeApiPrimaryDamageType(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (PRIMARY_DAMAGE_TYPE_VALUE_SET.has(normalized)) {
    return normalized;
  }
  if (normalized === "ad") {
    return "ad";
  }
  if (normalized === "ap") {
    return "ap";
  }
  return null;
}

function normalizeApiEffectivenessLevel(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (EFFECTIVENESS_LEVEL_VALUE_SET.has(normalized)) {
    return normalized;
  }
  return null;
}

function normalizeRoleProfilesFromMetadata(rawRoleProfiles, roles) {
  const source =
    rawRoleProfiles && typeof rawRoleProfiles === "object" && !Array.isArray(rawRoleProfiles)
      ? rawRoleProfiles
      : {};
  const profiles = {};
  for (const role of roles) {
    const rawProfile = source[role] ?? source[role.toLowerCase()];
    const profile =
      rawProfile && typeof rawProfile === "object" && !Array.isArray(rawProfile)
        ? rawProfile
        : createDefaultRoleProfileDraft();
    const normalizedPrimaryDamageType = normalizeApiPrimaryDamageType(
      profile.primaryDamageType ?? profile.primary_damage_type
    ) ?? "mixed";
    const rawEffectiveness =
      profile.effectiveness && typeof profile.effectiveness === "object" && !Array.isArray(profile.effectiveness)
        ? profile.effectiveness
        : {};
    profiles[role] = {
      primaryDamageType: normalizedPrimaryDamageType,
      effectiveness: {
        early: normalizeApiEffectivenessLevel(rawEffectiveness.early) ?? "neutral",
        mid: normalizeApiEffectivenessLevel(rawEffectiveness.mid) ?? "neutral",
        late: normalizeApiEffectivenessLevel(rawEffectiveness.late) ?? "neutral"
      }
    };
  }
  return profiles;
}

function cloneRoleProfileDraft(profile) {
  const source = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
  return {
    primaryDamageType: normalizeApiPrimaryDamageType(source.primaryDamageType ?? source.primary_damage_type) ?? "mixed",
    effectiveness: {
      early: normalizeApiEffectivenessLevel(source.effectiveness?.early) ?? "neutral",
      mid: normalizeApiEffectivenessLevel(source.effectiveness?.mid) ?? "neutral",
      late: normalizeApiEffectivenessLevel(source.effectiveness?.late) ?? "neutral"
    }
  };
}

function roleProfilesMatch(leftProfile, rightProfile) {
  const left = cloneRoleProfileDraft(leftProfile);
  const right = cloneRoleProfileDraft(rightProfile);
  return (
    left.primaryDamageType === right.primaryDamageType &&
    left.effectiveness.early === right.effectiveness.early &&
    left.effectiveness.mid === right.effectiveness.mid &&
    left.effectiveness.late === right.effectiveness.late
  );
}

function selectedRoleProfilesAreUniform(roles, roleProfiles) {
  if (!Array.isArray(roles) || roles.length < 2) {
    return false;
  }
  const anchorProfile = roleProfiles?.[roles[0]] ?? createDefaultRoleProfileDraft();
  for (const role of roles.slice(1)) {
    const candidateProfile = roleProfiles?.[role] ?? createDefaultRoleProfileDraft();
    if (!roleProfilesMatch(anchorProfile, candidateProfile)) {
      return false;
    }
  }
  return true;
}

function ensureChampionMetadataRoleProfiles() {
  const selectedRoles = normalizeChampionMetadataRoles(state.api.championMetadataDraft.roles);
  state.api.championMetadataDraft.roles = selectedRoles;
  const nextProfiles = {};
  for (const role of selectedRoles) {
    const existing = state.api.championMetadataDraft.roleProfiles?.[role];
    const normalizedExisting =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? normalizeRoleProfilesFromMetadata({ [role]: existing }, [role])[role]
        : createDefaultRoleProfileDraft();
    nextProfiles[role] = normalizedExisting;
  }
  if (state.api.championMetadataDraft.useSharedRoleProfile === true && selectedRoles.length > 1) {
    const anchorRole = selectedRoles[0];
    const anchorProfile = nextProfiles[anchorRole] ?? createDefaultRoleProfileDraft();
    for (const role of selectedRoles) {
      nextProfiles[role] = cloneRoleProfileDraft(anchorProfile);
    }
  }
  state.api.championMetadataDraft.roleProfiles = nextProfiles;
}

function getChampionRoleProfile(champion, role) {
  const roleProfiles =
    champion?.roleProfiles && typeof champion.roleProfiles === "object" && !Array.isArray(champion.roleProfiles)
      ? champion.roleProfiles
      : {};
  const fromRole = roleProfiles[role];
  if (fromRole && typeof fromRole === "object" && !Array.isArray(fromRole)) {
    return fromRole;
  }
  const fallbackRole = Array.isArray(champion?.roles) ? champion.roles[0] : null;
  if (!fallbackRole) {
    return null;
  }
  const fromFallback = roleProfiles[fallbackRole];
  if (fromFallback && typeof fromFallback === "object" && !Array.isArray(fromFallback)) {
    return fromFallback;
  }
  return null;
}

function deriveDisplayDamageTypeFromProfile(profile) {
  const value = normalizeApiPrimaryDamageType(profile?.primaryDamageType);
  if (value === "ad") {
    return "AD";
  }
  if (value === "ap") {
    return "AP";
  }
  if (value === "mixed") {
    return "Mixed";
  }
  if (value === "utility") {
    return "Utility";
  }
  return "Mixed";
}

function deriveLegacyScalingFromProfile(profile) {
  const effectiveness =
    profile?.effectiveness && typeof profile.effectiveness === "object" && !Array.isArray(profile.effectiveness)
      ? profile.effectiveness
      : {};
  const ranking = {
    weak: 1,
    neutral: 2,
    strong: 3
  };
  let bestPhase = "mid";
  let bestRank = 0;
  for (const phase of EFFECTIVENESS_PHASES) {
    const rank = ranking[normalizeApiEffectivenessLevel(effectiveness[phase]) ?? "weak"] ?? 0;
    if (rank > bestRank) {
      bestRank = rank;
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

function initializeChampionMetadataDraft(champion) {
  if (!champion) {
    state.api.championMetadataDraft = createEmptyChampionMetadataDraft();
    state.api.championReviewedDraft = false;
    return;
  }
  const roles = normalizeChampionMetadataRoles(champion.roles);
  const roleProfiles = normalizeRoleProfilesFromMetadata(champion.roleProfiles, roles);
  const useSharedRoleProfile = selectedRoleProfilesAreUniform(roles, roleProfiles);
  state.api.championMetadataDraft = {
    roles,
    roleProfiles,
    useSharedRoleProfile
  };
  ensureChampionMetadataRoleProfiles();
  state.api.championReviewedDraft = champion.reviewed === true;
}

function syncChampionMetadataDraftToState(championId, championPayload) {
  if (!Number.isInteger(championId) || championId <= 0 || !championPayload || typeof championPayload !== "object") {
    return;
  }
  const champion = getChampionById(championId);
  if (!champion) {
    return;
  }

  const metadata =
    championPayload.metadata && typeof championPayload.metadata === "object" && !Array.isArray(championPayload.metadata)
      ? championPayload.metadata
      : {};
  const nextRoles = normalizeChampionMetadataRoles(metadata.roles);
  const nextRoleProfiles = normalizeRoleProfilesFromMetadata(metadata.roleProfiles, nextRoles);
  if (nextRoles.length > 0) {
    champion.roles = nextRoles;
  }
  champion.roleProfiles = nextRoleProfiles;
  const previewProfile = getChampionRoleProfile(champion, champion.roles[0]);
  champion.damageType = deriveDisplayDamageTypeFromProfile(previewProfile);
  champion.scaling = deriveLegacyScalingFromProfile(previewProfile);
  const payloadTagIds = championPayload.tagIds ?? championPayload.tag_ids;
  if (payloadTagIds !== undefined) {
    champion.tagIds = normalizeChampionTagIdArray(payloadTagIds);
  }
  if (championPayload.reviewed !== undefined) {
    champion.reviewed = championPayload.reviewed === true;
  }
  initializeChampionMetadataDraft(champion);
}

function getChampionEditorSnapshot() {
  return JSON.stringify({
    tagIds: [...(state.api.selectedChampionTagIds ?? [])].sort((a, b) => a - b),
    roles: [...(state.api.championMetadataDraft?.roles ?? [])],
    roleProfiles: state.api.championMetadataDraft?.roleProfiles ?? {},
    reviewed: state.api.championReviewedDraft
  });
}

function hasChampionEditorUnsavedChanges() {
  if (!state.api.selectedChampionTagEditorId) return false;
  if (!state.api.championEditorSavedSnapshot) return false;
  return state.api.championEditorSavedSnapshot !== getChampionEditorSnapshot();
}

function clearChampionTagEditorState() {
  state.api.selectedChampionTagEditorId = null;
  state.api.selectedChampionTagIds = [];
  state.api.championTagScope = "all";
  state.api.championTagTeamId = "";
  state.api.championEditorTab = CHAMPION_EDITOR_TAB_COMPOSITION;
  state.api.championMetadataDraft = createEmptyChampionMetadataDraft();
  state.api.championReviewedDraft = false;
  state.api.championEditorSavedSnapshot = null;
  state.api.championProfileActiveRole = null;
  state.api.isLoadingChampionTags = false;
  state.api.isSavingChampionTags = false;
  setChampionTagEditorFeedback("");
  closeChampionTagEditor();
}

function clearTagsManagerState({ clearInputs = true } = {}) {
  state.api.selectedTagManagerId = null;
  state.api.isSavingTagCatalog = false;
  setTagsManageFeedback("");
  if (clearInputs) {
    if (elements.tagsManageName) {
      elements.tagsManageName.value = "";
    }
    if (elements.tagsManageDefinition) {
      elements.tagsManageDefinition.value = "";
    }
  }
}

function formatTeamCardTitle(team) {
  const name = typeof team?.name === "string" ? team.name : "Unnamed Team";
  const tag = typeof team?.tag === "string" ? team.tag.trim() : "";
  return tag ? `${name} (${tag})` : name;
}

function normalizeTeamEntityId(rawValue) {
  if (typeof rawValue === "string" && rawValue.trim() !== "") {
    const parsed = Number.parseInt(rawValue, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return String(parsed);
    }
  }
  if (Number.isInteger(rawValue) && rawValue > 0) {
    return String(rawValue);
  }
  return null;
}

function toApiTeamContextId(teamId) {
  if (teamId === NONE_TEAM_ID) {
    return null;
  }
  const normalizedId = normalizeTeamEntityId(teamId);
  if (!normalizedId) {
    return null;
  }
  return Number.parseInt(normalizedId, 10);
}

function findTeamById(teamId) {
  const normalizedId = normalizeTeamEntityId(teamId);
  if (!normalizedId) {
    return null;
  }
  return state.api.teams.find((team) => String(team.id) === normalizedId) ?? null;
}

function findDiscoverTeamById(teamId) {
  const normalizedId = normalizeTeamEntityId(teamId);
  if (!normalizedId) {
    return null;
  }
  return state.api.discoverTeams.find((team) => String(team.id) === normalizedId) ?? null;
}

function closeLogoLightbox() {
  if (!elements.logoLightbox) {
    return;
  }
  elements.logoLightbox.hidden = true;
  if (elements.logoLightboxImage) {
    elements.logoLightboxImage.removeAttribute("src");
  }
  if (elements.logoLightboxCaption) {
    elements.logoLightboxCaption.textContent = "";
  }
}

function openLogoLightbox(imageUrl, caption = "") {
  if (!elements.logoLightbox || !elements.logoLightboxImage || !imageUrl) {
    return;
  }
  elements.logoLightboxImage.src = imageUrl;
  elements.logoLightboxCaption.textContent = caption;
  elements.logoLightbox.hidden = false;
}

function normalizeTeamTag(tag) {
  if (typeof tag !== "string") {
    return "";
  }
  return tag.trim().toUpperCase();
}

function readTeamLogoFile(inputElement) {
  const list = inputElement?.files;
  if (!list || list.length < 1) {
    return null;
  }
  return list[0] ?? null;
}

function validateTeamLogoFile(file) {
  if (!file || typeof file !== "object") {
    return null;
  }
  if (!ALLOWED_TEAM_LOGO_MIME_TYPES.has(file.type)) {
    return "Team logo file must be PNG, JPEG, or WebP.";
  }
  if (typeof file.size === "number" && file.size > MAX_TEAM_LOGO_BYTES) {
    return "Team logo file must be 512KB or smaller.";
  }
  return null;
}

function buildTeamMutationRequest({ name, tag, logoFile, removeLogo = false, allowRemoveLogo = false }) {
  if (!name) {
    return {
      error: "Enter a team name."
    };
  }

  if (!tag) {
    return {
      error: "Enter a team tag."
    };
  }

  if (!allowRemoveLogo && removeLogo) {
    return {
      error: "Logo removal is only supported for updates."
    };
  }

  if (removeLogo && logoFile) {
    return {
      error: "Choose either a new logo file or remove logo, not both."
    };
  }

  if (logoFile) {
    const logoError = validateTeamLogoFile(logoFile);
    if (logoError) {
      return {
        error: logoError
      };
    }

    const FormDataCtor = runtimeWindow?.FormData ?? globalThis.FormData;
    const formData = new FormDataCtor();
    formData.set("name", name);
    formData.set("tag", tag);
    formData.set("logo", logoFile);
    return {
      body: formData,
      isFormData: true
    };
  }

  const body = {
    name,
    tag
  };
  if (allowRemoveLogo && removeLogo) {
    body.remove_logo = true;
  }
  return {
    body,
    isFormData: false
  };
}

function readTeamCreateFormValues() {
  const name = elements.teamAdminCreateName?.value.trim() ?? "";
  const tag = normalizeTeamTag(elements.teamAdminCreateTag?.value ?? "");
  const logoFile = readTeamLogoFile(elements.teamAdminCreateLogoUrl);
  return { name, tag, logoFile };
}

function readTeamUpdateFormValues() {
  const name = elements.teamAdminRenameName?.value.trim() ?? "";
  const tag = normalizeTeamTag(elements.teamAdminRenameTag?.value ?? "");
  const logoFile = readTeamLogoFile(elements.teamAdminRenameLogoUrl);
  const removeLogo = Boolean(elements.teamAdminRenameRemoveLogo?.checked);
  return { name, tag, logoFile, removeLogo };
}

function setTeamCreateControlsDisabled(disabled) {
  state.api.isCreatingTeam = disabled;
  if (elements.teamAdminCreate) {
    elements.teamAdminCreate.disabled = disabled || !isAuthenticated();
  }
  if (elements.teamAdminCreateName) {
    elements.teamAdminCreateName.disabled = disabled || !isAuthenticated();
  }
  if (elements.teamAdminCreateTag) {
    elements.teamAdminCreateTag.disabled = disabled || !isAuthenticated();
  }
  if (elements.teamAdminCreateLogoUrl) {
    elements.teamAdminCreateLogoUrl.disabled = disabled || !isAuthenticated();
    if (!isAuthenticated() || disabled) {
      elements.teamAdminCreateLogoUrl.value = "";
    }
  }
}

function setProfileRolesFeedback(message, isError = false) {
  if (!elements.profileRolesFeedback) {
    return;
  }
  elements.profileRolesFeedback.textContent = message;
  elements.profileRolesFeedback.style.color = isError ? "var(--warn)" : "var(--muted)";
}

function formatMembershipRole(role) {
  return role === "lead" ? "Team Lead" : "Team Member";
}

function formatRosterRole(teamRole) {
  return teamRole === "substitute" ? "Substitute" : "Primary";
}

function formatPositionLabel(position) {
  return SLOTS.includes(position) ? position : "Unassigned";
}

function resolveMemberDisplayName(member) {
  if (typeof member?.display_name === "string" && member.display_name.trim() !== "") {
    return member.display_name.trim();
  }
  if (typeof member?.game_name === "string" && member.game_name.trim() !== "") {
    if (typeof member?.tagline === "string" && member.tagline.trim() !== "") {
      return `${member.game_name.trim()}#${member.tagline.trim()}`;
    }
    return member.game_name.trim();
  }
  const memberId = Number.parseInt(String(member?.user_id ?? ""), 10);
  return Number.isInteger(memberId) ? `User ${memberId}` : "Unknown Player";
}

function resolveMemberLane(member) {
  const fromPosition = typeof member?.position === "string" ? member.position : null;
  if (SLOTS.includes(fromPosition)) {
    return fromPosition;
  }
  const fromLane = typeof member?.lane === "string" ? member.lane : null;
  if (SLOTS.includes(fromLane)) {
    return fromLane;
  }
  const fromPrimaryRole = typeof member?.primary_role === "string" ? member.primary_role : null;
  if (SLOTS.includes(fromPrimaryRole)) {
    return fromPrimaryRole;
  }
  return null;
}

function isPlayerPoolDirty(teamId) {
  return Boolean(state.playerConfig.dirtyPoolByTeamId?.[teamId]);
}

function setPlayerPoolDirty(teamId, dirty) {
  if (typeof teamId !== "string" || teamId === "") {
    return;
  }
  if (!state.playerConfig.dirtyPoolByTeamId || typeof state.playerConfig.dirtyPoolByTeamId !== "object") {
    state.playerConfig.dirtyPoolByTeamId = {};
  }
  state.playerConfig.dirtyPoolByTeamId[teamId] = Boolean(dirty);
}

function normalizeProfileRole(role) {
  return SLOTS.includes(role) ? role : DEFAULT_PRIMARY_ROLE;
}

function normalizeSecondaryRoles(roles, primaryRole) {
  if (!Array.isArray(roles)) {
    return [];
  }
  return Array.from(new Set(roles.filter((role) => SLOTS.includes(role) && role !== primaryRole)));
}

function getNormalizedFamiliarityFallback(fallback) {
  const parsedFallback = Number.parseInt(String(fallback), 10);
  if (Number.isInteger(parsedFallback) && parsedFallback >= 1 && parsedFallback <= 4) {
    return parsedFallback;
  }
  if (parsedFallback === 5 || parsedFallback === 6) {
    return 4;
  }
  return DEFAULT_FAMILIARITY_LEVEL;
}

function normalizeFamiliarityLevel(rawValue, fallback = DEFAULT_FAMILIARITY_LEVEL) {
  const parsed = Number.parseInt(String(rawValue), 10);
  if (!Number.isInteger(parsed)) {
    return getNormalizedFamiliarityFallback(fallback);
  }
  if (parsed >= 1 && parsed <= 4) {
    return parsed;
  }
  if (parsed === 5 || parsed === 6) {
    return 4;
  }
  return getNormalizedFamiliarityFallback(fallback);
}

function getFamiliarityGrade(level) {
  const normalizedLevel = normalizeFamiliarityLevel(level);
  return FAMILIARITY_GRADE_BY_LEVEL[normalizedLevel] ?? FAMILIARITY_GRADE_BY_LEVEL[DEFAULT_FAMILIARITY_LEVEL];
}

function familiarityGradeToLevel(grade, fallback = DEFAULT_FAMILIARITY_LEVEL) {
  const normalizedGrade = typeof grade === "string" ? grade.trim().toUpperCase() : "";
  if (FAMILIARITY_LEVEL_BY_GRADE[normalizedGrade]) {
    return FAMILIARITY_LEVEL_BY_GRADE[normalizedGrade];
  }
  return normalizeFamiliarityLevel(fallback);
}

function getFamiliarityLabel(level) {
  const grade = getFamiliarityGrade(level);
  return `${grade}: ${FAMILIARITY_GRADE_LABELS[grade] ?? FAMILIARITY_GRADE_LABELS.B}`;
}

function normalizeFamiliarityByChampion(championNames, rawMap) {
  const names = Array.isArray(championNames) ? championNames : [];
  const source = rawMap && typeof rawMap === "object" && !Array.isArray(rawMap) ? rawMap : {};
  const normalized = {};

  for (const championName of names) {
    if (typeof championName !== "string" || championName.trim() === "") {
      continue;
    }
    normalized[championName] = normalizeFamiliarityLevel(source[championName]);
  }

  return normalized;
}

function deriveFamiliarityFromMastery({ championLevel, championPoints }) {
  const level = Number.parseInt(String(championLevel), 10);
  const points = Number.parseInt(String(championPoints), 10);

  if (level >= 7 || points >= 250000) {
    return 1;
  }
  if (level >= 6 || points >= 120000) {
    return 2;
  }
  if (level >= 4 || points >= 25000) {
    return 3;
  }
  return 4;
}

function isHighSignalMasteryEntry(entry) {
  const level = Number.parseInt(String(entry?.championLevel), 10);
  const points = Number.parseInt(String(entry?.championPoints), 10);
  return level >= HIGH_SIGNAL_MASTERY_LEVEL || points >= HIGH_SIGNAL_CHAMPION_POINTS;
}

function buildMasteryRecommendationsByRole() {
  const byRole = Object.fromEntries(SLOTS.map((role) => [role, []]));
  const championStats = normalizeChampionStats(state.profile.championStats);
  if (championStats.status !== "ok" || championStats.champions.length === 0) {
    return byRole;
  }

  for (const entry of championStats.champions) {
    const champion = getChampionById(entry.championId);
    if (!champion) {
      continue;
    }

    const recommendation = {
      championName: champion.name,
      championLevel: entry.championLevel,
      championPoints: entry.championPoints,
      familiarity: deriveFamiliarityFromMastery(entry),
      highSignal: isHighSignalMasteryEntry(entry)
    };

    for (const role of champion.roles) {
      if (SLOTS.includes(role)) {
        byRole[role].push(recommendation);
      }
    }
  }

  for (const role of SLOTS) {
    const uniqueByChampion = new Map();
    for (const recommendation of byRole[role]) {
      const existing = uniqueByChampion.get(recommendation.championName);
      if (!existing) {
        uniqueByChampion.set(recommendation.championName, recommendation);
        continue;
      }
      if (
        recommendation.championLevel > existing.championLevel ||
        (recommendation.championLevel === existing.championLevel &&
          recommendation.championPoints > existing.championPoints)
      ) {
        uniqueByChampion.set(recommendation.championName, recommendation);
      }
    }

    byRole[role] = [...uniqueByChampion.values()].sort((left, right) => {
      if (left.championLevel !== right.championLevel) {
        return right.championLevel - left.championLevel;
      }
      if (left.championPoints !== right.championPoints) {
        return right.championPoints - left.championPoints;
      }
      return left.championName.localeCompare(right.championName);
    });
  }

  return byRole;
}

function createEmptyChampionStatsState() {
  return {
    provider: "riot",
    status: "idle",
    champions: [],
    fetchedAt: "",
    message: ""
  };
}

function normalizeChampionStats(rawStats) {
  const normalized = createEmptyChampionStatsState();
  if (!rawStats || typeof rawStats !== "object" || Array.isArray(rawStats)) {
    return normalized;
  }

  normalized.provider = typeof rawStats.provider === "string" && rawStats.provider.trim() !== ""
    ? rawStats.provider.trim()
    : "riot";
  normalized.status = typeof rawStats.status === "string" && rawStats.status.trim() !== ""
    ? rawStats.status.trim()
    : "idle";
  normalized.fetchedAt = typeof rawStats.fetchedAt === "string" ? rawStats.fetchedAt : "";
  normalized.message = typeof rawStats.message === "string" ? rawStats.message : "";

  if (Array.isArray(rawStats.champions)) {
    normalized.champions = rawStats.champions
      .map((entry) => {
        const championId = Number.parseInt(String(entry?.championId), 10);
        const championLevel = Number.parseInt(String(entry?.championLevel), 10);
        const championPoints = Number.parseInt(String(entry?.championPoints), 10);
        const championName = typeof entry?.championName === "string" ? entry.championName.trim() : "";
        const lastPlayedAt = typeof entry?.lastPlayedAt === "string" ? entry.lastPlayedAt : null;
        return {
          championId: Number.isInteger(championId) ? championId : null,
          championName,
          championLevel: Number.isInteger(championLevel) ? championLevel : 0,
          championPoints: Number.isInteger(championPoints) ? championPoints : 0,
          lastPlayedAt
        };
      })
      .filter((entry) => entry.championId !== null);
  }

  return normalized;
}

function getConfiguredProfileRoles() {
  const primaryRole = normalizeProfileRole(state.profile.primaryRole);
  const secondaryRoles = normalizeSecondaryRoles(state.profile.secondaryRoles, primaryRole);
  return [primaryRole, ...secondaryRoles];
}

function hasAuthSession() {
  return Boolean(state.auth.token && state.auth.user);
}

function isAuthenticated() {
  return hasAuthSession();
}

function readStoredAuthSession() {
  const stored = tryReadJsonStorage(AUTH_SESSION_STORAGE_KEY, {});
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { token: null, user: null };
  }
  const token = typeof stored.token === "string" && stored.token.trim() !== "" ? stored.token.trim() : null;
  const user =
    stored.user && typeof stored.user === "object" && !Array.isArray(stored.user) ? stored.user : null;
  return { token, user };
}

function saveAuthSession() {
  if (!state.auth.token) {
    tryWriteJsonStorage(AUTH_SESSION_STORAGE_KEY, {});
    return;
  }
  tryWriteJsonStorage(AUTH_SESSION_STORAGE_KEY, {
    token: state.auth.token,
    user: state.auth.user
  });
}

function clearAuthSession(feedback = "") {
  state.auth.token = null;
  state.auth.user = null;
  state.auth.mode = "login";
  state.profile.primaryRole = DEFAULT_PRIMARY_ROLE;
  state.profile.secondaryRoles = [];
  state.profile.isSavingRoles = false;
  state.profile.championStats = createEmptyChampionStatsState();
  state.api.isCreatingTeam = false;
  state.api.discoverTeams = [];
  state.api.joinRequestsByTeamId = {};
  state.api.selectedDiscoverTeamId = "";
  state.api.users = [];
  state.api.isLoadingUsers = false;
  state.api.authorizationMatrix = null;
  state.api.isLoadingAuthorizationMatrix = false;
  state.api.savingUserRoleId = null;
  state.api.savingUserRiotIdId = null;
  state.api.requirementDefinitions = [];
  state.api.selectedRequirementDefinitionId = null;
  state.api.requirementDefinitionDraft = createEmptyRequirementDefinitionDraft();
  state.api.isLoadingRequirementDefinitions = false;
  state.api.isSavingRequirementDefinition = false;
  state.api.compositionBundles = [];
  state.api.selectedCompositionBundleId = null;
  state.api.compositionBundleDraft = createEmptyCompositionBundleDraft();
  state.api.isLoadingCompositionBundles = false;
  state.api.isSavingCompositionBundle = false;
  state.playerConfig.dirtyPoolByTeamId = {};
  state.playerConfig.isSavingPool = false;
  clearChampionTagEditorState();
  clearTagsManagerState();
  setUsersFeedback("");
  setRequirementsFeedback("");
  setCompositionsFeedback("");
  setTeamJoinFeedback("");
  saveAuthSession();
  setAuthFeedback(feedback);
}

function setAuthMode(mode = "login") {
  const valid = new Set(["login", "register", "forgot", "reset", "change-password"]);
  const next = valid.has(mode) ? mode : "login";
  if (next !== state.auth.mode) {
    clearAuthForm();
  }
  state.auth.mode = next;
}

function hasDefinedProfileRoles(user) {
  if (!user || typeof user !== "object" || Array.isArray(user)) {
    return false;
  }

  const primaryRole = normalizeProfileRole(user.primaryRole);
  if (SLOTS.includes(primaryRole) && typeof user.primaryRole === "string" && user.primaryRole.trim() !== "") {
    return true;
  }

  if (!Array.isArray(user.secondaryRoles)) {
    return false;
  }
  return user.secondaryRoles.some((role) => SLOTS.includes(role));
}

function resolvePostLoginTab(user) {
  return hasDefinedProfileRoles(user) ? DEFAULT_TAB_ROUTE : "profile";
}

const AUTH_CARD_TITLES = {
  login: "Log In to Your Account",
  register: "Create Your Account",
  forgot: "Reset Your Password",
  reset: "Set New Password",
  "change-password": "Change Your Password",
};

function setAuthControlsVisibility(showAuthControls, mode = "login") {
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";
  const isPasswordFlow = isForgot || isReset;
  const isRegister = mode === "register";
  const isChangePassword = mode === "change-password";

  if (elements.authCardTitle) {
    elements.authCardTitle.textContent = AUTH_CARD_TITLES[mode] ?? AUTH_CARD_TITLES.login;
  }

  // Email: shown in login, register, forgot only
  if (elements.authEmailGroup) {
    elements.authEmailGroup.hidden = !showAuthControls || isReset || isChangePassword;
  }
  // Password: shown in login and register only
  if (elements.authPasswordGroup) {
    elements.authPasswordGroup.hidden = !showAuthControls || isPasswordFlow || isChangePassword;
  }
  // Retype Password: register only
  if (elements.authRetypePasswordGroup) {
    elements.authRetypePasswordGroup.hidden = !(showAuthControls && isRegister);
  }
  // Login button: login mode only
  if (elements.authLogin) {
    elements.authLogin.hidden = !showAuthControls || isPasswordFlow || isRegister || isChangePassword;
  }
  // Register submit button: register mode only
  if (elements.authRegister) {
    elements.authRegister.hidden = !showAuthControls || isPasswordFlow || !isRegister || isChangePassword;
  }
  // Register-only fields
  const registerOnlyControls = [
    elements.authGameNameGroup,
    elements.authTaglineGroup,
    elements.authFirstNameGroup,
    elements.authLastNameGroup,
  ];
  for (const control of registerOnlyControls) {
    if (control) {
      control.hidden = !(showAuthControls && isRegister);
    }
  }
  // Forgot link: login mode only
  if (elements.authForgotLink) {
    elements.authForgotLink.hidden = !showAuthControls || isPasswordFlow || isRegister || isChangePassword;
  }
  // Sign Up link row: login mode only
  if (elements.authSignupLink) {
    const signupWrap = elements.authSignupLink.closest("p");
    if (signupWrap) signupWrap.hidden = !showAuthControls || isPasswordFlow || isRegister || isChangePassword;
  }
  // "Already have an account? Log In" wrap: register mode only
  if (elements.authLoginLinkWrap) {
    elements.authLoginLinkWrap.hidden = !(showAuthControls && isRegister);
  }
  // Reset token: reset mode only
  if (elements.authResetTokenGroup) {
    elements.authResetTokenGroup.hidden = !showAuthControls || !isReset;
  }
  // New Password: reset or change-password modes
  if (elements.authNewPasswordGroup) {
    elements.authNewPasswordGroup.hidden = !showAuthControls || (!isReset && !isChangePassword);
  }
  // Confirm New Password: change-password mode only
  if (elements.authConfirmNewPasswordGroup) {
    elements.authConfirmNewPasswordGroup.hidden = !(showAuthControls && isChangePassword);
  }
  // Forgot/reset action buttons
  if (elements.authRequestReset) {
    elements.authRequestReset.hidden = !showAuthControls || !isForgot;
  }
  if (elements.authSubmitReset) {
    elements.authSubmitReset.hidden = !showAuthControls || !isReset;
  }
  // Change Password button: change-password mode only
  if (elements.authChangePassword) {
    elements.authChangePassword.hidden = !(showAuthControls && isChangePassword);
  }
  // Back to login: forgot/reset modes only
  if (elements.authBackToLogin) {
    elements.authBackToLogin.hidden = !showAuthControls || !isPasswordFlow;
  }
  // Cancel change: change-password mode only
  if (elements.authCancelChange) {
    elements.authCancelChange.hidden = !(showAuthControls && isChangePassword);
  }
}

function renderAuthGate() {
  const signedIn = hasAuthSession();
  const isChangingPassword = signedIn && state.auth.mode === "change-password";
  if (elements.appShell) {
    elements.appShell.hidden = !signedIn || isChangingPassword;
  }
  if (elements.authScreen) {
    elements.authScreen.hidden = signedIn && !isChangingPassword;
  }
  if (elements.siteHero) {
    elements.siteHero.hidden = !signedIn || isChangingPassword;
  }
  if (!signedIn) {
    setNavOpen(false);
    return;
  }
  applyNavLayout();
}

function renderAuth() {
  const signedIn = hasAuthSession();
  const usersTabButton = elements.tabTriggers.find((button) => button.dataset.tab === "users");
  const isAdmin = signedIn && isAdminUser();
  if (!signedIn) {
    setAuthControlsVisibility(true, state.auth.mode);
    elements.authStatus.textContent = "Signed out.";
    elements.authLogout.disabled = true;
    if (usersTabButton) {
      usersTabButton.hidden = true;
    }
    renderAuthGate();
    return;
  }

  const showOverlay = state.auth.mode === "change-password";
  setAuthControlsVisibility(showOverlay, state.auth.mode);
  const email = typeof state.auth.user.email === "string" ? state.auth.user.email : "unknown";
  const gameName = typeof state.auth.user.gameName === "string" ? state.auth.user.gameName : "";
  const tagline = typeof state.auth.user.tagline === "string" ? state.auth.user.tagline : "";
  const riotId = gameName && tagline ? `${gameName}#${tagline}` : gameName;
  elements.authStatus.textContent = riotId
    ? `Signed in as ${email} (${riotId}).`
    : `Signed in as ${email}.`;
  elements.authLogout.disabled = false;
  if (usersTabButton) {
    usersTabButton.hidden = !isAdmin;
  }
  if (!isAdmin && state.activeTab === "users") {
    setTab(DEFAULT_TAB_ROUTE, { syncRoute: true, replaceRoute: true });
  }
  renderAuthGate();
}

function applyUiCopy() {
  elements.heroKicker.textContent = UI_COPY.hero.kicker;
  elements.navTitle.textContent = UI_COPY.nav.title;
  if (elements.navMeta) {
    elements.navMeta.textContent = UI_COPY.nav.meta;
  }
  elements.explorerTitle.textContent = UI_COPY.panels.explorerTitle;
  if (elements.explorerMeta) {
    elements.explorerMeta.textContent = UI_COPY.panels.explorerMeta;
  }
  if (elements.tagsTitle) {
    elements.tagsTitle.textContent = UI_COPY.panels.tagsTitle;
  }
  if (elements.tagsMeta) {
    elements.tagsMeta.textContent = UI_COPY.panels.tagsMeta;
  }
  if (elements.usersTitle) {
    elements.usersTitle.textContent = UI_COPY.panels.usersTitle;
  }
  if (elements.usersMeta) {
    elements.usersMeta.textContent = UI_COPY.panels.usersMeta;
  }
  if (elements.requirementsTitle) {
    elements.requirementsTitle.textContent = UI_COPY.panels.requirementsTitle;
  }
  if (elements.requirementsMeta) {
    elements.requirementsMeta.textContent = UI_COPY.panels.requirementsMeta;
  }
  if (elements.compositionsTitle) {
    elements.compositionsTitle.textContent = UI_COPY.panels.compositionsTitle;
  }
  if (elements.compositionsMeta) {
    elements.compositionsMeta.textContent = UI_COPY.panels.compositionsMeta;
  }
  if (elements.teamConfigTitle) {
    elements.teamConfigTitle.textContent = UI_COPY.panels.teamConfigTitle;
  }
  if (elements.teamConfigMeta) {
    elements.teamConfigMeta.textContent = UI_COPY.panels.teamConfigMeta;
  }
  if (elements.comingSoonTitle) {
    elements.comingSoonTitle.textContent = UI_COPY.panels.comingSoonTitle;
  }
  if (elements.comingSoonMeta) {
    elements.comingSoonMeta.textContent = UI_COPY.panels.comingSoonMeta;
  }

  for (const button of elements.sideMenuLinks) {
    const tabId = button.dataset.tab;
    if (!tabId) {
      continue;
    }
    const label = UI_COPY.nav.items[tabId];
    if (label) {
      button.textContent = label;
    }
  }

  applyHeroCopy(state.activeTab);
}

function applyHeroCopy(tab) {
  const normalizedTab = TAB_ROUTE_SET.has(tab) ? tab : DEFAULT_TAB_ROUTE;
  const hero = UI_COPY.hero.tabs[normalizedTab] ?? UI_COPY.hero.tabs[DEFAULT_TAB_ROUTE];
  elements.heroTitle.textContent = hero.title;
  elements.heroSubtitle.textContent = hero.subtitle;
}

function getBuilderStageSteps() {
  return UI_COPY.builder.stages;
}

function isCompactNavViewport() {
  return runtimeMatchMedia(COMPACT_NAV_MEDIA_QUERY).matches;
}

function getBuilderStageIndex(stage) {
  return getBuilderStageSteps().findIndex((step) => step.key === stage);
}

function setBuilderStage(stage) {
  if (getBuilderStageIndex(stage) < 0) {
    return;
  }
  state.builder.stage = stage;
}

function setNavOpen(open) {
  state.ui.isNavOpen = open;
  applyNavLayout();
}

function setNavCollapsed(collapsed, { persist = true } = {}) {
  state.ui.isNavCollapsed = Boolean(collapsed);
  if (persist) {
    saveUiState();
  }
  applyNavLayout();
}

function applyNavLayout() {
  const compact = isCompactNavViewport();
  const showDrawer = state.ui.isNavOpen && compact;
  const hideDesktopNav = state.ui.isNavCollapsed && !compact;

  if (elements.navToggle) {
    elements.navToggle.hidden = !compact;
  }
  if (elements.navDesktopToggle) {
    elements.navDesktopToggle.hidden = compact;
  }

  elements.navDrawer.classList.toggle("is-open", showDrawer);
  elements.navOverlay.classList.toggle("is-open", showDrawer);
  runtimeDocument.body.classList.toggle("nav-open", showDrawer);
  elements.appShell.classList.toggle("is-nav-collapsed", hideDesktopNav);
  if (compact) {
    const label = showDrawer ? UI_COPY.nav.toggleOpen : UI_COPY.nav.toggleClosed;
    elements.navToggle.textContent = label;
    elements.navToggle.setAttribute("aria-label", label);
    elements.navToggle.setAttribute("title", label);
    elements.navToggle.setAttribute("aria-expanded", String(showDrawer));
    return;
  }
  const label = hideDesktopNav ? UI_COPY.nav.desktopExpandLabel : UI_COPY.nav.desktopCollapseLabel;
  if (elements.navDesktopToggle) {
    elements.navDesktopToggle.textContent = hideDesktopNav
      ? UI_COPY.nav.desktopExpandIcon
      : UI_COPY.nav.desktopCollapseIcon;
    elements.navDesktopToggle.setAttribute("aria-label", label);
    elements.navDesktopToggle.setAttribute("title", label);
    elements.navDesktopToggle.setAttribute("aria-expanded", String(!hideDesktopNav));
  }
}

function toggleNav() {
  if (isCompactNavViewport()) {
    setNavOpen(!state.ui.isNavOpen);
    return;
  }
  setNavCollapsed(!state.ui.isNavCollapsed);
}

function syncNavLayout() {
  if (!isCompactNavViewport() && state.ui.isNavOpen) {
    state.ui.isNavOpen = false;
  }
  applyNavLayout();
}

function resetBuilderTreeState() {
  state.builder.tree = null;
  state.builder.treeDensity = BUILDER_DEFAULTS.defaultTreeDensity;
  state.builder.treeSearch = "";
  state.builder.treeMinScore = 0;
  clearTreeSelectionState();
}

function clearTreeSelectionState() {
  state.builder.focusNodeId = "0";
  state.builder.selectedNodeId = null;
  state.builder.selectedNodeTitle = "Root Composition";
}

function renderBuilderStageGuide() {
  const completion = getTeamCompletionInfo(state.builder.teamState);
  elements.builderWorkflowTitle.textContent = UI_COPY.builder.workflowTitle;
  elements.builderStageSetupTitle.textContent = UI_COPY.builder.stages[0].panelTitle;
  elements.builderStageSetupMeta.textContent = UI_COPY.builder.stages[0].panelMeta;
  elements.builderStageInspectTitle.textContent = UI_COPY.builder.stages[1].panelTitle;
  elements.builderStageInspectMeta.textContent = UI_COPY.builder.stages[1].panelMeta;
  elements.builderContinueValidate.textContent = UI_COPY.builder.continueLabel;
  elements.builderGenerate.textContent = UI_COPY.builder.generateLabel;
  if (completion.completionState === "partial") {
    elements.builderStageGuideMeta.textContent = "Generate finish-out options from partial picks.";
  } else if (completion.completionState === "full") {
    elements.builderStageGuideMeta.textContent = "Checks evaluate the full composition.";
  } else {
    elements.builderStageGuideMeta.textContent =
      "Generate from an empty board or pre-select champions in Setup before inspecting options.";
  }

  elements.builderStageSetup.hidden = false;
  elements.builderStageInspect.hidden = false;

  elements.builderGenerate.disabled = false;
  elements.builderContinueValidate.hidden = true;
}

function createOption(value, label) {
  const option = runtimeDocument.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function replaceOptions(select, options, includeBlank = false, blankLabel = "Any") {
  const previous = select.multiple ? getMultiSelectValues(select) : [select.value];
  select.innerHTML = "";
  if (includeBlank) {
    select.append(createOption("", blankLabel));
  }
  for (const { value, label } of options) {
    select.append(createOption(value, label));
  }

  if (select.multiple) {
    setMultiSelectValues(select, previous);
  } else if (Array.from(select.options).some((option) => option.value === previous[0])) {
    select.value = previous[0];
  }
}

function setMultiSelectValues(select, values) {
  const valueSet = new Set(values);
  for (const option of select.options) {
    option.selected = valueSet.has(option.value);
  }
}

function getMultiSelectValues(select) {
  return Array.from(select.selectedOptions).map((option) => option.value);
}

function createCheckboxMultiControl({
  root,
  options,
  selectedValues = [],
  onChange = null,
  placeholder = "No selections",
  searchable = false,
  searchPlaceholder = "Filter options",
  summaryFormatter = null
}) {
  const normalizedOptions = options.map(({ value, label }) => ({
    value: String(value),
    label: String(label)
  }));
  const optionValueSet = new Set(normalizedOptions.map((option) => option.value));
  const optionLabelByValue = new Map(normalizedOptions.map((option) => [option.value, option.label]));
  const selected = new Set();

  const shell = runtimeDocument.createElement("div");
  shell.className = "checkbox-multi";

  const details = runtimeDocument.createElement("details");
  details.className = "checkbox-multi-details";
  checkboxMultiDetailsRegistry.add(details);
  details.addEventListener("toggle", () => {
    shell.classList.toggle("is-open", details.open);
    syncDropdownPanelLayering(details, details.open);
    if (details.open) {
      closeCheckboxMultiDetails(details);
    }
  });

  const summary = runtimeDocument.createElement("summary");
  summary.className = "checkbox-multi-summary";
  const summaryText = runtimeDocument.createElement("span");
  summary.append(summaryText);
  details.append(summary);

  const panel = runtimeDocument.createElement("div");
  panel.className = "checkbox-multi-panel";

  let searchInput = null;
  if (searchable) {
    searchInput = runtimeDocument.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = searchPlaceholder;
    searchInput.className = "checkbox-multi-search";
    panel.append(searchInput);
  }

  const list = runtimeDocument.createElement("div");
  list.className = "checkbox-multi-list";
  panel.append(list);
  details.append(panel);
  shell.append(details);

  root.innerHTML = "";
  root.append(shell);

  function getSelected() {
    return normalizedOptions
      .map((option) => option.value)
      .filter((value) => selected.has(value));
  }

  function updateSummary() {
    const selectedValuesNow = getSelected();
    if (summaryFormatter) {
      summaryText.textContent = summaryFormatter(selectedValuesNow, optionLabelByValue);
      return;
    }

    if (selectedValuesNow.length === 0) {
      summaryText.textContent = placeholder;
      return;
    }
    if (selectedValuesNow.length <= 2) {
      summaryText.textContent = selectedValuesNow
        .map((value) => optionLabelByValue.get(value) ?? value)
        .join(", ");
      return;
    }
    summaryText.textContent = `${selectedValuesNow.length} selected`;
  }

  function renderOptions() {
    const query = (searchInput?.value ?? "").trim().toLowerCase();
    list.innerHTML = "";

    const visibleOptions = normalizedOptions.filter((option) => {
      if (!query) {
        return true;
      }
      return option.label.toLowerCase().includes(query) || option.value.toLowerCase().includes(query);
    });

    if (visibleOptions.length === 0) {
      const empty = runtimeDocument.createElement("p");
      empty.className = "checkbox-multi-empty";
      empty.textContent = "No options match the current search.";
      list.append(empty);
      return;
    }

    for (const option of visibleOptions) {
      const label = runtimeDocument.createElement("label");
      label.className = "selection-option checkbox-multi-option";

      const checkbox = runtimeDocument.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = option.value;
      checkbox.checked = selected.has(option.value);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selected.add(option.value);
        } else {
          selected.delete(option.value);
        }
        updateSummary();
        if (onChange) {
          onChange(getSelected());
        }
      });

      const text = runtimeDocument.createElement("span");
      text.textContent = option.label;
      label.append(checkbox, text);
      list.append(label);
    }
  }

  function applySelectedValues(nextValues, emit = false) {
    selected.clear();
    for (const value of nextValues) {
      if (optionValueSet.has(String(value))) {
        selected.add(String(value));
      }
    }
    renderOptions();
    updateSummary();
    if (emit && onChange) {
      onChange(getSelected());
    }
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      renderOptions();
    });
  }

  applySelectedValues(selectedValues);
  updateSummary();

  return {
    getSelected,
    setSelected(nextValues, emit = false) {
      applySelectedValues(nextValues, emit);
    }
  };
}

function parseTabRouteHash(rawHash) {
  if (typeof rawHash !== "string" || rawHash === "") {
    return { tab: null, status: "missing", shouldNormalize: false };
  }
  const normalized = rawHash.startsWith("#") ? rawHash.slice(1).trim() : rawHash.trim();
  if (!normalized) {
    return { tab: null, status: "missing", shouldNormalize: false };
  }
  const resolved = resolveTabRoute(normalized);
  if (TAB_ROUTE_SET.has(resolved)) {
    return { tab: resolved, status: "valid", shouldNormalize: resolved !== normalized };
  }
  return { tab: null, status: "invalid", shouldNormalize: false };
}

function formatTabRouteHash(tab) {
  const resolved = resolveTabRoute(tab);
  return `#${resolved}`;
}

function resolveTabRoute(tab) {
  const rawTab = typeof tab === "string" ? tab.trim() : "";
  if (!rawTab) {
    return DEFAULT_TAB_ROUTE;
  }
  return TAB_ROUTE_SET.has(rawTab) ? rawTab : DEFAULT_TAB_ROUTE;
}

function updateLocationHashForTab(tab, { replace = false } = {}) {
  const targetHash = formatTabRouteHash(tab);
  if (!runtimeWindow?.location || runtimeWindow.location.hash === targetHash) {
    return;
  }

  const nextUrl = `${runtimeWindow.location.pathname}${runtimeWindow.location.search}${targetHash}`;
  if (replace && runtimeWindow.history?.replaceState) {
    runtimeWindow.history.replaceState(null, "", nextUrl);
    return;
  }

  if (runtimeWindow.history?.pushState) {
    runtimeWindow.history.pushState(null, "", nextUrl);
    return;
  }

  runtimeWindow.location.hash = targetHash;
}

function setTab(tabName, { syncRoute = false, replaceRoute = false } = {}) {
  const requestedTab = typeof tabName === "string" ? tabName : "";
  const normalizedRequestedTab = resolveTabRoute(requestedTab);
  const resolvedTab = hasAuthSession() ? normalizedRequestedTab : DEFAULT_TAB_ROUTE;
  const shouldNormalizeRoute = requestedTab !== resolvedTab || resolveTabRoute(requestedTab) !== requestedTab;
  const shouldSyncRoute = syncRoute || shouldNormalizeRoute;
  const tabChanged = state.activeTab !== resolvedTab;

  state.activeTab = resolvedTab;

  if (shouldSyncRoute) {
    updateLocationHashForTab(resolvedTab, {
      replace: replaceRoute || shouldNormalizeRoute
    });
  }

  for (const button of elements.sideMenuLinks) {
    const isActive = button.dataset.tab === resolvedTab;
    button.classList.toggle("is-active", isActive);
  }

  elements.tabExplorer.classList.toggle("is-active", resolvedTab === "explorer");
  elements.tabWorkflow.classList.toggle("is-active", resolvedTab === "workflow");
  elements.tabTags.classList.toggle("is-active", resolvedTab === "tags");
  elements.tabUsers.classList.toggle("is-active", resolvedTab === "users");
  elements.tabRequirements.classList.toggle("is-active", resolvedTab === "requirements");
  elements.tabCompositions.classList.toggle("is-active", resolvedTab === "compositions");
  elements.tabTeamConfig.classList.toggle("is-active", resolvedTab === "team-config");
  elements.tabProfile.classList.toggle("is-active", resolvedTab === "profile");
  elements.tabComingSoon.classList.toggle("is-active", resolvedTab === "coming-soon");
  applyHeroCopy(resolvedTab);

  if (resolvedTab === "team-config" && state.data) {
    renderTeamConfig();
    renderTeamAdmin();
  }
  if (resolvedTab === "profile" && state.data) {
    renderPlayerConfig();
  }
  if (resolvedTab === "explorer" && state.data) {
    applyExplorerSubTab();
    if (state.explorer.subTab === "edit-champions") renderExplorer();
    if (state.explorer.subTab === "my-champions") renderMyChampions();
  }
  if (resolvedTab === "tags") {
    renderTagsWorkspace();
  }
  if (resolvedTab === "users") {
    if (isAdminUser() && state.api.users.length === 0 && !state.api.isLoadingUsers) {
      void loadUsersFromApi();
    }
    if (isAdminUser() && !state.api.authorizationMatrix && !state.api.isLoadingAuthorizationMatrix) {
      void loadAuthorizationMatrixFromApi();
    }
    renderUsersWorkspace();
  }
  if (resolvedTab === "requirements") {
    if (isAuthenticated() && state.api.requirementDefinitions.length === 0 && !state.api.isLoadingRequirementDefinitions) {
      void loadRequirementDefinitionsFromApi();
    }
    renderRequirementDefinitionsWorkspace();
  }
  if (resolvedTab === "compositions") {
    if (isAuthenticated() && state.api.requirementDefinitions.length === 0 && !state.api.isLoadingRequirementDefinitions) {
      void loadRequirementDefinitionsFromApi();
    }
    if (isAuthenticated() && state.api.compositionBundles.length === 0 && !state.api.isLoadingCompositionBundles) {
      void loadCompositionBundlesFromApi();
    }
    renderCompositionBundlesWorkspace();
  }
  if (resolvedTab === "coming-soon") {
    renderUpdatesReleaseTabs();
  }

  if ((tabChanged || syncRoute) && isCompactNavViewport()) {
    setNavOpen(false);
  }
}

function normalizeApiBaseUrl(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return "";
  }
  return trimmed.replace(/\/+$/, "");
}

function resolveApiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${runtimeApiBaseUrl}${normalizedPath}`;
}

async function readApiError(response) {
  try {
    const payload = await response.json();
    const message =
      payload?.error?.message && typeof payload.error.message === "string"
        ? payload.error.message
        : `Request failed (${response.status}).`;
    const code = payload?.error?.code && typeof payload.error.code === "string" ? payload.error.code : "API_ERROR";
    return { code, message, payload };
  } catch {
    return {
      code: "API_ERROR",
      message: `Request failed (${response.status}).`,
      payload: null
    };
  }
}

async function apiRequest(path, { method = "GET", body = undefined, auth = false, isFormData = false } = {}) {
  if (!runtimeApiBaseUrl) {
    throw new Error("API base URL is not configured.");
  }

  const headers = {
    Accept: "application/json"
  };
  if (body !== undefined && !isFormData) {
    headers["Content-Type"] = "application/json";
  }
  if (auth && state.auth.token) {
    headers.Authorization = `Bearer ${state.auth.token}`;
  }

  const response = await runtimeFetch(resolveApiUrl(path), {
    method,
    headers,
    body: body === undefined ? undefined : (isFormData ? body : JSON.stringify(body))
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    const error = await readApiError(response);
    if (response.status === 401 && auth) {
      clearAuthSession("Session expired. Please log in again.");
      renderAuth();
    }
    const requestError = new Error(error.message);
    requestError.status = response.status;
    requestError.code = error.code;
    requestError.payload = error.payload;
    throw requestError;
  }

  return response.json();
}

function normalizeApiSlot(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (isSlot(trimmed)) {
    return trimmed;
  }
  const alias = ROLE_ALIASES[trimmed.toUpperCase()];
  return alias && isSlot(alias) ? alias : null;
}

function normalizeApiDamageType(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (isDamageType(trimmed)) {
    return trimmed;
  }
  if (trimmed.toUpperCase() === "UTILITY") {
    return "Utility";
  }
  if (trimmed.toUpperCase() === "MIXED") {
    return "Mixed";
  }
  return null;
}

function normalizeApiScaling(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (isScaling(trimmed)) {
    return trimmed;
  }
  const alias = SCALING_ALIASES[trimmed.toUpperCase()];
  return alias && isScaling(alias) ? alias : null;
}

function normalizeApiEntityId(value) {
  if (Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normalizeApiTags(rawTags) {
  const source = rawTags && typeof rawTags === "object" && !Array.isArray(rawTags) ? rawTags : {};
  const tags = {};
  for (const tag of BOOLEAN_TAGS) {
    const raw = source[tag];
    tags[tag] = raw === true || raw === 1 || raw === "1";
  }
  return tags;
}

const BOOLEAN_TAG_BY_NORMALIZED_NAME = new Map(
  BOOLEAN_TAGS.map((tagName) => [normalizeTagNameForMatching(tagName), tagName])
);

function deriveApiTagsFromTagIds(tagIds) {
  const derived = normalizeApiTags({});
  const normalizedTagIds = normalizeChampionTagIdArray(tagIds);
  if (normalizedTagIds.length === 0) {
    return derived;
  }

  for (const tagId of normalizedTagIds) {
    const catalogTag = state.api.tagById?.[String(tagId)];
    if (!catalogTag || typeof catalogTag.name !== "string") {
      continue;
    }
    const mappedBooleanTag = BOOLEAN_TAG_BY_NORMALIZED_NAME.get(normalizeTagNameForMatching(catalogTag.name));
    if (mappedBooleanTag) {
      derived[mappedBooleanTag] = true;
    }
  }
  return derived;
}

function synchronizeChampionTagsFromCatalog() {
  if (!state.data || !Array.isArray(state.data.champions)) {
    return;
  }
  if (!Array.isArray(state.api.tags) || state.api.tags.length === 0) {
    return;
  }

  for (const champion of state.data.champions) {
    if (!champion || typeof champion !== "object") {
      continue;
    }
    champion.tags = deriveApiTagsFromTagIds(champion.tagIds);
  }
}

function normalizeChampionTagIdArray(rawValue) {
  if (!Array.isArray(rawValue)) {
    return [];
  }
  const normalized = rawValue
    .map((value) => normalizeApiEntityId(value))
    .filter((value) => value !== null);
  return Array.from(new Set(normalized)).sort((left, right) => left - right);
}

function buildChampionFromApiRecord(rawChampion, index) {
  if (!rawChampion || typeof rawChampion !== "object" || Array.isArray(rawChampion)) {
    throw new DataValidationError(`Invalid champion payload at index ${index}.`);
  }

  const name = typeof rawChampion.name === "string" ? rawChampion.name.trim() : "";
  if (name === "") {
    throw new DataValidationError(`Champion payload at index ${index} is missing name.`);
  }

  const metadata =
    rawChampion.metadata && typeof rawChampion.metadata === "object" && !Array.isArray(rawChampion.metadata)
      ? rawChampion.metadata
      : {};

  const rolesFromMetadata = Array.isArray(metadata.roles)
    ? metadata.roles.map((role) => normalizeApiSlot(role)).filter(Boolean)
    : [];
  const normalizedRoles = rolesFromMetadata.length > 0
    ? Array.from(new Set(rolesFromMetadata))
    : (() => {
      const fallback = normalizeApiSlot(rawChampion.role);
      return fallback ? [fallback] : [];
    })();

  if (normalizedRoles.length === 0) {
    throw new DataValidationError(`Champion '${name}' is missing valid role metadata.`);
  }

  const roleProfiles = normalizeRoleProfilesFromMetadata(metadata.roleProfiles, normalizedRoles);
  if (Object.keys(roleProfiles).length === 0) {
    const fallbackDamageType = normalizeApiDamageType(metadata.damageType) ?? "Mixed";
    const fallbackScaling = normalizeApiScaling(metadata.scaling) ?? "Mid";
    const fallbackPrimaryDamageType = fallbackDamageType === "AD"
      ? "ad"
      : fallbackDamageType === "AP"
        ? "ap"
        : fallbackDamageType === "Utility"
          ? "utility"
          : "mixed";
    const fallbackEffectiveness = {
      early: fallbackScaling === "Early" ? "strong" : "neutral",
      mid: fallbackScaling === "Mid" ? "strong" : "neutral",
      late: fallbackScaling === "Late" ? "strong" : "neutral"
    };
    for (const role of normalizedRoles) {
      roleProfiles[role] = {
        primaryDamageType: fallbackPrimaryDamageType,
        effectiveness: {
          ...fallbackEffectiveness
        }
      };
    }
  }
  const previewProfile = getChampionRoleProfile({ roles: normalizedRoles, roleProfiles }, normalizedRoles[0]);
  const damageType = deriveDisplayDamageTypeFromProfile(previewProfile);
  const scaling = deriveLegacyScalingFromProfile(previewProfile);

  const tagIds = normalizeChampionTagIdArray(rawChampion.tagIds ?? rawChampion.tag_ids);
  const reviewed = rawChampion.reviewed === true || metadata.reviewed === true;

  return {
    id: normalizeApiEntityId(rawChampion.id),
    name,
    roles: normalizedRoles,
    damageType,
    scaling,
    roleProfiles,
    tags: deriveApiTagsFromTagIds(tagIds),
    tagIds,
    reviewed
  };
}

async function fetchJson(path) {
  const response = await runtimeFetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (${response.status})`);
  }
  return response.json();
}

async function loadChampionsData() {
  const payload = await fetchJson(resolveApiUrl("/champions"));
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.champions)) {
    throw new DataValidationError("Champions API response is missing the champions array.");
  }

  const champions = [];
  const championsByName = {};
  const championIdsByName = {};
  const championNamesById = {};
  const seenNames = new Set();

  for (let index = 0; index < payload.champions.length; index += 1) {
    const champion = buildChampionFromApiRecord(payload.champions[index], index);
    if (seenNames.has(champion.name)) {
      throw new DataValidationError(`Duplicate champion '${champion.name}' from API.`);
    }
    champions.push(champion);
    championsByName[champion.name] = champion;
    if (Number.isInteger(champion.id) && champion.id > 0) {
      championIdsByName[champion.name] = champion.id;
      championNamesById[champion.id] = champion.name;
    }
    seenNames.add(champion.name);
  }

  return {
    champions,
    championsByName,
    championIdsByName,
    championNamesById
  };
}

async function loadMvpData() {
  const championData = await loadChampionsData();

  const loaded = {
    champions: championData.champions,
    championsByName: championData.championsByName,
    championIdsByName: championData.championIdsByName ?? {},
    championNamesById: championData.championNamesById ?? {},
    teamPools: {},
    teamPoolEntries: [],
    teamLabels: {},
    config: {
      ...DEFAULT_APP_CONFIG,
      recommendation: {
        weights: {
          ...DEFAULT_APP_CONFIG.recommendation.weights
        }
      },
      treeDefaults: {
        ...DEFAULT_APP_CONFIG.treeDefaults
      }
    }
  };

  const basePlayerPoolsByTeam = buildPlayerPoolsByTeam(loaded.teamPoolEntries);
  const playerPoolsByTeam = clonePlayerPoolsByTeam(basePlayerPoolsByTeam);

  state.data = {
    ...loaded,
    noneTeamPools: buildNoneTeamPools(loaded.champions),
    defaultPlayerPoolsByTeam: basePlayerPoolsByTeam,
    playerPoolsByTeam,
    teamPools: buildTeamPoolsFromPlayerPools(playerPoolsByTeam),
    teamPlayersByRole: buildTeamPlayersByRoleFromPlayerPools(playerPoolsByTeam)
  };
}

function getChampionById(championId) {
  if (!state.data || !Array.isArray(state.data.champions)) {
    return null;
  }
  return state.data.champions.find((champion) => champion.id === championId) ?? null;
}

function normalizeTagCatalogEntry(rawTag) {
  if (!rawTag || typeof rawTag !== "object" || Array.isArray(rawTag)) {
    return null;
  }
  const id = normalizeApiEntityId(rawTag.id);
  if (!id) {
    return null;
  }
  const name = typeof rawTag.name === "string" ? rawTag.name.trim() : "";
  const definition = typeof rawTag.definition === "string" ? rawTag.definition.trim() : "";
  if (!name) {
    return null;
  }
  return { id, name, definition };
}

async function loadTagCatalogFromApi() {
  try {
    const payload = await fetchJson(resolveApiUrl("/tags"));
    const source = Array.isArray(payload?.tags) ? payload.tags : [];
    const tags = source.map(normalizeTagCatalogEntry).filter(Boolean);
    state.api.tags = tags;
    state.api.tagById = Object.fromEntries(tags.map((tag) => [String(tag.id), tag]));
    synchronizeChampionTagsFromCatalog();
    return true;
  } catch (_error) {
    state.api.tags = [];
    state.api.tagById = {};
    return false;
  }
}

function renderChampionTagCatalog() {
  if (!elements.championTagCatalogList || !elements.championTagCatalogMeta) {
    return;
  }

  const tags = Array.isArray(state.api.tags) ? state.api.tags : [];
  elements.championTagCatalogList.innerHTML = "";

  if (tags.length === 0) {
    elements.championTagCatalogMeta.textContent = "No API tag catalog entries returned.";
    const empty = runtimeDocument.createElement("span");
    empty.className = "meta";
    empty.textContent = "No tags available.";
    elements.championTagCatalogList.append(empty);
    return;
  }

  const query = elements.explorerCatalogSearch?.value.trim().toLowerCase() ?? "";
  const visible = query
    ? tags.filter(
        (tag) =>
          tag.name.toLowerCase().includes(query) ||
          String(tag.definition ?? "").toLowerCase().includes(query)
      )
    : tags;

  elements.championTagCatalogMeta.textContent = query
    ? `${visible.length} of ${tags.length} tags match.`
    : `${tags.length} tags available in the catalog.`;

  for (const tag of visible) {
    const chip = runtimeDocument.createElement("span");
    chip.className = "chip";
    chip.textContent = tag.name;
    if (tag.definition) {
      chip.title = tag.definition;
    }
    elements.championTagCatalogList.append(chip);
  }
}

function normalizeManagedTagName(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }
  return value.trim();
}

function normalizeManagedTagDefinition(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }
  return value.trim();
}

function getManagedTagById(tagId) {
  if (!Number.isInteger(tagId) || tagId <= 0) {
    return null;
  }
  return state.api.tags.find((tag) => tag.id === tagId) ?? null;
}

function readManagedTagDraftFromInputs() {
  const name = normalizeManagedTagName(elements.tagsManageName?.value ?? "");
  const definition = normalizeManagedTagDefinition(elements.tagsManageDefinition?.value ?? "");
  if (!name) {
    throw new Error("Tag name is required.");
  }
  if (!definition) {
    throw new Error("Tag definition is required.");
  }
  return { name, definition };
}

function beginManagedTagEdit(tagId) {
  const tag = getManagedTagById(tagId);
  if (!tag) {
    setTagsManageFeedback("Selected tag no longer exists.");
    return;
  }
  state.api.selectedTagManagerId = tag.id;
  if (elements.tagsManageName) {
    elements.tagsManageName.value = tag.name;
  }
  if (elements.tagsManageDefinition) {
    elements.tagsManageDefinition.value = String(tag.definition ?? "");
  }
  setTagsManageFeedback(`Editing '${tag.name}'.`);
  renderTagsWorkspace();
}

function renderTagsManagerControls() {
  const canManageTags = isAuthenticated() && isGlobalTagEditorUser();
  if (
    Number.isInteger(state.api.selectedTagManagerId) &&
    state.api.selectedTagManagerId > 0 &&
    !getManagedTagById(state.api.selectedTagManagerId)
  ) {
    state.api.selectedTagManagerId = null;
  }
  const isEditing = Number.isInteger(state.api.selectedTagManagerId) && state.api.selectedTagManagerId > 0;
  const controlsDisabled = !canManageTags || state.api.isSavingTagCatalog;

  if (elements.tagsManageAccess) {
    if (!isAuthenticated()) {
      elements.tagsManageAccess.textContent = "Sign in to manage tags.";
    } else if (!canManageTags) {
      elements.tagsManageAccess.textContent = "Your role is read-only for global tags.";
    } else if (!isAdminUser()) {
      elements.tagsManageAccess.textContent = "Global editor mode enabled: manage global tags and tag catalog entries.";
    } else {
      elements.tagsManageAccess.textContent = "Admin mode enabled: create, update, and delete tags.";
    }
  }

  if (elements.tagsManageName) {
    elements.tagsManageName.disabled = controlsDisabled;
  }
  if (elements.tagsManageDefinition) {
    elements.tagsManageDefinition.disabled = controlsDisabled;
  }
  if (elements.tagsManageSave) {
    elements.tagsManageSave.disabled = controlsDisabled;
    elements.tagsManageSave.textContent = isEditing ? "Update Tag" : "Create Tag";
  }
  if (elements.tagsManageCancel) {
    elements.tagsManageCancel.disabled = controlsDisabled;
    elements.tagsManageCancel.textContent = isEditing ? "Cancel Edit" : "Clear";
  }
}

async function refreshTagCatalogViews() {
  await loadTagCatalogFromApi();
  renderChampionTagCatalog();
  renderTagsWorkspace();
  renderChampionTagEditor();
  if (state.activeTab === "explorer") {
    renderExplorer();
  }
}

async function saveManagedTag() {
  if (!isAuthenticated() || state.api.isSavingTagCatalog) {
    return;
  }

  let draft = null;
  try {
    draft = readManagedTagDraftFromInputs();
  } catch (error) {
    setTagsManageFeedback(error.message || "Tag draft is invalid.");
    return;
  }

  const tagId = state.api.selectedTagManagerId;
  const isEditing = Number.isInteger(tagId) && tagId > 0;
  state.api.isSavingTagCatalog = true;
  setTagsManageFeedback(isEditing ? "Saving tag updates..." : "Creating tag...");
  renderTagsWorkspace();

  try {
    const payload = await apiRequest(isEditing ? `/tags/${tagId}` : "/tags", {
      method: isEditing ? "PUT" : "POST",
      auth: true,
      body: draft
    });

    await refreshTagCatalogViews();
    if (isEditing) {
      const savedTagId = normalizeApiEntityId(payload?.tag?.id) ?? tagId;
      state.api.selectedTagManagerId = savedTagId;
      const savedTag = getManagedTagById(savedTagId);
      if (savedTag) {
        if (elements.tagsManageName) {
          elements.tagsManageName.value = savedTag.name;
        }
        if (elements.tagsManageDefinition) {
          elements.tagsManageDefinition.value = String(savedTag.definition ?? "");
        }
      }
      setTagsManageFeedback("Tag updated.");
    } else {
      clearTagsManagerState();
      setTagsManageFeedback("Tag created.");
    }
  } catch (error) {
    setTagsManageFeedback(normalizeApiErrorMessage(error, "Failed to save tag."));
  } finally {
    state.api.isSavingTagCatalog = false;
    renderTagsWorkspace();
  }
}

async function deleteManagedTag(tagId) {
  if (!isAuthenticated() || state.api.isSavingTagCatalog) {
    return;
  }
  if (!Number.isInteger(tagId) || tagId <= 0) {
    return;
  }

  state.api.isSavingTagCatalog = true;
  setTagsManageFeedback("Deleting tag...");
  renderTagsWorkspace();

  try {
    await apiRequest(`/tags/${tagId}`, {
      method: "DELETE",
      auth: true
    });
    if (state.api.selectedTagManagerId === tagId) {
      clearTagsManagerState();
    }
    await refreshTagCatalogViews();
    setTagsManageFeedback("Tag deleted.");
  } catch (error) {
    setTagsManageFeedback(normalizeApiErrorMessage(error, "Failed to delete tag."));
  } finally {
    state.api.isSavingTagCatalog = false;
    renderTagsWorkspace();
  }
}

function buildChampionUsageByTagId() {
  const usageByTagId = new Map();
  if (!state.data || !Array.isArray(state.data.champions)) {
    return usageByTagId;
  }

  for (const champion of state.data.champions) {
    if (!champion || typeof champion.name !== "string") {
      continue;
    }
    for (const tagId of normalizeChampionTagIdArray(champion.tagIds)) {
      if (!usageByTagId.has(tagId)) {
        usageByTagId.set(tagId, []);
      }
      usageByTagId.get(tagId).push(champion.name);
    }
  }

  for (const championNames of usageByTagId.values()) {
    championNames.sort((left, right) => left.localeCompare(right));
  }

  return usageByTagId;
}

function renderTagsWorkspace() {
  if (!elements.tagsWorkspaceSummary || !elements.tagsWorkspaceCategories) {
    return;
  }

  renderTagsManagerControls();
  const tags = Array.isArray(state.api.tags) ? state.api.tags : [];
  const usageByTagId = buildChampionUsageByTagId();
  elements.tagsWorkspaceCategories.innerHTML = "";

  if (tags.length === 0) {
    elements.tagsWorkspaceSummary.textContent = "No tags were returned by the API.";
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "No tags to display.";
    elements.tagsWorkspaceCategories.append(empty);
    return;
  }

  const sortedTags = [...tags].sort((left, right) => left.name.localeCompare(right.name));
  elements.tagsWorkspaceSummary.textContent = `${tags.length} tags in the shared catalog.`;

  const list = runtimeDocument.createElement("ul");
  list.className = "tags-workspace-list";
  for (const tag of sortedTags) {
    const item = runtimeDocument.createElement("li");
    item.className = "tags-workspace-item";

    const usageCount = (usageByTagId.get(tag.id) ?? []).length;
    const content = runtimeDocument.createElement("div");
    content.className = "tags-workspace-content";

    const name = runtimeDocument.createElement("p");
    name.className = "tags-workspace-name";
    name.textContent = tag.name;

    const definition = runtimeDocument.createElement("p");
    definition.className = "meta tags-workspace-definition";
    definition.textContent = String(tag.definition ?? "").trim() || "No definition set.";

    const usage = runtimeDocument.createElement("p");
    usage.className = "meta tags-workspace-usage";
    usage.textContent = usageCount === 1 ? "Used by 1 champion" : `Used by ${usageCount} champions`;

    content.append(name, definition, usage);
    item.append(content);

    if (isAuthenticated() && isGlobalTagEditorUser()) {
      const actions = runtimeDocument.createElement("div");
      actions.className = "tags-workspace-actions";

      const editButton = runtimeDocument.createElement("button");
      editButton.className = "ghost";
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.disabled = state.api.isSavingTagCatalog;
      editButton.addEventListener("click", () => {
        beginManagedTagEdit(tag.id);
      });

      const deleteButton = runtimeDocument.createElement("button");
      deleteButton.className = "ghost";
      deleteButton.type = "button";
      deleteButton.textContent = "Delete";
      deleteButton.disabled = state.api.isSavingTagCatalog;
      deleteButton.addEventListener("click", () => {
        void deleteManagedTag(tag.id);
      });

      actions.append(editButton, deleteButton);
      item.append(actions);
    }
    list.append(item);
  }
  elements.tagsWorkspaceCategories.append(list);
}

function normalizeApiUserRole(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "admin" || normalized === "global") {
    return normalized;
  }
  return "member";
}

function normalizeApiAdminUser(rawUser) {
  if (!rawUser || typeof rawUser !== "object" || Array.isArray(rawUser)) {
    return null;
  }
  const id = normalizeApiEntityId(rawUser.id);
  if (!id) {
    return null;
  }
  const email = typeof rawUser.email === "string" ? rawUser.email.trim() : "";
  if (!email) {
    return null;
  }
  const gameName = typeof rawUser.game_name === "string" ? rawUser.game_name.trim() : "";
  const tagline = typeof rawUser.tagline === "string" ? rawUser.tagline.trim() : "";
  const riotId = typeof rawUser.riot_id === "string" ? rawUser.riot_id.trim() : "";
  const correctionCountRaw = Number.parseInt(String(rawUser.riot_id_correction_count ?? 0), 10);
  const correctionCount = Number.isInteger(correctionCountRaw) && correctionCountRaw >= 0 ? correctionCountRaw : 0;
  const canUpdateRiotId = rawUser.can_update_riot_id === false
    ? false
    : (rawUser.can_update_riot_id === true || correctionCount < 1);
  const normalizedRole = normalizeApiUserRole(rawUser.role);
  const storedRole = rawUser.stored_role === undefined
    ? normalizedRole
    : normalizeApiUserRole(rawUser.stored_role);
  const emailKey = email.toLowerCase();
  const isOwnerAdmin = rawUser.is_owner_admin === true
    ? true
    : (rawUser.is_owner_admin === false ? false : OWNER_ADMIN_EMAIL_SET.has(emailKey));
  return {
    id,
    email,
    role: normalizedRole,
    stored_role: storedRole,
    is_owner_admin: isOwnerAdmin,
    game_name: gameName,
    tagline,
    riot_id: riotId,
    riot_id_correction_count: correctionCount,
    can_update_riot_id: canUpdateRiotId
  };
}

function normalizeAuthorizationRoleDefinition(rawRole) {
  if (!rawRole || typeof rawRole !== "object" || Array.isArray(rawRole)) {
    return null;
  }
  const id = typeof rawRole.id === "string" ? rawRole.id.trim() : "";
  const label = typeof rawRole.label === "string" ? rawRole.label.trim() : id;
  const description = typeof rawRole.description === "string" ? rawRole.description.trim() : "";
  if (!id) {
    return null;
  }
  return {
    id,
    label: label || id,
    description
  };
}

function normalizeAuthorizationPermissionDefinition(rawPermission) {
  if (!rawPermission || typeof rawPermission !== "object" || Array.isArray(rawPermission)) {
    return null;
  }
  const id = typeof rawPermission.id === "string" ? rawPermission.id.trim() : "";
  const description = typeof rawPermission.description === "string" ? rawPermission.description.trim() : "";
  if (!id) {
    return null;
  }
  return {
    id,
    description
  };
}

function normalizePermissionAssignmentsByRole(rawAssignments) {
  if (!rawAssignments || typeof rawAssignments !== "object" || Array.isArray(rawAssignments)) {
    return {};
  }
  const entries = Object.entries(rawAssignments).map(([roleId, permissionIds]) => {
    const normalizedRoleId = typeof roleId === "string" ? roleId.trim() : "";
    if (!normalizedRoleId) {
      return null;
    }
    const normalizedPermissions = Array.isArray(permissionIds)
      ? permissionIds
        .map((permissionId) => (typeof permissionId === "string" ? permissionId.trim() : ""))
        .filter(Boolean)
      : [];
    return [normalizedRoleId, normalizedPermissions];
  }).filter(Boolean);
  return Object.fromEntries(entries);
}

function normalizeAuthorizationMatrix(rawAuthorization) {
  if (!rawAuthorization || typeof rawAuthorization !== "object" || Array.isArray(rawAuthorization)) {
    return null;
  }

  const globalRoles = Array.isArray(rawAuthorization.global_roles)
    ? rawAuthorization.global_roles.map(normalizeAuthorizationRoleDefinition).filter(Boolean)
    : [];
  const teamMembershipRoles = Array.isArray(rawAuthorization.team_membership_roles)
    ? rawAuthorization.team_membership_roles.map(normalizeAuthorizationRoleDefinition).filter(Boolean)
    : [];
  const teamRosterRoles = Array.isArray(rawAuthorization.team_roster_roles)
    ? rawAuthorization.team_roster_roles.map(normalizeAuthorizationRoleDefinition).filter(Boolean)
    : [];
  const permissions = Array.isArray(rawAuthorization.permissions)
    ? rawAuthorization.permissions.map(normalizeAuthorizationPermissionDefinition).filter(Boolean)
    : [];
  const assignments = rawAuthorization.assignments && typeof rawAuthorization.assignments === "object"
    ? rawAuthorization.assignments
    : {};

  return {
    global_roles: globalRoles,
    team_membership_roles: teamMembershipRoles,
    team_roster_roles: teamRosterRoles,
    permissions,
    assignments: {
      global_roles: normalizePermissionAssignmentsByRole(assignments.global_roles),
      team_membership_roles: normalizePermissionAssignmentsByRole(assignments.team_membership_roles)
    }
  };
}

function resetAdminUserDetailCache() {
  if (!state) {
    return;
  }
  state.api.userDetailsById = {};
  state.api.userDetailErrors = {};
  if (state.api.userDetailLoadingIds instanceof Set) {
    state.api.userDetailLoadingIds.clear();
  } else {
    state.api.userDetailLoadingIds = new Set();
  }
}

function normalizeTeamDetail(rawTeam) {
  if (!rawTeam || typeof rawTeam !== "object" || Array.isArray(rawTeam)) {
    return null;
  }
  const teamId = normalizeApiEntityId(rawTeam.team_id);
  if (!teamId) {
    return null;
  }
  const name = typeof rawTeam.name === "string" ? rawTeam.name : "";
  const tag = typeof rawTeam.tag === "string" ? rawTeam.tag : null;
  return {
    team_id: teamId,
    name,
    tag,
    membership_role: typeof rawTeam.membership_role === "string" ? rawTeam.membership_role : null,
    membership_team_role:
      typeof rawTeam.membership_team_role === "string" ? rawTeam.membership_team_role : null,
    membership_lane: typeof rawTeam.membership_lane === "string" ? rawTeam.membership_lane : null
  };
}

function normalizePoolDetail(rawPool) {
  if (!rawPool || typeof rawPool !== "object" || Array.isArray(rawPool)) {
    return null;
  }
  const poolId = normalizeApiEntityId(rawPool.pool_id);
  if (!poolId) {
    return null;
  }
  return {
    pool_id: poolId,
    name: typeof rawPool.name === "string" ? rawPool.name : "",
    champion_count: Number.isInteger(rawPool.champion_count) ? rawPool.champion_count : 0
  };
}

function normalizeApiUserDetail(rawDetail) {
  if (!rawDetail || typeof rawDetail !== "object" || Array.isArray(rawDetail)) {
    return null;
  }
  const userId = normalizeApiEntityId(rawDetail.user_id);
  if (!userId) {
    return null;
  }
  const primaryRole = typeof rawDetail.primary_role === "string" ? rawDetail.primary_role : null;
  const secondaryRoles = Array.isArray(rawDetail.secondary_roles)
    ? rawDetail.secondary_roles.filter((value) => typeof value === "string")
    : [];
  const activeTeam = normalizeTeamDetail(rawDetail.active_team);
  const championPools = Array.isArray(rawDetail.champion_pools)
    ? rawDetail.champion_pools.map(normalizePoolDetail).filter(Boolean)
    : [];
  const teamMemberships = Array.isArray(rawDetail.team_memberships)
    ? rawDetail.team_memberships.map(normalizeTeamDetail).filter(Boolean)
    : [];
  const promotions =
    rawDetail.champion_tag_promotions && typeof rawDetail.champion_tag_promotions === "object"
      ? {
          pending: Number.isInteger(rawDetail.champion_tag_promotions.pending)
            ? rawDetail.champion_tag_promotions.pending
            : 0,
          approved: Number.isInteger(rawDetail.champion_tag_promotions.approved)
            ? rawDetail.champion_tag_promotions.approved
            : 0,
          rejected: Number.isInteger(rawDetail.champion_tag_promotions.rejected)
            ? rawDetail.champion_tag_promotions.rejected
            : 0
        }
      : { pending: 0, approved: 0, rejected: 0 };
  return {
    user_id: userId,
    primary_role: primaryRole,
    secondary_roles: secondaryRoles,
    active_team: activeTeam,
    champion_pools: championPools,
    team_memberships: teamMemberships,
    champion_tag_promotions: promotions
  };
}

function createMetaParagraph(text) {
  const paragraph = runtimeDocument.createElement("p");
  paragraph.className = "meta";
  paragraph.textContent = text;
  return paragraph;
}

function renderUserDetailContent(userId, container) {
  container.innerHTML = "";
  const detail = state.api.userDetailsById[userId];
  const isLoading = state.api.userDetailLoadingIds.has(userId);
  const error = state.api.userDetailErrors[userId];

  if (isLoading && !detail) {
    container.append(createMetaParagraph("Loading details..."));
    return;
  }
  if (error) {
    container.append(createMetaParagraph(error));
    return;
  }
  if (!detail) {
    container.append(createMetaParagraph("Expand to load additional user details."));
    return;
  }

  const infoGrid = runtimeDocument.createElement("div");
  infoGrid.className = "user-detail-grid";
  infoGrid.append(
    createMetaParagraph(`Primary role: ${detail.primary_role ?? "Not set"}`),
    createMetaParagraph(
      detail.secondary_roles.length > 0
        ? `Secondary roles: ${detail.secondary_roles.join(", ")}`
        : "Secondary roles: none"
    ),
    createMetaParagraph(
      detail.active_team
        ? `Active team: ${detail.active_team.name || `Team ${detail.active_team.team_id}`} (${detail.active_team.tag ?? "TBD"})`
        : "Active team: None"
    )
  );
  container.append(infoGrid);

  const poolHeading = runtimeDocument.createElement("p");
  poolHeading.className = "meta";
  poolHeading.textContent = "Champion pools";
  container.append(poolHeading);
  if (detail.champion_pools.length === 0) {
    container.append(createMetaParagraph("No champion pools yet."));
  } else {
    const list = runtimeDocument.createElement("ul");
    list.className = "user-detail-list";
    for (const pool of detail.champion_pools) {
      const item = runtimeDocument.createElement("li");
      const name = pool.name || "Unnamed pool";
      const count = Number.isInteger(pool.champion_count) ? pool.champion_count : 0;
      item.textContent = `${name} — ${count} champion${count === 1 ? "" : "s"}`;
      list.append(item);
    }
    container.append(list);
  }

  const teamsHeading = runtimeDocument.createElement("p");
  teamsHeading.className = "meta";
  teamsHeading.textContent = "Team memberships";
  container.append(teamsHeading);
  if (detail.team_memberships.length === 0) {
    container.append(createMetaParagraph("Not associated with any teams."));
  } else {
    const list = runtimeDocument.createElement("ul");
    list.className = "user-detail-list";
    for (const membership of detail.team_memberships) {
      const item = runtimeDocument.createElement("li");
      const name = membership.name || `Team ${membership.team_id}`;
      const tagLabel = membership.tag ? ` (${membership.tag})` : "";
      const role = membership.membership_role ? membership.membership_role : "member";
      const teamRole = membership.membership_team_role ? membership.membership_team_role : "primary";
      const lane = membership.membership_lane ? ` | Lane: ${membership.membership_lane}` : "";
      item.textContent = `${name}${tagLabel} — ${role}/${teamRole}${lane}`;
      list.append(item);
    }
    container.append(list);
  }

  const promotions = detail.champion_tag_promotions;
  container.append(
    createMetaParagraph(
      `Champion tag promotions — pending: ${promotions.pending}, approved: ${promotions.approved}, rejected: ${promotions.rejected}`
    )
  );
}

async function loadUsersFromApi() {
  resetAdminUserDetailCache();

  if (!isAuthenticated() || !isAdminUser()) {
    state.api.users = [];
    state.api.deletingUserId = null;
    return false;
  }

  state.api.isLoadingUsers = true;
  renderUsersWorkspace();
  try {
    const payload = await apiRequest("/admin/users", { auth: true });
    const users = Array.isArray(payload?.users)
      ? payload.users.map(normalizeApiAdminUser).filter(Boolean)
      : [];
    state.api.users = users;
    setUsersFeedback("");
    return true;
  } catch (error) {
    state.api.users = [];
    setUsersFeedback(normalizeApiErrorMessage(error, "Failed to load users."));
    return false;
  } finally {
    state.api.isLoadingUsers = false;
    renderUsersWorkspace();
  }
}

async function loadAuthorizationMatrixFromApi() {
  if (!isAuthenticated() || !isAdminUser()) {
    state.api.authorizationMatrix = null;
    state.api.isLoadingAuthorizationMatrix = false;
    return false;
  }

  state.api.isLoadingAuthorizationMatrix = true;
  renderUsersWorkspace();
  try {
    const payload = await apiRequest("/admin/authorization", { auth: true });
    const matrix = normalizeAuthorizationMatrix(payload?.authorization);
    if (!matrix) {
      state.api.authorizationMatrix = null;
      setUsersFeedback("Authorization matrix payload was invalid.");
      return false;
    }
    state.api.authorizationMatrix = matrix;
    return true;
  } catch (error) {
    state.api.authorizationMatrix = null;
    setUsersFeedback(normalizeApiErrorMessage(error, "Failed to load authorization matrix."));
    return false;
  } finally {
    state.api.isLoadingAuthorizationMatrix = false;
    renderUsersWorkspace();
  }
}

async function loadUserDetail(userId) {
  if (!isAuthenticated() || !isAdminUser()) {
    return false;
  }
  if (!Number.isInteger(userId) || userId <= 0) {
    return false;
  }
  if (state.api.userDetailsById[userId] || state.api.userDetailLoadingIds.has(userId)) {
    return false;
  }

  state.api.userDetailLoadingIds.add(userId);
  delete state.api.userDetailErrors[userId];
  renderUsersWorkspace();

  try {
    const payload = await apiRequest(`/admin/users/${userId}/details`, { auth: true });
    const detail = normalizeApiUserDetail(payload?.details);
    if (detail) {
      state.api.userDetailsById[userId] = detail;
    }
    return true;
  } catch (error) {
    state.api.userDetailErrors[userId] = normalizeApiErrorMessage(error, "Failed to load user details.");
    return false;
  } finally {
    state.api.userDetailLoadingIds.delete(userId);
    renderUsersWorkspace();
  }
}

async function saveUserRoleFromWorkspace(userId, role) {
  if (!isAuthenticated() || !isAdminUser()) {
    return;
  }
  if (!Number.isInteger(userId) || userId <= 0) {
    return;
  }
  const normalizedRole = normalizeApiUserRole(role);
  state.api.savingUserRoleId = userId;
  setUsersFeedback("Saving user permissions...");
  renderUsersWorkspace();

  try {
    const payload = await apiRequest(`/admin/users/${userId}/role`, {
      method: "PUT",
      auth: true,
      body: { role: normalizedRole }
    });
    const updated = normalizeApiAdminUser(payload?.user);
    if (updated) {
      state.api.users = state.api.users.map((candidate) => (candidate.id === updated.id ? updated : candidate));
    }
    setUsersFeedback("User permissions saved.");
  } catch (error) {
    setUsersFeedback(normalizeApiErrorMessage(error, "Failed to update user permissions."));
  } finally {
    state.api.savingUserRoleId = null;
    renderUsersWorkspace();
  }
}

async function saveUserRiotIdFromWorkspace(userId, gameName, tagline) {
  if (!isAuthenticated() || !isAdminUser()) {
    return;
  }
  if (!Number.isInteger(userId) || userId <= 0) {
    return;
  }

  const normalizedGameName = typeof gameName === "string" ? gameName.trim() : "";
  const normalizedTagline = typeof tagline === "string" ? tagline.trim() : "";
  if (!normalizedGameName || !normalizedTagline) {
    setUsersFeedback("Game Name and Tagline are required for Riot ID correction.");
    return;
  }

  state.api.savingUserRiotIdId = userId;
  setUsersFeedback("Saving Riot ID correction...");
  renderUsersWorkspace();

  try {
    const payload = await apiRequest(`/admin/users/${userId}/riot-id`, {
      method: "PUT",
      auth: true,
      body: {
        gameName: normalizedGameName,
        tagline: normalizedTagline
      }
    });
    const updated = normalizeApiAdminUser(payload?.user);
    if (updated) {
      state.api.users = state.api.users.map((candidate) => (candidate.id === updated.id ? updated : candidate));
    }
    setUsersFeedback("Riot ID correction saved.");
  } catch (error) {
    setUsersFeedback(normalizeApiErrorMessage(error, "Failed to save Riot ID correction."));
  } finally {
    state.api.savingUserRiotIdId = null;
    renderUsersWorkspace();
  }
}

async function deleteUserFromWorkspace(userId, email) {
  if (!isAuthenticated() || !isAdminUser()) {
    return;
  }
  if (!Number.isInteger(userId) || userId <= 0) {
    return;
  }

  const userLabel = typeof email === "string" && email.trim() !== "" ? email.trim() : `user #${userId}`;
  state.api.deletingUserId = userId;
  setUsersFeedback(`Deleting ${userLabel}...`);
  renderUsersWorkspace();

  try {
    await apiRequest(`/admin/users/${userId}`, {
      method: "DELETE",
      auth: true
    });
    state.api.users = state.api.users.filter((candidate) => candidate.id !== userId);
    setUsersFeedback(`Deleted ${userLabel}.`);
  } catch (error) {
    setUsersFeedback(normalizeApiErrorMessage(error, "Failed to delete user."));
  } finally {
    state.api.deletingUserId = null;
    renderUsersWorkspace();
  }
}

function renderUsersAuthorizationWorkspace() {
  if (
    !elements.usersAuthorizationAccess ||
    !elements.usersAuthorizationRoles ||
    !elements.usersAuthorizationPermissions ||
    !elements.usersAuthorizationAssignments
  ) {
    return;
  }

  elements.usersAuthorizationRoles.innerHTML = "";
  elements.usersAuthorizationPermissions.innerHTML = "";
  elements.usersAuthorizationAssignments.innerHTML = "";
  elements.usersAuthorizationPermissions.hidden = true;

  if (!isAuthenticated()) {
    elements.usersAuthorizationAccess.textContent = "Sign in as admin to view roles and permissions.";
    return;
  }
  if (!isAdminUser()) {
    elements.usersAuthorizationAccess.textContent = "Roles and permissions matrix is admin-only.";
    return;
  }
  if (state.api.isLoadingAuthorizationMatrix) {
    elements.usersAuthorizationAccess.textContent = "Loading roles and permissions...";
    return;
  }

  const matrix = state.api.authorizationMatrix;
  if (!matrix) {
    elements.usersAuthorizationAccess.textContent = "Roles and permissions are unavailable.";
    return;
  }

  const globalRoles = Array.isArray(matrix.global_roles) ? matrix.global_roles : [];
  const teamMembershipRoles = Array.isArray(matrix.team_membership_roles) ? matrix.team_membership_roles : [];
  const permissions = Array.isArray(matrix.permissions) ? matrix.permissions : [];
  const globalAssignments =
    matrix.assignments && typeof matrix.assignments.global_roles === "object"
      ? matrix.assignments.global_roles
      : {};
  const teamMembershipAssignments =
    matrix.assignments && typeof matrix.assignments.team_membership_roles === "object"
      ? matrix.assignments.team_membership_roles
      : {};
  const permissionById = new Map(permissions.map((permission) => [permission.id, permission]));
  const combinedRoles = [
    ...globalRoles.map((role) => ({ ...role, scope: "global", key: `global:${role.id}` })),
    ...teamMembershipRoles.map((role) => ({ ...role, scope: "team_membership", key: `team_membership:${role.id}` }))
  ];
  const combinedAssignments = Object.fromEntries(
    combinedRoles.map((role) => {
      const assignmentSource = role.scope === "team_membership" ? teamMembershipAssignments : globalAssignments;
      const assigned = Array.isArray(assignmentSource[role.id]) ? assignmentSource[role.id] : [];
      return [role.key, assigned];
    })
  );

  elements.usersAuthorizationAccess.textContent = [
    `${combinedRoles.length} role${combinedRoles.length === 1 ? "" : "s"}`,
    `${permissions.length} permission${permissions.length === 1 ? "" : "s"}`
  ].join(" • ");

  const formatRoleCode = (role) => {
    const scopePrefix = role.scope === "team_membership" ? "team_membership" : "global";
    return `${scopePrefix}.${role.id}`;
  };

  const createBlockHeader = (title, count, subtitle) => {
    const header = runtimeDocument.createElement("div");
    header.className = "users-authz-block-header";
    const titleRow = runtimeDocument.createElement("div");
    titleRow.className = "users-authz-block-title-row";
    const heading = runtimeDocument.createElement("strong");
    heading.textContent = title;
    titleRow.append(heading);
    if (Number.isInteger(count)) {
      const countBadge = runtimeDocument.createElement("span");
      countBadge.className = "users-authz-count-badge";
      countBadge.textContent = `${count}`;
      titleRow.append(countBadge);
    }
    header.append(titleRow);
    if (typeof subtitle === "string" && subtitle.trim() !== "") {
      header.append(createMetaParagraph(subtitle));
    }
    return header;
  };

  const createRoleCard = (title, roles, assignments = null, { emptyMessage = "No roles defined." } = {}) => {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card users-authz-block";
    const normalizedRoles = Array.isArray(roles) ? roles : [];
    card.append(
      createBlockHeader(
        title,
        normalizedRoles.length,
        "Role id and human label are shown together for quick policy auditing."
      )
    );
    if (normalizedRoles.length === 0) {
      card.append(createMetaParagraph(emptyMessage));
      return card;
    }
    const grid = runtimeDocument.createElement("div");
    grid.className = "users-authz-role-grid";
    for (const role of normalizedRoles) {
      const roleCard = runtimeDocument.createElement("article");
      roleCard.className = "users-authz-role-card";
      const roleHeader = runtimeDocument.createElement("div");
      roleHeader.className = "users-authz-role-header";
      const roleLabel = runtimeDocument.createElement("strong");
      roleLabel.textContent = role.label || role.id;
      const roleId = runtimeDocument.createElement("span");
      roleId.className = "users-authz-role-id";
      roleId.textContent = formatRoleCode(role);
      roleHeader.append(roleLabel, roleId);
      roleCard.append(roleHeader);
      if (assignments && typeof assignments === "object") {
        const assignmentCount = Array.isArray(assignments[role.key]) ? assignments[role.key].length : 0;
        roleCard.append(
          createMetaParagraph(`${assignmentCount} permission${assignmentCount === 1 ? "" : "s"} assigned`)
        );
      }
      if (role.description) {
        roleCard.append(createMetaParagraph(role.description));
      }
      grid.append(roleCard);
    }
    card.append(grid);
    return card;
  };

  elements.usersAuthorizationRoles.append(createRoleCard("Roles", combinedRoles, combinedAssignments));

  const normalizePermissionDomainLabel = (domain) => {
    const normalized = typeof domain === "string" ? domain.trim() : "";
    if (!normalized) {
      return "General";
    }
    return normalized
      .split("_")
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(" ");
  };

  const normalizePermissionDomain = (permissionId) => {
    const rawDomain = String(permissionId ?? "").split(".")[0] || "general";
    if (rawDomain === "champion_tags" || rawDomain === "champion_metadata") {
      return "champions";
    }
    return rawDomain;
  };

  const createAssignmentCard = (title, roles, assignments) => {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card users-authz-block";
    if (!Array.isArray(roles) || roles.length === 0) {
      card.append(createBlockHeader(title, 0, "No roles are available for this assignment scope."));
      card.append(createMetaParagraph("No roles defined."));
      return card;
    }
    card.append(
      createBlockHeader(
        title,
        roles.length,
        "Rows are permissions, columns are roles. Use this matrix to verify grants quickly."
      )
    );
    if (permissions.length === 0) {
      card.append(createMetaParagraph("No permissions defined."));
      return card;
    }

    const rolePermissionSets = new Map(
      roles.map((role) => [role.key, new Set(Array.isArray(assignments[role.key]) ? assignments[role.key] : [])])
    );
    const unknownPermissionIds = [...new Set([...rolePermissionSets.values()].flatMap((set) => [...set]))]
      .filter((permissionId) => !permissionById.has(permissionId))
      .sort((left, right) => left.localeCompare(right));
    if (unknownPermissionIds.length > 0) {
      card.append(
        createMetaParagraph(
          `Warning: ${unknownPermissionIds.length} assigned permission id${unknownPermissionIds.length === 1 ? "" : "s"} not present in catalog.`
        )
      );
    }

    const legend = runtimeDocument.createElement("div");
    legend.className = "users-authz-assignment-legend";
    const yesPill = runtimeDocument.createElement("span");
    yesPill.className = "users-authz-assignment-pill is-granted";
    yesPill.textContent = "Yes";
    const noPill = runtimeDocument.createElement("span");
    noPill.className = "users-authz-assignment-pill";
    noPill.textContent = "No";
    const legendText = runtimeDocument.createElement("span");
    legendText.className = "meta";
    legendText.textContent = "Cell value indicates whether that role grants that permission.";
    legend.append(yesPill, noPill, legendText);
    card.append(legend);

    const groupedPermissionRows = permissions.reduce((acc, permission) => {
      const domain = normalizePermissionDomain(permission.id);
      if (!acc.has(domain)) {
        acc.set(domain, []);
      }
      acc.get(domain).push(permission);
      return acc;
    }, new Map());

    const sortedDomains = [...groupedPermissionRows.keys()].sort((left, right) => left.localeCompare(right));
    for (const role of roles) {
      if (!rolePermissionSets.has(role.key)) {
        rolePermissionSets.set(role.key, new Set());
      }
    }

    for (const domain of sortedDomains) {
      const domainSection = runtimeDocument.createElement("section");
      domainSection.className = "users-authz-matrix-domain";
      const domainHeader = runtimeDocument.createElement("h4");
      domainHeader.className = "users-authz-permission-heading";
      domainHeader.textContent = normalizePermissionDomainLabel(domain);
      domainSection.append(domainHeader);

      const matrixWrap = runtimeDocument.createElement("div");
      matrixWrap.className = "users-authz-matrix-wrap";
      const matrixTable = runtimeDocument.createElement("table");
      matrixTable.className = "users-authz-matrix";
      const head = runtimeDocument.createElement("thead");
      const headRow = runtimeDocument.createElement("tr");
      const permissionHead = runtimeDocument.createElement("th");
      permissionHead.scope = "col";
      permissionHead.textContent = "Permission";
      headRow.append(permissionHead);
      for (const role of roles) {
        const roleHead = runtimeDocument.createElement("th");
        roleHead.scope = "col";
        roleHead.className = "users-authz-matrix-role";
        const roleLabel = runtimeDocument.createElement("span");
        roleLabel.textContent = role.label || role.id;
        const roleId = runtimeDocument.createElement("span");
        roleId.className = "users-authz-role-id";
        roleId.textContent = formatRoleCode(role);
        roleHead.append(roleLabel, roleId);
        headRow.append(roleHead);
      }
      head.append(headRow);
      matrixTable.append(head);

      const body = runtimeDocument.createElement("tbody");
      const domainPermissions = groupedPermissionRows.get(domain) ?? [];
      domainPermissions.sort((left, right) => String(left.id ?? "").localeCompare(String(right.id ?? "")));
      for (const permission of domainPermissions) {
        const permissionRow = runtimeDocument.createElement("tr");
        const permissionCell = runtimeDocument.createElement("th");
        permissionCell.scope = "row";
        permissionCell.className = "users-authz-matrix-permission";
        const code = runtimeDocument.createElement("span");
        code.className = "users-authz-code";
        code.textContent = permission.id;
        permissionCell.append(code);
        if (permission.description) {
          permissionCell.append(createMetaParagraph(permission.description));
        }
        permissionRow.append(permissionCell);

        for (const role of roles) {
          const rolePermissionSet = rolePermissionSets.get(role.key) ?? new Set();
          const granted = rolePermissionSet.has(permission.id);
          const cell = runtimeDocument.createElement("td");
          cell.className = "users-authz-matrix-cell";
          const pill = runtimeDocument.createElement("span");
          pill.className = granted ? "users-authz-assignment-pill is-granted" : "users-authz-assignment-pill";
          pill.textContent = granted ? "Yes" : "No";
          pill.title = granted
            ? `${role.label || role.id} grants ${permission.id}`
            : `${role.label || role.id} does not grant ${permission.id}`;
          cell.append(pill);
          permissionRow.append(cell);
        }
        body.append(permissionRow);
      }
      matrixTable.append(body);
      matrixWrap.append(matrixTable);
      domainSection.append(matrixWrap);
      card.append(domainSection);
    }
    return card;
  };

  elements.usersAuthorizationAssignments.append(
    createAssignmentCard("Permission Assignments", combinedRoles, combinedAssignments)
  );
}

function renderUsersWorkspace() {
  if (!elements.usersList || !elements.usersAccess) {
    return;
  }

  elements.usersList.innerHTML = "";
  renderUsersAuthorizationWorkspace();
  if (!isAuthenticated()) {
    elements.usersAccess.textContent = "Sign in to access users.";
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "Users page is available to admins only.";
    elements.usersList.append(empty);
    return;
  }
  if (!isAdminUser()) {
    elements.usersAccess.textContent = "Users page is admin-only.";
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "Your account does not have admin access.";
    elements.usersList.append(empty);
    return;
  }

  if (state.api.isLoadingUsers) {
    elements.usersAccess.textContent = "Loading users...";
    return;
  }

  const users = Array.isArray(state.api.users) ? state.api.users : [];
  elements.usersAccess.textContent = `${users.length} users loaded.`;
  if (users.length === 0) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "No users found.";
    elements.usersList.append(empty);
    return;
  }

  for (const user of users) {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card";
    const isSavingRole = state.api.savingUserRoleId === user.id;
    const isSavingRiotId = state.api.savingUserRiotIdId === user.id;
    const isDeletingUser = state.api.deletingUserId === user.id;
    const isSavingAnyUserAction = isSavingRole || isSavingRiotId || isDeletingUser;
    const isOwnerAdmin = user.is_owner_admin === true;
    const ownerStoredRole = normalizeApiUserRole(user.stored_role);
    const ownerRoleNeedsSync = isOwnerAdmin && ownerStoredRole !== "admin";

    const title = runtimeDocument.createElement("strong");
    title.textContent = user.email;

    const riot = runtimeDocument.createElement("p");
    riot.className = "meta";
    riot.textContent = user.riot_id ? `Riot ID: ${user.riot_id}` : "Riot ID: not set";

    const roleLabel = runtimeDocument.createElement("label");
    roleLabel.className = "meta";
    roleLabel.textContent = "Permissions";

    const roleSelect = runtimeDocument.createElement("select");
    const options = isOwnerAdmin
      ? [{ value: "admin", label: "admin" }]
      : [
          { value: "member", label: "user" },
          { value: "global", label: "global" }
        ];
    replaceOptions(roleSelect, options);
    roleSelect.value = isOwnerAdmin ? "admin" : normalizeApiUserRole(user.role);
    roleSelect.disabled = isSavingAnyUserAction || isOwnerAdmin;
    if (!isOwnerAdmin) {
      roleSelect.addEventListener("change", () => {
        void saveUserRoleFromWorkspace(user.id, roleSelect.value);
      });
    }

    const ownerAdminSyncButton = runtimeDocument.createElement("button");
    ownerAdminSyncButton.type = "button";
    ownerAdminSyncButton.className = "ghost";
    ownerAdminSyncButton.textContent = isSavingRole
      ? "Applying..."
      : (ownerRoleNeedsSync ? "Apply Admin to DB" : "Reapply Admin");
    ownerAdminSyncButton.disabled = !isOwnerAdmin || isSavingAnyUserAction;
    ownerAdminSyncButton.addEventListener("click", () => {
      void saveUserRoleFromWorkspace(user.id, "admin");
    });

    const ownerAdminSyncMeta = runtimeDocument.createElement("p");
    ownerAdminSyncMeta.className = "meta";
    ownerAdminSyncMeta.textContent = ownerRoleNeedsSync
      ? `Stored DB role is '${ownerStoredRole}'. Click Apply Admin to DB to sync.`
      : "Owner admin DB role is synced.";

    const riotCorrectionLabel = runtimeDocument.createElement("label");
    riotCorrectionLabel.className = "meta";
    riotCorrectionLabel.textContent = "Riot ID Correction (one-time)";

    const riotCorrectionGameName = runtimeDocument.createElement("input");
    riotCorrectionGameName.type = "text";
    riotCorrectionGameName.placeholder = "Game Name";
    riotCorrectionGameName.value = typeof user.game_name === "string" ? user.game_name : "";

    const riotCorrectionTagline = runtimeDocument.createElement("input");
    riotCorrectionTagline.type = "text";
    riotCorrectionTagline.placeholder = "Tagline";
    riotCorrectionTagline.value = typeof user.tagline === "string" ? user.tagline : "";

    const canUpdateRiotId = user.can_update_riot_id === true;
    riotCorrectionGameName.disabled = isSavingAnyUserAction || !canUpdateRiotId;
    riotCorrectionTagline.disabled = isSavingAnyUserAction || !canUpdateRiotId;

    const riotCorrectionSave = runtimeDocument.createElement("button");
    riotCorrectionSave.type = "button";
    riotCorrectionSave.textContent = isSavingRiotId ? "Saving..." : "Save Riot ID";
    riotCorrectionSave.disabled = isSavingAnyUserAction || !canUpdateRiotId;
    riotCorrectionSave.addEventListener("click", () => {
      void saveUserRiotIdFromWorkspace(user.id, riotCorrectionGameName.value, riotCorrectionTagline.value);
    });

    const riotCorrectionMeta = runtimeDocument.createElement("p");
    riotCorrectionMeta.className = "meta";
    riotCorrectionMeta.textContent = canUpdateRiotId
      ? "One-time correction available."
      : "One-time correction already used.";

    const riotCorrectionControls = runtimeDocument.createElement("div");
    riotCorrectionControls.className = "button-row";
    riotCorrectionControls.append(riotCorrectionGameName, riotCorrectionTagline, riotCorrectionSave);

    const deleteUserButton = runtimeDocument.createElement("button");
    deleteUserButton.type = "button";
    deleteUserButton.className = "ghost";
    deleteUserButton.textContent = isDeletingUser ? "Deleting..." : "Delete User";
    deleteUserButton.disabled = isSavingAnyUserAction || isOwnerAdmin;
    deleteUserButton.addEventListener("click", () => {
      void deleteUserFromWorkspace(user.id, user.email);
    });

    const deleteUserMeta = runtimeDocument.createElement("p");
    deleteUserMeta.className = "meta";
    deleteUserMeta.textContent = isOwnerAdmin
      ? "Owner account cannot be deleted."
      : "Delete permanently removes this user account and dependent records.";

    roleLabel.append(runtimeDocument.createElement("br"), roleSelect);
    riotCorrectionLabel.append(runtimeDocument.createElement("br"), riotCorrectionControls);
    card.append(title, riot, roleLabel);
    if (isOwnerAdmin) {
      card.append(ownerAdminSyncButton, ownerAdminSyncMeta);
    }
    card.append(riotCorrectionLabel, riotCorrectionMeta, deleteUserButton, deleteUserMeta);

    const detailPanel = runtimeDocument.createElement("details");
    detailPanel.className = "user-detail-panel";
    const detailSummary = runtimeDocument.createElement("summary");
    detailSummary.textContent = "Details";
    const detailContent = runtimeDocument.createElement("div");
    detailContent.className = "user-detail-content";
    detailPanel.append(detailSummary, detailContent);
    detailPanel.addEventListener("toggle", () => {
      if (!detailPanel.open) {
        return;
      }
      void loadUserDetail(user.id);
    });
    renderUserDetailContent(user.id, detailContent);
    card.append(detailPanel);

    elements.usersList.append(card);
  }
}

function normalizeRequirementDefinition(rawRequirement) {
  if (!rawRequirement || typeof rawRequirement !== "object" || Array.isArray(rawRequirement)) {
    return null;
  }
  const id = normalizeApiEntityId(rawRequirement.id);
  if (!id) {
    return null;
  }
  const name = typeof rawRequirement.name === "string" ? rawRequirement.name.trim() : "";
  if (!name) {
    return null;
  }
  const definition = typeof rawRequirement.definition === "string" ? rawRequirement.definition.trim() : "";
  const rules = Array.isArray(rawRequirement.rules) ? rawRequirement.rules : [];
  return {
    id,
    name,
    definition,
    rules
  };
}

function normalizeCompositionBundle(rawComposition) {
  if (!rawComposition || typeof rawComposition !== "object" || Array.isArray(rawComposition)) {
    return null;
  }
  const id = normalizeApiEntityId(rawComposition.id);
  if (!id) {
    return null;
  }
  const name = typeof rawComposition.name === "string" ? rawComposition.name.trim() : "";
  if (!name) {
    return null;
  }
  const description =
    typeof rawComposition.description === "string" ? rawComposition.description.trim() : "";
  const requirementIds = normalizeApiTagIdArray(rawComposition.requirement_ids);
  return {
    id,
    name,
    description,
    requirement_ids: requirementIds,
    is_active: rawComposition.is_active === true
  };
}

function getSelectedRequirementDefinition() {
  const selectedId = normalizeApiEntityId(state.api.selectedRequirementDefinitionId);
  if (!selectedId) {
    return null;
  }
  return state.api.requirementDefinitions.find((requirement) => requirement.id === selectedId) ?? null;
}

function normalizeRequirementRoleFilter(rawRoleFilter) {
  const roles = Array.isArray(rawRoleFilter) ? rawRoleFilter : [];
  const normalized = roles.map((role) => normalizeApiSlot(role)).filter(Boolean);
  return SLOTS.filter((slot) => normalized.includes(slot));
}

function normalizeRequirementClauseReferenceIds(rawReferenceIds) {
  const values = Array.isArray(rawReferenceIds)
    ? rawReferenceIds
    : rawReferenceIds === undefined || rawReferenceIds === null
      ? []
      : [rawReferenceIds];
  const normalized = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const clauseId = value.trim();
    if (!clauseId || normalized.includes(clauseId)) {
      continue;
    }
    normalized.push(clauseId);
  }
  return normalized;
}

function normalizeRequirementJoiner(rawJoiner, fallback = "and") {
  const normalizedFallback = REQUIREMENT_JOINER_MODES.includes(fallback) ? fallback : "and";
  const joiner = typeof rawJoiner === "string" ? rawJoiner.trim().toLowerCase() : "";
  return REQUIREMENT_JOINER_MODES.includes(joiner) ? joiner : normalizedFallback;
}

function normalizeRequirementTermKind(rawKind, fallback = "tag") {
  const normalizedFallback = REQUIREMENT_TERM_KIND_VALUE_SET.has(fallback) ? fallback : "tag";
  const kind = typeof rawKind === "string" ? rawKind.trim().toLowerCase() : "";
  return REQUIREMENT_TERM_KIND_VALUE_SET.has(kind) ? kind : normalizedFallback;
}

function collectTagValuesFromRequirementExpr(rawExpr, values) {
  if (typeof rawExpr === "string") {
    const trimmed = rawExpr.trim();
    if (trimmed) {
      values.add(trimmed);
    }
    return;
  }
  if (!rawExpr || typeof rawExpr !== "object" || Array.isArray(rawExpr)) {
    return;
  }
  if (typeof rawExpr.tag === "string" && rawExpr.tag.trim() !== "") {
    values.add(rawExpr.tag.trim());
  }
  for (const joiner of REQUIREMENT_JOINER_MODES) {
    if (!Array.isArray(rawExpr[joiner])) {
      continue;
    }
    for (const child of rawExpr[joiner]) {
      collectTagValuesFromRequirementExpr(child, values);
    }
  }
}

function collectKnownRequirementTagValues() {
  const knownValues = new Set();
  const addTermTagValue = (rawTerm) => {
    if (!rawTerm || typeof rawTerm !== "object" || Array.isArray(rawTerm)) {
      return;
    }
    const kind = normalizeRequirementTermKind(rawTerm.kind, "tag");
    if (kind !== "tag" || typeof rawTerm.value !== "string") {
      return;
    }
    const trimmedValue = rawTerm.value.trim();
    if (trimmedValue) {
      knownValues.add(trimmedValue);
    }
  };
  const addRuleTagValues = (rawRule) => {
    if (!rawRule || typeof rawRule !== "object" || Array.isArray(rawRule)) {
      return;
    }
    if (Array.isArray(rawRule.terms)) {
      for (const rawTerm of rawRule.terms) {
        addTermTagValue(rawTerm);
      }
    }
    if (rawRule.expr !== undefined) {
      collectTagValuesFromRequirementExpr(rawRule.expr, knownValues);
    }
  };
  for (const requirement of Array.isArray(state.api.requirementDefinitions) ? state.api.requirementDefinitions : []) {
    for (const rawRule of Array.isArray(requirement.rules) ? requirement.rules : []) {
      addRuleTagValues(rawRule);
    }
  }
  for (const rawRule of Array.isArray(state.api.requirementDefinitionDraft.rules)
    ? state.api.requirementDefinitionDraft.rules
    : []) {
    addRuleTagValues(rawRule);
  }
  return knownValues;
}

function getRequirementTagOptions() {
  const optionsByKey = new Map();
  const addOption = (value, description = "") => {
    if (typeof value !== "string") {
      return;
    }
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return;
    }
    const key = trimmedValue.toLowerCase();
    const existing = optionsByKey.get(key);
    if (existing) {
      if (!existing.description && description) {
        existing.description = description;
      }
      return;
    }
    optionsByKey.set(key, {
      value: trimmedValue,
      label: trimmedValue,
      description
    });
  };

  const catalogTags = Array.isArray(state.api.tags)
    ? [...state.api.tags]
        .map((tag) => ({
          name: typeof tag?.name === "string" ? tag.name.trim() : "",
          definition: typeof tag?.definition === "string" ? tag.definition.trim() : ""
        }))
        .filter((tag) => tag.name !== "")
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
    : [];
  for (const tag of catalogTags) {
    addOption(tag.name, tag.definition);
  }
  if (optionsByKey.size < 1) {
    for (const legacyTag of [...BOOLEAN_TAGS].sort((left, right) => left.localeCompare(right))) {
      addOption(legacyTag, "Legacy tag value.");
    }
  }
  for (const knownValue of collectKnownRequirementTagValues()) {
    addOption(knownValue, "Legacy requirement value. Add this tag in Tags to define it.");
  }

  return Array.from(optionsByKey.values()).sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" })
  );
}

function getRequirementTermOptions(kind) {
  const normalizedKind = normalizeRequirementTermKind(kind, "tag");
  if (normalizedKind === "damage_type") {
    return REQUIREMENT_DAMAGE_TYPE_OPTIONS;
  }
  if (normalizedKind === "effectiveness_focus") {
    return REQUIREMENT_EFFECTIVENESS_FOCUS_OPTIONS;
  }
  return getRequirementTagOptions();
}

function getRequirementTermKindLabel(kind) {
  const normalizedKind = normalizeRequirementTermKind(kind, "tag");
  return REQUIREMENT_TERM_KIND_OPTIONS.find((option) => option.value === normalizedKind)?.label ?? "Tag";
}

function getRequirementTermLabel(kind, value) {
  const option = getRequirementTermOptions(kind).find((candidate) => candidate.value === value);
  return option?.label ?? value;
}

function getRequirementTermDescription(kind, value) {
  const option = getRequirementTermOptions(kind).find((candidate) => candidate.value === value);
  return typeof option?.description === "string" ? option.description : "";
}

function normalizeRequirementTermValue(kind, rawValue) {
  if (typeof rawValue !== "string") {
    return "";
  }
  const value = rawValue.trim();
  if (!value) {
    return "";
  }
  const options = getRequirementTermOptions(kind);
  const exactMatch = options.find((option) => option.value === value);
  if (exactMatch) {
    return exactMatch.value;
  }
  const caseInsensitiveMatch = options.find((option) => option.value.toLowerCase() === value.toLowerCase());
  return caseInsensitiveMatch ? caseInsensitiveMatch.value : "";
}

function normalizeRequirementClauseTerm(rawTerm = null) {
  const term = rawTerm && typeof rawTerm === "object" && !Array.isArray(rawTerm) ? rawTerm : {};
  const kind = normalizeRequirementTermKind(term.kind, "tag");
  return {
    kind,
    value: normalizeRequirementTermValue(kind, term.value)
  };
}

function normalizeRequirementClauseTerms(rawTerms) {
  const values = Array.isArray(rawTerms) ? rawTerms : [];
  const terms = values.map((term) => normalizeRequirementClauseTerm(term));
  return terms.length > 0 ? terms : [createEmptyRequirementClauseTerm()];
}

function normalizeRequirementClauseTermJoiners(rawJoiners, termCount) {
  const joinerCount = Math.max(0, termCount - 1);
  const values = Array.isArray(rawJoiners) ? rawJoiners : [];
  const normalized = [];
  for (let index = 0; index < joinerCount; index += 1) {
    normalized.push(normalizeRequirementJoiner(values[index], "and"));
  }
  return normalized;
}

function normalizeRequirementTermSearchByKind(rawValue = null) {
  const normalized = {};
  for (const kindOption of REQUIREMENT_TERM_KIND_OPTIONS) {
    normalized[kindOption.value] = "";
  }
  if (typeof rawValue === "string") {
    normalized.tag = rawValue;
    return normalized;
  }
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return normalized;
  }
  for (const kindOption of REQUIREMENT_TERM_KIND_OPTIONS) {
    const value = rawValue[kindOption.value];
    normalized[kindOption.value] = typeof value === "string" ? value : "";
  }
  return normalized;
}

function createRequirementTermFromExprNode(rawNode) {
  if (typeof rawNode === "string") {
    const value = normalizeRequirementTermValue("tag", rawNode);
    if (value) {
      return { kind: "tag", value };
    }
    return null;
  }
  if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) {
    return null;
  }
  if (typeof rawNode.tag === "string") {
    const value = normalizeRequirementTermValue("tag", rawNode.tag);
    if (value) {
      return { kind: "tag", value };
    }
  }
  const rawDamageType =
    typeof rawNode.damageType === "string"
      ? rawNode.damageType
      : typeof rawNode.primaryDamageType === "string"
        ? rawNode.primaryDamageType
        : typeof rawNode.damage_type === "string"
          ? rawNode.damage_type
          : null;
  if (rawDamageType) {
    const value = normalizeRequirementTermValue("damage_type", rawDamageType.toLowerCase());
    if (value) {
      return { kind: "damage_type", value };
    }
  }
  const rawEffectivenessFocus =
    typeof rawNode.effectivenessFocus === "string"
      ? rawNode.effectivenessFocus
      : typeof rawNode.effectiveness_focus === "string"
        ? rawNode.effectiveness_focus
        : null;
  if (rawEffectivenessFocus) {
    const value = normalizeRequirementTermValue("effectiveness_focus", rawEffectivenessFocus.toLowerCase());
    if (value) {
      return { kind: "effectiveness_focus", value };
    }
  }
  return null;
}

function flattenRequirementClauseExprToTermChain(rawExpr) {
  const directTerm = createRequirementTermFromExprNode(rawExpr);
  if (directTerm) {
    return {
      terms: [directTerm],
      termJoiners: []
    };
  }
  if (typeof rawExpr === "string") {
    const parts = rawExpr
      .split(/\s+(AND|OR)\s+/i)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length >= 3 && parts.length % 2 === 1) {
      const terms = [];
      const termJoiners = [];
      let isValid = true;
      for (let index = 0; index < parts.length; index += 1) {
        if (index % 2 === 0) {
          const term = createRequirementTermFromExprNode(parts[index]);
          if (!term) {
            isValid = false;
            break;
          }
          terms.push(term);
        } else {
          termJoiners.push(normalizeRequirementJoiner(parts[index], "and"));
        }
      }
      if (isValid && terms.length > 0) {
        return {
          terms,
          termJoiners: normalizeRequirementClauseTermJoiners(termJoiners, terms.length)
        };
      }
    }
  }
  if (!rawExpr || typeof rawExpr !== "object" || Array.isArray(rawExpr)) {
    return null;
  }

  for (const joiner of REQUIREMENT_JOINER_MODES) {
    const children = rawExpr[joiner];
    if (!Array.isArray(children) || children.length < 2) {
      continue;
    }

    const parts = children.map((child) => flattenRequirementClauseExprToTermChain(child));
    if (parts.some((part) => !part || part.terms.length < 1)) {
      continue;
    }

    const terms = [...parts[0].terms];
    const termJoiners = [...parts[0].termJoiners];
    for (let partIndex = 1; partIndex < parts.length; partIndex += 1) {
      const part = parts[partIndex];
      termJoiners.push(joiner);
      terms.push(part.terms[0]);
      for (let termIndex = 1; termIndex < part.terms.length; termIndex += 1) {
        termJoiners.push(normalizeRequirementJoiner(part.termJoiners[termIndex - 1], "and"));
        terms.push(part.terms[termIndex]);
      }
    }
    return {
      terms,
      termJoiners: normalizeRequirementClauseTermJoiners(termJoiners, terms.length)
    };
  }

  return null;
}

function createRequirementRuleClauseDraft(rawClause = null) {
  const clause = rawClause && typeof rawClause === "object" && !Array.isArray(rawClause) ? rawClause : {};
  const minCount = Number.isInteger(clause.minCount) && clause.minCount > 0 ? clause.minCount : 1;
  const maxCount =
    Number.isInteger(clause.maxCount) && clause.maxCount >= minCount ? String(clause.maxCount) : "";
  const roleFilter = normalizeRequirementRoleFilter(clause.roleFilter);
  const clauseId =
    typeof clause.id === "string" && clause.id.trim() !== "" ? clause.id.trim() : createRequirementClauseDraftId();
  const separateFrom = normalizeRequirementClauseReferenceIds(clause.separateFrom);
  const clauseJoiner = normalizeRequirementJoiner(clause.clauseJoiner, "and");

  const flattenedExpr = flattenRequirementClauseExprToTermChain(clause.expr);
  const terms = flattenedExpr?.terms ?? normalizeRequirementClauseTerms(clause.terms);
  const termJoiners = normalizeRequirementClauseTermJoiners(
    flattenedExpr?.termJoiners ?? clause.termJoiners,
    terms.length
  );
  const activeTermIndex = Number.parseInt(String(clause.activeTermIndex), 10);

  return {
    clauseId,
    clauseJoiner,
    terms,
    termJoiners,
    activeTermIndex:
      Number.isInteger(activeTermIndex) && activeTermIndex >= 0 && activeTermIndex < terms.length
        ? activeTermIndex
        : Math.max(0, terms.length - 1),
    termSearchByKind: normalizeRequirementTermSearchByKind(clause.termSearchByKind ?? clause.termSearch),
    isOpen: clause.isOpen === true,
    minCount,
    maxCount,
    roleFilter,
    separateFrom
  };
}

function setRequirementDefinitionDraft(requirement = null) {
  if (!requirement) {
    state.api.selectedRequirementDefinitionId = null;
    state.api.requirementDefinitionDraft = createEmptyRequirementDefinitionDraft();
    return;
  }

  state.api.selectedRequirementDefinitionId = requirement.id;
  state.api.requirementDefinitionDraft = {
    name: requirement.name,
    definition: requirement.definition,
    rules:
      Array.isArray(requirement.rules) && requirement.rules.length > 0
        ? requirement.rules.map((rule) => createRequirementRuleClauseDraft(rule))
        : createEmptyRequirementDefinitionDraft().rules
  };
}

function syncRequirementDefinitionInputsFromState() {
  if (elements.requirementsName) {
    elements.requirementsName.value = state.api.requirementDefinitionDraft.name;
  }
  if (elements.requirementsDefinition) {
    elements.requirementsDefinition.value = state.api.requirementDefinitionDraft.definition;
  }
}

function parseRequirementRuleClauseExpr(clause, clauseIndex) {
  const terms = normalizeRequirementClauseTerms(clause.terms);
  for (const [termIndex, term] of terms.entries()) {
    const value = normalizeRequirementTermValue(term.kind, term.value);
    if (!value) {
      throw new Error(`Clause ${clauseIndex + 1}, condition ${termIndex + 1}: select a value.`);
    }
    term.value = value;
  }
  if (terms.length === 1) {
    return createRequirementExprNodeFromTerm(terms[0]);
  }

  const termJoiners = normalizeRequirementClauseTermJoiners(clause.termJoiners, terms.length);
  let expression = createRequirementExprNodeFromTerm(terms[0]);
  for (let index = 1; index < terms.length; index += 1) {
    const joiner = normalizeRequirementJoiner(termJoiners[index - 1], "and");
    expression = {
      [joiner]: [expression, createRequirementExprNodeFromTerm(terms[index])]
    };
  }
  return expression;
}

function createRequirementExprNodeFromTerm(term) {
  const kind = normalizeRequirementTermKind(term.kind, "tag");
  const value = normalizeRequirementTermValue(kind, term.value);
  if (kind === "damage_type") {
    return { damageType: value };
  }
  if (kind === "effectiveness_focus") {
    return { effectivenessFocus: value };
  }
  return { tag: value };
}

function parseRequirementRulesFromDraftClauses() {
  const rules = Array.isArray(state.api.requirementDefinitionDraft.rules)
    ? state.api.requirementDefinitionDraft.rules
    : [];
  if (rules.length < 1) {
    throw new Error("Add at least one rule clause.");
  }

  const normalizedClauses = rules.map((clause) => {
    const clauseId =
      typeof clause?.clauseId === "string" && clause.clauseId.trim() !== ""
        ? clause.clauseId.trim()
        : createRequirementClauseDraftId();
    return {
      ...clause,
      clauseId
    };
  });
  state.api.requirementDefinitionDraft.rules = normalizedClauses;

  const clauseIdSet = new Set();
  for (const [index, clause] of normalizedClauses.entries()) {
    if (clauseIdSet.has(clause.clauseId)) {
      throw new Error(`Clause ${index + 1}: duplicate clause reference id.`);
    }
    clauseIdSet.add(clause.clauseId);
  }

  return normalizedClauses.map((clause, index) => {
    const minCount = Number.parseInt(String(clause.minCount), 10);
    if (!Number.isInteger(minCount) || minCount < 1) {
      throw new Error(`Clause ${index + 1}: min count must be a positive integer.`);
    }

    const maxCountRaw = String(clause.maxCount ?? "").trim();
    const maxCount = maxCountRaw === "" ? null : Number.parseInt(maxCountRaw, 10);
    if (maxCount !== null && (!Number.isInteger(maxCount) || maxCount < minCount)) {
      throw new Error(`Clause ${index + 1}: max count must be blank or >= min count.`);
    }

    const roleFilter = normalizeRequirementRoleFilter(clause.roleFilter);
    const separateFrom = normalizeRequirementClauseReferenceIds(clause.separateFrom).filter(
      (referenceId) => referenceId !== clause.clauseId
    );
    const clauseJoiner = normalizeRequirementJoiner(clause.clauseJoiner, "and");
    for (const referenceId of separateFrom) {
      if (!clauseIdSet.has(referenceId)) {
        throw new Error(`Clause ${index + 1}: unknown separation target '${referenceId}'.`);
      }
    }

    return {
      id: clause.clauseId,
      expr: parseRequirementRuleClauseExpr(clause, index),
      minCount,
      ...(maxCount === null ? {} : { maxCount }),
      ...(roleFilter.length < 1 ? {} : { roleFilter }),
      ...(index < 1 ? {} : { clauseJoiner }),
      ...(separateFrom.length < 1 ? {} : { separateFrom })
    };
  });
}

function getSelectedCompositionBundle() {
  const selectedId = normalizeApiEntityId(state.api.selectedCompositionBundleId);
  if (!selectedId) {
    return null;
  }
  return state.api.compositionBundles.find((composition) => composition.id === selectedId) ?? null;
}

function setCompositionBundleDraft(composition = null) {
  if (!composition) {
    state.api.selectedCompositionBundleId = null;
    state.api.compositionBundleDraft = createEmptyCompositionBundleDraft();
    return;
  }

  state.api.selectedCompositionBundleId = composition.id;
  state.api.compositionBundleDraft = {
    name: composition.name,
    description: composition.description,
    requirementIds: [...composition.requirement_ids],
    isActive: composition.is_active === true
  };
}

function syncCompositionBundleInputsFromState() {
  if (elements.compositionsName) {
    elements.compositionsName.value = state.api.compositionBundleDraft.name;
  }
  if (elements.compositionsDescription) {
    elements.compositionsDescription.value = state.api.compositionBundleDraft.description;
  }
  if (elements.compositionsIsActive) {
    elements.compositionsIsActive.checked = state.api.compositionBundleDraft.isActive === true;
  }
}

function renderCompositionRequirementOptions() {
  if (!elements.compositionsRequirementOptions) {
    return;
  }
  elements.compositionsRequirementOptions.innerHTML = "";

  const requirements = Array.isArray(state.api.requirementDefinitions) ? state.api.requirementDefinitions : [];
  if (requirements.length < 1) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "Create at least one requirement definition first.";
    elements.compositionsRequirementOptions.append(empty);
    return;
  }

  const selectedIdSet = new Set(normalizeApiTagIdArray(state.api.compositionBundleDraft.requirementIds));
  const controlsDisabled =
    state.api.isSavingCompositionBundle || state.api.isLoadingCompositionBundles || !isAdminUser();

  for (const requirement of requirements) {
    const label = runtimeDocument.createElement("label");
    label.className = "selection-option";

    const checkbox = runtimeDocument.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedIdSet.has(requirement.id);
    checkbox.disabled = controlsDisabled;
    checkbox.addEventListener("change", () => {
      const next = new Set(state.api.compositionBundleDraft.requirementIds);
      if (checkbox.checked) {
        next.add(requirement.id);
      } else {
        next.delete(requirement.id);
      }
      state.api.compositionBundleDraft.requirementIds = [...next].sort((left, right) => left - right);
    });

    const text = runtimeDocument.createElement("span");
    text.textContent = requirement.name;

    label.append(checkbox, text);
    elements.compositionsRequirementOptions.append(label);
  }
}

function formatRequirementClauseExpressionSummary(clause) {
  const terms = normalizeRequirementClauseTerms(clause.terms);
  if (terms.length < 1) {
    return "No conditions selected.";
  }
  const termJoiners = normalizeRequirementClauseTermJoiners(clause.termJoiners, terms.length);
  let summary = formatRequirementClauseTermSummary(terms[0]);
  for (let index = 1; index < terms.length; index += 1) {
    summary = `${summary} ${normalizeRequirementJoiner(termJoiners[index - 1], "and").toUpperCase()} ${formatRequirementClauseTermSummary(terms[index])}`;
  }
  return summary;
}

function formatRequirementClauseTermSummary(term) {
  const kind = normalizeRequirementTermKind(term.kind, "tag");
  const value = normalizeRequirementTermValue(kind, term.value);
  if (!value) {
    return "Select Condition";
  }
  return `${getRequirementTermKindLabel(kind)}: ${getRequirementTermLabel(kind, value)}`;
}

function renderRequirementClauseEditor() {
  if (!elements.requirementsClauses) {
    return;
  }
  elements.requirementsClauses.innerHTML = "";

  const clauses = Array.isArray(state.api.requirementDefinitionDraft.rules)
    ? state.api.requirementDefinitionDraft.rules
    : [];
  const controlsDisabled = state.api.isSavingRequirementDefinition || !isAdminUser();

  if (clauses.length < 1) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "Add at least one clause.";
    elements.requirementsClauses.append(empty);
    return;
  }

  for (const [index, clause] of clauses.entries()) {
    clause.terms = normalizeRequirementClauseTerms(clause.terms);
    clause.termJoiners = normalizeRequirementClauseTermJoiners(clause.termJoiners, clause.terms.length);
    clause.clauseJoiner = normalizeRequirementJoiner(clause.clauseJoiner, "and");
    clause.termSearchByKind = normalizeRequirementTermSearchByKind(clause.termSearchByKind ?? clause.termSearch);
    const parsedActiveTermIndex = Number.parseInt(String(clause.activeTermIndex), 10);
    clause.activeTermIndex =
      Number.isInteger(parsedActiveTermIndex) && parsedActiveTermIndex >= 0 && parsedActiveTermIndex < clause.terms.length
        ? parsedActiveTermIndex
        : Math.max(0, clause.terms.length - 1);

    const card = runtimeDocument.createElement("article");
    card.className = "summary-card requirement-clause-card";

    const summaryRow = runtimeDocument.createElement("div");
    summaryRow.className = "requirement-clause-summary";

    const summaryText = runtimeDocument.createElement("div");
    const heading = runtimeDocument.createElement("p");
    heading.className = "panel-kicker";
    heading.textContent = `Clause ${index + 1}`;
    const expressionSummary = runtimeDocument.createElement("p");
    expressionSummary.className = "meta";
    expressionSummary.textContent = formatRequirementClauseExpressionSummary(clause);
    const constraintsSummary = runtimeDocument.createElement("p");
    constraintsSummary.className = "meta";
    const roleFilterCount = normalizeRequirementRoleFilter(clause.roleFilter).length;
    const separateFromCount = normalizeRequirementClauseReferenceIds(clause.separateFrom).length;
    constraintsSummary.textContent = [
      `Min ${Number.parseInt(String(clause.minCount), 10) || 1}`,
      String(clause.maxCount ?? "").trim() === "" ? "Max none" : `Max ${String(clause.maxCount).trim()}`,
      roleFilterCount > 0 ? `${roleFilterCount} role filter${roleFilterCount === 1 ? "" : "s"}` : "No role filter",
      separateFromCount > 0
        ? `${separateFromCount} separate-champion link${separateFromCount === 1 ? "" : "s"}`
        : "No separation links"
    ].join(" | ");
    summaryText.append(heading, expressionSummary, constraintsSummary);

    const summaryControls = runtimeDocument.createElement("div");
    summaryControls.className = "button-row requirement-inline-actions";
    if (index > 0) {
      const clauseJoinerSelect = runtimeDocument.createElement("select");
      clauseJoinerSelect.className = "requirement-inline-select";
      clauseJoinerSelect.dataset.field = "clause-joiner";
      clauseJoinerSelect.dataset.clauseIndex = String(index);
      replaceOptions(clauseJoinerSelect, [
        { value: "and", label: "AND" },
        { value: "or", label: "OR" }
      ]);
      clauseJoinerSelect.value = normalizeRequirementJoiner(clause.clauseJoiner, "and");
      clauseJoinerSelect.disabled = controlsDisabled;
      clauseJoinerSelect.addEventListener("change", () => {
        clause.clauseJoiner = normalizeRequirementJoiner(clauseJoinerSelect.value, "and");
      });
      summaryControls.append(clauseJoinerSelect);
    }

    const editButton = runtimeDocument.createElement("button");
    editButton.type = "button";
    editButton.className = "ghost requirement-inline-button";
    editButton.textContent = clause.isOpen ? "Close" : "Edit";
    editButton.disabled = controlsDisabled;
    editButton.addEventListener("click", () => {
      clause.isOpen = !clause.isOpen;
      renderRequirementClauseEditor();
    });
    summaryControls.append(editButton);

    const removeButton = runtimeDocument.createElement("button");
    removeButton.type = "button";
    removeButton.className = "ghost requirement-inline-button";
    removeButton.textContent = "Remove";
    removeButton.disabled = controlsDisabled || clauses.length <= 1;
    removeButton.addEventListener("click", () => {
      const nextClauses = [...clauses];
      nextClauses.splice(index, 1);
      const remainingIds = new Set(
        nextClauses
          .map((candidate) =>
            typeof candidate?.clauseId === "string" && candidate.clauseId.trim() !== ""
              ? candidate.clauseId.trim()
              : null
          )
          .filter(Boolean)
      );
      for (const nextClause of nextClauses) {
        nextClause.separateFrom = normalizeRequirementClauseReferenceIds(nextClause.separateFrom).filter((referenceId) =>
          remainingIds.has(referenceId)
        );
      }
      state.api.requirementDefinitionDraft.rules = nextClauses;
      renderRequirementClauseEditor();
    });
    summaryControls.append(removeButton);

    summaryRow.append(summaryText, summaryControls);
    card.append(summaryRow);

    if (!clause.isOpen) {
      elements.requirementsClauses.append(card);
      continue;
    }

    const editor = runtimeDocument.createElement("div");
    editor.className = "requirement-clause-editor";

    const termsTitle = runtimeDocument.createElement("p");
    termsTitle.className = "meta";
    termsTitle.textContent = "Conditions";

    const termChain = runtimeDocument.createElement("div");
    termChain.className = "requirement-tag-chain";
    for (let termIndex = 0; termIndex < clause.terms.length; termIndex += 1) {
      if (termIndex > 0) {
        const termJoinerSelect = runtimeDocument.createElement("select");
        termJoinerSelect.className = "requirement-inline-select";
        termJoinerSelect.dataset.field = "term-joiner";
        termJoinerSelect.dataset.clauseIndex = String(index);
        termJoinerSelect.dataset.termIndex = String(termIndex);
        replaceOptions(termJoinerSelect, [
          { value: "and", label: "AND" },
          { value: "or", label: "OR" }
        ]);
        termJoinerSelect.value = normalizeRequirementJoiner(clause.termJoiners[termIndex - 1], "and");
        termJoinerSelect.disabled = controlsDisabled;
        termJoinerSelect.addEventListener("change", () => {
          clause.termJoiners = normalizeRequirementClauseTermJoiners(clause.termJoiners, clause.terms.length);
          clause.termJoiners[termIndex - 1] = normalizeRequirementJoiner(termJoinerSelect.value, "and");
        });
        termChain.append(termJoinerSelect);
      }

      const termButton = runtimeDocument.createElement("button");
      termButton.type = "button";
      termButton.className = `ghost requirement-inline-button requirement-tag-token${
        clause.activeTermIndex === termIndex ? " is-active" : ""
      }`;
      const termSummary = formatRequirementClauseTermSummary(clause.terms[termIndex]);
      termButton.textContent = termSummary;
      const activeTermKind = normalizeRequirementTermKind(clause.terms[termIndex]?.kind, "tag");
      const activeTermValue = normalizeRequirementTermValue(activeTermKind, clause.terms[termIndex]?.value);
      const activeTermDescription = activeTermValue ? getRequirementTermDescription(activeTermKind, activeTermValue) : "";
      if (activeTermDescription) {
        termButton.title = activeTermDescription;
      }
      termButton.disabled = controlsDisabled;
      termButton.addEventListener("click", () => {
        clause.activeTermIndex = termIndex;
        renderRequirementClauseEditor();
      });
      termChain.append(termButton);

      if (clause.terms.length > 1) {
        const removeTermButton = runtimeDocument.createElement("button");
        removeTermButton.type = "button";
        removeTermButton.className = "ghost requirement-inline-button";
        removeTermButton.textContent = "x";
        removeTermButton.disabled = controlsDisabled;
        removeTermButton.addEventListener("click", () => {
          clause.terms = clause.terms.filter((_term, candidateIndex) => candidateIndex !== termIndex);
          clause.termJoiners = normalizeRequirementClauseTermJoiners(
            clause.termJoiners.filter((_joiner, candidateIndex) => candidateIndex !== termIndex - 1),
            clause.terms.length
          );
          clause.activeTermIndex = Math.max(0, Math.min(clause.activeTermIndex, clause.terms.length - 1));
          renderRequirementClauseEditor();
        });
        termChain.append(removeTermButton);
      }
    }

    const addTermButton = runtimeDocument.createElement("button");
    addTermButton.type = "button";
    addTermButton.className = "ghost requirement-inline-button";
    addTermButton.textContent = "Add Condition";
    addTermButton.dataset.field = "add-term";
    addTermButton.dataset.clauseIndex = String(index);
    addTermButton.disabled = controlsDisabled;
    addTermButton.addEventListener("click", () => {
      clause.terms = [...clause.terms, createEmptyRequirementClauseTerm()];
      clause.termJoiners = [...normalizeRequirementClauseTermJoiners(clause.termJoiners, clause.terms.length - 1), "and"];
      clause.activeTermIndex = clause.terms.length - 1;
      renderRequirementClauseEditor();
    });
    termChain.append(addTermButton);

    const activeTerm = clause.terms[clause.activeTermIndex] ?? createEmptyRequirementClauseTerm();
    const activeKind = normalizeRequirementTermKind(activeTerm.kind, "tag");
    const activeValue = normalizeRequirementTermValue(activeKind, activeTerm.value);
    const conditionGrid = runtimeDocument.createElement("div");
    conditionGrid.className = "requirement-condition-grid";

    for (const kindOption of REQUIREMENT_TERM_KIND_OPTIONS) {
      const conditionKind = normalizeRequirementTermKind(kindOption.value, "tag");
      const termPicker = runtimeDocument.createElement("div");
      termPicker.className = "requirement-tag-picker requirement-condition-picker";

      const pickerTitle = runtimeDocument.createElement("p");
      pickerTitle.className = "meta requirement-condition-picker-title";
      pickerTitle.textContent = kindOption.label;
      termPicker.append(pickerTitle);

      const termFilterInput = runtimeDocument.createElement("input");
      termFilterInput.type = "text";
      termFilterInput.className = "pool-snapshot-filter";
      termFilterInput.placeholder = `Filter ${kindOption.label.toLowerCase()}...`;
      termFilterInput.value = clause.termSearchByKind[conditionKind] ?? "";
      termFilterInput.dataset.field = "term-filter";
      termFilterInput.dataset.clauseIndex = String(index);
      termFilterInput.dataset.kind = conditionKind;
      termFilterInput.disabled = controlsDisabled;
      termFilterInput.addEventListener("input", () => {
        clause.termSearchByKind[conditionKind] = termFilterInput.value;
        renderRequirementClauseEditor();
      });
      termPicker.append(termFilterInput);

      const termList = runtimeDocument.createElement("ul");
      termList.className = "pool-snapshot-list requirement-tag-picker-list";
      const filterText = String(clause.termSearchByKind[conditionKind] ?? "").trim().toLowerCase();
      const filteredOptions = getRequirementTermOptions(conditionKind).filter((option) =>
        option.label.toLowerCase().includes(filterText)
      );
      if (filteredOptions.length < 1) {
        const emptyTerm = runtimeDocument.createElement("li");
        emptyTerm.className = "pool-snapshot-empty";
        emptyTerm.textContent = "No options match.";
        termList.append(emptyTerm);
      } else {
        for (const option of filteredOptions) {
          const optionItem = runtimeDocument.createElement("li");
          if (activeKind === conditionKind && activeValue === option.value) {
            optionItem.classList.add("is-selected");
          }
          optionItem.dataset.field = "term-option";
          optionItem.dataset.clauseIndex = String(index);
          optionItem.dataset.kind = conditionKind;
          optionItem.dataset.value = option.value;
          optionItem.textContent = option.label;
          if (option.description) {
            optionItem.title = option.description;
          }
          if (!controlsDisabled) {
            optionItem.addEventListener("click", () => {
              clause.terms[clause.activeTermIndex] = {
                kind: conditionKind,
                value: option.value
              };
              renderRequirementClauseEditor();
            });
          }
          termList.append(optionItem);
        }
      }
      termPicker.append(termList);
      conditionGrid.append(termPicker);
    }

    const minMaxGrid = runtimeDocument.createElement("div");
    minMaxGrid.className = "grid grid-2";

    const minLabel = runtimeDocument.createElement("label");
    minLabel.textContent = "Min Count";
    const minInput = runtimeDocument.createElement("input");
    minInput.type = "number";
    minInput.min = "1";
    minInput.step = "1";
    minInput.value = String(clause.minCount ?? 1);
    minInput.disabled = controlsDisabled;
    minInput.addEventListener("change", () => {
      const parsed = Number.parseInt(minInput.value, 10);
      clause.minCount = Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
      minInput.value = String(clause.minCount);
      if (String(clause.maxCount ?? "").trim() !== "" && Number.parseInt(String(clause.maxCount), 10) < clause.minCount) {
        clause.maxCount = String(clause.minCount);
      }
      renderRequirementClauseEditor();
    });
    minLabel.append(runtimeDocument.createElement("br"), minInput);

    const maxLabel = runtimeDocument.createElement("label");
    maxLabel.textContent = "Max Count (optional)";
    const maxInput = runtimeDocument.createElement("input");
    maxInput.type = "number";
    maxInput.min = "1";
    maxInput.step = "1";
    maxInput.placeholder = "No max";
    maxInput.value = String(clause.maxCount ?? "");
    maxInput.disabled = controlsDisabled;
    maxInput.addEventListener("input", () => {
      clause.maxCount = maxInput.value.trim();
    });
    maxLabel.append(runtimeDocument.createElement("br"), maxInput);
    minMaxGrid.append(minLabel, maxLabel);

    const roleFilterWrap = runtimeDocument.createElement("div");
    const roleFilterTitle = runtimeDocument.createElement("p");
    roleFilterTitle.className = "meta";
    roleFilterTitle.textContent = "Role Filter (optional)";
    roleFilterWrap.append(roleFilterTitle);
    const roleSet = new Set(normalizeRequirementRoleFilter(clause.roleFilter));
    for (const slot of SLOTS) {
      const roleLabel = runtimeDocument.createElement("label");
      roleLabel.className = "selection-option";
      const roleCheckbox = runtimeDocument.createElement("input");
      roleCheckbox.type = "checkbox";
      roleCheckbox.checked = roleSet.has(slot);
      roleCheckbox.disabled = controlsDisabled;
      roleCheckbox.addEventListener("change", () => {
        const next = new Set(normalizeRequirementRoleFilter(clause.roleFilter));
        if (roleCheckbox.checked) {
          next.add(slot);
        } else {
          next.delete(slot);
        }
        clause.roleFilter = [...next].sort((left, right) => SLOTS.indexOf(left) - SLOTS.indexOf(right));
      });
      const roleText = runtimeDocument.createElement("span");
      roleText.textContent = slot;
      roleLabel.append(roleCheckbox, roleText);
      roleFilterWrap.append(roleLabel);
    }

    const separationWrap = runtimeDocument.createElement("div");
    const separationTitle = runtimeDocument.createElement("p");
    separationTitle.className = "meta";
    separationTitle.textContent = "Champion Separation (optional)";
    separationWrap.append(separationTitle);
    if (clauses.length <= 1) {
      const separationEmpty = runtimeDocument.createElement("p");
      separationEmpty.className = "meta";
      separationEmpty.textContent = "Add another clause to enforce separate champions.";
      separationWrap.append(separationEmpty);
    } else {
      const selectedReferenceSet = new Set(normalizeRequirementClauseReferenceIds(clause.separateFrom));
      for (const [candidateIndex, candidateClause] of clauses.entries()) {
        if (candidateIndex === index) {
          continue;
        }
        const candidateId =
          typeof candidateClause.clauseId === "string" && candidateClause.clauseId.trim() !== ""
            ? candidateClause.clauseId.trim()
            : "";
        if (!candidateId) {
          continue;
        }
        const candidateLabel = runtimeDocument.createElement("label");
        candidateLabel.className = "selection-option";
        const candidateCheckbox = runtimeDocument.createElement("input");
        candidateCheckbox.type = "checkbox";
        candidateCheckbox.checked = selectedReferenceSet.has(candidateId);
        candidateCheckbox.disabled = controlsDisabled;
        candidateCheckbox.dataset.field = "separate-from";
        candidateCheckbox.dataset.clauseIndex = String(index);
        candidateCheckbox.dataset.targetClauseIndex = String(candidateIndex);
        candidateCheckbox.addEventListener("change", () => {
          const next = new Set(normalizeRequirementClauseReferenceIds(clause.separateFrom));
          if (candidateCheckbox.checked) {
            next.add(candidateId);
          } else {
            next.delete(candidateId);
          }
          clause.separateFrom = Array.from(next);
        });
        const candidateText = runtimeDocument.createElement("span");
        candidateText.textContent = `Different champion than Clause ${candidateIndex + 1}`;
        candidateLabel.append(candidateCheckbox, candidateText);
        separationWrap.append(candidateLabel);
      }
    }
    editor.append(termsTitle, termChain, conditionGrid, minMaxGrid, roleFilterWrap, separationWrap);
    card.append(editor);
    elements.requirementsClauses.append(card);
  }
}

function renderRequirementDefinitionsWorkspace() {
  if (!elements.requirementsList) {
    return;
  }

  syncRequirementDefinitionInputsFromState();
  renderRequirementClauseEditor();

  const isEditing = Boolean(normalizeApiEntityId(state.api.selectedRequirementDefinitionId));
  const isEditorOpen = state.api.isRequirementDefinitionEditorOpen === true;
  const controlsDisabled = state.api.isSavingRequirementDefinition || !isAdminUser();
  if (elements.requirementsEditor) {
    elements.requirementsEditor.hidden = !isEditorOpen;
  }
  if (elements.requirementsOpenEditor) {
    elements.requirementsOpenEditor.hidden = isEditorOpen;
    elements.requirementsOpenEditor.disabled = controlsDisabled;
  }
  if (elements.requirementsName) {
    elements.requirementsName.disabled = controlsDisabled;
  }
  if (elements.requirementsDefinition) {
    elements.requirementsDefinition.disabled = controlsDisabled;
  }
  if (elements.requirementsAddClause) {
    elements.requirementsAddClause.disabled = controlsDisabled;
  }
  if (elements.requirementsSave) {
    elements.requirementsSave.disabled = controlsDisabled;
    elements.requirementsSave.textContent = isEditing ? "Update Requirement" : "Create Requirement";
  }
  if (elements.requirementsCancel) {
    elements.requirementsCancel.disabled = controlsDisabled;
  }
  if (elements.requirementsDelete) {
    elements.requirementsDelete.hidden = !isEditing;
    elements.requirementsDelete.disabled = controlsDisabled || !isEditing;
  }

  elements.requirementsList.innerHTML = "";
  if (!isAuthenticated()) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "Sign in to load requirement definitions.";
    elements.requirementsList.append(empty);
    return;
  }
  if (state.api.isLoadingRequirementDefinitions) {
    const loading = runtimeDocument.createElement("p");
    loading.className = "meta";
    loading.textContent = "Loading requirement definitions...";
    elements.requirementsList.append(loading);
    return;
  }

  const requirements = Array.isArray(state.api.requirementDefinitions) ? state.api.requirementDefinitions : [];
  if (requirements.length < 1) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "No requirement definitions yet.";
    elements.requirementsList.append(empty);
    return;
  }

  for (const requirement of requirements) {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card";

    const title = runtimeDocument.createElement("strong");
    title.textContent = requirement.name;

    const definition = runtimeDocument.createElement("p");
    definition.className = "meta";
    definition.textContent = requirement.definition || "No definition provided.";

    const ruleCount = runtimeDocument.createElement("p");
    ruleCount.className = "meta";
    ruleCount.textContent = `${requirement.rules.length} rule clause${requirement.rules.length === 1 ? "" : "s"}.`;

    card.append(title, definition, ruleCount);
    if (isAdminUser()) {
      const edit = runtimeDocument.createElement("button");
      edit.type = "button";
      edit.className = "ghost requirement-inline-button";
      edit.textContent = "Edit";
      edit.disabled = state.api.isSavingRequirementDefinition;
      edit.addEventListener("click", () => {
        setRequirementDefinitionDraft(requirement);
        state.api.isRequirementDefinitionEditorOpen = true;
        setRequirementsFeedback(`Editing '${requirement.name}'.`);
        renderRequirementDefinitionsWorkspace();
      });
      const actionRow = runtimeDocument.createElement("div");
      actionRow.className = "button-row requirement-inline-actions";
      actionRow.append(edit);
      card.append(actionRow);
    }
    elements.requirementsList.append(card);
  }
}

function renderCompositionBundlesWorkspace() {
  if (!elements.compositionsList) {
    return;
  }

  syncCompositionBundleInputsFromState();
  renderCompositionRequirementOptions();

  const isEditing = Boolean(normalizeApiEntityId(state.api.selectedCompositionBundleId));
  const controlsDisabled = state.api.isSavingCompositionBundle || !isAdminUser();
  if (elements.compositionsName) {
    elements.compositionsName.disabled = controlsDisabled;
  }
  if (elements.compositionsDescription) {
    elements.compositionsDescription.disabled = controlsDisabled;
  }
  if (elements.compositionsIsActive) {
    elements.compositionsIsActive.disabled = controlsDisabled;
  }
  if (elements.compositionsSave) {
    elements.compositionsSave.disabled = controlsDisabled;
    elements.compositionsSave.textContent = isEditing ? "Update Composition" : "Create Composition";
  }
  if (elements.compositionsCancel) {
    elements.compositionsCancel.disabled = controlsDisabled;
  }
  if (elements.compositionsDelete) {
    elements.compositionsDelete.hidden = !isEditing;
    elements.compositionsDelete.disabled = controlsDisabled || !isEditing;
  }

  const compositions = Array.isArray(state.api.compositionBundles) ? state.api.compositionBundles : [];
  const activeComposition = compositions.find((composition) => composition.is_active) ?? null;
  if (elements.compositionsSummary) {
    elements.compositionsSummary.textContent = activeComposition
      ? `Active composition: ${activeComposition.name}`
      : "No active composition selected.";
  }

  elements.compositionsList.innerHTML = "";
  if (!isAuthenticated()) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "Sign in to load compositions.";
    elements.compositionsList.append(empty);
    return;
  }
  if (state.api.isLoadingCompositionBundles) {
    const loading = runtimeDocument.createElement("p");
    loading.className = "meta";
    loading.textContent = "Loading compositions...";
    elements.compositionsList.append(loading);
    return;
  }
  if (compositions.length < 1) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "No compositions yet.";
    elements.compositionsList.append(empty);
    return;
  }

  const requirementById = new Map(
    (Array.isArray(state.api.requirementDefinitions) ? state.api.requirementDefinitions : []).map((requirement) => [
      requirement.id,
      requirement
    ])
  );
  for (const composition of compositions) {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card";

    const title = runtimeDocument.createElement("strong");
    title.textContent = composition.name;

    const description = runtimeDocument.createElement("p");
    description.className = "meta";
    description.textContent = composition.description || "No description provided.";

    const includedRequirementNames = composition.requirement_ids
      .map((requirementId) => requirementById.get(requirementId)?.name ?? `Requirement ${requirementId}`)
      .join(", ");
    const included = runtimeDocument.createElement("p");
    included.className = "meta";
    included.textContent = includedRequirementNames
      ? `Includes: ${includedRequirementNames}`
      : "Includes: none";

    const activeLabel = runtimeDocument.createElement("p");
    activeLabel.className = "meta";
    activeLabel.textContent = composition.is_active ? "Active composition" : "Inactive composition";

    card.append(title, description, included, activeLabel);
    if (isAdminUser()) {
      const edit = runtimeDocument.createElement("button");
      edit.type = "button";
      edit.className = "ghost requirement-inline-button";
      edit.textContent = "Edit";
      edit.disabled = state.api.isSavingCompositionBundle;
      edit.addEventListener("click", () => {
        setCompositionBundleDraft(composition);
        setCompositionsFeedback(`Editing '${composition.name}'.`);
        renderCompositionBundlesWorkspace();
      });
      const actionRow = runtimeDocument.createElement("div");
      actionRow.className = "button-row requirement-inline-actions";
      actionRow.append(edit);
      card.append(actionRow);
    }
    elements.compositionsList.append(card);
  }
}

function renderCompositionsWorkspace() {
  renderRequirementDefinitionsWorkspace();
  renderCompositionBundlesWorkspace();
}

async function loadRequirementDefinitionsFromApi() {
  if (!isAuthenticated()) {
    state.api.requirementDefinitions = [];
    setRequirementDefinitionDraft(null);
    renderCompositionsWorkspace();
    return false;
  }

  state.api.isLoadingRequirementDefinitions = true;
  renderCompositionsWorkspace();
  try {
    const payload = await apiRequest("/requirements", { auth: true });
    const requirements = Array.isArray(payload?.requirements)
      ? payload.requirements.map(normalizeRequirementDefinition).filter(Boolean)
      : [];
    state.api.requirementDefinitions = requirements;
    const selectedId = normalizeApiEntityId(state.api.selectedRequirementDefinitionId);
    const selected =
      requirements.find((requirement) => requirement.id === selectedId) ??
      (requirements.length === 1 && !selectedId ? requirements[0] : null);
    if (selected) {
      setRequirementDefinitionDraft(selected);
    }
    setRequirementsFeedback("");
    return true;
  } catch (error) {
    state.api.requirementDefinitions = [];
    setRequirementDefinitionDraft(null);
    setRequirementsFeedback(normalizeApiErrorMessage(error, "Failed to load requirement definitions."));
    return false;
  } finally {
    state.api.isLoadingRequirementDefinitions = false;
    renderCompositionsWorkspace();
  }
}

async function loadCompositionBundlesFromApi() {
  if (!isAuthenticated()) {
    state.api.compositionBundles = [];
    setCompositionBundleDraft(null);
    renderCompositionsWorkspace();
    return false;
  }

  state.api.isLoadingCompositionBundles = true;
  renderCompositionsWorkspace();
  try {
    const payload = await apiRequest("/compositions", { auth: true });
    const compositions = Array.isArray(payload?.compositions)
      ? payload.compositions.map(normalizeCompositionBundle).filter(Boolean)
      : [];
    state.api.compositionBundles = compositions;
    state.builder.activeCompositionId = resolveBuilderActiveCompositionId(state.builder.activeCompositionId);
    const selectedId = normalizeApiEntityId(state.api.selectedCompositionBundleId);
    const activeId = normalizeApiEntityId(payload?.active_composition_id);
    const selected =
      compositions.find((composition) => composition.id === selectedId) ??
      compositions.find((composition) => composition.id === activeId) ??
      null;
    setCompositionBundleDraft(selected);
    setCompositionsFeedback("");
    return true;
  } catch (error) {
    state.api.compositionBundles = [];
    setCompositionBundleDraft(null);
    setCompositionsFeedback(normalizeApiErrorMessage(error, "Failed to load compositions."));
    return false;
  } finally {
    state.api.isLoadingCompositionBundles = false;
    renderCompositionsWorkspace();
  }
}

async function hydrateCompositionsWorkspaceFromApi() {
  await loadRequirementDefinitionsFromApi();
  await loadCompositionBundlesFromApi();
}

async function saveRequirementDefinitionFromWorkspace() {
  if (!isAuthenticated() || !isAdminUser() || state.api.isSavingRequirementDefinition) {
    return;
  }

  const name = String(state.api.requirementDefinitionDraft.name ?? "").trim();
  if (!name) {
    setRequirementsFeedback("Requirement name is required.");
    return;
  }

  const selectedRequirement = getSelectedRequirementDefinition();
  const isEditing = Boolean(selectedRequirement);
  let parsedRules;
  try {
    parsedRules = parseRequirementRulesFromDraftClauses();
  } catch (error) {
    setRequirementsFeedback(error instanceof Error ? error.message : "Rules are invalid.");
    return;
  }

  const payload = {
    name,
    definition: String(state.api.requirementDefinitionDraft.definition ?? "").trim(),
    rules: parsedRules
  };

  state.api.isSavingRequirementDefinition = true;
  setRequirementsFeedback(isEditing ? "Saving requirement..." : "Creating requirement...");
  renderCompositionsWorkspace();
  try {
    const response = await apiRequest(
      isEditing ? `/requirements/${selectedRequirement.id}` : "/requirements",
      {
        method: isEditing ? "PUT" : "POST",
        auth: true,
        body: payload
      }
    );
    const saved = normalizeRequirementDefinition(response?.requirement);
    await hydrateCompositionsWorkspaceFromApi();
    if (saved) {
      setRequirementDefinitionDraft(null);
      state.api.isRequirementDefinitionEditorOpen = false;
    }
    setRequirementsFeedback(isEditing ? "Requirement updated." : "Requirement created.");
  } catch (error) {
    setRequirementsFeedback(normalizeApiErrorMessage(error, "Failed to save requirement."));
  } finally {
    state.api.isSavingRequirementDefinition = false;
    renderCompositionsWorkspace();
  }
}

async function deleteRequirementDefinitionFromWorkspace() {
  if (!isAuthenticated() || !isAdminUser() || state.api.isSavingRequirementDefinition) {
    return;
  }
  const selectedRequirement = getSelectedRequirementDefinition();
  if (!selectedRequirement) {
    setRequirementsFeedback("Select a requirement first.");
    return;
  }

  state.api.isSavingRequirementDefinition = true;
  setRequirementsFeedback("Deleting requirement...");
  renderCompositionsWorkspace();
  try {
    await apiRequest(`/requirements/${selectedRequirement.id}`, {
      method: "DELETE",
      auth: true
    });
    setRequirementDefinitionDraft(null);
    state.api.isRequirementDefinitionEditorOpen = false;
    await hydrateCompositionsWorkspaceFromApi();
    setRequirementsFeedback("Requirement deleted.");
  } catch (error) {
    setRequirementsFeedback(normalizeApiErrorMessage(error, "Failed to delete requirement."));
  } finally {
    state.api.isSavingRequirementDefinition = false;
    renderCompositionsWorkspace();
  }
}

async function saveCompositionBundleFromWorkspace() {
  if (!isAuthenticated() || !isAdminUser() || state.api.isSavingCompositionBundle) {
    return;
  }

  const name = String(state.api.compositionBundleDraft.name ?? "").trim();
  if (!name) {
    setCompositionsFeedback("Composition name is required.");
    return;
  }

  const selectedComposition = getSelectedCompositionBundle();
  const isEditing = Boolean(selectedComposition);
  const payload = {
    name,
    description: String(state.api.compositionBundleDraft.description ?? "").trim(),
    requirement_ids: normalizeApiTagIdArray(state.api.compositionBundleDraft.requirementIds),
    is_active: state.api.compositionBundleDraft.isActive === true
  };

  state.api.isSavingCompositionBundle = true;
  setCompositionsFeedback(isEditing ? "Saving composition..." : "Creating composition...");
  renderCompositionsWorkspace();
  try {
    const response = await apiRequest(
      isEditing ? `/compositions/${selectedComposition.id}` : "/compositions",
      {
        method: isEditing ? "PUT" : "POST",
        auth: true,
        body: payload
      }
    );
    const saved = normalizeCompositionBundle(response?.composition);
    await loadCompositionBundlesFromApi();
    if (saved) {
      setCompositionBundleDraft(saved);
    }
    setCompositionsFeedback(isEditing ? "Composition updated." : "Composition created.");
  } catch (error) {
    setCompositionsFeedback(normalizeApiErrorMessage(error, "Failed to save composition."));
  } finally {
    state.api.isSavingCompositionBundle = false;
    renderCompositionsWorkspace();
  }
}

async function deleteCompositionBundleFromWorkspace() {
  if (!isAuthenticated() || !isAdminUser() || state.api.isSavingCompositionBundle) {
    return;
  }
  const selectedComposition = getSelectedCompositionBundle();
  if (!selectedComposition) {
    setCompositionsFeedback("Select a composition first.");
    return;
  }

  state.api.isSavingCompositionBundle = true;
  setCompositionsFeedback("Deleting composition...");
  renderCompositionsWorkspace();
  try {
    await apiRequest(`/compositions/${selectedComposition.id}`, {
      method: "DELETE",
      auth: true
    });
    setCompositionBundleDraft(null);
    await loadCompositionBundlesFromApi();
    setCompositionsFeedback("Composition deleted.");
  } catch (error) {
    setCompositionsFeedback(normalizeApiErrorMessage(error, "Failed to delete composition."));
  } finally {
    state.api.isSavingCompositionBundle = false;
    renderCompositionsWorkspace();
  }
}

function normalizeApiTagIdArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  const normalized = values
    .map((value) => normalizeApiEntityId(value))
    .filter((value) => value !== null);
  return Array.from(new Set(normalized)).sort((left, right) => left - right);
}

function normalizeTagNameForMatching(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function renderChampionTagEditorTagOptions() {
  if (!elements.cedTagsAvailable || !elements.cedTagsSelected) {
    return;
  }

  elements.cedTagsAvailable.innerHTML = "";
  elements.cedTagsSelected.innerHTML = "";

  const selectedTagIds = normalizeApiTagIdArray(state.api.selectedChampionTagIds);
  const selectedTagIdSet = new Set(selectedTagIds);
  const allTags = Array.isArray(state.api.tags)
    ? state.api.tags
        .map((tag) => {
          const tagId = normalizeApiEntityId(tag?.id);
          if (tagId === null) return null;
          return { ...tag, id: tagId };
        })
        .filter(Boolean)
    : [];
  const allTagsById = new Map(allTags.map((tag) => [tag.id, tag]));
  const tags = [...allTags];
  const renderedTagIds = new Set(tags.map((tag) => tag.id));

  for (const selectedTagId of selectedTagIds) {
    if (renderedTagIds.has(selectedTagId)) continue;
    const assignedTag = allTagsById.get(selectedTagId);
    tags.push(assignedTag ?? { id: selectedTagId, name: `Tag ${selectedTagId}`, definition: "" });
    renderedTagIds.add(selectedTagId);
  }

  tags.sort((left, right) => String(left.name ?? "").localeCompare(String(right.name ?? "")));

  const availableFilter = (elements.cedTagsAvailableFilter?.value ?? "").toLowerCase().trim();
  const selectedFilter = (elements.cedTagsSelectedFilter?.value ?? "").toLowerCase().trim();
  const disabled = state.api.isSavingChampionTags || state.api.isLoadingChampionTags;

  const makePill = (tag, isSelected) => {
    const pill = runtimeDocument.createElement("button");
    pill.type = "button";
    pill.className = isSelected ? "ced-tag-pill ced-tag-pill--selected" : "ced-tag-pill";
    pill.textContent = tag.name;
    const definitionText = typeof tag.definition === "string" ? tag.definition.trim() : "";
    if (definitionText) {
      pill.title = definitionText;
    }
    pill.disabled = disabled;
    pill.addEventListener("click", () => {
      const next = new Set(state.api.selectedChampionTagIds);
      if (isSelected) {
        next.delete(tag.id);
      } else {
        next.add(tag.id);
      }
      state.api.selectedChampionTagIds = [...next].sort((a, b) => a - b);
      renderChampionTagEditorTagOptions();
    });
    return pill;
  };

  for (const tag of tags) {
    const isSelected = selectedTagIdSet.has(tag.id);
    const tagName = String(tag.name ?? "").toLowerCase();
    if (isSelected) {
      if (selectedFilter && !tagName.includes(selectedFilter)) continue;
      elements.cedTagsSelected.append(makePill(tag, true));
    } else {
      if (availableFilter && !tagName.includes(availableFilter)) continue;
      elements.cedTagsAvailable.append(makePill(tag, false));
    }
  }

  if (elements.cedTagsAvailable.childElementCount === 0) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = availableFilter ? "No matching tags." : "No available tags.";
    elements.cedTagsAvailable.append(empty);
  }
  if (elements.cedTagsSelected.childElementCount === 0) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = selectedFilter ? "No matching tags." : "No tags selected.";
    elements.cedTagsSelected.append(empty);
  }
}

function renderChampionEditorTabs() {
  // Legacy no-op: editor tabs were replaced by a unified metadata surface.
}

function renderChampionMetadataRoleOptions() {
  if (!elements.championMetadataEditorRoles) {
    return;
  }
  elements.championMetadataEditorRoles.innerHTML = "";
  const selected = new Set(state.api.championMetadataDraft.roles);

  for (const role of SLOTS) {
    const btn = runtimeDocument.createElement("button");
    btn.type = "button";
    btn.className = selected.has(role) ? "role-pill is-active" : "role-pill";
    btn.textContent = role;
    btn.disabled = state.api.isSavingChampionTags;
    btn.addEventListener("click", () => {
      const next = new Set(state.api.championMetadataDraft.roles);
      if (next.has(role)) {
        next.delete(role);
      } else {
        next.add(role);
      }
      state.api.championMetadataDraft.roles = normalizeChampionMetadataRoles([...next]);
      ensureChampionMetadataRoleProfiles();
      renderChampionTagEditor();
    });
    elements.championMetadataEditorRoles.append(btn);
  }
}

function renderChampionMetadataRoleProfileEditors() {
  if (elements.cedDamageSlot) elements.cedDamageSlot.innerHTML = "";
  if (elements.cedEffectivenessSlot) elements.cedEffectivenessSlot.innerHTML = "";
  if (elements.cedShareToggleSlot) elements.cedShareToggleSlot.innerHTML = "";
  if (!elements.championMetadataRoleProfiles) return;
  elements.championMetadataRoleProfiles.innerHTML = "";

  const selectedRoles = normalizeChampionMetadataRoles(state.api.championMetadataDraft.roles);
  if (selectedRoles.length === 0) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "Select at least one role to configure damage type and effectiveness.";
    if (elements.cedDamageSlot) elements.cedDamageSlot.append(empty);
    return;
  }

  const effLevelValues = ["weak", "neutral", "strong"];

  const validActiveRole = selectedRoles.includes(state.api.championProfileActiveRole)
    ? state.api.championProfileActiveRole
    : selectedRoles[0];
  state.api.championProfileActiveRole = validActiveRole;

  const useSharedRoleProfile = state.api.championMetadataDraft.useSharedRoleProfile === true && selectedRoles.length > 1;

  // "Apply tags to all selected Roles?" toggle — shown in roles section when multiple roles
  if (selectedRoles.length > 1 && elements.cedShareToggleSlot) {
    const shareToggleLabel = runtimeDocument.createElement("label");
    shareToggleLabel.className = "inline-checkbox champion-role-profile-sync-toggle";
    const shareToggle = runtimeDocument.createElement("input");
    shareToggle.id = "champion-metadata-share-role-profile";
    shareToggle.type = "checkbox";
    shareToggle.checked = useSharedRoleProfile;
    shareToggle.disabled = state.api.isSavingChampionTags;
    shareToggle.addEventListener("change", () => {
      state.api.championMetadataDraft.useSharedRoleProfile = shareToggle.checked;
      ensureChampionMetadataRoleProfiles();
      renderChampionTagEditor();
    });
    const shareToggleText = runtimeDocument.createElement("span");
    shareToggleText.textContent = "Apply tags to all selected Roles?";
    shareToggleLabel.append(shareToggle, shareToggleText);
    elements.cedShareToggleSlot.append(shareToggleLabel);
  }

  // "UPDATE ROLE PROFILE:" tab selector — bottom-left of meta container when multiple roles and not shared
  if (selectedRoles.length > 1 && !useSharedRoleProfile) {
    const tabRow = runtimeDocument.createElement("div");
    tabRow.className = "ced-role-tab-row";
    const tabLabel = runtimeDocument.createElement("span");
    tabLabel.className = "ced-role-tab-label";
    tabLabel.textContent = "UPDATE ROLE PROFILE:";
    tabRow.append(tabLabel);
    for (const role of selectedRoles) {
      const tab = runtimeDocument.createElement("button");
      tab.type = "button";
      tab.className = `ced-role-tab${role === validActiveRole ? " is-active" : ""}`;
      tab.textContent = role;
      tab.disabled = state.api.isSavingChampionTags;
      tab.addEventListener("click", () => {
        state.api.championProfileActiveRole = role;
        renderChampionTagEditor();
      });
      tabRow.append(tab);
    }
    elements.championMetadataRoleProfiles.append(tabRow);
  }

  // Resolve which profile to show
  const anchorRole = useSharedRoleProfile ? selectedRoles[0] : validActiveRole;
  const profile = state.api.championMetadataDraft.roleProfiles?.[anchorRole] ?? createDefaultRoleProfileDraft();

  // Damage type callbacks
  const onDamageChange = useSharedRoleProfile
    ? (nextDamageType) => {
        const normalizedDamageType = normalizeApiPrimaryDamageType(nextDamageType) ?? "mixed";
        for (const role of selectedRoles) {
          const roleProfile = state.api.championMetadataDraft.roleProfiles?.[role] ?? createDefaultRoleProfileDraft();
          state.api.championMetadataDraft.roleProfiles[role] = { ...roleProfile, primaryDamageType: normalizedDamageType };
        }
        renderChampionTagEditor();
      }
    : (nextDamageType) => {
        state.api.championMetadataDraft.roleProfiles[validActiveRole] = {
          ...state.api.championMetadataDraft.roleProfiles[validActiveRole],
          primaryDamageType: normalizeApiPrimaryDamageType(nextDamageType) ?? "mixed"
        };
        renderChampionTagEditor();
      };

  // Effectiveness callbacks
  const onEffectivenessChange = useSharedRoleProfile
    ? (phase, nextLevel) => {
        const normalizedLevel = normalizeApiEffectivenessLevel(nextLevel) ?? "neutral";
        for (const role of selectedRoles) {
          const roleProfile = state.api.championMetadataDraft.roleProfiles?.[role] ?? createDefaultRoleProfileDraft();
          state.api.championMetadataDraft.roleProfiles[role] = {
            ...roleProfile,
            effectiveness: { ...(roleProfile.effectiveness ?? {}), [phase]: normalizedLevel }
          };
        }
        renderChampionTagEditor();
      }
    : (phase, nextLevel) => {
        const roleProfile = state.api.championMetadataDraft.roleProfiles[validActiveRole] ?? createDefaultRoleProfileDraft();
        state.api.championMetadataDraft.roleProfiles[validActiveRole] = {
          ...roleProfile,
          effectiveness: {
            ...(roleProfile.effectiveness ?? {}),
            [phase]: normalizeApiEffectivenessLevel(nextLevel) ?? "neutral"
          }
        };
        renderChampionTagEditor();
      };

  // Render damage type into its slot
  if (elements.cedDamageSlot) {
    const damageSectionLabel = runtimeDocument.createElement("p");
    damageSectionLabel.className = "ced-section-label";
    damageSectionLabel.textContent = "Damage Type";
    const damageButtons = runtimeDocument.createElement("div");
    damageButtons.className = "ced-damage-buttons";
    const currentDamage = normalizeApiPrimaryDamageType(profile.primaryDamageType) ?? "mixed";
    for (const opt of PRIMARY_DAMAGE_TYPE_OPTIONS) {
      const btn = runtimeDocument.createElement("button");
      btn.type = "button";
      btn.className = `ced-damage-btn ced-damage-btn--${opt.value}${currentDamage === opt.value ? " is-active" : ""}`;
      btn.textContent = opt.label;
      btn.disabled = state.api.isSavingChampionTags;
      btn.addEventListener("click", () => onDamageChange(opt.value));
      damageButtons.append(btn);
    }
    elements.cedDamageSlot.append(damageSectionLabel, damageButtons);
  }

  // Render effectiveness into its slot
  if (elements.cedEffectivenessSlot) {
    const effSectionLabel = runtimeDocument.createElement("p");
    effSectionLabel.className = "ced-section-label";
    effSectionLabel.textContent = "Effectiveness";
    const effGrid = runtimeDocument.createElement("div");
    effGrid.className = "ced-effectiveness-grid";
    for (const phase of EFFECTIVENESS_PHASES) {
      const phaseDiv = runtimeDocument.createElement("div");
      phaseDiv.className = "ced-effectiveness-phase";
      const phaseLabel = runtimeDocument.createElement("p");
      phaseLabel.className = "ced-phase-label";
      phaseLabel.textContent = `${phase[0].toUpperCase()}${phase.slice(1)}`;
      const currentLevel = normalizeApiEffectivenessLevel(profile.effectiveness?.[phase]) ?? "neutral";
      const pillRow = runtimeDocument.createElement("div");
      pillRow.className = "ced-eff-pill-row";
      for (const lvl of effLevelValues) {
        const btn = runtimeDocument.createElement("button");
        btn.type = "button";
        btn.className = `ced-eff-pill ced-eff-pill--${lvl}${currentLevel === lvl ? " is-active" : ""}`;
        btn.textContent = lvl[0].toUpperCase() + lvl.slice(1);
        btn.disabled = state.api.isSavingChampionTags;
        btn.addEventListener("click", () => onEffectivenessChange(phase, lvl));
        pillRow.append(btn);
      }
      phaseDiv.append(phaseLabel, pillRow);
      effGrid.append(phaseDiv);
    }
    elements.cedEffectivenessSlot.append(effSectionLabel, effGrid);
  }
}

function championMetadataDraftIsComplete() {
  const selectedRoles = normalizeChampionMetadataRoles(state.api.championMetadataDraft.roles);
  if (selectedRoles.length === 0) {
    return false;
  }
  for (const role of selectedRoles) {
    const roleProfile = state.api.championMetadataDraft.roleProfiles?.[role];
    if (!roleProfile || typeof roleProfile !== "object" || Array.isArray(roleProfile)) {
      return false;
    }
    if (!normalizeApiPrimaryDamageType(roleProfile.primaryDamageType)) {
      return false;
    }
    for (const phase of EFFECTIVENESS_PHASES) {
      if (!normalizeApiEffectivenessLevel(roleProfile.effectiveness?.[phase])) {
        return false;
      }
    }
  }
  return true;
}

function renderChampionMetadataEditors() {
  ensureChampionMetadataRoleProfiles();
  renderChampionMetadataRoleOptions();
  renderChampionMetadataRoleProfileEditors();
}

function renderChampionTagEditor() {
  if (!elements.championTagEditor) {
    return;
  }

  const championId = state.api.selectedChampionTagEditorId;
  const champion = Number.isInteger(championId) ? getChampionById(championId) : null;
  const canEditGlobal = isGlobalTagEditorUser();
  const leadTeamOptions = getChampionTagLeadTeamOptions();
  const canEditTeam = leadTeamOptions.length > 0;
  const canRenderEditor = Boolean(champion && isAuthenticated() && (canEditGlobal || canEditTeam));
  if (!canRenderEditor) {
    return;
  }

  state.api.championTagScope = normalizeChampionTagScope(state.api.championTagScope);
  const scopeOptions = [];
  if (canEditGlobal) {
    scopeOptions.push({ value: "all", label: "Global" });
  }
  if (canEditTeam) {
    scopeOptions.push({ value: "team", label: "Team" });
  }
  if (scopeOptions.length === 0) {
    return;
  }

  if (!scopeOptions.some((option) => option.value === state.api.championTagScope)) {
    state.api.championTagScope = scopeOptions[0].value;
  }

  if (elements.championTagEditorTitle) {
    elements.championTagEditorTitle.textContent = `Edit ${champion.name} Profile`;
  }
  if (elements.cedChampImage) {
    elements.cedChampImage.src = getChampionImageUrl(champion.name);
    elements.cedChampImage.alt = champion.name;
  }
  if (elements.cedChampRoles) {
    const roles = normalizeChampionMetadataRoles(state.api.championMetadataDraft?.roles ?? []);
    elements.cedChampRoles.textContent = roles.length > 0 ? roles.join(" / ") : "";
  }

  if (elements.championTagEditorScope) {
    replaceOptions(elements.championTagEditorScope, scopeOptions);
    elements.championTagEditorScope.value = state.api.championTagScope;
    elements.championTagEditorScope.disabled = scopeOptions.length <= 1;
  }

  if (state.api.championTagScope === "team") {
    if (!leadTeamOptions.some((option) => option.value === state.api.championTagTeamId)) {
      state.api.championTagTeamId = leadTeamOptions[0]?.value ?? "";
    }
  } else {
    state.api.championTagTeamId = "";
  }

  if (elements.championTagEditorTeamGroup) {
    elements.championTagEditorTeamGroup.hidden = state.api.championTagScope !== "team";
  }

  if (elements.championTagEditorTeam) {
    replaceOptions(elements.championTagEditorTeam, leadTeamOptions);
    if (state.api.championTagTeamId) {
      elements.championTagEditorTeam.value = state.api.championTagTeamId;
    }
    elements.championTagEditorTeam.disabled = state.api.championTagScope !== "team" || leadTeamOptions.length === 0;
  }

  renderChampionEditorTabs();
  renderChampionTagEditorTagOptions();
  renderChampionMetadataEditors();
  if (elements.championTagEditorReviewed) {
    elements.championTagEditorReviewed.checked = state.api.championReviewedDraft === true;
    elements.championTagEditorReviewed.disabled = state.api.isSavingChampionTags || state.api.isLoadingChampionTags;
  }

  const metadataDraftComplete = championMetadataDraftIsComplete();

  if (elements.championTagEditorSave) {
    elements.championTagEditorSave.textContent = canEditGlobal ? "Save Tags + Metadata" : "Save Tags";
    const compositionSaveBlocked = state.api.isLoadingChampionTags;
    elements.championTagEditorSave.disabled =
      state.api.isSavingChampionTags ||
      compositionSaveBlocked ||
      (canEditGlobal && !metadataDraftComplete);
  }
  if (elements.championTagEditorClear) {
    elements.championTagEditorClear.disabled = state.api.isSavingChampionTags;
  }
}

async function loadChampionScopedTags(championId) {
  if (!isAuthenticated() || !Number.isInteger(championId) || championId <= 0) {
    return false;
  }

  const scope = normalizeChampionTagScope(state.api.championTagScope);
  const query = new URLSearchParams({ scope });
  if (scope === "team") {
    const teamId = normalizeTeamEntityId(state.api.championTagTeamId);
    if (!teamId) {
      setChampionTagEditorFeedback("Select a team to load team tags.");
      return false;
    }
    query.set("team_id", teamId);
  }

  state.api.isLoadingChampionTags = true;
  renderChampionTagEditor();

  try {
    const payload = await apiRequest(`/champions/${championId}/tags?${query.toString()}`, { auth: true });
    const payloadTagIds = payload?.tag_ids ?? payload?.tagIds;
    if (payloadTagIds !== undefined) {
      const scopedTagIds = normalizeApiTagIdArray(payloadTagIds);
      state.api.selectedChampionTagIds = scopedTagIds;
      if (payload?.reviewed !== undefined) {
        state.api.championReviewedDraft = payload.reviewed === true;
      }
      setChampionTagEditorFeedback("");
    } else {
      setChampionTagEditorFeedback("");
    }
    if (payload?.team_id !== undefined && payload?.team_id !== null) {
      state.api.championTagTeamId = String(payload.team_id);
    }
    return true;
  } catch (error) {
    setChampionTagEditorFeedback(normalizeApiErrorMessage(error, "Failed to load champion tags."));
    return false;
  } finally {
    state.api.isLoadingChampionTags = false;
  }
}

async function openChampionTagEditor(championId) {
  const canEditGlobal = isGlobalTagEditorUser();
  const leadTeamOptions = getChampionTagLeadTeamOptions();
  const canEditTeam = leadTeamOptions.length > 0;
  if (!isAuthenticated() || (!canEditGlobal && !canEditTeam) || !Number.isInteger(championId) || championId <= 0) {
    return;
  }

  const champion = getChampionById(championId);
  state.api.selectedChampionTagEditorId = championId;
  const scopedTagIds = normalizeChampionTagIdArray(champion?.tagIds);
  state.api.selectedChampionTagIds = scopedTagIds;
  state.api.championTagScope = isGlobalTagEditorUser() ? "all" : "team";
  if (state.api.championTagScope === "team") {
    const selectedTeam = getSelectedAdminTeam();
    const hasSelectedLeadTeam = selectedTeam?.membership_role === "lead" ? String(selectedTeam.id) : "";
    const firstLeadTeamValue = leadTeamOptions[0]?.value ?? "";
    state.api.championTagTeamId = hasSelectedLeadTeam || firstLeadTeamValue;
  } else {
    state.api.championTagTeamId = "";
  }
  initializeChampionMetadataDraft(champion);
  setChampionTagEditorFeedback("Loading champion tags...");

  if (elements.championGridPanel) elements.championGridPanel.hidden = true;
  if (elements.championTagEditor) elements.championTagEditor.hidden = false;

  renderChampionTagEditor();
  await loadChampionScopedTags(championId);
  state.api.championEditorSavedSnapshot = getChampionEditorSnapshot();
  renderChampionTagEditor();
}

function closeChampionTagEditor() {
  if (elements.championTagEditor) elements.championTagEditor.hidden = true;
  if (elements.championGridPanel) elements.championGridPanel.hidden = false;
  if (state.data) renderExplorer();
}

let _navWarningPendingAction = null;

function showNavWarning(onLeave) {
  _navWarningPendingAction = onLeave;
  let toast = runtimeDocument.getElementById("nav-warning-toast");
  if (!toast) {
    toast = runtimeDocument.createElement("div");
    toast.id = "nav-warning-toast";
    toast.className = "nav-warning-toast";

    const box = runtimeDocument.createElement("div");
    box.className = "nav-warning-box";

    const title = runtimeDocument.createElement("p");
    title.className = "nav-warning-title";
    title.textContent = "Unsaved Changes";

    const body = runtimeDocument.createElement("p");
    body.className = "nav-warning-body";
    body.textContent = "The Champion editor has unsaved changes. Leaving now will discard them.";

    const btnRow = runtimeDocument.createElement("div");
    btnRow.className = "button-row";

    const leaveBtn = runtimeDocument.createElement("button");
    leaveBtn.type = "button";
    leaveBtn.id = "nav-warning-leave";
    leaveBtn.textContent = "Leave Anyway";

    const stayBtn = runtimeDocument.createElement("button");
    stayBtn.type = "button";
    stayBtn.className = "ghost";
    stayBtn.id = "nav-warning-stay";
    stayBtn.textContent = "Stay";

    leaveBtn.addEventListener("click", () => {
      const action = _navWarningPendingAction;
      hideNavWarning();
      if (action) action();
    });
    stayBtn.addEventListener("click", hideNavWarning);
    toast.addEventListener("click", (e) => { if (e.target === toast) hideNavWarning(); });

    btnRow.append(leaveBtn, stayBtn);
    box.append(title, body, btnRow);
    toast.append(box);
    runtimeDocument.body.append(toast);
  }
  toast.hidden = false;
}

function hideNavWarning() {
  _navWarningPendingAction = null;
  const toast = runtimeDocument.getElementById("nav-warning-toast");
  if (toast) toast.hidden = true;
}

function setChampionEditorTab(tab) {
  state.api.championEditorTab = normalizeChampionEditorTab(tab);
  renderChampionTagEditor();
}

async function saveChampionCompositionTab(championId) {
  const scope = normalizeChampionTagScope(state.api.championTagScope);
  const tagIds = [...state.api.selectedChampionTagIds].sort((left, right) => left - right);
  const payload = {
    scope,
    tag_ids: tagIds,
    reviewed: state.api.championReviewedDraft === true
  };
  if (scope === "team") {
    const teamId = normalizeTeamEntityId(state.api.championTagTeamId);
    if (!teamId) {
      throw new Error("Select a team before saving team-scoped tags.");
    }
    payload.team_id = Number.parseInt(teamId, 10);
  }

  const response = await apiRequest(`/champions/${championId}/tags`, {
    method: "PUT",
    auth: true,
    body: payload
  });
  state.api.selectedChampionTagIds = normalizeApiTagIdArray(response?.tag_ids);
  const champion = getChampionById(championId);
  if (champion) {
    champion.tagIds = [...state.api.selectedChampionTagIds];
    champion.tags = deriveApiTagsFromTagIds(champion.tagIds);
    champion.reviewed = response?.reviewed === true;
  }
}

async function saveChampionMetadataTab(championId) {
  ensureChampionMetadataRoleProfiles();
  const roleProfilesPayload = {};
  for (const role of state.api.championMetadataDraft.roles) {
    const profile = state.api.championMetadataDraft.roleProfiles?.[role] ?? createDefaultRoleProfileDraft();
    roleProfilesPayload[role] = {
      primary_damage_type: normalizeApiPrimaryDamageType(profile.primaryDamageType) ?? "mixed",
      effectiveness: {
        early: normalizeApiEffectivenessLevel(profile.effectiveness?.early) ?? "neutral",
        mid: normalizeApiEffectivenessLevel(profile.effectiveness?.mid) ?? "neutral",
        late: normalizeApiEffectivenessLevel(profile.effectiveness?.late) ?? "neutral"
      }
    };
  }
  const payload = {
    roles: [...state.api.championMetadataDraft.roles],
    role_profiles: roleProfilesPayload
  };

  const response = await apiRequest(`/champions/${championId}/metadata`, {
    method: "PUT",
    auth: true,
    body: payload
  });
  syncChampionMetadataDraftToState(championId, response?.champion);
}

async function saveChampionTagEditor() {
  const championId = state.api.selectedChampionTagEditorId;
  if (
    !isAuthenticated() ||
    !Number.isInteger(championId) ||
    championId <= 0 ||
    state.api.isSavingChampionTags
  ) {
    return;
  }
  if (state.api.isLoadingChampionTags) {
    setChampionTagEditorFeedback("Wait for champion tags to finish loading before saving.");
    renderChampionTagEditor();
    return;
  }
  const canEditGlobal = isGlobalTagEditorUser();

  state.api.isSavingChampionTags = true;
  setChampionTagEditorFeedback("Saving champion tags...");
  renderChampionTagEditor();

  try {
    await saveChampionCompositionTab(championId);
    if (canEditGlobal) {
      setChampionTagEditorFeedback("Saving champion metadata...");
      await saveChampionMetadataTab(championId);
    }
    state.api.championEditorSavedSnapshot = getChampionEditorSnapshot();
    closeChampionTagEditor();
  } catch (error) {
    setChampionTagEditorFeedback(normalizeApiErrorMessage(error, "Failed to save champion updates."));
    state.api.isSavingChampionTags = false;
    renderChampionTagEditor();
  } finally {
    state.api.isSavingChampionTags = false;
  }
}

function buildRolePoolTeamId(role) {
  return `role:${role}`;
}

function parseRolePoolTeamId(teamId) {
  if (typeof teamId !== "string" || !teamId.startsWith("role:")) {
    return null;
  }
  const role = teamId.slice("role:".length);
  return SLOTS.includes(role) ? role : null;
}

function getTeamDisplayLabel(teamId) {
  if (teamId === NONE_TEAM_ID) {
    return "None (global context)";
  }
  const team = findTeamById(teamId);
  if (team) {
    return formatTeamCardTitle(team);
  }
  return state.data.teamLabels?.[teamId] ?? String(teamId);
}

function buildRolePlayerFromChampionNames(role, championNames, familiarityByChampion = {}) {
  const roleEligible = new Set(state.data.noneTeamPools[role] ?? []);
  const uniqueNames = Array.from(new Set(championNames))
    .filter((name) => roleEligible.has(name))
    .sort((left, right) => left.localeCompare(right));
  const normalizedFamiliarity = normalizeFamiliarityByChampion(uniqueNames, familiarityByChampion);
  return [
    {
      id: `${role}::${role} Player`,
      player: `${role} Player`,
      role,
      champions: uniqueNames,
      familiarityByChampion: normalizedFamiliarity
    }
  ];
}

function clearApiPoolState() {
  state.api.pools = [];
  state.api.poolByTeamId = {};
  state.playerConfig.byTeam = {};
  state.playerConfig.teamId = "";
  state.playerConfig.dirtyPoolByTeamId = {};
  state.playerConfig.isSavingPool = false;
  state.data.teamLabels = {};
  syncDerivedTeamDataFromPlayerConfig();
}

function applyApiPoolsToState(pools, preferredTeamId = null) {
  const byTeam = {};
  const teamLabels = {};
  const poolByTeamId = {};
  const configuredRoles = getConfiguredProfileRoles();
  const poolByRole = new Map();

  for (const pool of pools) {
    const role = SLOTS.includes(pool?.name) ? pool.name : null;
    if (!role || !configuredRoles.includes(role) || poolByRole.has(role)) {
      continue;
    }
    poolByRole.set(role, pool);
  }

  for (const role of configuredRoles) {
    const teamId = buildRolePoolTeamId(role);
    const pool = poolByRole.get(role) ?? null;
    const championNames = [];
    const familiarityByChampion = {};
    const poolFamiliarity =
      pool?.champion_familiarity && typeof pool.champion_familiarity === "object"
        ? pool.champion_familiarity
        : {};

    for (const rawChampionId of pool?.champion_ids ?? []) {
      const championId = Number.parseInt(String(rawChampionId), 10);
      if (!Number.isInteger(championId)) {
        continue;
      }
      const championName = state.data.championNamesById[championId];
      if (!championName) {
        continue;
      }
      championNames.push(championName);
      familiarityByChampion[championName] = normalizeFamiliarityLevel(poolFamiliarity[String(championId)]);
    }

    byTeam[teamId] = buildRolePlayerFromChampionNames(role, championNames, familiarityByChampion);
    teamLabels[teamId] = role;
    poolByTeamId[teamId] = pool;
  }

  state.api.pools = pools;
  state.api.poolByTeamId = poolByTeamId;
  state.playerConfig.byTeam = byTeam;
  state.playerConfig.dirtyPoolByTeamId = Object.fromEntries(
    Object.keys(byTeam).map((teamId) => [teamId, false])
  );
  state.playerConfig.isSavingPool = false;
  state.data.teamLabels = teamLabels;
  state.playerConfig.teamId = normalizePlayerConfigTeamId(preferredTeamId ?? state.playerConfig.teamId);
  syncDerivedTeamDataFromPlayerConfig();
  syncConfiguredTeamSelection();
}

function normalizeApiErrorMessage(error, fallbackMessage) {
  if (error instanceof Error && typeof error.message === "string" && error.message.trim() !== "") {
    return error.message;
  }
  return fallbackMessage;
}

async function ensureProfileRolePools(pools) {
  const configuredRoles = getConfiguredProfileRoles();
  let currentPools = Array.isArray(pools) ? pools : [];

  const collectExistingRoles = (sourcePools) =>
    new Set(
      sourcePools
        .map((pool) => (SLOTS.includes(pool?.name) ? pool.name : null))
        .filter((role) => Boolean(role))
    );

  let existingRoles = collectExistingRoles(currentPools);
  const missingRoles = configuredRoles.filter((role) => !existingRoles.has(role));
  let migratedAny = false;

  const legacyPools = currentPools.filter((pool) => {
    const poolName = typeof pool?.name === "string" ? pool.name : "";
    return poolName !== "" && !SLOTS.includes(poolName);
  });

  for (const role of missingRoles) {
    if (legacyPools.length === 0) {
      break;
    }
    const legacyPool = legacyPools.shift();
    const legacyPoolId = Number(legacyPool?.id);
    if (!Number.isInteger(legacyPoolId)) {
      continue;
    }
    try {
      await apiRequest(`/me/pools/${legacyPoolId}`, {
        method: "PUT",
        auth: true,
        body: { name: role }
      });
      existingRoles.add(role);
      migratedAny = true;
    } catch (error) {
      setPoolApiFeedback(normalizeApiErrorMessage(error, `Failed to migrate legacy pool to ${role}.`));
    }
  }

  if (migratedAny) {
    const refreshedAfterMigration = await apiRequest("/me/pools", { auth: true });
    currentPools = Array.isArray(refreshedAfterMigration?.pools) ? refreshedAfterMigration.pools : currentPools;
    existingRoles = collectExistingRoles(currentPools);
  }

  let createdAny = false;
  for (const role of configuredRoles) {
    if (existingRoles.has(role)) {
      continue;
    }
    try {
      await apiRequest("/me/pools", {
        method: "POST",
        auth: true,
        body: { name: role }
      });
      existingRoles.add(role);
      createdAny = true;
    } catch (error) {
      setPoolApiFeedback(normalizeApiErrorMessage(error, `Failed to create ${role} role pool.`));
    }
  }

  if (!createdAny) {
    return currentPools;
  }

  const refreshed = await apiRequest("/me/pools", { auth: true });
  return Array.isArray(refreshed?.pools) ? refreshed.pools : currentPools;
}

async function loadPoolsFromApi(preferredTeamId = null) {
  if (!isAuthenticated()) {
    clearApiPoolState();
    return false;
  }

  try {
    const payload = await apiRequest("/me/pools", { auth: true });
    const loadedPools = Array.isArray(payload?.pools) ? payload.pools : [];
    const pools = await ensureProfileRolePools(loadedPools);
    applyApiPoolsToState(pools, preferredTeamId);
    return true;
  } catch (error) {
    setPoolApiFeedback(normalizeApiErrorMessage(error, "Failed to load pools."));
    return false;
  }
}

async function loadProfileFromApi() {
  if (!isAuthenticated()) {
    state.profile.primaryRole = DEFAULT_PRIMARY_ROLE;
    state.profile.secondaryRoles = [];
    state.profile.championStats = createEmptyChampionStatsState();
    return false;
  }

  try {
    const payload = await apiRequest("/me/profile", { auth: true });
    const profile = payload?.profile ?? {};
    const primaryRole = normalizeProfileRole(profile.primaryRole);
    state.profile.primaryRole = primaryRole;
    state.profile.secondaryRoles = normalizeSecondaryRoles(profile.secondaryRoles, primaryRole);
    state.profile.championStats = normalizeChampionStats(profile.championStats);
    if (state.auth.user && typeof state.auth.user === "object") {
      state.auth.user.primaryRole = state.profile.primaryRole;
      state.auth.user.secondaryRoles = [...state.profile.secondaryRoles];
      saveAuthSession();
    }
    return true;
  } catch (error) {
    state.profile.championStats = createEmptyChampionStatsState();
    setProfileRolesFeedback(normalizeApiErrorMessage(error, "Failed to load profile roles."), true);
    return false;
  }
}

async function loadTeamMembersForSelectedTeam() {
  const selectedTeam = getSelectedAdminTeam();
  if (!selectedTeam || !isAuthenticated()) {
    return;
  }

  try {
    const payload = await apiRequest(`/teams/${selectedTeam.id}/members`, { auth: true });
    state.api.membersByTeamId[String(selectedTeam.id)] = Array.isArray(payload?.members) ? payload.members : [];
  } catch (error) {
    state.api.membersByTeamId[String(selectedTeam.id)] = [];
    setTeamAdminFeedback(normalizeApiErrorMessage(error, "Failed to load team members."));
  }
}

async function loadDiscoverTeamsFromApi() {
  if (!isAuthenticated()) {
    state.api.discoverTeams = [];
    state.api.selectedDiscoverTeamId = "";
    return false;
  }

  try {
    const payload = await apiRequest("/teams/discover", { auth: true });
    state.api.discoverTeams = Array.isArray(payload?.teams) ? payload.teams : [];
    const selectedDiscoverTeam = findDiscoverTeamById(state.api.selectedDiscoverTeamId);
    state.api.selectedDiscoverTeamId = selectedDiscoverTeam
      ? String(selectedDiscoverTeam.id)
      : (state.api.discoverTeams[0] ? String(state.api.discoverTeams[0].id) : "");
    return true;
  } catch (error) {
    state.api.discoverTeams = [];
    state.api.selectedDiscoverTeamId = "";
    setTeamJoinFeedback(normalizeApiErrorMessage(error, "Failed to load discoverable teams."));
    return false;
  }
}

async function loadPendingJoinRequestsForSelectedTeam() {
  const selectedTeam = getSelectedAdminTeam();
  if (!selectedTeam || !isAuthenticated()) {
    return false;
  }

  const selectedTeamId = String(selectedTeam.id);
  const canReview = selectedTeam.membership_role === "lead" || isAdminUser();
  if (!canReview) {
    state.api.joinRequestsByTeamId[selectedTeamId] = [];
    return false;
  }

  try {
    const payload = await apiRequest(`/teams/${selectedTeam.id}/join-requests?status=pending`, { auth: true });
    state.api.joinRequestsByTeamId[selectedTeamId] = Array.isArray(payload?.requests) ? payload.requests : [];
    return true;
  } catch (error) {
    state.api.joinRequestsByTeamId[selectedTeamId] = [];
    setTeamJoinFeedback(normalizeApiErrorMessage(error, "Failed to load pending join requests."));
    return false;
  }
}

async function loadTeamsFromApi(preferredTeamId = null) {
  if (!isAuthenticated()) {
    state.api.teams = [];
    state.api.discoverTeams = [];
    state.api.membersByTeamId = {};
    state.api.joinRequestsByTeamId = {};
    state.api.selectedTeamId = "";
    state.api.selectedDiscoverTeamId = "";
    return false;
  }

  try {
    const payload = await apiRequest("/teams", { auth: true });
    state.api.teams = Array.isArray(payload?.teams) ? payload.teams : [];
    state.api.selectedTeamId = preferredTeamId ? String(preferredTeamId) : state.api.selectedTeamId;
    const selectedTeam = getSelectedAdminTeam();
    state.api.selectedTeamId = selectedTeam ? String(selectedTeam.id) : "";
    await loadTeamMembersForSelectedTeam();
    return true;
  } catch (error) {
    state.api.teams = [];
    state.api.discoverTeams = [];
    state.api.membersByTeamId = {};
    state.api.joinRequestsByTeamId = {};
    state.api.selectedTeamId = "";
    state.api.selectedDiscoverTeamId = "";
    setTeamAdminFeedback(normalizeApiErrorMessage(error, "Failed to load teams."));
    return false;
  }
}

async function loadTeamContextFromApi() {
  if (!isAuthenticated()) {
    state.teamConfig.activeTeamId = NONE_TEAM_ID;
    return false;
  }

  try {
    const payload = await apiRequest("/me/team-context", { auth: true });
    const apiActiveTeamId = normalizeTeamEntityId(payload?.teamContext?.activeTeamId);
    state.teamConfig.activeTeamId = apiActiveTeamId ?? NONE_TEAM_ID;
    return true;
  } catch (error) {
    setTeamAdminFeedback(normalizeApiErrorMessage(error, "Failed to load team context."));
    return false;
  }
}

async function saveTeamContextToApi() {
  if (!isAuthenticated()) {
    return false;
  }

  try {
    const activeTeamId = toApiTeamContextId(state.teamConfig.activeTeamId);
    const payload = await apiRequest("/me/team-context", {
      method: "PUT",
      auth: true,
      body: {
        activeTeamId
      }
    });
    const persistedActiveTeamId = normalizeTeamEntityId(payload?.teamContext?.activeTeamId);
    state.teamConfig.activeTeamId = persistedActiveTeamId ?? NONE_TEAM_ID;
    return true;
  } catch (error) {
    setTeamAdminFeedback(normalizeApiErrorMessage(error, "Failed to save team context."));
    return false;
  }
}

async function createTeamFromTeamAdmin() {
  if (!isAuthenticated()) {
    setTeamAdminFeedback("Sign in to create teams.");
    return;
  }
  if (state.api.isCreatingTeam) {
    return;
  }

  const payload = readTeamCreateFormValues();
  const requestConfig = buildTeamMutationRequest({
    name: payload.name,
    tag: payload.tag,
    logoFile: payload.logoFile,
    allowRemoveLogo: false
  });
  if (requestConfig.error) {
    setTeamAdminFeedback(requestConfig.error);
    return;
  }

  setTeamCreateControlsDisabled(true);
  try {
    const response = await apiRequest("/teams", {
      method: "POST",
      auth: true,
      body: requestConfig.body,
      isFormData: requestConfig.isFormData
    });
    const createdTeam = response?.team ?? {};
    if (elements.teamAdminCreateName) {
      elements.teamAdminCreateName.value = "";
    }
    if (elements.teamAdminCreateTag) {
      elements.teamAdminCreateTag.value = "";
    }
    if (elements.teamAdminCreateLogoUrl) {
      elements.teamAdminCreateLogoUrl.value = "";
    }
    const teamId = createdTeam?.id;
    setTeamAdminFeedback(`Created team '${createdTeam?.name ?? payload.name}'.`);
    await hydrateAuthenticatedViews(state.playerConfig.teamId, teamId);
  } catch (error) {
    setTeamAdminFeedback(normalizeApiErrorMessage(error, "Failed to create team."));
  } finally {
    setTeamCreateControlsDisabled(false);
    renderTeamAdmin();
  }
}

function initializeExplorerControls() {
  multiSelectControls.explorerRole = createCheckboxMultiControl({
    root: elements.explorerRole,
    options: [
      { value: NO_FILTER, label: "None (no role filter)" },
      ...SLOTS.map((slot) => ({ value: slot, label: slot }))
    ],
    selectedValues: [NO_FILTER],
    placeholder: "None (no role filter)",
    summaryFormatter(selectedValues) {
      if (selectedValues.length === 0 || selectedValues.includes(NO_FILTER)) {
        return "None (no role filter)";
      }
      return selectedValues.length === 1 ? selectedValues[0] : `${selectedValues.length} roles selected`;
    },
    onChange(selectedValues) {
      state.explorer.roles = normalizeNoFilterMultiSelection(selectedValues);
      const valuesToRender = state.explorer.roles.length === 0 ? [NO_FILTER] : state.explorer.roles;
      multiSelectControls.explorerRole.setSelected(valuesToRender);
      renderExplorer();
    }
  });

  multiSelectControls.explorerDamage = createCheckboxMultiControl({
    root: elements.explorerDamage,
    options: [
      { value: NO_FILTER, label: "None (no damage filter)" },
      ...DAMAGE_TYPES.map((value) => ({ value, label: value }))
    ],
    selectedValues: [NO_FILTER],
    placeholder: "None (no damage filter)",
    summaryFormatter(selectedValues) {
      if (selectedValues.length === 0 || selectedValues.includes(NO_FILTER)) {
        return "None (no damage filter)";
      }
      return selectedValues.length === 1 ? selectedValues[0] : `${selectedValues.length} damage tags selected`;
    },
    onChange(selectedValues) {
      state.explorer.damageTypes = normalizeNoFilterMultiSelection(selectedValues);
      const valuesToRender = state.explorer.damageTypes.length === 0 ? [NO_FILTER] : state.explorer.damageTypes;
      multiSelectControls.explorerDamage.setSelected(valuesToRender);
      renderExplorer();
    }
  });

  replaceOptions(
    elements.explorerScaling,
    SCALING_VALUES.map((value) => ({ value, label: value })),
    true,
    "Any Effectiveness Focus"
  );

  replaceOptions(
    elements.explorerSort,
    [
      { value: "alpha-asc", label: "Alphabetical (A-Z)" },
      { value: "alpha-desc", label: "Alphabetical (Z-A)" },
      { value: "role", label: "Primary Role, then Name" }
    ]
  );

  multiSelectControls.explorerIncludeTags = createCheckboxMultiControl({
    root: elements.explorerIncludeTags,
    options: BOOLEAN_TAGS.map((tag) => ({ value: tag, label: tag })),
    selectedValues: [],
    placeholder: "No include tags",
    summaryFormatter(selectedValues) {
      if (selectedValues.length === 0) {
        return "No include tags";
      }
      return selectedValues.length === 1 ? selectedValues[0] : `${selectedValues.length} include tags`;
    },
    onChange(selectedValues) {
      syncTagMutualExclusion(
        "include",
        selectedValues,
        multiSelectControls.explorerExcludeTags.getSelected()
      );
      renderExplorer();
    }
  });

  multiSelectControls.explorerExcludeTags = createCheckboxMultiControl({
    root: elements.explorerExcludeTags,
    options: BOOLEAN_TAGS.map((tag) => ({ value: tag, label: tag })),
    selectedValues: [],
    placeholder: "No exclude tags",
    summaryFormatter(selectedValues) {
      if (selectedValues.length === 0) {
        return "No exclude tags";
      }
      return selectedValues.length === 1 ? selectedValues[0] : `${selectedValues.length} exclude tags`;
    },
    onChange(selectedValues) {
      syncTagMutualExclusion(
        "exclude",
        multiSelectControls.explorerIncludeTags.getSelected(),
        selectedValues
      );
      renderExplorer();
    }
  });
}

function clearExplorerFilters() {
  state.explorer.search = "";
  state.explorer.roles = [];
  state.explorer.damageTypes = [];
  state.explorer.scaling = "";
  state.explorer.includeTags = [];
  state.explorer.excludeTags = [];
  state.explorer.sortBy = "alpha-asc";

  elements.explorerSearch.value = "";
  multiSelectControls.explorerRole?.setSelected([NO_FILTER]);
  multiSelectControls.explorerDamage?.setSelected([NO_FILTER]);
  elements.explorerScaling.value = "";
  elements.explorerSort.value = "alpha-asc";
  multiSelectControls.explorerIncludeTags?.setSelected([]);
  multiSelectControls.explorerExcludeTags?.setSelected([]);
  renderActivePills();
}

function renderActivePills() {
  if (!elements.explorerActivePills) return;
  const pills = [];
  if (state.explorer.search) {
    pills.push({ label: "Champion Name", values: [state.explorer.search] });
  }
  if (state.explorer.roles.length > 0) {
    pills.push({ label: "Roles", values: state.explorer.roles });
  }
  if (state.explorer.damageTypes.length > 0) {
    pills.push({ label: "Damage Type", values: state.explorer.damageTypes });
  }
  if (state.explorer.scaling) {
    pills.push({ label: "Effectiveness", values: [state.explorer.scaling] });
  }
  if (state.explorer.sortBy !== "alpha-asc") {
    const sortLabels = { "alpha-desc": "Alphabetical (Z-A)", role: "Primary Role, then Name" };
    pills.push({ label: "Sort Cards", values: [sortLabels[state.explorer.sortBy] ?? state.explorer.sortBy] });
  }
  if (state.explorer.includeTags.length > 0) {
    pills.push({ label: "Include Tags", values: state.explorer.includeTags });
  }
  if (state.explorer.excludeTags.length > 0) {
    pills.push({ label: "Exclude Tags", values: state.explorer.excludeTags });
  }

  elements.explorerActivePills.innerHTML = "";

  // Shared tooltip element
  let pillTooltip = runtimeDocument.querySelector(".explorer-pill-tooltip");
  if (!pillTooltip) {
    pillTooltip = runtimeDocument.createElement("div");
    pillTooltip.className = "explorer-pill-tooltip";
    runtimeDocument.body.append(pillTooltip);
  }

  for (const { label, values } of pills) {
    const pill = runtimeDocument.createElement("span");
    pill.className = "explorer-active-pill";
    pill.textContent = label;

    pill.addEventListener("mouseenter", () => {
      pillTooltip.innerHTML = values.map(v => `<span>${v}</span>`).join("");
      pillTooltip.classList.add("visible");
      const rect = pill.getBoundingClientRect();
      pillTooltip.style.left = `${rect.left + window.scrollX}px`;
      pillTooltip.style.top = `${rect.bottom + window.scrollY + 4}px`;
    });
    pill.addEventListener("mouseleave", () => {
      pillTooltip.classList.remove("visible");
    });

    elements.explorerActivePills.append(pill);
  }
}

function getMemberForSlot(slot) {
  if (state.builder.teamId === NONE_TEAM_ID) {
    return null;
  }
  const ctx = state.builder.draftContext;
  if (ctx?.members) {
    const matches = ctx.members.filter((m) => m.lane === slot);
    const member = matches.find((m) => m.teamRole === "primary") ?? matches[0] ?? null;
    if (member) {
      return member;
    }
  }
  const roster = state.api.membersByTeamId[String(state.builder.teamId)] ?? [];
  const rosterMatches = roster.filter((m) => (m.lane ?? m.position) === slot);
  const rosterMember = rosterMatches.find((m) => m.team_role === "primary") ?? rosterMatches[0] ?? null;
  if (rosterMember) {
    return {
      displayName: rosterMember.display_name || rosterMember.game_name || rosterMember.email || String(rosterMember.user_id),
      lane: slot
    };
  }
  return null;
}

function getSlotLabel(slot) {
  if (state.builder.teamId === NONE_TEAM_ID) {
    return slot;
  }
  const member = getMemberForSlot(slot);
  return member ? `${slot} (${member.displayName})` : slot;
}

function updateTeamHelpAndSlotLabels() {
  if (state.builder.teamId === NONE_TEAM_ID) {
    elements.builderTeamHelp.textContent =
      "Role candidates use global champion eligibility.";
  } else {
    elements.builderTeamHelp.textContent =
      "Team context is set. Candidate pools use your configured role pools.";
  }
}

function getTeamSelectOptions() {
  const teamOptions = [...state.api.teams]
    .sort((left, right) => formatTeamCardTitle(left).localeCompare(formatTeamCardTitle(right)))
    .map((team) => ({ value: String(team.id), label: formatTeamCardTitle(team) }));
  return [
    { value: NONE_TEAM_ID, label: "None (global context)" },
    ...teamOptions
  ];
}

function normalizeConfiguredTeamId(teamId) {
  if (teamId === NONE_TEAM_ID) {
    return NONE_TEAM_ID;
  }
  const normalizedId = normalizeTeamEntityId(teamId);
  if (!normalizedId) {
    return NONE_TEAM_ID;
  }
  if (findTeamById(normalizedId)) {
    return normalizedId;
  }
  return NONE_TEAM_ID;
}

function getOnlyConfiguredTeamId() {
  return state.api.teams.length === 1 ? String(state.api.teams[0].id) : null;
}

function resolveConfiguredTeamSelection(teamId) {
  const normalizedTeamId = normalizeConfiguredTeamId(teamId);
  if (normalizedTeamId !== NONE_TEAM_ID) {
    return normalizedTeamId;
  }
  if (teamId === NONE_TEAM_ID) {
    return NONE_TEAM_ID;
  }
  return getOnlyConfiguredTeamId() ?? NONE_TEAM_ID;
}

function syncConfiguredTeamSelection() {
  state.teamConfig.activeTeamId = resolveConfiguredTeamSelection(state.teamConfig.activeTeamId);
  state.builder.teamId = state.teamConfig.activeTeamId;
}

function getProfileRolePools() {
  const pools = createEmptyRolePools();
  for (const slot of SLOTS) {
    const roleTeamId = buildRolePoolTeamId(slot);
    const rolePools = state.data.teamPools[roleTeamId];
    const champions = Array.isArray(rolePools?.[slot]) ? rolePools[slot] : [];
    pools[slot] = [...champions];
  }
  return pools;
}

function getPoolsForTeam(teamId) {
  if (teamId === NONE_TEAM_ID) {
    return state.data.noneTeamPools;
  }
  return getProfileRolePools();
}

function getBuilderCompositionOptions() {
  const compositions = Array.isArray(state.api.compositionBundles) ? state.api.compositionBundles : [];
  return compositions.map((composition) => ({
    value: String(composition.id),
    label: composition.is_active ? `${composition.name} (Active)` : composition.name
  }));
}

function resolveBuilderActiveCompositionId(rawId = null) {
  const compositions = Array.isArray(state.api.compositionBundles) ? state.api.compositionBundles : [];
  if (compositions.length < 1) {
    return null;
  }
  const parsed = normalizeApiEntityId(rawId);
  if (parsed && compositions.some((composition) => composition.id === parsed)) {
    return parsed;
  }
  const active = compositions.find((composition) => composition.is_active) ?? null;
  return active?.id ?? compositions[0].id;
}

function getBuilderSelectedComposition() {
  const selectedId = resolveBuilderActiveCompositionId(state.builder.activeCompositionId);
  if (!selectedId) {
    return null;
  }
  return (
    (Array.isArray(state.api.compositionBundles) ? state.api.compositionBundles : []).find(
      (composition) => composition.id === selectedId
    ) ?? null
  );
}

function getBuilderSelectedRequirements() {
  const selectedComposition = getBuilderSelectedComposition();
  if (!selectedComposition) {
    return [];
  }
  const requirementById = new Map(
    (Array.isArray(state.api.requirementDefinitions) ? state.api.requirementDefinitions : []).map((requirement) => [
      requirement.id,
      requirement
    ])
  );
  return selectedComposition.requirement_ids
    .map((requirementId) => requirementById.get(requirementId) ?? null)
    .filter(Boolean);
}

function syncBuilderCompositionControls() {
  const compositionOptions = getBuilderCompositionOptions();
  state.builder.activeCompositionId = resolveBuilderActiveCompositionId(state.builder.activeCompositionId);

  if (elements.builderActiveComposition) {
    replaceOptions(elements.builderActiveComposition, compositionOptions, false, "No compositions defined");
    elements.builderActiveComposition.value = state.builder.activeCompositionId
      ? String(state.builder.activeCompositionId)
      : "";
    elements.builderActiveComposition.disabled = compositionOptions.length < 1;
  }

  if (elements.builderCompositionHelp) {
    const selectedComposition = getBuilderSelectedComposition();
    if (!selectedComposition) {
      elements.builderCompositionHelp.textContent = "No composition selected. Create one in the Compositions page.";
      return;
    }
    const requirementCount = Array.isArray(selectedComposition.requirement_ids)
      ? selectedComposition.requirement_ids.length
      : 0;
    elements.builderCompositionHelp.textContent = requirementCount > 0
      ? `Using composition '${selectedComposition.name}' (${requirementCount} requirement${requirementCount === 1 ? "" : "s"}).`
      : `Using composition '${selectedComposition.name}' (no requirements).`;
  }
}

function initializeBuilderControls() {
  const candidateActiveTeamId = state.teamConfig.activeTeamId ?? state.data.config.teamDefault ?? null;
  state.teamConfig.activeTeamId = resolveConfiguredTeamSelection(candidateActiveTeamId);
  state.builder.teamId = state.teamConfig.activeTeamId;
  state.builder.showOptionalChecks = BUILDER_DEFAULTS.showOptionalChecksByDefault;
  state.builder.treeDensity = BUILDER_DEFAULTS.defaultTreeDensity;
  replaceOptions(elements.builderActiveTeam, getTeamSelectOptions());
  elements.builderActiveTeam.value = state.builder.teamId;
  syncBuilderCompositionControls();

  state.builder.maxBranch = state.data.config.treeDefaults.maxBranch;
  elements.builderMaxBranch.value = String(state.builder.maxBranch);

  updateTeamHelpAndSlotLabels();
}

function renderTeamWorkspaceTabs() {
  const activeTab = TEAM_WORKSPACE_TAB_SET.has(state.ui.teamWorkspaceTab)
    ? state.ui.teamWorkspaceTab
    : TEAM_WORKSPACE_TAB_DEFAULT;
  state.ui.teamWorkspaceTab = activeTab;

  for (const button of elements.teamWorkspaceTabButtons) {
    const tab = button.dataset.teamWorkspaceTab;
    const selected = tab === activeTab;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.setAttribute("tabindex", selected ? "0" : "-1");
  }

  if (elements.teamWorkspaceMemberPanel) {
    elements.teamWorkspaceMemberPanel.hidden = activeTab !== TEAM_WORKSPACE_TAB_MEMBER;
  }
  if (elements.teamWorkspaceManagePanel) {
    elements.teamWorkspaceManagePanel.hidden = activeTab !== TEAM_WORKSPACE_TAB_MANAGE;
  }
  if (elements.teamWorkspaceCreatePanel) {
    elements.teamWorkspaceCreatePanel.hidden = activeTab !== TEAM_WORKSPACE_TAB_CREATE;
  }
}

function setTeamWorkspaceTab(tab) {
  state.ui.teamWorkspaceTab = TEAM_WORKSPACE_TAB_SET.has(tab) ? tab : TEAM_WORKSPACE_TAB_DEFAULT;
  renderTeamWorkspaceTabs();
}

function renderUpdatesReleaseTabs() {
  const activeTab = UPDATES_RELEASE_TAB_SET.has(state.ui.updatesReleaseTab)
    ? state.ui.updatesReleaseTab
    : UPDATES_RELEASE_TAB_DEFAULT;
  state.ui.updatesReleaseTab = activeTab;

  for (const button of elements.updatesReleaseTabButtons) {
    const tab = button.dataset.updatesReleaseTab;
    const selected = tab === activeTab;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.setAttribute("tabindex", selected ? "0" : "-1");
  }

  if (elements.updatesReleaseWhatsNewPanel) {
    elements.updatesReleaseWhatsNewPanel.hidden = activeTab !== UPDATES_RELEASE_TAB_WHATS_NEW;
  }
  if (elements.updatesReleaseComingSoonPanel) {
    elements.updatesReleaseComingSoonPanel.hidden = activeTab !== UPDATES_RELEASE_TAB_COMING_SOON;
  }
  if (elements.updatesReleasePreviousPanel) {
    elements.updatesReleasePreviousPanel.hidden = activeTab !== UPDATES_RELEASE_TAB_PREVIOUS;
  }
}

function setUpdatesReleaseTab(tab) {
  state.ui.updatesReleaseTab = UPDATES_RELEASE_TAB_SET.has(tab) ? tab : UPDATES_RELEASE_TAB_DEFAULT;
  renderUpdatesReleaseTabs();
}

function resolveTeamManageActionTitle(action, context) {
  const laneLabel = typeof context?.lane === "string" && context.lane.trim() !== ""
    ? context.lane.trim()
    : "";

  if (action === TEAM_MANAGE_ACTION_ADD_MEMBER) {
    return laneLabel ? `${laneLabel}: Add Member` : "Add Member";
  }
  if (action === TEAM_MANAGE_ACTION_UPDATE_MEMBER_ROLE) {
    return laneLabel ? `${laneLabel}: Update Member Role` : "Update Member Role";
  }
  if (action === TEAM_MANAGE_ACTION_UPDATE_TEAM_ROLE) {
    return laneLabel ? `${laneLabel}: Update Member Team Role` : "Update Member Team Role";
  }
  if (action === TEAM_MANAGE_ACTION_REMOVE_MEMBER) {
    return laneLabel ? `${laneLabel}: Remove Member` : "Remove Member";
  }
  return "Edit Team";
}

function renderTeamManageActions() {
  const activeAction = TEAM_MANAGE_ACTION_SET.has(state.ui.teamManageAction)
    ? state.ui.teamManageAction
    : null;
  state.ui.teamManageAction = activeAction;
  const actionContext = activeAction ? state.ui.teamManageActionContext : null;

  for (const button of elements.teamManageActionButtons) {
    const action = button.dataset.teamManageAction;
    const selected = action === activeAction;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }

  for (const panel of elements.teamManageActionPanels) {
    const panelAction = panel.dataset.teamManagePanel;
    panel.hidden = panelAction !== activeAction;
  }

  if (elements.teamManageActionHelp) {
    elements.teamManageActionHelp.hidden = Boolean(activeAction);
  }

  if (elements.teamAdminAddTitle) {
    elements.teamAdminAddTitle.textContent = resolveTeamManageActionTitle(
      TEAM_MANAGE_ACTION_ADD_MEMBER,
      actionContext
    );
  }
  if (elements.teamAdminUpdateRoleTitle) {
    elements.teamAdminUpdateRoleTitle.textContent = resolveTeamManageActionTitle(
      TEAM_MANAGE_ACTION_UPDATE_MEMBER_ROLE,
      actionContext
    );
  }
  if (elements.teamAdminUpdateTeamRoleTitle) {
    elements.teamAdminUpdateTeamRoleTitle.textContent = resolveTeamManageActionTitle(
      TEAM_MANAGE_ACTION_UPDATE_TEAM_ROLE,
      actionContext
    );
  }
  if (elements.teamAdminRemoveTitle) {
    elements.teamAdminRemoveTitle.textContent = resolveTeamManageActionTitle(
      TEAM_MANAGE_ACTION_REMOVE_MEMBER,
      actionContext
    );
  }
}

function setTeamManageAction(action) {
  if (!TEAM_MANAGE_ACTION_SET.has(action)) {
    state.ui.teamManageAction = null;
    state.ui.teamManageActionContext = null;
  } else {
    state.ui.teamManageAction = state.ui.teamManageAction === action ? null : action;
    state.ui.teamManageActionContext = state.ui.teamManageAction === null ? null : {};
  }
  renderTeamManageActions();
}

function openTeamManageAction(action, context = null) {
  state.ui.teamManageAction = TEAM_MANAGE_ACTION_SET.has(action) ? action : null;
  state.ui.teamManageActionContext = state.ui.teamManageAction
    ? (context && typeof context === "object" ? { ...context } : {})
    : null;
  renderTeamManageActions();
}

function renderTeamConfig() {
  syncConfiguredTeamSelection();
  if (elements.teamConfigActiveTeam) {
    elements.teamConfigActiveTeam.value = state.teamConfig.activeTeamId;
  }

  const activeTeam = findTeamById(state.teamConfig.activeTeamId);
  const activeMembershipLane = activeTeam?.membership_lane ?? null;
  const activeTeamSuffix =
    activeMembershipLane && SLOTS.includes(activeMembershipLane)
      ? ` Your position: ${activeMembershipLane}.`
      : "";
  if (elements.teamConfigActiveHelp) {
    elements.teamConfigActiveHelp.textContent = state.teamConfig.activeTeamId === NONE_TEAM_ID
      ? "Active team: None (global context)."
      : `Active team: ${getTeamDisplayLabel(state.teamConfig.activeTeamId)}.${activeTeamSuffix}`;
  }

  const activeTeamId = state.teamConfig.activeTeamId;

  const poolRoles = SLOTS.map((slot) => state.builder.slotPoolRole[slot] ?? slot);
  const seen = new Set();
  const dupeRoles = new Set();
  for (const r of poolRoles) {
    if (seen.has(r)) dupeRoles.add(r);
    seen.add(r);
  }
  const roleCounts = SLOTS.map((slot, i) => {
    const poolRole = poolRoles[i];
    return { poolRole, text: `${poolRole}: ${getChampionsForSlotAndRole(slot, poolRole).length}` };
  });
  if (elements.teamConfigPoolSummary) {
    elements.teamConfigPoolSummary.innerHTML = "";
    const prefix = activeTeamId === NONE_TEAM_ID
      ? "Global candidate pools -> "
      : `Team pool snapshot (${getTeamDisplayLabel(activeTeamId)}) -> `;
    elements.teamConfigPoolSummary.append(prefix);
    roleCounts.forEach(({ poolRole, text }, i) => {
      const span = runtimeDocument.createElement("span");
      if (dupeRoles.has(poolRole)) {
        span.className = "pool-snapshot-dupe-error";
      }
      span.textContent = text;
      elements.teamConfigPoolSummary.append(span);
      if (i < roleCounts.length - 1) {
        const sep = runtimeDocument.createElement("span");
        sep.textContent = "\u00a0|\u00a0";
        elements.teamConfigPoolSummary.append(sep);
      }
    });
    if (dupeRoles.size > 0) {
      const errSpan = runtimeDocument.createElement("span");
      errSpan.className = "pool-snapshot-unique-error";
      errSpan.textContent = "All roles must be unique!";
      elements.teamConfigPoolSummary.append(errSpan);
    }
  }

  if (!elements.teamConfigPoolGrid) {
    return;
  }
  elements.teamConfigPoolGrid.innerHTML = "";
  for (const slot of SLOTS) {
    const poolRole = state.builder.slotPoolRole[slot] ?? slot;
    const draftIndex = state.builder.draftOrder.indexOf(slot);
    const filled = Boolean(state.builder.teamState[slot]);

    const card = runtimeDocument.createElement("article");
    card.className = "summary-card pool-snapshot-card";
    card.dataset.slot = slot;
    card.draggable = true;
    card.style.order = String(draftIndex);
    card.classList.toggle("is-filled", filled);

    const member = getMemberForSlot(slot);
    const memberName = member?.displayName?.split("#")[0] ?? null;
    const allChampions = getChampionsForSlotAndRole(slot, poolRole).slice().sort((a, b) => a.localeCompare(b));
    const champions = allChampions.filter((champ) => {
      if (state.builder.excludedChampions.includes(champ)) return false;
      if (champ !== state.builder.teamState[slot] && isChampionInOtherSlot(slot, champ)) return false;
      return true;
    });

    // Row 1: name + role
    const header = runtimeDocument.createElement("div");
    header.className = "pool-snapshot-header";

    const title = runtimeDocument.createElement("strong");
    title.textContent = memberName ?? slot;

    const roleSelect = runtimeDocument.createElement("select");
    roleSelect.className = "pool-snapshot-role-select";
    for (const s of SLOTS) {
      const opt = runtimeDocument.createElement("option");
      opt.value = s;
      opt.textContent = s;
      if (s === poolRole) opt.selected = true;
      roleSelect.append(opt);
    }
    header.append(title, roleSelect);

    // Row 2: left arrow, pick order, status, right arrow
    const controlsRow = runtimeDocument.createElement("div");
    controlsRow.className = "pool-snapshot-controls";

    const leftBtn = runtimeDocument.createElement("button");
    leftBtn.type = "button";
    leftBtn.className = "ghost pool-snapshot-order-btn";
    leftBtn.textContent = "\u25C0";
    leftBtn.disabled = draftIndex === 0;
    leftBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      moveSlotInDraftOrder(slot, -1);
    });

    const orderBadge = runtimeDocument.createElement("span");
    orderBadge.className = "pool-snapshot-order";
    orderBadge.textContent = `#${draftIndex + 1}`;

    const statusBadge = runtimeDocument.createElement("span");
    statusBadge.className = `pool-snapshot-status ${filled ? "is-filled" : "is-pending"}`;
    statusBadge.textContent = filled ? "Filled" : "Pending";

    const rightBtn = runtimeDocument.createElement("button");
    rightBtn.type = "button";
    rightBtn.className = "ghost pool-snapshot-order-btn";
    rightBtn.textContent = "\u25B6";
    rightBtn.disabled = draftIndex === state.builder.draftOrder.length - 1;
    rightBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      moveSlotInDraftOrder(slot, 1);
    });

    controlsRow.append(leftBtn, orderBadge, statusBadge, rightBtn);

    const count = runtimeDocument.createElement("p");
    count.className = "meta";
    count.textContent = `${champions.length} champion${champions.length === 1 ? "" : "s"} in pool.`;

    const filter = runtimeDocument.createElement("input");
    filter.type = "text";
    filter.className = "pool-snapshot-filter";
    filter.placeholder = "Filter\u2026";
    const savedFilter = state.builder.slotFilterText?.[slot] ?? "";
    if (savedFilter) filter.value = savedFilter;

    const ul = runtimeDocument.createElement("ul");
    ul.className = "pool-snapshot-list";

    if (champions.length > 0) {
      for (const champ of champions) {
        const li = runtimeDocument.createElement("li");
        li.textContent = champ;
        if (champ === state.builder.teamState[slot]) {
          li.classList.add("is-selected");
        }
        if (savedFilter && !champ.toLowerCase().includes(savedFilter.toLowerCase())) {
          li.hidden = true;
        }
        li.addEventListener("click", () => {
          if (!validateAndApplySlotSelection(slot, champ)) {
            renderTeamConfig();
            return;
          }
          setBuilderStage("setup");
          resetBuilderTreeState();
          renderTeamConfig();
          renderBuilder();
          setSetupFeedback("");
        });
        ul.append(li);
      }
    } else {
      const li = runtimeDocument.createElement("li");
      li.textContent = "No champions configured.";
      li.className = "pool-snapshot-empty";
      ul.append(li);
    }

    filter.addEventListener("input", () => {
      const q = filter.value.trim().toLowerCase();
      if (!state.builder.slotFilterText) state.builder.slotFilterText = {};
      state.builder.slotFilterText[slot] = filter.value;
      for (const li of ul.querySelectorAll("li:not(.pool-snapshot-empty)")) {
        li.hidden = q.length > 0 && !li.textContent.toLowerCase().includes(q);
      }
    });

    roleSelect.addEventListener("change", () => {
      state.builder.slotPoolRole[slot] = roleSelect.value;
      state.builder.teamState[slot] = null;
      setBuilderStage("setup");
      resetBuilderTreeState();
      renderTeamConfig();
      renderBuilder();
    });

    // Drag-to-reorder
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/slot", slot);
      event.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      const sourceSlot = event.dataTransfer?.getData("text/slot");
      if (!sourceSlot || sourceSlot === slot) return;
      const updated = [...state.builder.draftOrder];
      const sourceIndex = updated.indexOf(sourceSlot);
      const targetIndex = updated.indexOf(slot);
      if (sourceIndex < 0 || targetIndex < 0) return;
      updated.splice(sourceIndex, 1);
      updated.splice(targetIndex, 0, sourceSlot);
      state.builder.draftOrder = updated;
      setBuilderStage("setup");
      resetBuilderTreeState();
      renderBuilder();
    });

    card.append(header, controlsRow, count, filter, ul);
    elements.teamConfigPoolGrid.append(card);
  }
}

function getSelectedAdminTeam() {
  const selectedId = state.api.selectedTeamId;
  if (selectedId && state.api.teams.some((team) => String(team.id) === selectedId)) {
    return state.api.teams.find((team) => String(team.id) === selectedId) ?? null;
  }
  return state.api.teams[0] ?? null;
}

function renderTeamAdminCurrentLogo(selectedTeam) {
  if (!elements.teamAdminCurrentLogo) {
    return;
  }
  if (!selectedTeam) {
    elements.teamAdminCurrentLogo.hidden = true;
    if (elements.teamAdminCurrentLogoImage) {
      elements.teamAdminCurrentLogoImage.removeAttribute("src");
    }
    if (elements.teamAdminCurrentLogoHelp) {
      elements.teamAdminCurrentLogoHelp.textContent = "";
    }
    return;
  }

  const hasLogo = typeof selectedTeam.logo_data_url === "string" && selectedTeam.logo_data_url.trim() !== "";
  elements.teamAdminCurrentLogo.hidden = false;
  if (elements.teamAdminCurrentLogoOpen) {
    elements.teamAdminCurrentLogoOpen.hidden = !hasLogo;
    elements.teamAdminCurrentLogoOpen.disabled = !hasLogo;
    elements.teamAdminCurrentLogoOpen.dataset.logoUrl = hasLogo ? selectedTeam.logo_data_url : "";
    elements.teamAdminCurrentLogoOpen.dataset.logoCaption = hasLogo
      ? `${formatTeamCardTitle(selectedTeam)} logo`
      : "";
  }
  if (elements.teamAdminCurrentLogoImage) {
    if (hasLogo) {
      elements.teamAdminCurrentLogoImage.src = selectedTeam.logo_data_url;
      elements.teamAdminCurrentLogoImage.alt = `${formatTeamCardTitle(selectedTeam)} logo`;
    } else {
      elements.teamAdminCurrentLogoImage.removeAttribute("src");
      elements.teamAdminCurrentLogoImage.alt = "No current team logo";
    }
  }
  if (elements.teamAdminCurrentLogoHelp) {
    elements.teamAdminCurrentLogoHelp.textContent = hasLogo
      ? "Current logo shown. Upload a file only if you want to replace it."
      : "No current logo is set. Upload a file to add one.";
  }
}

function renderTeamJoinWorkspace(selectedTeam) {
  const discoverTeams = Array.isArray(state.api.discoverTeams) ? state.api.discoverTeams : [];
  const discoverOptions = discoverTeams
    .map((team) => {
      const baseLabel = formatTeamCardTitle(team);
      const pendingStatus = String(team?.pending_join_request_status ?? "").trim().toLowerCase();
      const membershipRole = String(team?.membership_role ?? "").trim().toLowerCase();
      if (membershipRole) {
        return { value: String(team.id), label: `${baseLabel} (member)` };
      }
      if (pendingStatus === "pending") {
        return { value: String(team.id), label: `${baseLabel} (pending)` };
      }
      return { value: String(team.id), label: baseLabel };
    })
    .sort((left, right) => left.label.localeCompare(right.label));

  if (elements.teamJoinDiscoverSelect) {
    replaceOptions(elements.teamJoinDiscoverSelect, discoverOptions);
  }

  const selectedDiscoverTeam =
    findDiscoverTeamById(state.api.selectedDiscoverTeamId) ??
    (discoverTeams[0] ?? null);
  state.api.selectedDiscoverTeamId = selectedDiscoverTeam ? String(selectedDiscoverTeam.id) : "";

  if (elements.teamJoinDiscoverSelect) {
    elements.teamJoinDiscoverSelect.value = state.api.selectedDiscoverTeamId;
    elements.teamJoinDiscoverSelect.disabled = !isAuthenticated();
  }

  const selectedPendingStatus = String(selectedDiscoverTeam?.pending_join_request_status ?? "").trim().toLowerCase();
  const selectedMembershipRole = String(selectedDiscoverTeam?.membership_role ?? "").trim().toLowerCase();
  const hasPendingRequest = Number.isInteger(Number(selectedDiscoverTeam?.pending_join_request_id))
    && selectedPendingStatus === "pending";
  const canRequestJoin = Boolean(selectedDiscoverTeam) && !selectedMembershipRole && !hasPendingRequest;
  const canCancelRequest = Boolean(selectedDiscoverTeam) && hasPendingRequest;

  if (elements.teamJoinRequest) {
    elements.teamJoinRequest.disabled = !isAuthenticated() || !canRequestJoin;
  }
  if (elements.teamJoinCancel) {
    elements.teamJoinCancel.disabled = !isAuthenticated() || !canCancelRequest;
  }
  if (elements.teamJoinNote) {
    elements.teamJoinNote.disabled = !isAuthenticated() || !canRequestJoin;
  }
  if (elements.teamJoinLoadDiscover) {
    elements.teamJoinLoadDiscover.disabled = !isAuthenticated();
  }

  if (elements.teamJoinDiscoverMeta) {
    if (!isAuthenticated()) {
      elements.teamJoinDiscoverMeta.textContent = "Sign in to discover teams and submit join requests.";
    } else if (!selectedDiscoverTeam) {
      elements.teamJoinDiscoverMeta.textContent = "Load discover teams to request a position.";
    } else if (selectedMembershipRole) {
      elements.teamJoinDiscoverMeta.textContent = `You are already on ${formatTeamCardTitle(selectedDiscoverTeam)} as ${selectedMembershipRole}.`;
    } else if (hasPendingRequest) {
      elements.teamJoinDiscoverMeta.textContent = `Pending request to ${formatTeamCardTitle(selectedDiscoverTeam)} is awaiting lead review.`;
    } else {
      elements.teamJoinDiscoverMeta.textContent = `Ready to request a position on ${formatTeamCardTitle(selectedDiscoverTeam)}.`;
    }
  }

  const canReview = Boolean(selectedTeam) && (selectedTeam.membership_role === "lead" || isAdminUser());
  if (elements.teamJoinLoadReview) {
    elements.teamJoinLoadReview.disabled = !isAuthenticated() || !canReview;
  }
  if (!elements.teamJoinReviewList) {
    return;
  }

  elements.teamJoinReviewList.innerHTML = "";
  if (!isAuthenticated()) {
    const message = runtimeDocument.createElement("p");
    message.className = "meta";
    message.textContent = "Sign in to review team join requests.";
    elements.teamJoinReviewList.append(message);
    return;
  }
  if (!selectedTeam) {
    const message = runtimeDocument.createElement("p");
    message.className = "meta";
    message.textContent = "Select a team to review incoming join requests.";
    elements.teamJoinReviewList.append(message);
    return;
  }
  if (!canReview) {
    const message = runtimeDocument.createElement("p");
    message.className = "meta";
    message.textContent = "Only team leads can review join requests for this team.";
    elements.teamJoinReviewList.append(message);
    return;
  }

  const requests = state.api.joinRequestsByTeamId[String(selectedTeam.id)] ?? [];
  if (requests.length === 0) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "No pending requests loaded. Use Load Pending Requests.";
    elements.teamJoinReviewList.append(empty);
    return;
  }

  for (const request of requests) {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card";

    const title = runtimeDocument.createElement("strong");
    title.textContent = request?.requester?.display_name ?? `User ${request?.requester_user_id ?? "?"}`;

    const lane = runtimeDocument.createElement("p");
    lane.className = "meta";
    lane.textContent = `Requested lane: ${request?.requested_lane ?? "Unknown"}`;

    const note = runtimeDocument.createElement("p");
    note.className = "meta";
    const trimmedNote = typeof request?.note === "string" ? request.note.trim() : "";
    note.textContent = trimmedNote ? `Note: ${trimmedNote}` : "Note: (none)";

    const actions = runtimeDocument.createElement("div");
    actions.className = "button-row";

    const approve = runtimeDocument.createElement("button");
    approve.type = "button";
    approve.textContent = "Approve";
    approve.dataset.teamJoinReviewAction = "approve";
    approve.dataset.requestId = String(request.id);

    const reject = runtimeDocument.createElement("button");
    reject.type = "button";
    reject.className = "ghost";
    reject.textContent = "Reject";
    reject.dataset.teamJoinReviewAction = "reject";
    reject.dataset.requestId = String(request.id);

    actions.append(approve, reject);
    card.append(title, lane, note, actions);
    elements.teamJoinReviewList.append(card);
  }
}

function getTeamInviteList(selectedTeam) {
  if (!selectedTeam) {
    return [];
  }
  return state.api.invitationsByTeamId[String(selectedTeam.id)] ?? [];
}

function renderTeamInviteList(selectedTeam) {
  if (!elements.teamInviteList) {
    return;
  }
  elements.teamInviteList.innerHTML = "";

  const isAuth = isAuthenticated();
  if (elements.teamInviteListMeta) {
    elements.teamInviteListMeta.textContent = !isAuth
      ? "Sign in to view team invitations."
      : selectedTeam
        ? `Pending invitations for ${formatTeamCardTitle(selectedTeam)}.`
        : "Select a team to view invitations.";
  }

  if (!isAuth) {
    const message = runtimeDocument.createElement("p");
    message.className = "meta";
    message.textContent = "Sign in to view team invitations.";
    elements.teamInviteList.append(message);
    return;
  }

  if (!selectedTeam) {
    const message = runtimeDocument.createElement("p");
    message.className = "meta";
    message.textContent = "Select a team to view pending invitations.";
    elements.teamInviteList.append(message);
    return;
  }

  if (state.api.isLoadingTeamInvitations) {
    const loading = runtimeDocument.createElement("p");
    loading.className = "meta";
    loading.textContent = "Loading team invitations...";
    elements.teamInviteList.append(loading);
    return;
  }

  const invitations = getTeamInviteList(selectedTeam);
  if (invitations.length === 0) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "No pending invitations. Send a new invite to get started.";
    elements.teamInviteList.append(empty);
    return;
  }

  for (const invitation of invitations) {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card";

    const title = runtimeDocument.createElement("strong");
    title.textContent = invitation?.target?.display_name ?? `User ${invitation?.target_user_id ?? "?"}`;

    const lane = runtimeDocument.createElement("p");
    lane.className = "meta";
    const laneLabel = invitation?.requested_lane ? `Lane: ${invitation.requested_lane}` : "Lane: (auto)";
    lane.textContent = laneLabel;

    const note = runtimeDocument.createElement("p");
    note.className = "meta";
    const trimmedNote = typeof invitation?.note === "string" ? invitation.note.trim() : "";
    note.textContent = trimmedNote ? `Note: ${trimmedNote}` : "Note: (none)";

    const status = runtimeDocument.createElement("p");
    status.className = "meta";
    status.textContent = `Status: ${invitation.status}`;

    card.append(title, lane, note, status);

    if (invitation.status === "pending") {
      const actions = runtimeDocument.createElement("div");
      actions.className = "button-row";
      const cancelButton = runtimeDocument.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "ghost";
      cancelButton.textContent = "Cancel";
      cancelButton.dataset.teamInviteAction = "cancel";
      cancelButton.dataset.teamInviteId = String(invitation.id);
      actions.append(cancelButton);
      card.append(actions);
    }

    elements.teamInviteList.append(card);
  }
}

function renderTeamInviteUserList() {
  if (!elements.teamInviteUserList) {
    return;
  }
  elements.teamInviteUserList.innerHTML = "";

  if (elements.teamInviteUserFeedback && !isAuthenticated()) {
    elements.teamInviteUserFeedback.textContent = "";
  }

  if (!isAuthenticated()) {
    const message = runtimeDocument.createElement("p");
    message.className = "meta";
    message.textContent = "Sign in to review incoming invitations.";
    elements.teamInviteUserList.append(message);
    return;
  }

  if (state.api.isLoadingUserInvitations) {
    const loading = runtimeDocument.createElement("p");
    loading.className = "meta";
    loading.textContent = "Loading invitations...";
    elements.teamInviteUserList.append(loading);
    return;
  }

  const invitations = Array.isArray(state.api.userInvitations) ? state.api.userInvitations : [];
  if (invitations.length === 0) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "No invitations at this time.";
    elements.teamInviteUserList.append(empty);
    return;
  }

  for (const invitation of invitations) {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card";

    const title = runtimeDocument.createElement("strong");
    title.textContent = invitation?.team?.name
      ? `${invitation.team.name} (${invitation.team.tag ?? "TBD"})`
      : `Team ${invitation.team_id ?? "?"}`;

    const lane = runtimeDocument.createElement("p");
    lane.className = "meta";
    lane.textContent = invitation?.requested_lane
      ? `Lane: ${invitation.requested_lane}`
      : "Lane: (auto)";

    const note = runtimeDocument.createElement("p");
    note.className = "meta";
    const trimmedNote = typeof invitation?.note === "string" ? invitation.note.trim() : "";
    note.textContent = trimmedNote ? `Note: ${trimmedNote}` : "Note: (none)";

    const status = runtimeDocument.createElement("p");
    status.className = "meta";
    status.textContent = `Status: ${invitation.status}`;

    card.append(title, lane, note, status);

    if (invitation.status === "pending") {
      const actions = runtimeDocument.createElement("div");
      actions.className = "button-row";

      const accept = runtimeDocument.createElement("button");
      accept.type = "button";
      accept.textContent = "Accept";
      accept.dataset.teamInviteUserAction = "accept";
      accept.dataset.teamInviteId = String(invitation.id);
      accept.dataset.teamId = String(invitation.team_id);

      const reject = runtimeDocument.createElement("button");
      reject.type = "button";
      reject.className = "ghost";
      reject.textContent = "Reject";
      reject.dataset.teamInviteUserAction = "reject";
      reject.dataset.teamInviteId = String(invitation.id);
      reject.dataset.teamId = String(invitation.team_id);

      actions.append(accept, reject);
      card.append(actions);
    }

    elements.teamInviteUserList.append(card);
  }
}

async function loadMemberInvitationsForSelectedTeam({ status = "pending" } = {}) {
  const selectedTeam = getSelectedAdminTeam();
  if (!selectedTeam || !isAuthenticated()) {
    return false;
  }

  const teamId = selectedTeam.id;
  state.api.isLoadingTeamInvitations = true;
  renderTeamInviteList(selectedTeam);

  try {
    const payload = await apiRequest(`/teams/${teamId}/member-invitations?status=${status}`, { auth: true });
    const invitations = Array.isArray(payload?.invitations) ? payload.invitations : [];
    state.api.invitationsByTeamId[String(teamId)] = invitations;
    setTeamInviteFeedback("Team invitations loaded.");
    return true;
  } catch (error) {
    state.api.invitationsByTeamId[String(teamId)] = [];
    setTeamInviteFeedback(normalizeApiErrorMessage(error, "Failed to load team invitations."));
    return false;
  } finally {
    state.api.isLoadingTeamInvitations = false;
    renderTeamInviteList(selectedTeam);
  }
}

async function loadInvitationsForUser({ status = "pending" } = {}) {
  if (!isAuthenticated()) {
    state.api.userInvitations = [];
    return false;
  }

  state.api.isLoadingUserInvitations = true;
  renderTeamInviteUserList();

  try {
    const payload = await apiRequest(`/me/member-invitations?status=${status}`, { auth: true });
    state.api.userInvitations = Array.isArray(payload?.invitations) ? payload.invitations : [];
    setTeamInviteUserFeedback("");
    return true;
  } catch (error) {
    state.api.userInvitations = [];
    setTeamInviteUserFeedback(normalizeApiErrorMessage(error, "Failed to load your invitations."));
    return false;
  } finally {
    state.api.isLoadingUserInvitations = false;
    renderTeamInviteUserList();
  }
}

function clearTeamInviteForm() {
  if (elements.teamInviteRiotId) {
    elements.teamInviteRiotId.value = "";
  }
  if (elements.teamInviteLane) {
    elements.teamInviteLane.value = "";
  }
  if (elements.teamInviteNote) {
    elements.teamInviteNote.value = "";
  }
  if (elements.teamInviteRole) {
    elements.teamInviteRole.value = DEFAULT_MEMBER_ROLE;
  }
  if (elements.teamInviteTeamRole) {
    elements.teamInviteTeamRole.value = "primary";
  }
}

function readTeamInviteForm() {
  return {
    riotId: elements.teamInviteRiotId ? elements.teamInviteRiotId.value.trim() : "",
    note: elements.teamInviteNote ? elements.teamInviteNote.value.trim() : "",
    lane: elements.teamInviteLane ? elements.teamInviteLane.value : "",
    role: elements.teamInviteRole ? elements.teamInviteRole.value : DEFAULT_MEMBER_ROLE,
    teamRole: elements.teamInviteTeamRole ? elements.teamInviteTeamRole.value : "primary"
  };
}

async function sendTeamInvitation() {
  const selectedTeam = getSelectedAdminTeam();
  if (!selectedTeam) {
    setTeamInviteFeedback("Select a team first.");
    return;
  }

  const form = readTeamInviteForm();
  if (!form.riotId) {
    setTeamInviteFeedback("Enter a Riot ID (GameName#NA1).");
    return;
  }

  const payload = {
    riot_id: form.riotId,
    role: form.role || DEFAULT_MEMBER_ROLE,
    team_role: form.teamRole || "primary"
  };
  if (form.note) {
    payload.note = form.note;
  }
  if (form.lane) {
    payload.requested_lane = form.lane;
  }

  setTeamInviteFeedback("Sending invitation...");

  try {
    const response = await apiRequest(`/teams/${selectedTeam.id}/member-invitations`, {
      method: "POST",
      auth: true,
      body: payload
    });
    const display = response?.invitation?.target?.display_name ?? form.riotId;
    setTeamInviteFeedback(`Invitation sent to ${display}.`);
    clearTeamInviteForm();
    await loadMemberInvitationsForSelectedTeam();
  } catch (error) {
    setTeamInviteFeedback(normalizeApiErrorMessage(error, "Failed to send invitation."));
  }
}

async function updateTeamInvitationStatus(teamId, invitationId, status, feedbackMessage, { suppressTeamFeedback = false } = {}) {
  try {
    await apiRequest(`/teams/${teamId}/member-invitations/${invitationId}`, {
      method: "PUT",
      auth: true,
      body: { status }
    });
    if (!suppressTeamFeedback) {
      setTeamInviteFeedback(feedbackMessage);
    }
    await loadMemberInvitationsForSelectedTeam();
    await loadInvitationsForUser();
  } catch (error) {
    setTeamInviteFeedback(normalizeApiErrorMessage(error, "Failed to update invitation."));
  }
}

function sortRosterMembers(members) {
  return [...members].sort((left, right) => {
    const leftLead = left?.role === "lead" ? 0 : 1;
    const rightLead = right?.role === "lead" ? 0 : 1;
    if (leftLead !== rightLead) {
      return leftLead - rightLead;
    }
    return resolveMemberDisplayName(left).localeCompare(resolveMemberDisplayName(right));
  });
}

function resolveMemberUserId(member) {
  const memberId = Number.parseInt(String(member?.user_id ?? ""), 10);
  return Number.isInteger(memberId) && memberId > 0 ? memberId : null;
}

function parseRiotIdInput(rawValue) {
  const normalizedValue = typeof rawValue === "string" ? rawValue.trim() : "";
  const segments = normalizedValue.split("#");
  if (segments.length !== 2) {
    return null;
  }
  const gameName = segments[0].trim();
  const tagline = segments[1].trim();
  if (!gameName || !tagline) {
    return null;
  }
  return {
    gameName,
    tagline,
    display: `${gameName}#${tagline}`,
    key: `${gameName.toLowerCase()}#${tagline.toLowerCase()}`
  };
}

function resolveMemberRiotId(member) {
  const gameName = typeof member?.game_name === "string" ? member.game_name.trim() : "";
  const tagline = typeof member?.tagline === "string" ? member.tagline.trim() : "";
  if (gameName && tagline) {
    return `${gameName}#${tagline}`;
  }

  const displayName = typeof member?.display_name === "string" ? member.display_name.trim() : "";
  const parsedDisplayName = parseRiotIdInput(displayName);
  return parsedDisplayName ? parsedDisplayName.display : "";
}

function resolveSelectedTeamMemberByRiotId(rawRiotId) {
  const selectedTeam = getSelectedAdminTeam();
  if (!selectedTeam) {
    return { error: "Select a team first.", member: null, riotId: null };
  }

  const parsedRiotId = parseRiotIdInput(rawRiotId);
  if (!parsedRiotId) {
    return { error: "Enter a Riot ID in the format GameName#NA1.", member: null, riotId: null };
  }

  const members = state.api.membersByTeamId[String(selectedTeam.id)] ?? [];
  const member = members.find((candidate) => {
    const candidateRiotId = parseRiotIdInput(resolveMemberRiotId(candidate));
    return candidateRiotId?.key === parsedRiotId.key;
  }) ?? null;

  if (!member) {
    return {
      error: `No team member found for Riot ID ${parsedRiotId.display}.`,
      member: null,
      riotId: parsedRiotId.display
    };
  }

  return { error: "", member, riotId: parsedRiotId.display };
}

function createRosterQuickActionButton({
  label,
  quickAction,
  userId = null,
  riotId = null,
  teamRole = null,
  lane = null,
  disabled = false
}) {
  const button = runtimeDocument.createElement("button");
  button.type = "button";
  button.className = "ghost roster-quick-action";
  button.textContent = label;
  button.dataset.rosterQuickAction = quickAction;
  if (Number.isInteger(userId)) {
    button.dataset.userId = String(userId);
  }
  if (typeof riotId === "string" && riotId.trim() !== "") {
    button.dataset.riotId = riotId.trim();
  }
  if (typeof teamRole === "string") {
    button.dataset.teamRole = teamRole;
  }
  if (typeof lane === "string") {
    button.dataset.lane = lane;
  }
  button.disabled = disabled;
  return button;
}

function createRosterOpenSlotRow({ lane, teamRole, adminEnabled, emptyClass = false }) {
  const row = runtimeDocument.createElement("div");
  row.className = "roster-member-row roster-member-row-empty";

  const info = runtimeDocument.createElement("div");
  info.className = "roster-member-info";

  const empty = runtimeDocument.createElement("p");
  empty.className = `meta${emptyClass ? " roster-slot-empty" : ""}`;
  empty.textContent = "Open slot";
  info.append(empty);
  row.append(info);

  if (adminEnabled) {
    const actions = runtimeDocument.createElement("div");
    actions.className = "roster-member-actions";
    actions.append(
      createRosterQuickActionButton({
        label: "Add Member",
        quickAction: "open-add-member",
        teamRole,
        lane,
        disabled: !adminEnabled
      })
    );
    row.append(actions);
  }

  return row;
}

function createRosterMemberRow(member, { adminEnabled, showLane = false, totalMembers = 0 }) {
  const teamRole = member?.team_role === "substitute" ? "substitute" : "primary";
  const userId = resolveMemberUserId(member);
  const riotId = resolveMemberRiotId(member);
  const lane = formatPositionLabel(resolveMemberLane(member));

  const row = runtimeDocument.createElement("div");
  row.className = "roster-member-row";

  const info = runtimeDocument.createElement("div");
  info.className = "roster-member-info";

  const title = runtimeDocument.createElement("strong");
  title.className = "roster-member-name";
  title.textContent = resolveMemberDisplayName(member);

  const details = runtimeDocument.createElement("p");
  details.className = "meta";
  const detailParts = [formatMembershipRole(member.role)];
  if (showLane) {
    detailParts.push(lane);
  }
  details.textContent = detailParts.join(" | ");

  info.append(title, details);
  row.append(info);

  if (!adminEnabled) {
    return row;
  }

  const actions = runtimeDocument.createElement("div");
  actions.className = "roster-member-actions";

  actions.append(
    createRosterQuickActionButton({
      label: "Remove Member",
      quickAction: "remove-member",
      userId,
      riotId,
      lane,
      disabled: !adminEnabled || !Number.isInteger(userId) || totalMembers <= 1
    })
  );

  if (member?.role !== "lead") {
    actions.append(
      createRosterQuickActionButton({
        label: "Promote to Lead",
        quickAction: "promote-lead",
        userId,
        riotId,
        lane,
        disabled: !adminEnabled || !Number.isInteger(userId)
      })
    );
  }

  actions.append(
    createRosterQuickActionButton({
      label: teamRole === "substitute" ? "Move to Primary" : "Move to Sub",
      quickAction: "move-team-role",
      userId,
      riotId,
      teamRole: teamRole === "substitute" ? "primary" : "substitute",
      lane,
      disabled: !adminEnabled || !Number.isInteger(userId)
    })
  );

  row.append(actions);
  return row;
}

function appendRosterLaneCard({
  laneLabel,
  members,
  teamRole,
  adminEnabled,
  showLane = false,
  emptyClass = false,
  teamMemberCount = 0
}) {
  const laneCard = runtimeDocument.createElement("section");
  laneCard.className = "summary-card roster-slot-card";
  laneCard.dataset.lane = laneLabel;

  const header = runtimeDocument.createElement("h4");
  header.className = "roster-slot-title";
  header.textContent = laneLabel;
  laneCard.append(header);

  const body = runtimeDocument.createElement("div");
  body.className = "roster-slot-list";

  if (members.length === 0) {
    body.append(
      createRosterOpenSlotRow({
        lane: laneLabel,
        teamRole,
        adminEnabled,
        emptyClass
      })
    );
  } else {
    for (const member of sortRosterMembers(members)) {
      body.append(createRosterMemberRow(member, { adminEnabled, showLane, totalMembers: teamMemberCount }));
    }
  }

  laneCard.append(body);
  elements.teamAdminMembers.append(laneCard);
}

function renderTeamAdmin() {
  const teamOptions = state.api.teams
    .map((team) => ({ value: String(team.id), label: formatTeamCardTitle(team) }))
    .sort((left, right) => left.label.localeCompare(right.label));

  replaceOptions(elements.teamAdminTeamSelect, teamOptions);

  const selectedTeam = getSelectedAdminTeam();
  state.api.selectedTeamId = selectedTeam ? String(selectedTeam.id) : "";
  elements.teamAdminTeamSelect.value = state.api.selectedTeamId;
  if (selectedTeam) {
    elements.teamAdminRenameName.value = selectedTeam.name;
    elements.teamAdminRenameTag.value = selectedTeam.tag ?? "";
    elements.teamAdminRenameLogoUrl.value = "";
    if (elements.teamAdminRenameRemoveLogo) {
      elements.teamAdminRenameRemoveLogo.checked = false;
    }
  } else {
    elements.teamAdminRenameName.value = "";
    elements.teamAdminRenameTag.value = "";
    elements.teamAdminRenameLogoUrl.value = "";
    if (elements.teamAdminRenameRemoveLogo) {
      elements.teamAdminRenameRemoveLogo.checked = false;
    }
  }
  renderTeamAdminCurrentLogo(selectedTeam);

  const members = selectedTeam ? state.api.membersByTeamId[String(selectedTeam.id)] ?? [] : [];
  const teamMemberCount = members.length;
  const isLead = selectedTeam?.membership_role === "lead";
  const adminEnabled = Boolean(selectedTeam) && (isLead || isAdminUser());

  if (!adminEnabled && state.ui.teamManageAction !== null) {
    state.ui.teamManageAction = null;
    state.ui.teamManageActionContext = null;
  }
  renderTeamManageActions();

  elements.teamAdminRename.disabled = !adminEnabled;
  elements.teamAdminDelete.disabled = !adminEnabled;
  elements.teamAdminAddMember.disabled = !adminEnabled;
  elements.teamAdminUpdateRole.disabled = !adminEnabled;
  elements.teamAdminRemoveMember.disabled = !adminEnabled || teamMemberCount <= 1;
  elements.teamAdminRenameName.disabled = !adminEnabled;
  elements.teamAdminAddRiotId.disabled = !adminEnabled;
  elements.teamAdminAddRole.disabled = !adminEnabled;
  elements.teamAdminAddTeamRole.disabled = !adminEnabled;
  elements.teamAdminRoleRiotId.disabled = !adminEnabled;
  elements.teamAdminRole.disabled = !adminEnabled;
  elements.teamAdminTeamRoleRiotId.disabled = !adminEnabled;
  elements.teamAdminTeamRole.disabled = !adminEnabled;
  elements.teamAdminUpdateTeamRole.disabled = !adminEnabled;
  elements.teamAdminRemoveRiotId.disabled = !adminEnabled;
  elements.teamAdminRenameTag.disabled = !adminEnabled;
  elements.teamAdminRenameLogoUrl.disabled = !adminEnabled;
  if (elements.teamAdminRenameRemoveLogo) {
    elements.teamAdminRenameRemoveLogo.disabled = !adminEnabled;
  }
  if (elements.teamAdminRefresh) {
    elements.teamAdminRefresh.disabled = !isAuthenticated();
  }
  if (elements.teamAdminOpenEdit) {
    elements.teamAdminOpenEdit.hidden = !adminEnabled;
    elements.teamAdminOpenEdit.disabled = !adminEnabled;
  }
  setTeamCreateControlsDisabled(state.api.isCreatingTeam);
  renderTeamJoinWorkspace(selectedTeam);

  elements.teamAdminMembers.innerHTML = "";
  renderChampionTagEditor();
  renderTeamInviteList(selectedTeam);
  renderTeamInviteUserList();
  renderTeamActivityMembership();
  if (!selectedTeam) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = isAuthenticated()
      ? "No teams yet. Create a team to start."
      : "Sign in to manage teams.";
    elements.teamAdminMembers.append(empty);
    return;
  }

  const primaryMembersByLane = new Map(LANE_ORDER.map((lane) => [lane, []]));
  const substituteMembers = [];
  const unassignedPrimaryMembers = [];

  for (const member of members) {
    const teamRole = member?.team_role === "substitute" ? "substitute" : "primary";
    if (teamRole === "substitute") {
      substituteMembers.push(member);
      continue;
    }

    const lane = resolveMemberLane(member);
    if (lane && primaryMembersByLane.has(lane)) {
      primaryMembersByLane.get(lane).push(member);
    } else {
      unassignedPrimaryMembers.push(member);
    }
  }

  for (const lane of LANE_ORDER) {
    appendRosterLaneCard({
      laneLabel: lane,
      members: primaryMembersByLane.get(lane) ?? [],
      teamRole: "primary",
      adminEnabled,
      emptyClass: true,
      teamMemberCount
    });
  }

  if (unassignedPrimaryMembers.length > 0) {
    appendRosterLaneCard({
      laneLabel: "Unassigned",
      members: unassignedPrimaryMembers,
      teamRole: "primary",
      adminEnabled,
      showLane: true,
      teamMemberCount
    });
  }

  appendRosterLaneCard({
    laneLabel: "Substitutes",
    members: substituteMembers,
    teamRole: "substitute",
    adminEnabled,
    showLane: true,
    teamMemberCount
  });

  if (adminEnabled && substituteMembers.length > 0) {
    const substituteCard = elements.teamAdminMembers.querySelector("[data-lane='Substitutes'] .roster-slot-list");
    if (substituteCard) {
      substituteCard.append(
        createRosterOpenSlotRow({
          lane: "Substitutes",
          teamRole: "substitute",
          adminEnabled
        })
      );
    }
  }
}

function initializeTeamConfigControls() {
  const options = getTeamSelectOptions();
  if (elements.teamConfigActiveTeam) {
    replaceOptions(elements.teamConfigActiveTeam, options);
  }
  syncConfiguredTeamSelection();
  renderTeamConfig();
  renderTeamWorkspaceTabs();
  renderTeamManageActions();
  renderTeamAdmin();
}

function syncDerivedTeamDataFromPlayerConfig() {
  state.data.playerPoolsByTeam = clonePlayerPoolsByTeam(state.playerConfig.byTeam);
  state.data.teamPools = buildTeamPoolsFromPlayerPools(state.data.playerPoolsByTeam);
  state.data.teamPlayersByRole = buildTeamPlayersByRoleFromPlayerPools(state.data.playerPoolsByTeam);
}

function normalizePlayerConfigTeamId(teamId) {
  if (typeof teamId === "string" && state.playerConfig.byTeam[teamId]) {
    return teamId;
  }
  const preferredOrder = getConfiguredProfileRoles().map((role) => buildRolePoolTeamId(role));
  for (const candidate of preferredOrder) {
    if (state.playerConfig.byTeam[candidate]) {
      return candidate;
    }
  }
  const fallback = Object.keys(state.playerConfig.byTeam);
  return fallback[0] ?? "";
}

function renderPlayerConfigFeedback(message, isError = false) {
  elements.playerConfigFeedback.textContent = message;
  elements.playerConfigFeedback.style.color = isError ? "var(--warn)" : "var(--muted)";
}

function renderProfileRolesSection() {
  if (!elements.profilePrimaryRole || !elements.profileSecondaryRoles) {
    return;
  }
  const authenticated = isAuthenticated();
  const isSavingRoles = Boolean(state.profile.isSavingRoles);

  replaceOptions(
    elements.profilePrimaryRole,
    SLOTS.map((role) => ({ value: role, label: role }))
  );
  elements.profilePrimaryRole.value = state.profile.primaryRole;
  elements.profilePrimaryRole.disabled = !authenticated || isSavingRoles;
  if (elements.profileSaveRoles) {
    elements.profileSaveRoles.disabled = !authenticated || isSavingRoles;
    elements.profileSaveRoles.textContent = isSavingRoles ? "Saving..." : "Save Roles";
  }

  elements.profileSecondaryRoles.innerHTML = "";
  const selectedSecondary = new Set(state.profile.secondaryRoles);
  const secondaryCandidates = SLOTS.filter((role) => role !== state.profile.primaryRole);
  for (const role of secondaryCandidates) {
    const label = runtimeDocument.createElement("label");
    label.className = "profile-role-option";

    const checkbox = runtimeDocument.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = role;
    checkbox.checked = selectedSecondary.has(role);
    checkbox.disabled = !authenticated || isSavingRoles;
    checkbox.addEventListener("change", () => {
      const chosen = Array.from(
        elements.profileSecondaryRoles.querySelectorAll("input[type='checkbox']:checked"),
        (input) => input.value
      );
      state.profile.secondaryRoles = normalizeSecondaryRoles(chosen, state.profile.primaryRole);
    });

    const text = runtimeDocument.createElement("span");
    text.textContent = role;
    label.append(checkbox, text);
    elements.profileSecondaryRoles.append(label);
  }
}

function formatProfileChampionStatsSummary(championStats, authenticated) {
  if (!authenticated) {
    return "Sign in to load Riot champion stats.";
  }

  if (!championStats || typeof championStats !== "object") {
    return "Riot champion stats are unavailable.";
  }

  const status = typeof championStats.status === "string" ? championStats.status : "idle";
  const champions = Array.isArray(championStats.champions) ? championStats.champions : [];

  if (status === "ok") {
    if (champions.length === 0) {
      return "No Riot champion mastery data returned for this account.";
    }
    return `Top ${champions.length} champion mastery entr${champions.length === 1 ? "y" : "ies"} from Riot.`;
  }

  if (status === "disabled") {
    return championStats.message || "Riot integration is not configured on this deployment.";
  }
  if (status === "unlinked") {
    return championStats.message || "Link a Riot game name and tagline to load champion stats.";
  }
  if (status === "not_found") {
    return championStats.message || "No Riot account found for the linked Riot ID.";
  }
  if (status === "error") {
    return championStats.message || "Riot champion stats are temporarily unavailable.";
  }

  return "Riot champion stats are not implemented yet in this workspace.";
}

function formatLastPlayedText(lastPlayedAt) {
  if (typeof lastPlayedAt !== "string" || lastPlayedAt.trim() === "") {
    return "Last played: n/a";
  }
  const asDate = new Date(lastPlayedAt);
  if (Number.isNaN(asDate.getTime())) {
    return "Last played: n/a";
  }
  return `Last played: ${asDate.toLocaleDateString()}`;
}

function renderProfileChampionStatsSection() {
  if (!elements.profileRiotStatsSummary || !elements.profileRiotStatsList) {
    return;
  }

  const authenticated = isAuthenticated();
  const championStats = normalizeChampionStats(state.profile.championStats);
  elements.profileRiotStatsSummary.textContent = formatProfileChampionStatsSummary(championStats, authenticated);
  elements.profileRiotStatsList.innerHTML = "";

  if (!authenticated || championStats.status !== "ok" || championStats.champions.length === 0) {
    return;
  }

  for (const champion of championStats.champions) {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card";

    const title = runtimeDocument.createElement("strong");
    const championLabel =
      champion.championName && champion.championName.trim() !== ""
        ? champion.championName
        : `Champion #${champion.championId}`;
    title.textContent = championLabel;

    const mastery = runtimeDocument.createElement("p");
    mastery.className = "meta";
    mastery.textContent = `Mastery ${champion.championLevel} | ${NUMBER_FORMATTER.format(champion.championPoints)} pts`;

    const played = runtimeDocument.createElement("p");
    played.className = "meta";
    played.textContent = formatLastPlayedText(champion.lastPlayedAt);

    card.append(title, mastery, played);
    elements.profileRiotStatsList.append(card);
  }
}

function renderSettingsTeamList(target, teams, emptyMessage) {
  if (!target) {
    return;
  }
  target.innerHTML = "";
  if (teams.length === 0) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = emptyMessage;
    target.append(empty);
    return;
  }

  for (const team of teams) {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card settings-team-card";

    if (typeof team.logo_data_url === "string" && team.logo_data_url.trim() !== "") {
      const logoButton = runtimeDocument.createElement("button");
      logoButton.type = "button";
      logoButton.className = "summary-card-logo-button ghost";
      logoButton.setAttribute("aria-label", `Expand ${formatTeamCardTitle(team)} logo`);
      logoButton.addEventListener("click", () => {
        openLogoLightbox(team.logo_data_url, `${formatTeamCardTitle(team)} logo`);
      });

      const logo = runtimeDocument.createElement("img");
      logo.className = "summary-card-logo";
      logo.src = team.logo_data_url;
      logo.alt = `${team.name} logo`;
      logoButton.append(logo);
      card.append(logoButton);
    }

    const title = runtimeDocument.createElement("strong");
    title.className = "settings-team-card-title";
    title.textContent = formatTeamCardTitle(team);

    const details = runtimeDocument.createElement("p");
    details.className = "meta settings-team-card-meta";
    const lane = formatPositionLabel(team.membership_lane);
    details.textContent = `Role: ${formatMembershipRole(team.membership_role)} | Roster: ${formatRosterRole(team.membership_team_role)} | Position: ${lane}`;

    card.append(title, details);
    target.append(card);
  }
}

function renderSettingsTeamMembership() {
  const allTeams = [...state.api.teams].sort((left, right) => left.name.localeCompare(right.name));
  const authenticated = isAuthenticated();

  if (elements.settingsTeamsMemberSummary) {
    elements.settingsTeamsMemberSummary.textContent = authenticated
      ? `${allTeams.length} team${allTeams.length === 1 ? "" : "s"} total.`
      : "Sign in to view teams.";
  }

  renderSettingsTeamList(
    elements.settingsTeamsMemberList,
    allTeams,
    authenticated ? "You are not currently on any teams." : "Sign in to view teams."
  );
}

function renderTeamActivityMembership() {
  if (!elements.teamActivityTeamsSummary && !elements.teamActivityTeamsList) {
    return;
  }

  const currentTeams = [...state.api.teams].sort((left, right) => left.name.localeCompare(right.name));
  const authenticated = isAuthenticated();

  if (elements.teamActivityTeamsSummary) {
    elements.teamActivityTeamsSummary.textContent = authenticated
      ? `${currentTeams.length} team${currentTeams.length === 1 ? "" : "s"} total.`
      : "Sign in to view your teams.";
  }

  if (elements.teamActivityTeamsList) {
    renderSettingsTeamList(
      elements.teamActivityTeamsList,
      currentTeams,
      authenticated ? "You are not currently on any teams." : "Sign in to view teams."
    );
  }
}

async function syncPoolSelectionToApi(teamId) {
  const role = parseRolePoolTeamId(teamId);
  if (!role) {
    return;
  }

  let pool = state.api.poolByTeamId[teamId];
  if (!pool) {
    const created = await apiRequest("/me/pools", {
      method: "POST",
      auth: true,
      body: { name: role }
    });
    const createdPoolId = created?.pool?.id;
    if (!createdPoolId) {
      return;
    }
    await loadPoolsFromApi(teamId);
    pool = state.api.poolByTeamId[teamId];
    if (!pool) {
      return;
    }
  }

  const players = state.playerConfig.byTeam[teamId] ?? [];
  const activePlayer = players.find((player) => player.role === role);
  const desiredFamiliarityByChampion = normalizeFamiliarityByChampion(
    activePlayer?.champions ?? [],
    activePlayer?.familiarityByChampion
  );
  const desiredChampionIds = (activePlayer?.champions ?? [])
    .map((name) => state.data.championIdsByName[name])
    .filter((id) => Number.isInteger(id));
  const desiredFamiliarityByChampionId = {};
  for (const championName of activePlayer?.champions ?? []) {
    const championId = state.data.championIdsByName[championName];
    if (!Number.isInteger(championId)) {
      continue;
    }
    desiredFamiliarityByChampionId[championId] = normalizeFamiliarityLevel(
      desiredFamiliarityByChampion[championName]
    );
  }
  const desiredIdSet = new Set(desiredChampionIds);
  const currentIdSet = new Set((pool.champion_ids ?? []).map((value) => Number(value)));
  const currentFamiliarityByChampionId =
    pool?.champion_familiarity && typeof pool.champion_familiarity === "object"
      ? pool.champion_familiarity
      : {};

  const toAdd = [...desiredIdSet].filter((id) => !currentIdSet.has(id));
  const toRemove = [...currentIdSet].filter((id) => !desiredIdSet.has(id));
  const toAddSet = new Set(toAdd);

  for (const championId of toAdd) {
    const familiarity = normalizeFamiliarityLevel(
      desiredFamiliarityByChampionId[championId],
      DEFAULT_FAMILIARITY_LEVEL
    );
    await apiRequest(`/me/pools/${pool.id}/champions`, {
      method: "POST",
      auth: true,
      body: {
        champion_id: championId,
        familiarity
      }
    });
  }

  for (const championId of toRemove) {
    await apiRequest(`/me/pools/${pool.id}/champions/${championId}`, {
      method: "DELETE",
      auth: true
    });
  }

  const toUpdateFamiliarity = [...desiredIdSet].filter((championId) => {
    if (toAddSet.has(championId)) {
      return false;
    }
    const desiredFamiliarity = normalizeFamiliarityLevel(
      desiredFamiliarityByChampionId[championId],
      DEFAULT_FAMILIARITY_LEVEL
    );
    const currentFamiliarity = normalizeFamiliarityLevel(
      currentFamiliarityByChampionId[String(championId)],
      DEFAULT_FAMILIARITY_LEVEL
    );
    return desiredFamiliarity !== currentFamiliarity;
  });

  for (const championId of toUpdateFamiliarity) {
    await apiRequest(`/me/pools/${pool.id}/champions/${championId}/familiarity`, {
      method: "PUT",
      auth: true,
      body: {
        familiarity: normalizeFamiliarityLevel(
          desiredFamiliarityByChampionId[championId],
          DEFAULT_FAMILIARITY_LEVEL
        )
      }
    });
  }

  await loadPoolsFromApi(teamId);
  renderTeamConfig();
  renderBuilder();
}

async function saveActivePlayerPoolSelection() {
  const teamId = state.playerConfig.teamId;
  const role = parseRolePoolTeamId(teamId);
  if (!role) {
    renderPlayerConfigFeedback("Select a role pool first.", true);
    return;
  }
  if (!isPlayerPoolDirty(teamId)) {
    renderPlayerConfigFeedback("No champion changes to save.");
    return;
  }

  state.playerConfig.isSavingPool = true;
  renderMyChampions();

  try {
    if (isAuthenticated()) {
      await syncPoolSelectionToApi(teamId);
    } else {
      const saved = savePlayerConfig();
      if (!saved) {
        renderPlayerConfigFeedback("Champion updates are in memory, but local storage is unavailable.", true);
        return;
      }
    }

    setPlayerPoolDirty(teamId, false);
    renderPlayerConfigFeedback(`Saved pool updates for ${role}.`);
  } catch (error) {
    renderPlayerConfigFeedback(normalizeApiErrorMessage(error, "Failed to save pool updates."), true);
  } finally {
    state.playerConfig.isSavingPool = false;
    renderMyChampions();
  }
}

function renderPlayerConfig() {
  const user = state.auth.user;
  const authenticated = isAuthenticated();

  // --- Identity Header ---
  if (elements.profileSummonerName) {
    elements.profileSummonerName.textContent = authenticated && user
      ? `${user.gameName || ""}#${user.tagline || ""}`
      : "Not signed in";
  }

  // Avatar display (click opens modal)
  if (elements.profileAvatarDisplay) {
    elements.profileAvatarDisplay.innerHTML = "";
    const avatarChampion = state.profile.avatarChampionId && state.data
      ? (state.data.champions || []).find((c) => c.id === state.profile.avatarChampionId)
      : null;
    if (avatarChampion) {
      const img = runtimeDocument.createElement("img");
      img.src = getChampionImageUrl(avatarChampion.name);
      img.alt = avatarChampion.name;
      img.className = "profile-avatar-img";
      img.addEventListener("error", () => {
        img.src = championImageFallback(avatarChampion.name);
      }, { once: true });
      elements.profileAvatarDisplay.append(img);
    } else {
      const placeholder = runtimeDocument.createElement("span");
      placeholder.className = "profile-avatar-placeholder";
      placeholder.textContent = authenticated && user ? (user.gameName || "?")[0].toUpperCase() : "?";
      elements.profileAvatarDisplay.append(placeholder);
    }
  }

  // Roles display in header
  if (elements.profileRolesDisplay) {
    elements.profileRolesDisplay.innerHTML = "";
    const allRoles = getConfiguredProfileRoles();
    for (const role of allRoles) {
      const pill = runtimeDocument.createElement("span");
      pill.className = "profile-role-pill";
      if (role === state.profile.primaryRole) {
        pill.classList.add("is-primary");
      }
      pill.textContent = role;
      elements.profileRolesDisplay.append(pill);
    }
  }

  // Team display in header (right side, large)
  if (elements.profileTeamDisplay) {
    elements.profileTeamDisplay.innerHTML = "";
    const allTeams = [...state.api.teams].sort((a, b) => a.name.localeCompare(b.name));
    const displayTeam = state.profile.displayTeamId
      ? allTeams.find((t) => t.id === state.profile.displayTeamId)
      : allTeams[0] || null;
    if (displayTeam) {
      const teamName = runtimeDocument.createElement("span");
      teamName.className = "profile-team-name";
      teamName.textContent = displayTeam.name;
      teamName.style.cursor = "pointer";
      teamName.addEventListener("click", () => setTab("team-config", { syncRoute: true }));
      elements.profileTeamDisplay.append(teamName);
      if (displayTeam.logo_data_url) {
        const logo = runtimeDocument.createElement("img");
        logo.src = displayTeam.logo_data_url;
        logo.alt = `${displayTeam.name} logo`;
        logo.className = "profile-team-logo-lg";
        logo.style.cursor = "pointer";
        logo.addEventListener("click", () => setTab("team-config", { syncRoute: true }));
        elements.profileTeamDisplay.append(logo);
      }
    }
  }

  // --- Settings List Values ---
  if (elements.profileSettingRolesValue) {
    const allRoles = getConfiguredProfileRoles();
    elements.profileSettingRolesValue.textContent = allRoles.length > 0 ? allRoles.join(", ") : "None set";
  }

  if (elements.profileSettingAccountValue) {
    elements.profileSettingAccountValue.textContent = authenticated && user ? user.email : "Not signed in";
  }

  // Admin link visibility
  if (elements.profileAdminLink) {
    elements.profileAdminLink.hidden = !isAdminUser();
  }

  // --- Toggle editors ---
  const openSetting = state.profile.openSetting;
  const settingItems = elements.profileSettingsList
    ? elements.profileSettingsList.querySelectorAll(".profile-setting-item")
    : [];
  settingItems.forEach((item) => {
    const settingName = item.dataset.setting;
    const editor = item.querySelector(".profile-setting-editor");
    const chevron = item.querySelector(".profile-setting-chevron");
    const isOpen = settingName === openSetting;
    item.classList.toggle("is-open", isOpen);
    if (editor) editor.hidden = !isOpen;
    if (chevron) chevron.textContent = isOpen ? "⌄" : "›";
  });

  // --- Render Account Fields ---
  if (openSetting === "account" && elements.profileAccountFields) {
    if (elements.profileAccountFields.children.length === 0) {
      const fields = [
        { id: "profile-account-email", label: "Email", value: user ? user.email : "" },
        { id: "profile-account-gamename", label: "Game Name", value: user ? user.gameName : "" },
        { id: "profile-account-tagline", label: "Tagline", value: user ? user.tagline : "" },
        { id: "profile-account-firstname", label: "First Name", value: user ? (user.firstName || "") : "" },
        { id: "profile-account-lastname", label: "Last Name", value: user ? (user.lastName || "") : "" }
      ];
      const grid = runtimeDocument.createElement("div");
      grid.className = "grid grid-2";
      for (const field of fields) {
        const label = runtimeDocument.createElement("label");
        label.textContent = field.label;
        const input = runtimeDocument.createElement("input");
        input.type = "text";
        input.id = field.id;
        input.value = field.value;
        label.append(input);
        grid.append(label);
      }
      elements.profileAccountFields.append(grid);
    }
  }

  // --- Sub-renders ---
  renderProfileRolesSection();
  renderProfileChampionStatsSection();
}

function openAvatarModal() {
  state.profile.avatarFilter = "";
  state.profile.pendingAvatarId = state.profile.avatarChampionId;
  if (elements.avatarModalSearch) elements.avatarModalSearch.value = "";
  if (elements.avatarModal) elements.avatarModal.hidden = false;
  renderAvatarModalGrid();
}

function closeAvatarModal() {
  if (elements.avatarModal) elements.avatarModal.hidden = true;
}

function saveAvatarSelection() {
  state.profile.avatarChampionId = state.profile.pendingAvatarId;
  persistAvatarChampionId();
  closeAvatarModal();
  renderPlayerConfig();
}

const AVATAR_STORAGE_KEY = "draftengine_avatar_champion_id";

function persistAvatarChampionId() {
  if (!runtimeStorage) return;
  try {
    if (state.profile.avatarChampionId != null) {
      runtimeStorage.setItem(AVATAR_STORAGE_KEY, String(state.profile.avatarChampionId));
    } else {
      runtimeStorage.removeItem(AVATAR_STORAGE_KEY);
    }
  } catch { /* ignore storage errors */ }
}

function restoreAvatarChampionId() {
  if (!runtimeStorage) return;
  try {
    const stored = runtimeStorage.getItem(AVATAR_STORAGE_KEY);
    if (stored != null && stored !== "") {
      const parsed = Number(stored);
      if (Number.isInteger(parsed) && parsed > 0) {
        state.profile.avatarChampionId = parsed;
      }
    }
  } catch { /* ignore storage errors */ }
}

function renderAvatarModalGrid() {
  if (!elements.avatarModalGrid) return;
  elements.avatarModalGrid.innerHTML = "";
  const champions = state.data ? (state.data.champions || []) : [];
  const filter = (state.profile.avatarFilter || "").toLowerCase();
  const filtered = filter
    ? champions.filter((c) => c.name.toLowerCase().includes(filter))
    : champions;

  for (const champion of filtered) {
    const btn = runtimeDocument.createElement("button");
    btn.type = "button";
    btn.className = "avatar-option";
    if (champion.id === state.profile.pendingAvatarId) {
      btn.classList.add("is-selected");
    }

    const img = runtimeDocument.createElement("img");
    img.src = getChampionImageUrl(champion.name);
    img.alt = champion.name;
    img.className = "avatar-option-img";
    img.loading = "lazy";
    img.addEventListener("error", () => {
      img.src = championImageFallback(champion.name);
    }, { once: true });
    btn.append(img);

    const label = runtimeDocument.createElement("span");
    label.className = "avatar-option-name";
    label.textContent = champion.name;
    btn.append(label);

    btn.addEventListener("click", () => {
      state.profile.pendingAvatarId = champion.id;
      renderAvatarModalGrid();
    });
    elements.avatarModalGrid.append(btn);
  }
}

function openPrimaryRoleModal() {
  if (!elements.primaryRoleModal || !elements.primaryRoleModalOptions) return;
  elements.primaryRoleModal.hidden = false;
  if (elements.primaryRoleModalFeedback) elements.primaryRoleModalFeedback.textContent = "";
  elements.primaryRoleModalOptions.innerHTML = "";

  for (const role of SLOTS) {
    const btn = runtimeDocument.createElement("button");
    btn.type = "button";
    btn.className = "role-modal-option";
    if (role === state.profile.primaryRole) {
      btn.classList.add("is-selected");
    }
    btn.textContent = role;
    btn.addEventListener("click", () => {
      const oldPrimary = state.profile.primaryRole;
      state.profile.primaryRole = normalizeProfileRole(role);
      state.profile.secondaryRoles = normalizeSecondaryRoles(state.profile.secondaryRoles, state.profile.primaryRole);
      state.playerConfig.teamId = buildRolePoolTeamId(state.profile.primaryRole);
      if (elements.profilePrimaryRole) elements.profilePrimaryRole.value = role;

      if (isAuthenticated()) {
        if (elements.primaryRoleModalFeedback) elements.primaryRoleModalFeedback.textContent = "Saving...";
        void apiRequest("/me/profile", {
          method: "PUT",
          auth: true,
          body: {
            primaryRole: state.profile.primaryRole,
            secondaryRoles: state.profile.secondaryRoles
          }
        }).then(async (payload) => {
          const profile = payload?.profile ?? {};
          const primaryRole = normalizeProfileRole(profile.primaryRole);
          state.profile.primaryRole = primaryRole;
          state.profile.secondaryRoles = normalizeSecondaryRoles(profile.secondaryRoles, primaryRole);
          state.playerConfig.teamId = buildRolePoolTeamId(primaryRole);
          if (state.auth.user && typeof state.auth.user === "object") {
            state.auth.user.primaryRole = state.profile.primaryRole;
            state.auth.user.secondaryRoles = [...state.profile.secondaryRoles];
            saveAuthSession();
          }
          elements.primaryRoleModal.hidden = true;
          renderPlayerConfig();
          await hydrateAuthenticatedViews(state.playerConfig.teamId, state.api.selectedTeamId);
        }).catch((error) => {
          if (elements.primaryRoleModalFeedback) {
            elements.primaryRoleModalFeedback.textContent = normalizeApiErrorMessage(error, "Failed to save.");
            elements.primaryRoleModalFeedback.style.color = "var(--warn)";
          }
        });
      } else {
        elements.primaryRoleModal.hidden = true;
        renderPlayerConfig();
      }
    });
    elements.primaryRoleModalOptions.append(btn);
  }
}

function closePrimaryRoleModal() {
  if (elements.primaryRoleModal) elements.primaryRoleModal.hidden = true;
}

function openOtherRolesModal() {
  if (!elements.otherRolesModal) return;
  elements.otherRolesModal.hidden = false;
  if (elements.otherRolesModalFeedback) elements.otherRolesModalFeedback.textContent = "";
  renderProfileRolesSection();
}

function closeOtherRolesModal() {
  if (elements.otherRolesModal) elements.otherRolesModal.hidden = true;
}

function initializePlayerConfigControls() {
  renderPlayerConfig();
  renderPlayerConfigFeedback("");
  setProfileRolesFeedback("");
}

function tryReadJsonStorage(key, fallback) {
  if (!runtimeStorage) {
    return fallback;
  }
  try {
    const raw = runtimeStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fallback;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function tryWriteJsonStorage(key, value) {
  if (!runtimeStorage) {
    return false;
  }
  try {
    runtimeStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function loadStoredTeamConfig() {
  const stored = tryReadJsonStorage(TEAM_CONFIG_STORAGE_KEY, {});
  if (stored.activeTeamId === NONE_TEAM_ID) {
    state.teamConfig.activeTeamId = NONE_TEAM_ID;
    return;
  }

  const activeTeamId = normalizeTeamEntityId(stored.activeTeamId);
  if (activeTeamId) {
    state.teamConfig.activeTeamId = activeTeamId;
    return;
  }
  state.teamConfig.activeTeamId = NONE_TEAM_ID;
}

function saveTeamConfig() {
  tryWriteJsonStorage(TEAM_CONFIG_STORAGE_KEY, {
    activeTeamId: state.teamConfig.activeTeamId
  });
}

function savePlayerConfig() {
  return tryWriteJsonStorage(PLAYER_CONFIG_STORAGE_KEY, {
    teamId: state.playerConfig.teamId,
    byTeam: state.playerConfig.byTeam
  });
}

function loadStoredUiState() {
  const stored = tryReadJsonStorage(UI_STATE_STORAGE_KEY, {});
  state.ui.isNavCollapsed = stored.navCollapsed === true;
}

function saveUiState() {
  return tryWriteJsonStorage(UI_STATE_STORAGE_KEY, {
    navCollapsed: state.ui.isNavCollapsed
  });
}

function loadStoredAuthSession() {
  const stored = readStoredAuthSession();
  state.auth.token = stored.token;
  state.auth.user = stored.user;
  state.activeTab = resolvePostLoginTab(stored.user);
  const primaryRole = normalizeProfileRole(stored.user?.primaryRole);
  state.profile.primaryRole = primaryRole;
  state.profile.secondaryRoles = normalizeSecondaryRoles(stored.user?.secondaryRoles, primaryRole);
}

function loadStoredPlayerConfig() {
  state.playerConfig.byTeam = clonePlayerPoolsByTeam(state.data.defaultPlayerPoolsByTeam);
  state.playerConfig.dirtyPoolByTeamId = Object.fromEntries(
    Object.keys(state.playerConfig.byTeam).map((teamId) => [teamId, false])
  );
  state.playerConfig.isSavingPool = false;
  const stored = tryReadJsonStorage(PLAYER_CONFIG_STORAGE_KEY, {});
  const allowedChampionNames = new Set(Object.keys(state.data.championsByName));

  if (stored.byTeam && typeof stored.byTeam === "object" && !Array.isArray(stored.byTeam)) {
    for (const [teamId, storedPlayers] of Object.entries(stored.byTeam)) {
      if (!state.playerConfig.byTeam[teamId] || !Array.isArray(storedPlayers)) {
        continue;
      }

      const playersById = {};
      for (const candidate of storedPlayers) {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
          continue;
        }

        const role = typeof candidate.role === "string" ? candidate.role : "";
        if (!SLOTS.includes(role)) {
          continue;
        }

        const playerName = normalizePoolPlayerName(candidate.player, role);
        const playerId = `${role}::${playerName}`;
        if (!playersById[playerId]) {
          playersById[playerId] = {
            id: playerId,
            player: playerName,
            role,
            champions: [],
            familiarityByChampion: {}
          };
        }

        const champions = Array.isArray(candidate.champions) ? candidate.champions : [];
        const familiarityByChampion =
          candidate.familiarityByChampion &&
          typeof candidate.familiarityByChampion === "object" &&
          !Array.isArray(candidate.familiarityByChampion)
            ? candidate.familiarityByChampion
            : {};
        for (const champion of champions) {
          if (typeof champion !== "string" || !allowedChampionNames.has(champion)) {
            continue;
          }
          if (!playersById[playerId].champions.includes(champion)) {
            playersById[playerId].champions.push(champion);
          }
          playersById[playerId].familiarityByChampion[champion] = normalizeFamiliarityLevel(
            familiarityByChampion[champion]
          );
        }
      }

      const normalizedPlayers = Object.values(playersById);
      for (const player of normalizedPlayers) {
        const roleEligible = new Set(state.data.noneTeamPools[player.role] ?? []);
        player.champions = player.champions.filter((champion) => roleEligible.has(champion));
        player.champions.sort((left, right) => left.localeCompare(right));
        player.familiarityByChampion = normalizeFamiliarityByChampion(
          player.champions,
          player.familiarityByChampion
        );
      }
      normalizedPlayers.sort((left, right) => {
        const roleCmp = compareSlots(left.role, right.role);
        if (roleCmp !== 0) {
          return roleCmp;
        }
        return left.player.localeCompare(right.player);
      });

      if (normalizedPlayers.length > 0) {
        state.playerConfig.byTeam[teamId] = normalizedPlayers;
      }
    }
  }

  state.playerConfig.teamId = normalizePlayerConfigTeamId(
    typeof stored.teamId === "string" ? stored.teamId : null
  );
  syncDerivedTeamDataFromPlayerConfig();
}

function resetBuilderToDefaults() {
  syncConfiguredTeamSelection();
  state.builder.teamState = createEmptyTeamState();
  state.builder.draftOrder = [...SLOTS];
  state.builder.slotPoolRole = Object.fromEntries(SLOTS.map((s) => [s, s]));
  state.builder.showOptionalChecks = BUILDER_DEFAULTS.showOptionalChecksByDefault;
  state.builder.excludedChampions = [];
  state.builder.excludedSearch = "";
  state.builder.treeDensity = BUILDER_DEFAULTS.defaultTreeDensity;
  state.builder.treeSearch = "";
  state.builder.treeMinScore = 0;
  state.builder.treeMinCandidateScore = 1;
  state.builder.treeRankGoal = BUILDER_RANK_GOAL_VALID_END_STATES;
  state.builder.candidateScoringWeights = {
    ...BUILDER_DEFAULT_CANDIDATE_SCORING_WEIGHTS
  };
  state.builder.treeValidLeavesOnly = true;

  const rawBranch = Number.parseInt(String(state.data.config.treeDefaults.maxBranch), 10);
  state.builder.maxBranch = Number.isFinite(rawBranch) ? Math.max(1, rawBranch) : 8;

  resetBuilderTreeState();
  state.builder.treeDensity = BUILDER_DEFAULTS.defaultTreeDensity;
  setBuilderStage("setup");

  elements.builderMaxBranch.value = String(state.builder.maxBranch);
  elements.builderExcludedSearch.value = "";
  elements.treeSearch.value = "";
  elements.treeMinScore.value = "0";
  if (elements.treeMinCandidateScore) {
    elements.treeMinCandidateScore.value = "1";
  }
  if (elements.treeRankGoal) {
    elements.treeRankGoal.value = BUILDER_RANK_GOAL_VALID_END_STATES;
  }
  if (elements.treeCandidateRedundancyPenalty) {
    elements.treeCandidateRedundancyPenalty.value = String(
      BUILDER_DEFAULT_CANDIDATE_SCORING_WEIGHTS.redundancyPenalty
    );
  }
  elements.treeValidLeavesOnly.checked = true;
  elements.treeDensity.value = state.builder.treeDensity;

  saveTeamConfig();
  return true;
}

function getDraftContextMemberForLane(ctx, lane) {
  if (!ctx?.members?.length || !SLOTS.includes(lane)) {
    return null;
  }
  return (
    ctx.members.find((member) => member?.lane === lane && member?.teamRole === "primary") ??
    ctx.members.find((member) => member?.lane === lane) ??
    null
  );
}

function getChampionNamesFromDraftContextPool(member, poolName) {
  if (!member?.pools?.length) {
    return [];
  }
  const normalizedPoolName = normalizeApiSlot(poolName);
  if (!normalizedPoolName) {
    return [];
  }
  const memberPool =
    member.pools.find((pool) => normalizeApiSlot(pool?.name) === normalizedPoolName) ?? null;
  if (!memberPool || !Array.isArray(memberPool.championIds)) {
    return [];
  }
  const names = memberPool.championIds
    .map((id) => state.data.championNamesById[id])
    .filter(Boolean);
  return Array.from(new Set(names));
}


function getEnginePoolContext() {
  if (state.builder.teamId === NONE_TEAM_ID) {
    return {
      teamId: NONE_TEAM_ID,
      teamPools: {
        [NONE_TEAM_ID]: state.data.noneTeamPools
      }
    };
  }

  const ctx = state.builder.draftContext;
  if (ctx?.members?.length > 0) {
    const rolePools = createEmptyRolePools();
    for (const lane of SLOTS) {
      const member = getDraftContextMemberForLane(ctx, lane);
      rolePools[lane] = member
        ? getChampionNamesFromDraftContextPool(member, lane)
        : [];
    }
    return {
      teamId: state.builder.teamId,
      teamPools: {
        [state.builder.teamId]: rolePools
      }
    };
  }

  const profileRolePools = getProfileRolePools();
  return {
    teamId: BUILDER_PROFILE_POOL_CONTEXT_ID,
    teamPools: {
      [BUILDER_PROFILE_POOL_CONTEXT_ID]: profileRolePools
    }
  };
}

function getChampionsForSlotAndRole(slot, poolRole) {
  const ctx = state.builder.draftContext;
  if (ctx?.members?.length > 0) {
    const member = getDraftContextMemberForLane(ctx, slot);
    if (member) {
      return getChampionNamesFromDraftContextPool(member, poolRole);
    }
  }
  const { teamId, teamPools } = getEnginePoolContext();
  const rolePools = teamPools[teamId] ?? {};
  return rolePools[poolRole] ?? [];
}

async function fetchBuilderDraftContext(teamId) {
  state.builder.draftContext = null;
  if (!teamId || teamId === NONE_TEAM_ID || !isAuthenticated()) {
    return;
  }
  try {
    const payload = await apiRequest(`/teams/${teamId}/draft-context`, { auth: true });
    if (payload?.draftContext?.teamId === Number(teamId)) {
      state.builder.draftContext = payload.draftContext;
    }
  } catch {
    // silently fall back to profile pools
  }
}

function generateTreeFromCurrentState({ scrollToResults = true } = {}) {
  try {
    setInspectFeedback("");
    const { teamId, teamPools } = getEnginePoolContext();
    const requirements = getBuilderSelectedRequirements();
    state.builder.tree = generatePossibilityTree({
      teamState: state.builder.teamState,
      teamId,
      roleOrder: state.builder.draftOrder,
      teamPools,
      championsByName: state.data.championsByName,
      requirements,
      tagById: state.api.tagById,
      excludedChampions: state.builder.excludedChampions,
      maxBranch: state.builder.maxBranch,
      minCandidateScore: state.builder.treeMinCandidateScore,
      candidateScoringWeights: normalizeBuilderCandidateScoringWeights(state.builder.candidateScoringWeights),
      pruneUnreachableRequired: true,
      rankGoal: normalizeBuilderRankGoal(state.builder.treeRankGoal)
    });
    clearTreeSelectionState();
    setBuilderStage("inspect");
    renderBuilder();
    if (scrollToResults) {
      scrollReviewResultsIntoView();
    }
    return true;
  } catch (error) {
    setBuilderStage("inspect");
    setInspectFeedback(error instanceof Error ? error.message : "Failed to generate tree.");
    renderBuilder();
    return false;
  }
}

function applyBuilderScoringWeightChange(key, rawValue, fallback, { min = null } = {}) {
  let value = normalizeBuilderFiniteNumber(rawValue, fallback);
  if (Number.isFinite(min)) {
    value = Math.max(min, value);
  }
  state.builder.candidateScoringWeights = {
    ...state.builder.candidateScoringWeights,
    [key]: value
  };
  return value;
}

function isChampionInOtherSlot(slot, championName) {
  return SLOTS.some((otherSlot) => {
    if (otherSlot === slot) {
      return false;
    }
    return state.builder.teamState[otherSlot] === championName;
  });
}

function validateTeamSelections() {
  for (const slot of SLOTS) {
    const selected = state.builder.teamState[slot];
    if (!selected) continue;
    const poolRole = state.builder.slotPoolRole[slot] ?? slot;
    const pool = getChampionsForSlotAndRole(slot, poolRole);
    const valid = pool.includes(selected)
      && !state.builder.excludedChampions.includes(selected)
      && !isChampionInOtherSlot(slot, selected);
    if (!valid) {
      state.builder.teamState[slot] = null;
    }
  }
}

function championImageKey(name) {
  if (CHAMPION_IMAGE_OVERRIDES[name]) {
    return CHAMPION_IMAGE_OVERRIDES[name];
  }
  return name.replace(/[^A-Za-z]/g, "");
}

function championImageFallback(name) {
  const initials = name
    .split(/\s+/)
    .map((token) => token[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='72' height='112'>` +
      `<rect width='72' height='112' fill='#1a2228'/>` +
      `<text x='50%' y='52%' dominant-baseline='middle' text-anchor='middle' font-size='26' font-family='Arial' fill='#f2d0c2'>${initials}</text>` +
      `</svg>`
  )}`;
}

function getChampionImageUrl(name) {
  const key = championImageKey(name);
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${key}_0.jpg`;
}

function sortChampions(champions) {
  if (state.explorer.sortBy === "alpha-desc") {
    return champions.sort((left, right) => right.name.localeCompare(left.name));
  }
  if (state.explorer.sortBy === "role") {
    return champions.sort((left, right) => {
      const roleCmp = (left.roles[0] ?? "").localeCompare(right.roles[0] ?? "");
      if (roleCmp !== 0) {
        return roleCmp;
      }
      return left.name.localeCompare(right.name);
    });
  }
  return champions.sort((left, right) => left.name.localeCompare(right.name));
}

function applyExplorerSubTab() {
  const sub = state.explorer.subTab;
  elements.explorerSubNavBtns.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.explorerSub === sub);
  });
  if (elements.myChampionsPanel) {
    elements.myChampionsPanel.hidden = sub !== "my-champions";
  }
  if (elements.championGridPanel) {
    elements.championGridPanel.hidden = sub !== "edit-champions";
  }
  if (elements.championTagEditor) {
    elements.championTagEditor.hidden = sub !== "edit-champions" || !state.api.selectedChampionTagEditorId;
  }
}

function renderMyChampions() {
  state.playerConfig.teamId = normalizePlayerConfigTeamId(state.playerConfig.teamId);
  const teamOptions = getConfiguredProfileRoles().map((role) => ({
    value: buildRolePoolTeamId(role),
    label: role
  }));

  replaceOptions(elements.playerConfigTeam, teamOptions);
  elements.playerConfigTeam.value = state.playerConfig.teamId;

  const activeRole = parseRolePoolTeamId(state.playerConfig.teamId) ?? state.profile.primaryRole;
  const poolDirty = isPlayerPoolDirty(state.playerConfig.teamId);

  const players = state.playerConfig.byTeam[state.playerConfig.teamId] ?? [];
  const activePlayer = players.find((player) => player.role === activeRole) ?? null;
  if (activePlayer) {
    activePlayer.familiarityByChampion = normalizeFamiliarityByChampion(
      activePlayer.champions,
      activePlayer.familiarityByChampion
    );
  }
  if (elements.playerConfigSavePool) {
    elements.playerConfigSavePool.disabled = !activePlayer || !poolDirty || state.playerConfig.isSavingPool;
    elements.playerConfigSavePool.textContent = state.playerConfig.isSavingPool ? "Saving..." : "Save Champions";
  }

  elements.playerConfigGrid.innerHTML = "";
  if (!activePlayer) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = isAuthenticated()
      ? `No champions selected for ${activeRole}.`
      : "Sign in to load API-backed pools.";
    elements.playerConfigGrid.append(empty);
    return;
  }

  const card = runtimeDocument.createElement("article");
  card.className = "player-config-card";

  const poolControlHost = runtimeDocument.createElement("div");
  poolControlHost.className = "player-pool-control";

  const roleEligible = state.data.noneTeamPools[activeRole] ?? [];
  createCheckboxMultiControl({
    root: poolControlHost,
    options: roleEligible.map((championName) => ({
      value: championName,
      label: championName
    })),
    selectedValues: activePlayer.champions,
    placeholder: "No champions selected",
    searchable: true,
    searchPlaceholder: "Filter champions",
    summaryFormatter(selectedValues) {
      if (selectedValues.length === 0) {
        return "No champions selected";
      }
      return `${selectedValues.length} champion${selectedValues.length === 1 ? "" : "s"} selected`;
    },
    onChange(selectedValues) {
      activePlayer.champions = Array.from(new Set(selectedValues)).sort((left, right) => left.localeCompare(right));
      activePlayer.familiarityByChampion = normalizeFamiliarityByChampion(
        activePlayer.champions,
        activePlayer.familiarityByChampion
      );
      setPlayerPoolDirty(state.playerConfig.teamId, true);
      syncDerivedTeamDataFromPlayerConfig();
      syncConfiguredTeamSelection();
      setBuilderStage("setup");
      resetBuilderTreeState();
      validateTeamSelections();
      renderTeamConfig();
      renderBuilder();
      if (elements.playerConfigSavePool) {
        elements.playerConfigSavePool.disabled = state.playerConfig.isSavingPool;
      }
      renderPlayerConfigFeedback("Unsaved champion changes. Click Save Champions.");
    }
  });

  const familiarityHost = runtimeDocument.createElement("div");
  familiarityHost.className = "player-familiarity";

  const familiarityTitle = runtimeDocument.createElement("h3");
  familiarityTitle.textContent = "Familiarity Grade";
  const familiarityMeta = runtimeDocument.createElement("p");
  familiarityMeta.className = "meta";
  familiarityMeta.textContent = "S = one-trick detail mastery, A = high execution, B = misses some nuance, C = basic understanding.";
  familiarityHost.append(familiarityTitle, familiarityMeta);

  const selectedChampionNames = [...activePlayer.champions].sort((left, right) => left.localeCompare(right));
  if (selectedChampionNames.length === 0) {
    const emptyFamiliarity = runtimeDocument.createElement("p");
    emptyFamiliarity.className = "meta";
    emptyFamiliarity.textContent = "Select champions above to set familiarity.";
    familiarityHost.append(emptyFamiliarity);
  } else {
    const familiarityList = runtimeDocument.createElement("div");
    familiarityList.className = "player-familiarity-list";
    for (const championName of selectedChampionNames) {
      const familiarityRow = runtimeDocument.createElement("div");
      familiarityRow.className = "player-familiarity-row";

      const championLabel = runtimeDocument.createElement("strong");
      championLabel.className = "player-familiarity-name";
      championLabel.textContent = championName;

      const familiarityControl = runtimeDocument.createElement("div");
      familiarityControl.className = "player-familiarity-control";
      const familiaritySelect = runtimeDocument.createElement("select");
      familiaritySelect.className = "player-familiarity-select";

      for (const grade of FAMILIARITY_GRADES) {
        familiaritySelect.append(createOption(grade, grade));
      }

      const currentFamiliarity = normalizeFamiliarityLevel(activePlayer.familiarityByChampion[championName]);
      familiaritySelect.value = getFamiliarityGrade(currentFamiliarity);

      const familiarityDescription = runtimeDocument.createElement("span");
      familiarityDescription.className = "meta player-familiarity-description";
      const setDescriptionText = () => {
        const nextLevel = familiarityGradeToLevel(familiaritySelect.value);
        familiarityDescription.textContent = getFamiliarityLabel(nextLevel);
      };
      setDescriptionText();

      familiaritySelect.addEventListener("change", () => {
        const nextLevel = familiarityGradeToLevel(familiaritySelect.value);
        activePlayer.familiarityByChampion = normalizeFamiliarityByChampion(
          activePlayer.champions,
          {
            ...(activePlayer.familiarityByChampion ?? {}),
            [championName]: nextLevel
          }
        );
        setDescriptionText();
        setPlayerPoolDirty(state.playerConfig.teamId, true);
        if (elements.playerConfigSavePool) {
          elements.playerConfigSavePool.disabled = state.playerConfig.isSavingPool;
        }
        renderPlayerConfigFeedback("Unsaved familiarity changes. Click Save Champions.");
      });

      familiarityControl.append(familiaritySelect, familiarityDescription);
      familiarityRow.append(championLabel, familiarityControl);
      familiarityList.append(familiarityRow);
    }
    familiarityHost.append(familiarityList);
  }

  card.append(poolControlHost, familiarityHost);
  elements.playerConfigGrid.append(card);
}

function renderExplorer() {
  renderActivePills();
  renderChampionTagCatalog();
  renderChampionTagEditor();

  const query = state.explorer.search.trim().toLowerCase();
  const includeTags = new Set(state.explorer.includeTags);
  const excludeTags = new Set(state.explorer.excludeTags);

  const filtered = state.data.champions.filter((champion) => {
    if (query && !champion.name.toLowerCase().includes(query)) {
      return false;
    }
    if (state.explorer.roles.length > 0 && !state.explorer.roles.some((role) => champion.roles.includes(role))) {
      return false;
    }
    if (state.explorer.damageTypes.length > 0 && !state.explorer.damageTypes.includes(champion.damageType)) {
      return false;
    }
    if (state.explorer.scaling && champion.scaling !== state.explorer.scaling) {
      return false;
    }
    for (const tag of includeTags) {
      if (!champion.tags[tag]) {
        return false;
      }
    }
    for (const tag of excludeTags) {
      if (champion.tags[tag]) {
        return false;
      }
    }
    return true;
  });

  const sorted = sortChampions(filtered);
  elements.explorerCount.textContent = `Results: ${sorted.length}`;
  elements.explorerResults.innerHTML = "";

  if (sorted.length === 0) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "No champions match these filters.";
    elements.explorerResults.append(empty);
    return;
  }

  for (const champion of sorted) {
    const card = runtimeDocument.createElement("article");
    card.className = "champ-card";

    // ── Header: image + name/badge row + pencil ──────────────────────────
    const cardHeader = runtimeDocument.createElement("div");
    cardHeader.className = "champ-card-header";

    const image = runtimeDocument.createElement("img");
    image.className = "champ-thumb";
    image.alt = `${champion.name} portrait`;
    image.src = getChampionImageUrl(champion.name);
    image.loading = "lazy";
    image.addEventListener(
      "error",
      () => {
        image.src = championImageFallback(champion.name);
      },
      { once: true }
    );

    const nameWrap = runtimeDocument.createElement("div");
    nameWrap.className = "champ-card-name-wrap";

    const name = runtimeDocument.createElement("p");
    name.className = "champ-name";
    name.textContent = champion.name;
    nameWrap.append(name);

    if (champion.reviewed === true) {
      const indicator = runtimeDocument.createElement("span");
      indicator.className = "champ-reviewed-indicator";
      const check = runtimeDocument.createElement("span");
      check.className = "champ-reviewed-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "✓";
      indicator.append(check, " Human reviewed");
      nameWrap.append(indicator);
    }

    cardHeader.append(image, nameWrap);

    // ── Pencil edit button ───────────────────────────────────────────────
    const canEdit =
      isAuthenticated() &&
      isGlobalTagEditorUser() &&
      Number.isInteger(champion.id) &&
      champion.id > 0;
    if (canEdit) {
      const editBtn = runtimeDocument.createElement("button");
      editBtn.type = "button";
      editBtn.className = "champ-card-edit-btn";
      editBtn.title = "Edit Tags";
      editBtn.setAttribute("aria-label", `Edit tags for ${champion.name}`);
      editBtn.textContent = "✎";
      editBtn.addEventListener("click", () => {
        void openChampionTagEditor(champion.id);
      });
      cardHeader.append(editBtn);
    }

    // ── Meta section: Role(s) / Damage Type / Effectiveness Focus ───────
    const makeMetaSection = (labelText, pills, pillRowClass = "") => {
      const section = runtimeDocument.createElement("div");
      section.className = "champ-meta-section";
      const label = runtimeDocument.createElement("p");
      label.className = "champ-meta-label";
      label.textContent = labelText;
      const pillRow = runtimeDocument.createElement("div");
      pillRow.className = ("champ-meta-pills" + (pillRowClass ? " " + pillRowClass : "")).trim();
      pillRow.append(...pills);
      section.append(label, pillRow);
      return section;
    };

    const makePill = (text, extraClass = "") => {
      const pill = runtimeDocument.createElement("span");
      pill.className = ("champ-meta-pill" + (extraClass ? " " + extraClass : "")).trim();
      pill.textContent = text;
      return pill;
    };

    // Detect whether all role profiles are identical (shared profile scenario)
    const champRoles = champion.roles ?? [];
    const allRoleProfilesSame = (() => {
      if (champRoles.length <= 1) return true;
      const profiles = champRoles.map((r) => champion.roleProfiles?.[r]);
      if (profiles.some((p) => !p)) return false;
      const first = JSON.stringify(profiles[0]);
      return profiles.every((p) => JSON.stringify(p) === first);
    })();

    const buildCardMeta = (activeRoleKey) => {
      const meta = runtimeDocument.createElement("div");
      meta.className = "champ-card-meta";

      // Role pills — clickable if more than one role and profiles differ
      const roleBtns = champRoles.map((r) => {
        const btn = runtimeDocument.createElement("button");
        btn.type = "button";
        const isActive = allRoleProfilesSame || r === champRoles[0];
        btn.className = isActive ? "champ-role-pill is-active" : "champ-role-pill is-inactive";
        btn.textContent = r;
        if (champRoles.length > 1 && !allRoleProfilesSame) {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            state.explorer.activeCardRole[champion.id] = r;
            const newMeta = buildCardMeta(r);
            meta.replaceWith(newMeta);
          });
        }
        return btn;
      });

      // Profile data for active role
      const profile = champion.roleProfiles?.[activeRoleKey];
      const damageType = profile
        ? deriveDisplayDamageTypeFromProfile(profile)
        : champion.damageType;

      // Effectiveness Focus: always show all 3 phases
      const spikePills = [];
      if (profile?.effectiveness) {
        for (const phase of EFFECTIVENESS_PHASES) {
          const level = normalizeApiEffectivenessLevel(profile.effectiveness[phase]) ?? "neutral";
          const label = `${phase[0].toUpperCase()}${phase.slice(1)}: ${level[0].toUpperCase()}${level.slice(1)}`;
          spikePills.push(makePill(label, `champ-spike-${level}`));
        }
      } else if (champion.scaling) {
        spikePills.push(makePill(champion.scaling));
      }

      const damagePills = damageType
        ? [makePill(damageType, `champ-damage-${damageType.toLowerCase()}`)]
        : [];

      meta.append(
        makeMetaSection("Role(s)", roleBtns, "champ-role-pill-row"),
        makeMetaSection("Damage Type", damagePills),
        makeMetaSection("Effectiveness Focus", spikePills, "champ-spike-pill-row")
      );
      return meta;
    };

    const storedCardRole = state.explorer.activeCardRole[champion.id];
    const activeCardRole = (storedCardRole && champRoles.includes(storedCardRole)) ? storedCardRole : champRoles[0];
    const metaSection = buildCardMeta(activeCardRole);

    // ── Champion Tags collapsible ────────────────────────────────────────
    const tagDetails = runtimeDocument.createElement("details");
    tagDetails.className = "champ-card-tags-panel";

    const tagSummary = runtimeDocument.createElement("summary");
    const scopedTagNames = Array.isArray(champion.tagIds)
      ? champion.tagIds
          .map((tagId) => {
            const tag = state.api.tagById[String(tagId)];
            return tag ? { name: tag.name, definition: tag.definition ?? "" } : null;
          })
          .filter(Boolean)
      : [];
    tagSummary.textContent = `Champion Tags (${scopedTagNames.length})`;
    tagDetails.append(tagSummary);

    const tagFilter = runtimeDocument.createElement("input");
    tagFilter.type = "search";
    tagFilter.className = "champ-card-tag-filter";
    tagFilter.placeholder = "Filter tags…";
    tagDetails.append(tagFilter);

    const tagList = runtimeDocument.createElement("div");
    tagList.className = "champ-card-tag-list";

    if (scopedTagNames.length > 0) {
      for (const { name: tagName, definition } of scopedTagNames) {
        const chip = runtimeDocument.createElement("span");
        chip.className = "chip champ-tag-chip";
        chip.dataset.tagName = tagName.toLowerCase();
        chip.textContent = tagName;
        if (definition) {
          chip.title = definition;
        }
        tagList.append(chip);
      }
    } else {
      const empty = runtimeDocument.createElement("span");
      empty.className = "meta";
      empty.textContent = "No tags assigned.";
      tagList.append(empty);
    }
    tagDetails.append(tagList);

    tagFilter.addEventListener("input", () => {
      const query = tagFilter.value.trim().toLowerCase();
      for (const chip of tagList.querySelectorAll(".champ-tag-chip")) {
        chip.hidden = query.length > 0 && !chip.dataset.tagName.includes(query);
      }
    });

    card.append(cardHeader, metaSection, tagDetails);
    elements.explorerResults.append(card);
  }
}

function renderTeamContext() {
  elements.builderTeamContext.innerHTML = "";
  for (const slot of SLOTS) {
    const chip = runtimeDocument.createElement("span");
    chip.className = "context-chip";
    chip.textContent = `${getSlotLabel(slot)}: ${state.builder.teamState[slot] ?? "Empty"}`;
    elements.builderTeamContext.append(chip);
  }
}

function evaluateComposerRequirements() {
  const selectedRequirements = getBuilderSelectedRequirements();
  const { teamId, teamPools } = getEnginePoolContext();
  return evaluateCompositionRequirements({
    teamState: state.builder.teamState,
    championsByName: state.data.championsByName,
    requirements: selectedRequirements,
    teamPools,
    teamId,
    excludedChampions: state.builder.excludedChampions,
    tagById: state.api.tagById
  });
}

function getComposerRedundancyPenalty() {
  return normalizeBuilderCandidateScoringWeights(state.builder.candidateScoringWeights).redundancyPenalty;
}

function buildComposerRequirementScoreBreakdown(requirementEvaluation) {
  return buildRequirementScoreBreakdown(requirementEvaluation, getComposerRedundancyPenalty());
}

function formatRequirementHeadline(requirementResult) {
  const clauses = Array.isArray(requirementResult?.clauses) ? requirementResult.clauses : [];
  const totalUnderBy = clauses.reduce((sum, clause) => sum + (clause?.underBy ?? 0), 0);
  const totalOverBy = clauses.reduce((sum, clause) => sum + (clause?.overBy ?? 0), 0);
  if (totalUnderBy > 0) {
    return `Missing ${totalUnderBy} required match${totalUnderBy === 1 ? "" : "es"}.`;
  }
  if (totalOverBy > 0) {
    return `Meets minimums, but has ${totalOverBy} redundant extra match${totalOverBy === 1 ? "" : "es"}.`;
  }
  return "Currently in range.";
}

function buildRequirementStatusRow(requirementResult, requirementScore = null) {
  const status = requirementResult.status;
  const passed = status === "pass";
  const item = runtimeDocument.createElement("li");
  item.className = `check is-required ${passed ? "is-passed" : "is-failed"}`;

  const titleRow = runtimeDocument.createElement("div");
  titleRow.className = "check-title-row";
  const title = runtimeDocument.createElement("strong");
  title.textContent = requirementResult.name;

  const badgeRow = runtimeDocument.createElement("div");
  badgeRow.className = "check-badges";
  const requirementBadge = runtimeDocument.createElement("span");
  requirementBadge.className = "check-badge is-required";
  requirementBadge.textContent = "Required";
  const stateBadge = runtimeDocument.createElement("span");
  stateBadge.className = `check-badge ${passed ? "is-passed" : "is-failed"}`;
  stateBadge.textContent = passed ? "Passed" : status === "pending" ? "Pending" : "Failed";
  badgeRow.append(requirementBadge, stateBadge);
  titleRow.append(title, badgeRow);

  const detail = runtimeDocument.createElement("div");
  detail.className = "check-headline";
  detail.textContent = formatRequirementHeadline(requirementResult);
  item.append(titleRow, detail);

  if (requirementResult.definition) {
    const definition = runtimeDocument.createElement("p");
    definition.className = "meta";
    definition.textContent = requirementResult.definition;
    item.append(definition);
  }

  if (Array.isArray(requirementResult.clauses) && requirementResult.clauses.length > 0) {
    const clauseSummary = runtimeDocument.createElement("p");
    clauseSummary.className = "meta";
    const clausesMissing = requirementResult.clauses.filter((clause) => (clause?.underBy ?? 0) > 0).length;
    const clausesOverflowing = requirementResult.clauses.filter((clause) => (clause?.overBy ?? 0) > 0).length;
    const summaryParts = [];
    if (clausesMissing > 0) {
      summaryParts.push(`${clausesMissing} clause${clausesMissing === 1 ? "" : "s"} still need coverage`);
    }
    if (clausesOverflowing > 0) {
      summaryParts.push(`${clausesOverflowing} clause${clausesOverflowing === 1 ? "" : "s"} overflow max`);
    }
    if (summaryParts.length < 1) {
      summaryParts.push("All clause ranges currently satisfied");
    }
    clauseSummary.textContent = summaryParts.join(" | ");
    item.append(clauseSummary);

    const clauseDetails = runtimeDocument.createElement("details");
    clauseDetails.className = "debug-details";
    const clauseDetailsSummary = runtimeDocument.createElement("summary");
    clauseDetailsSummary.textContent = "Clause details";
    clauseDetails.append(clauseDetailsSummary);

    const clausesList = runtimeDocument.createElement("ul");
    clausesList.className = "meta check-clause-list";
    const clauseScoreById = new Map(
      Array.isArray(requirementScore?.clauses)
        ? requirementScore.clauses.map((clause) => [clause.id, clause])
        : []
    );

    for (const [index, clause] of requirementResult.clauses.entries()) {
      const clauseId =
        typeof clause?.id === "string" && clause.id.trim() !== ""
          ? clause.id.trim()
          : `clause-${index + 1}`;
      const clauseScore = clauseScoreById.get(clauseId) ?? null;
      const clauseItem = runtimeDocument.createElement("li");
      const rangeLabel = clause.maxCount === null ? `${clause.minCount}+` : `${clause.minCount}-${clause.maxCount}`;
      const pieces = [`${clause.currentMatches}/${rangeLabel}`];
      if ((clause.underBy ?? 0) > 0) {
        pieces.push(`needs ${clause.underBy}`);
      } else {
        pieces.push("minimum met");
      }
      if ((clause.overBy ?? 0) > 0) {
        pieces.push(`overflow ${clause.overBy}`);
      }
      if (clauseScore) {
        pieces.push(`score ${clauseScore.scoreContribution}`);
      }
      clauseItem.textContent = `C${index + 1}: ${pieces.join(" | ")}`;
      clausesList.append(clauseItem);
    }
    clauseDetails.append(clausesList);
    item.append(clauseDetails);
  }

  if (requirementScore) {
    const scoreMeta = runtimeDocument.createElement("p");
    scoreMeta.className = "meta";
    scoreMeta.textContent =
      `Missing matches ${requirementScore.totalUnderBy} | redundancy overflow ${requirementScore.totalOverBy}.`;
    item.append(scoreMeta);
  }

  return item;
}

function renderChecks() {
  const completion = getTeamCompletionInfo(state.builder.teamState);
  if (elements.builderOptionalChecks) {
    elements.builderOptionalChecks.innerHTML = "";
    elements.builderOptionalChecks.hidden = true;
  }
  const selectedComposition = getBuilderSelectedComposition();
  if (!selectedComposition) {
    elements.builderChecksReadiness.textContent =
      "Select a composition to evaluate requirement clauses and generate a composition-aware tree.";
    elements.builderRequiredChecks.innerHTML = "";
    const empty = runtimeDocument.createElement("li");
    empty.className = "check is-optional";
    empty.textContent = "No composition selected.";
    elements.builderRequiredChecks.append(empty);
    return;
  }

  const requirementEvaluation = evaluateComposerRequirements();
  const scoreBreakdown = buildComposerRequirementScoreBreakdown(requirementEvaluation);
  const requiredTotal = requirementEvaluation.requiredSummary.requiredTotal;
  const requiredPassed = requirementEvaluation.requiredSummary.requiredPassed;
  const requiredGaps = requirementEvaluation.requiredSummary.requiredGaps;

  if (completion.completionState === "empty" || completion.completionState === "partial") {
    elements.builderChecksReadiness.textContent =
      `Composition '${selectedComposition.name}': ${completion.filledSlots}/${completion.totalSlots} slots filled. ` +
      `Requirements passed: ${requiredPassed}/${requiredTotal}.`;
  } else {
    elements.builderChecksReadiness.textContent =
      `Composition '${selectedComposition.name}': Requirements passed ${requiredPassed}/${requiredTotal}. ` +
      (requiredGaps > 0 ? `${requiredGaps} requirement gap(s) remain.` : "No requirement gaps.");
  }

  elements.builderRequiredChecks.innerHTML = "";
  const requirementResults = requirementEvaluation.requirements;
  if (!Array.isArray(requirementResults) || requirementResults.length < 1) {
    const empty = runtimeDocument.createElement("li");
    empty.className = "check is-optional";
    empty.textContent = "Selected composition has no requirements.";
    elements.builderRequiredChecks.append(empty);
    return;
  }
  for (const requirementResult of requirementResults) {
    const requirementScore =
      scoreBreakdown.requirements.find((candidate) => candidate.requirementId === requirementResult.id) ?? null;
    elements.builderRequiredChecks.append(buildRequirementStatusRow(requirementResult, requirementScore));
  }
}

function renderExcludedPills() {
  elements.builderExcludedPills.innerHTML = "";
  if (state.builder.excludedChampions.length === 0) {
    const empty = runtimeDocument.createElement("span");
    empty.className = "meta";
    empty.textContent = "No excluded champions selected.";
    elements.builderExcludedPills.append(empty);
    return;
  }

  const sorted = [...state.builder.excludedChampions].sort((left, right) => left.localeCompare(right));
  for (const championName of sorted) {
    const pill = runtimeDocument.createElement("span");
    pill.className = "pill pill-removable";
    pill.textContent = championName;
    pill.title = `Click to remove ${championName} from exclusions`;
    pill.addEventListener("click", () => {
      state.builder.excludedChampions = state.builder.excludedChampions.filter((name) => name !== championName);
      resetBuilderTreeState();
      setBuilderStage("setup");
      validateTeamSelections();
      renderTeamConfig();
      renderBuilder();
    });
    elements.builderExcludedPills.append(pill);
  }
}

function renderExcludedOptions() {
  const query = state.builder.excludedSearch.trim().toLowerCase();
  const allChampions = state.data.champions
    .map((champion) => champion.name)
    .sort((left, right) => left.localeCompare(right));

  const filtered = allChampions.filter((name) =>
    query ? name.toLowerCase().includes(query) : true
  );

  elements.builderExcludedOptions.innerHTML = "";

  if (filtered.length === 0) {
    const empty = runtimeDocument.createElement("li");
    empty.className = "pool-snapshot-empty";
    empty.textContent = "No champions match the current search.";
    elements.builderExcludedOptions.append(empty);
    return;
  }

  for (const championName of filtered) {
    const li = runtimeDocument.createElement("li");
    li.textContent = championName;
    if (state.builder.excludedChampions.includes(championName)) {
      li.classList.add("is-selected");
    }
    li.addEventListener("click", () => {
      if (state.builder.excludedChampions.includes(championName)) {
        state.builder.excludedChampions = state.builder.excludedChampions.filter((name) => name !== championName);
      } else {
        state.builder.excludedChampions.push(championName);
      }

      for (const slot of SLOTS) {
        if (state.builder.teamState[slot] === championName) {
          state.builder.teamState[slot] = null;
        }
      }

      resetBuilderTreeState();
      setBuilderStage("setup");
      validateTeamSelections();
      renderTeamConfig();
      renderBuilder();
    });
    elements.builderExcludedOptions.append(li);
  }
}

function moveSlotInDraftOrder(slot, direction) {
  const order = [...state.builder.draftOrder];
  const idx = order.indexOf(slot);
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= order.length) {
    return;
  }
  order.splice(idx, 1);
  order.splice(newIdx, 0, slot);
  state.builder.draftOrder = order;
  setBuilderStage("setup");
  resetBuilderTreeState();
  renderTeamConfig();
  renderBuilder();
}

function renderDraftOrder() {
  const activeNextRole = getActiveNextRole(state.builder.draftOrder, state.builder.teamState);
  if (activeNextRole) {
    elements.builderNextRoleReadout.textContent = `Next expansion role: ${getSlotLabel(activeNextRole)}`;
  } else {
    elements.builderNextRoleReadout.textContent = "All roles are already filled.";
  }
}

function getNodeById(nodeId = "0") {
  if (!state.builder.tree) {
    return null;
  }
  if (nodeId === "0") {
    return state.builder.tree;
  }

  const indexes = nodeId
    .split(".")
    .slice(1)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value >= 0);

  let cursor = state.builder.tree;
  for (const index of indexes) {
    if (!cursor?.children?.[index]) {
      return null;
    }
    cursor = cursor.children[index];
  }
  return cursor ?? null;
}

function getFocusedTreeNodeId() {
  if (!state.builder.tree) {
    return "0";
  }
  const candidate = state.builder.focusNodeId ?? "0";
  return getNodeById(candidate) ? candidate : "0";
}

function getFocusedTreeNode() {
  return getNodeById(getFocusedTreeNodeId());
}

function inspectNode(node, nodeId, nodeTitle) {
  setBuilderStage("inspect");
  state.builder.focusNodeId = nodeId;
  state.builder.teamState = normalizeTeamState(node.teamSlots);
  validateTeamSelections();
  clearBuilderFeedback();
  setSetupFeedback("");
  state.builder.selectedNodeId = nodeId;
  state.builder.selectedNodeTitle = nodeTitle;
  renderTeamConfig();
  renderTree();
  renderTreeMap();
}

function getSelectedPathIds() {
  if (!state.builder.selectedNodeId) {
    return new Set();
  }
  const segments = state.builder.selectedNodeId.split(".");
  const ids = new Set();
  for (let length = 1; length <= segments.length; length += 1) {
    ids.add(segments.slice(0, length).join("."));
  }
  return ids;
}

function getNodeStatus(node) {
  if (node?.viability?.isTerminalValid) {
    return "terminal-valid";
  }
  if ((node?.branchPotential?.validLeafCount ?? 0) > 0) {
    return "recoverable";
  }
  return "filtered-context";
}

function buildTreeFilterContext() {
  return {
    minScore: state.builder.treeMinScore,
    query: state.builder.treeSearch,
    slots: SLOTS,
    validLeavesOnly: state.builder.treeValidLeavesOnly
  };
}

function nodePassesActiveTreeFilters(node) {
  const filters = buildTreeFilterContext();
  return nodePassesTreeFilters(
    node,
    filters.minScore,
    filters.query,
    filters.slots,
    filters.validLeavesOnly
  );
}

function getCandidateBreakdownLines(candidateBreakdown, limit = 3) {
  if (!candidateBreakdown || !Array.isArray(candidateBreakdown.requirements)) {
    return [];
  }

  const lines = [];
  for (const requirement of candidateBreakdown.requirements) {
    for (const clause of requirement.clauses ?? []) {
      if (clause.underDelta > 0) {
        lines.push(`${requirement.requirementName} ${clause.label}: +${clause.underDelta} required coverage`);
      }
      if (clause.overDelta > 0) {
        lines.push(`${requirement.requirementName} ${clause.label}: +${clause.overDelta} redundancy overflow`);
      }
      if (clause.overDelta < 0) {
        lines.push(
          `${requirement.requirementName} ${clause.label}: -${Math.abs(clause.overDelta)} redundancy overflow`
        );
      }
    }
  }

  if (candidateBreakdown.unreachablePenalty > 0) {
    lines.push(`unreachable penalty ${candidateBreakdown.unreachablePenalty}`);
  }

  return lines.slice(0, limit);
}

function getCandidateDeltaSummary(candidateBreakdown) {
  const summary = {
    totalCoverageGain: 0,
    totalCoverageLoss: 0,
    totalOverflowAdded: 0,
    totalOverflowReduced: 0,
    changedClauseCount: 0,
    unreachablePenalty: Number(candidateBreakdown?.unreachablePenalty ?? 0) || 0
  };
  if (!candidateBreakdown || !Array.isArray(candidateBreakdown.requirements)) {
    return summary;
  }
  for (const requirement of candidateBreakdown.requirements) {
    for (const clause of requirement.clauses ?? []) {
      if (clause.underDelta > 0) {
        summary.totalCoverageGain += clause.underDelta;
        summary.changedClauseCount += 1;
      } else if (clause.underDelta < 0) {
        summary.totalCoverageLoss += Math.abs(clause.underDelta);
        summary.changedClauseCount += 1;
      }
      if (clause.overDelta > 0) {
        summary.totalOverflowAdded += clause.overDelta;
        summary.changedClauseCount += 1;
      } else if (clause.overDelta < 0) {
        summary.totalOverflowReduced += Math.abs(clause.overDelta);
        summary.changedClauseCount += 1;
      }
    }
  }
  return summary;
}

function getCandidateBenefitLines(candidateBreakdown, limit = 2) {
  const rawLines = getCandidateBreakdownLines(candidateBreakdown, 8);
  return rawLines.filter((line) => !line.startsWith("unreachable penalty")).slice(0, limit);
}

function getCandidateBenefitMeta(candidateBreakdown, limit = 2) {
  const rawLines = getCandidateBreakdownLines(candidateBreakdown, 100).filter(
    (line) => !line.startsWith("unreachable penalty")
  );
  return {
    lines: rawLines.slice(0, limit),
    hiddenCount: Math.max(0, rawLines.length - limit),
    summary: getCandidateDeltaSummary(candidateBreakdown)
  };
}

function getRemainingCoverageMeta(scoreBreakdown, limit = 2) {
  const lines = [];
  if (!scoreBreakdown || !Array.isArray(scoreBreakdown.requirements)) {
    return { lines, hiddenCount: 0 };
  }
  for (const requirement of scoreBreakdown.requirements) {
    for (const clause of requirement.clauses ?? []) {
      if ((clause?.underBy ?? 0) > 0) {
        lines.push(`${requirement.requirementName} ${clause.label}: needs ${clause.underBy}`);
      }
    }
  }
  return {
    lines: lines.slice(0, limit),
    hiddenCount: Math.max(0, lines.length - limit)
  };
}

function getBranchImpactSummary(candidateBreakdown) {
  const summary = getCandidateDeltaSummary(candidateBreakdown);
  const parts = [];
  if (summary.totalCoverageGain > 0) {
    parts.push(
      `Immediate gain: +${summary.totalCoverageGain} required coverage across ${summary.changedClauseCount} clause change${summary.changedClauseCount === 1 ? "" : "s"}`
    );
  }
  if (summary.totalOverflowAdded > 0) {
    parts.push(`Adds ${summary.totalOverflowAdded} redundancy overflow`);
  } else if (summary.totalOverflowReduced > 0) {
    parts.push(`Reduces redundancy overflow by ${summary.totalOverflowReduced}`);
  }
  if (summary.totalCoverageLoss > 0) {
    parts.push(`Loses ${summary.totalCoverageLoss} required coverage`);
  }
  if (parts.length < 1) {
    return "No immediate clause coverage change; ranked via downstream viable finishes.";
  }
  return parts.join(" | ");
}

function getBranchStatusLine(node) {
  const missing = node?.scoreBreakdown?.totalUnderBy ?? 0;
  const overflow = node?.scoreBreakdown?.totalOverBy ?? 0;
  if (missing > 0) {
    return `${missing} required coverage still missing`;
  }
  if (overflow > 0) {
    return `All minimums met, ${overflow} redundant overflow`;
  }
  return "All current clause ranges satisfied";
}

function getRankGoalLabel() {
  return normalizeBuilderRankGoal(state.builder.treeRankGoal) === BUILDER_RANK_GOAL_CANDIDATE_SCORE
    ? "Ranked by immediate candidate score"
    : "Ranked by viable end states first";
}

function renderTreeNode(node, depth = 0, nodeId = "0", visibleIds = null) {
  if (visibleIds && !visibleIds.has(nodeId)) {
    return null;
  }

  const details = runtimeDocument.createElement("details");
  details.open = depth <= 1;

  const summary = runtimeDocument.createElement("summary");
  const nodeBox = runtimeDocument.createElement("div");
  nodeBox.className = "node";
  nodeBox.classList.add(`is-${getNodeStatus(node)}`);
  if (!nodePassesActiveTreeFilters(node)) {
    nodeBox.classList.add("is-context");
  }

  if (state.builder.selectedNodeId === nodeId) {
    nodeBox.classList.add("is-selected");
  }

  const titleRow = runtimeDocument.createElement("div");
  titleRow.className = "node-title";
  const title = runtimeDocument.createElement("strong");
  const titleText = node.addedChampion
    ? `${node.addedRole}: ${node.addedChampion}`
    : "Root Composition";
  title.textContent = titleText;
  const score = runtimeDocument.createElement("small");
  score.textContent = getBranchStatusLine(node);
  titleRow.append(title, score);

  const action = runtimeDocument.createElement("button");
  action.type = "button";
  action.textContent = "Inspect";
  action.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    inspectNode(node, nodeId, titleText);
  });

  const actionRow = runtimeDocument.createElement("div");
  actionRow.className = "button-row";
  actionRow.append(action);

  nodeBox.append(titleRow, actionRow);

  const candidateBenefits = getCandidateBenefitMeta(node.candidateBreakdown, 2);
  if (candidateBenefits.lines.length > 0) {
    const candidateMeta = runtimeDocument.createElement("div");
    candidateMeta.className = "branch-benefit-list";
    const visibleLines = [...candidateBenefits.lines];
    if (candidateBenefits.hiddenCount > 0) {
      visibleLines.push(`+${candidateBenefits.hiddenCount} more clause change${candidateBenefits.hiddenCount === 1 ? "" : "s"}`);
    }
    candidateMeta.textContent = visibleLines.join(" | ");
    nodeBox.append(candidateMeta);
  }

  if (node.addedChampion) {
    const nodeDebug = runtimeDocument.createElement("details");
    nodeDebug.className = "debug-details";
    const nodeDebugSummary = runtimeDocument.createElement("summary");
    nodeDebugSummary.textContent = "Debug scores";
    const nodeDebugBody = runtimeDocument.createElement("p");
    nodeDebugBody.className = "meta";
    const nodeDeltaSummary = getCandidateDeltaSummary(node.candidateBreakdown);
    nodeDebugBody.textContent =
      `Composition score ${node.score} | candidate score ${node.candidateScore ?? 0} | ` +
      `+${nodeDeltaSummary.totalCoverageGain} required coverage | ` +
      `redundancy overflow +${nodeDeltaSummary.totalOverflowAdded} | ` +
      `missing coverage ${node.scoreBreakdown?.totalUnderBy ?? 0}`;
    nodeDebug.append(nodeDebugSummary, nodeDebugBody);
    nodeBox.append(nodeDebug);
  }

  if (Array.isArray(node.pathRationale) && node.pathRationale.length > 0) {
    const rationale = runtimeDocument.createElement("div");
    rationale.className = "chip-row";
    const reasonsToShow = node.pathRationale.slice(-4);
    for (const reason of reasonsToShow) {
      const chip = runtimeDocument.createElement("span");
      chip.className = "chip";
      chip.textContent = reason;
      rationale.append(chip);
    }
    if (node.pathRationale.length > reasonsToShow.length) {
      const more = runtimeDocument.createElement("span");
      more.className = "chip";
      more.textContent = `+${node.pathRationale.length - reasonsToShow.length} more reasons`;
      rationale.append(more);
    }
    nodeBox.append(rationale);
  }

  summary.append(nodeBox);
  details.append(summary);

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    const renderedChild = renderTreeNode(child, depth + 1, `${nodeId}.${index}`, visibleIds);
    if (renderedChild) {
      details.append(renderedChild);
    }
  }
  return details;
}

function collectIncompleteDraftReasons(root) {
  const flat = flattenTreeForMap(root);
  const incompleteLeaves = flat
    .map((entry) => entry.node)
    .filter((node) => node.children.length === 0 && !node.viability?.isDraftComplete);

  const blockedRoles = new Map();
  const blockedReasons = new Map();
  const unreachableRequired = new Set();

  for (const node of incompleteLeaves) {
    const role = node.viability?.blockedRole;
    if (role) {
      blockedRoles.set(role, (blockedRoles.get(role) ?? 0) + 1);
    }
    const reason = node.viability?.blockedReason;
    if (reason) {
      blockedReasons.set(reason, (blockedReasons.get(reason) ?? 0) + 1);
    }
    for (const checkName of node.viability?.unreachableRequired ?? []) {
      unreachableRequired.add(checkName);
    }
  }

  return {
    incompleteLeafCount: incompleteLeaves.length,
    blockedRoles,
    blockedReasons,
    unreachableRequired: [...unreachableRequired]
  };
}

function getTopCountEntry(map) {
  let bestKey = null;
  let bestCount = 0;
  for (const [key, count] of map.entries()) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  return bestKey ? { key: bestKey, count: bestCount } : null;
}

function formatBlockedReason(reason, role) {
  switch (reason) {
    case "no_eligible_champions_for_role":
      return `most dead-end paths run out at ${role} because no eligible champions remain after pool/exclusion/duplicate constraints.`;
    default:
      return `most dead-end paths run out at ${role} due to no viable candidates.`;
  }
}

function renderTreeSummary(root, rootNodeId, visibleIds) {
  elements.builderTreeSummary.innerHTML = "";
  if (!state.builder.tree || !root) {
    return;
  }
  const flat = flattenTreeForMap(root, rootNodeId).filter((entry) => visibleIds.has(entry.id));
  const generationStats = state.builder.tree.generationStats ?? null;
  const maxDepth = Math.max(...flat.map((entry) => entry.depth));
  const summaryMeta = runtimeDocument.createElement("p");
  summaryMeta.className = "tree-summary-headline";
  summaryMeta.textContent =
    `${flat.length} visible node${flat.length === 1 ? "" : "s"} | ` +
    `${generationStats?.validLeaves ?? 0} viable finish${(generationStats?.validLeaves ?? 0) === 1 ? "" : "es"} | depth ${maxDepth}.`;
  elements.builderTreeSummary.append(summaryMeta);

  if (rootNodeId !== "0") {
    const navActions = runtimeDocument.createElement("div");
    navActions.className = "button-row";
    const back = runtimeDocument.createElement("button");
    back.type = "button";
    back.className = "ghost";
    back.textContent = "Back";
    back.addEventListener("click", () => {
      const parentId = getParentNodeId(rootNodeId) ?? "0";
      const parentNode = getNodeById(parentId);
      if (!parentNode) {
        return;
      }
      state.builder.focusNodeId = parentId;
      state.builder.selectedNodeId = parentId;
      state.builder.selectedNodeTitle = parentNode.addedChampion
        ? `${parentNode.addedRole}: ${parentNode.addedChampion}`
        : "Root Composition";
      state.builder.teamState = normalizeTeamState(parentNode.teamSlots);
      validateTeamSelections();
      clearBuilderFeedback();
      setSetupFeedback("");
      renderTeamConfig();
      renderTree();
      renderTreeMap();
    });
    navActions.append(back);
    elements.builderTreeSummary.append(navActions);
  }

  if (generationStats) {
    const rankMeta = runtimeDocument.createElement("p");
    rankMeta.className = "meta";
    rankMeta.textContent = getRankGoalLabel();
    elements.builderTreeSummary.append(rankMeta);

    const statsDetails = runtimeDocument.createElement("details");
    statsDetails.className = "debug-details";
    const statsSummary = runtimeDocument.createElement("summary");
    statsSummary.textContent = "Generation stats";
    const statsMeta = runtimeDocument.createElement("p");
    statsMeta.className = "meta";
    statsMeta.textContent =
      `Visited ${generationStats.nodesVisited}, kept ${generationStats.nodesKept}, ` +
      `candidate calls ${generationStats.candidateGenerationCalls ?? 0}, ` +
      `candidates evaluated ${generationStats.candidatesEvaluated ?? 0}, selected ${generationStats.candidatesSelected ?? 0}, ` +
      `pruned unreachable ${generationStats.prunedUnreachable}, ` +
      `pruned low score ${generationStats.prunedLowCandidateScore}, ` +
      `pruned relative score ${generationStats.prunedRelativeCandidateScore ?? 0}, ` +
      `fallback candidates ${generationStats.fallbackCandidatesUsed ?? 0}, fallback nodes ${generationStats.fallbackNodes ?? 0}, ` +
      `complete draft leaves ${generationStats.completeDraftLeaves}, incomplete draft leaves ${generationStats.incompleteDraftLeaves}, ` +
      `valid leaves ${generationStats.validLeaves}, incomplete leaves ${generationStats.incompleteLeaves}.`;
    statsDetails.append(statsSummary, statsMeta);

    if ((generationStats.fallbackNodes ?? 0) > 0) {
      const fallbackMeta = runtimeDocument.createElement("p");
      fallbackMeta.className = "meta";
      fallbackMeta.textContent =
        `Adaptive fallback kept ${generationStats.fallbackCandidatesUsed} below-floor candidate(s) ` +
        `across ${generationStats.fallbackNodes} node(s) to avoid artificial dead-ends.`;
      statsDetails.append(fallbackMeta);
    }
    elements.builderTreeSummary.append(statsDetails);

    if (generationStats.completeDraftLeaves === 0) {
      const hardFail = runtimeDocument.createElement("p");
      hardFail.className = "meta";
      hardFail.textContent = "All possible outcomes result in incomplete drafts.";
      elements.builderTreeSummary.append(hardFail);

      const reasons = collectIncompleteDraftReasons(root);
      const reasonLine = runtimeDocument.createElement("p");
      reasonLine.className = "meta";

      if (reasons.unreachableRequired.length > 0) {
        reasonLine.textContent =
          `Fail-fast reason: required checks become unreachable on every leaf (${reasons.unreachableRequired.join(", ")}).`;
      } else {
        const topRole = getTopCountEntry(reasons.blockedRoles);
        const topReason = getTopCountEntry(reasons.blockedReasons);
        if (topRole) {
          reasonLine.textContent = formatBlockedReason(topReason?.key, topRole.key);
        } else {
          reasonLine.textContent = "Fail-fast reason: no branch can finish all five roles with current pools and constraints.";
        }
      }
      elements.builderTreeSummary.append(reasonLine);
    }
  }

  const topHeading = runtimeDocument.createElement("p");
  topHeading.className = "panel-kicker";
  topHeading.textContent = rootNodeId === "0" ? "Top branches from root:" : `Top branches from ${state.builder.selectedNodeTitle}:`;
  elements.builderTreeSummary.append(topHeading);

  const list = runtimeDocument.createElement("div");
  list.className = "summary-card-list";
  const topBranches = root.children
    .map((node, index) => ({
      node,
      id: `${rootNodeId}.${index}`,
      title: `${node.addedRole}: ${node.addedChampion}`
    }))
    .filter((entry) => visibleIds.has(entry.id))
    .slice(0, 8);

  if (topBranches.length === 0) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent =
      rootNodeId === "0"
        ? "No root branches match current filters. Try disabling 'Valid leaves only', lowering Min Score, or clearing Search."
        : "No child branches match current filters at this inspected node.";
    elements.builderTreeSummary.append(empty);

    const quickActions = runtimeDocument.createElement("div");
    quickActions.className = "button-row";

    if (state.builder.treeValidLeavesOnly) {
      const showAll = runtimeDocument.createElement("button");
      showAll.type = "button";
      showAll.textContent = "Show all branches";
      showAll.addEventListener("click", () => {
        state.builder.treeValidLeavesOnly = false;
        elements.treeValidLeavesOnly.checked = false;
        renderTree();
        renderTreeMap();
      });
      quickActions.append(showAll);
    }

    if (state.builder.treeSearch.trim()) {
      const clearSearch = runtimeDocument.createElement("button");
      clearSearch.type = "button";
      clearSearch.className = "ghost";
      clearSearch.textContent = "Clear Search";
      clearSearch.addEventListener("click", () => {
        state.builder.treeSearch = "";
        elements.treeSearch.value = "";
        renderTree();
        renderTreeMap();
      });
      quickActions.append(clearSearch);
    }

    if (state.builder.treeMinCandidateScore > 0) {
      const lowerFloor = runtimeDocument.createElement("button");
      lowerFloor.type = "button";
      lowerFloor.className = "ghost";
      lowerFloor.textContent = "Lower Min Candidate Score to 0";
      lowerFloor.addEventListener("click", () => {
        state.builder.treeMinCandidateScore = 0;
        if (elements.treeMinCandidateScore) {
          elements.treeMinCandidateScore.value = "0";
        }
        setBuilderStage("setup");
        resetBuilderTreeState();
        renderBuilder();
      });
      quickActions.append(lowerFloor);
    }

    if (quickActions.childElementCount > 0) {
      elements.builderTreeSummary.append(quickActions);
    }

    if (root.children.length === 0) {
      const guidance = runtimeDocument.createElement("p");
      guidance.className = "meta";
      guidance.textContent =
        "No viable branches were generated. Depth is automatic to remaining slots. Adjust slot picks, exclusions, or active composition requirements.";
      elements.builderTreeSummary.append(guidance);
    }
    return;
  }

  for (const entry of topBranches) {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card branch-card";

    const cardTop = runtimeDocument.createElement("div");
    cardTop.className = "branch-card-top";
    const rank = runtimeDocument.createElement("span");
    rank.className = "branch-rank";
    rank.textContent = `#${topBranches.indexOf(entry) + 1}`;
    const title = runtimeDocument.createElement("strong");
    title.textContent = entry.title;
    cardTop.append(rank, title);

    const headline = runtimeDocument.createElement("p");
    headline.className = "branch-headline";
    headline.textContent =
      `${entry.node.branchPotential?.validLeafCount ?? 0} viable finish${(entry.node.branchPotential?.validLeafCount ?? 0) === 1 ? "" : "es"} | ` +
      `${getBranchStatusLine(entry.node)}.`;

    const impact = runtimeDocument.createElement("p");
    impact.className = "branch-impact-summary";
    impact.textContent = getBranchImpactSummary(entry.node.candidateBreakdown);

    const benefits = runtimeDocument.createElement("ul");
    benefits.className = "branch-benefit-list";
    const candidateBenefitMeta = getCandidateBenefitMeta(entry.node.candidateBreakdown, 2);
    const benefitLines =
      candidateBenefitMeta.lines.length > 0
        ? candidateBenefitMeta.lines
        : ["No immediate clause coverage gain; ranked via downstream viable finishes."];
    for (const line of benefitLines) {
      const item = runtimeDocument.createElement("li");
      item.textContent = line;
      benefits.append(item);
    }
    if (candidateBenefitMeta.hiddenCount > 0) {
      const hidden = runtimeDocument.createElement("li");
      hidden.className = "branch-more";
      hidden.textContent =
        `+${candidateBenefitMeta.hiddenCount} more clause change${candidateBenefitMeta.hiddenCount === 1 ? "" : "s"}`;
      benefits.append(hidden);
    }

    const remainingCoverage = getRemainingCoverageMeta(entry.node.scoreBreakdown, 2);
    let remaining = null;
    if (remainingCoverage.lines.length > 0) {
      remaining = runtimeDocument.createElement("p");
      remaining.className = "branch-gap-list";
      remaining.textContent =
        `Still missing: ${remainingCoverage.lines.join(" | ")}` +
        (remainingCoverage.hiddenCount > 0
          ? ` | +${remainingCoverage.hiddenCount} more unmet clause${remainingCoverage.hiddenCount === 1 ? "" : "s"}`
          : "");
    }

    const debugDetails = runtimeDocument.createElement("details");
    debugDetails.className = "debug-details";
    const debugSummary = runtimeDocument.createElement("summary");
    debugSummary.textContent = "Debug scores";
    const debugBody = runtimeDocument.createElement("p");
    debugBody.className = "meta";
    const fallbackSuffix = entry.node.passesMinScore === false ? ", below candidate floor" : "";
    const deltaSummary = getCandidateDeltaSummary(entry.node.candidateBreakdown);
    debugBody.textContent =
      `Composition score ${entry.node.score}, candidate score ${entry.node.candidateScore ?? 0}, ` +
      `+${deltaSummary.totalCoverageGain} required coverage, ` +
      `redundancy overflow +${deltaSummary.totalOverflowAdded}, ` +
      `missing coverage ${entry.node.scoreBreakdown?.totalUnderBy ?? 0}${fallbackSuffix}.`;
    debugDetails.append(debugSummary, debugBody);

    const actions = runtimeDocument.createElement("div");
    actions.className = "button-row";
    const inspect = runtimeDocument.createElement("button");
    inspect.type = "button";
    inspect.textContent = "Inspect";
    inspect.addEventListener("click", () => {
      inspectNode(entry.node, entry.id, entry.title);
    });
    actions.append(inspect);

    if (remaining) {
      card.append(cardTop, headline, impact, benefits, remaining, debugDetails, actions);
    } else {
      card.append(cardTop, headline, impact, benefits, debugDetails, actions);
    }
    list.append(card);
  }

  elements.builderTreeSummary.append(list);
}

function setAllTreeDetails(open) {
  if (state.builder.treeDensity !== "detailed") {
    return;
  }
  const detailsNodes = elements.builderTree.querySelectorAll("details");
  for (const node of detailsNodes) {
    node.open = open;
  }
}

function renderTree() {
  elements.builderTreeSummary.innerHTML = "";
  elements.builderTree.innerHTML = "";
  if (!state.builder.tree) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "Generate a tree to see ranked next composition additions.";
    elements.builderTree.append(empty);
    return;
  }

  const focusedNodeId = getFocusedTreeNodeId();
  const focusedNode = getFocusedTreeNode();
  if (!focusedNode) {
    return;
  }

  const visibleIds = new Set();
  collectVisibleNodeIds(
    focusedNode,
    focusedNodeId,
    visibleIds,
    state.builder.treeMinScore,
    state.builder.treeSearch,
    SLOTS,
    state.builder.treeValidLeavesOnly
  );

  if (state.builder.treeDensity === "summary") {
    renderTreeSummary(focusedNode, focusedNodeId, visibleIds);
    const summaryNotice = runtimeDocument.createElement("p");
    summaryNotice.className = "meta";
    summaryNotice.textContent = "Summary mode is active. Switch to Detailed for the full outline.";
    elements.builderTree.append(summaryNotice);
    return;
  }

  const rendered = renderTreeNode(focusedNode, 0, focusedNodeId, visibleIds);
  if (!rendered) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "No nodes match current filters.";
    elements.builderTree.append(empty);
    return;
  }
  elements.builderTree.append(rendered);
}

function renderTreeMap() {
  elements.builderTreeMap.innerHTML = "";
  if (!state.builder.tree) {
    return;
  }

  const focusedNodeId = getFocusedTreeNodeId();
  const focusedNode = getFocusedTreeNode();
  if (!focusedNode) {
    return;
  }

  const visibleIds = new Set();
  collectVisibleNodeIds(
    focusedNode,
    focusedNodeId,
    visibleIds,
    state.builder.treeMinScore,
    state.builder.treeSearch,
    SLOTS,
    state.builder.treeValidLeavesOnly
  );
  const flat = flattenTreeForMap(focusedNode, focusedNodeId).filter((entry) => visibleIds.has(entry.id));
  if (flat.length === 0) {
    return;
  }

  const depthMax = Math.max(...flat.map((entry) => entry.depth));
  const depthCols = Array.from({ length: depthMax + 1 }, () => []);
  for (const entry of flat) {
    depthCols[entry.depth].push(entry);
  }

  for (const column of depthCols) {
    column.sort((left, right) => {
      const leftKey = teamStateKey(left.node.teamSlots);
      const rightKey = teamStateKey(right.node.teamSlots);
      return leftKey.localeCompare(rightKey);
    });
  }

  const width = 900;
  const maxColumnSize = Math.max(...depthCols.map((column) => column.length));
  const height = Math.max(320, Math.min(720, maxColumnSize * 24 + 64));
  elements.builderTreeMap.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const xPadding = 46;
  const yPadding = 26;
  const colWidth = depthMax > 0 ? (width - xPadding * 2) / depthMax : 0;
  const pointsById = {};
  const selectedPathIds = getSelectedPathIds();

  for (let depth = 0; depth < depthCols.length; depth += 1) {
    const column = depthCols[depth];
    const step = column.length > 1 ? (height - yPadding * 2) / (column.length - 1) : 0;
    for (let index = 0; index < column.length; index += 1) {
      const entry = column[index];
      pointsById[entry.id] = {
        x: depthMax > 0 ? xPadding + depth * colWidth : width / 2,
        y: column.length > 1 ? yPadding + index * step : height / 2
      };
    }
  }

  for (const entry of flat) {
    if (!entry.parentId) {
      continue;
    }
    const source = pointsById[entry.parentId];
    const target = pointsById[entry.id];
    const line = runtimeDocument.createElementNS("http://www.w3.org/2000/svg", "line");
    let lineClass = "tree-map-line";
    if (selectedPathIds.has(entry.id) && selectedPathIds.has(entry.parentId)) {
      lineClass += " is-selected-path";
    }
    line.setAttribute("class", lineClass);
    line.setAttribute("x1", String(source.x));
    line.setAttribute("y1", String(source.y));
    line.setAttribute("x2", String(target.x));
    line.setAttribute("y2", String(target.y));
    elements.builderTreeMap.append(line);
  }

  for (const entry of flat) {
    const point = pointsById[entry.id];
    const circle = runtimeDocument.createElementNS("http://www.w3.org/2000/svg", "circle");
    let circleClass = "tree-map-node";
    if (nodePassesActiveTreeFilters(entry.node)) {
      circleClass += " is-match";
    }
    circleClass += ` is-${getNodeStatus(entry.node)}`;
    circle.setAttribute("cx", String(point.x));
    circle.setAttribute("cy", String(point.y));
    const validLeafCount = entry.node.branchPotential?.validLeafCount ?? 0;
    const baseRadius = 4 + Math.min(6, Math.sqrt(validLeafCount));
    circle.setAttribute("r", String(entry.id === state.builder.selectedNodeId ? baseRadius + 2 : baseRadius));
    if (entry.id === state.builder.selectedNodeId) {
      circleClass += " is-selected";
    }
    circle.setAttribute("class", circleClass);
    circle.setAttribute(
      "aria-label",
      entry.node.addedChampion
        ? `${entry.node.addedRole} ${entry.node.addedChampion}, required gaps ${entry.node.requiredSummary?.requiredGaps ?? 0}, valid leaves ${validLeafCount}`
        : `Root Composition, required gaps ${entry.node.requiredSummary?.requiredGaps ?? 0}, valid leaves ${validLeafCount}`
    );
    circle.addEventListener("click", () => {
      const title = entry.node.addedChampion
        ? `${entry.node.addedRole}: ${entry.node.addedChampion}`
        : "Root Composition";
      inspectNode(entry.node, entry.id, title);
    });
    elements.builderTreeMap.append(circle);
  }

  for (let depth = 0; depth < depthCols.length; depth += 1) {
    const label = runtimeDocument.createElementNS("http://www.w3.org/2000/svg", "text");
    const x = depthMax > 0 ? xPadding + depth * colWidth : width / 2;
    label.setAttribute("x", String(x - 18));
    label.setAttribute("y", "16");
    label.setAttribute("class", "tree-map-label");
    label.textContent = `D${depth}`;
    elements.builderTreeMap.append(label);
  }

  if (elements.treeMapLegend) {
    elements.treeMapLegend.textContent =
      "Legend: green=terminal valid, amber=recoverable branch, muted=filtered/dead-end.";
  }
}

function renderBuilder() {
  state.builder.candidateScoringWeights = normalizeBuilderCandidateScoringWeights(state.builder.candidateScoringWeights);
  renderBuilderStageGuide();
  replaceOptions(elements.builderActiveTeam, getTeamSelectOptions());
  elements.builderActiveTeam.value = state.builder.teamId;
  syncBuilderCompositionControls();
  elements.treeDensity.value = state.builder.treeDensity;
  elements.treeSearch.value = state.builder.treeSearch;
  elements.treeMinScore.value = String(state.builder.treeMinScore);
  if (elements.treeMinCandidateScore) {
    elements.treeMinCandidateScore.value = String(state.builder.treeMinCandidateScore);
  }
  if (elements.treeRankGoal) {
    elements.treeRankGoal.value = normalizeBuilderRankGoal(state.builder.treeRankGoal);
  }
  if (elements.treeCandidateRedundancyPenalty) {
    elements.treeCandidateRedundancyPenalty.value = String(state.builder.candidateScoringWeights.redundancyPenalty);
  }
  elements.treeValidLeavesOnly.checked = state.builder.treeValidLeavesOnly;
  elements.treeDensity.disabled = !state.builder.tree;
  elements.treeSearch.disabled = !state.builder.tree;
  elements.treeMinScore.disabled = !state.builder.tree;
  elements.treeValidLeavesOnly.disabled = !state.builder.tree;
  elements.treeExpandAll.disabled = !state.builder.tree || state.builder.treeDensity !== "detailed";
  elements.treeCollapseAll.disabled = !state.builder.tree || state.builder.treeDensity !== "detailed";
  updateTeamHelpAndSlotLabels();
  renderTeamContext();
  renderDraftOrder();
  renderChecks();
  renderExcludedOptions();
  renderExcludedPills();
  renderTree();
  renderTreeMap();
}

function scrollReviewResultsIntoView() {
  const prefersReducedMotion = runtimeMatchMedia("(prefers-reduced-motion: reduce)").matches;
  elements.builderTreeSummary.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "start"
  });
}

function validateAndApplySlotSelection(slot, championName) {
  const poolRole = state.builder.slotPoolRole[slot] ?? slot;
  const { teamId, teamPools } = getEnginePoolContext();
  const rolePools = teamPools[teamId] ?? {};
  const pools = { ...rolePools, [slot]: getChampionsForSlotAndRole(slot, poolRole) };
  const selection = validateSlotSelection({
    slot,
    championName,
    teamState: state.builder.teamState,
    excludedChampions: state.builder.excludedChampions,
    pools,
    slots: SLOTS
  });

  if (!selection.ok) {
    setSetupFeedback(selection.message);
    return false;
  }

  setSetupFeedback("");
  state.builder.teamState[slot] = selection.nextChampionName;
  return true;
}

function syncTagMutualExclusion(changed, includeValuesInput, excludeValuesInput) {
  const { includeValues, excludeValues } = resolveTagMutualExclusion(
    changed,
    includeValuesInput,
    excludeValuesInput
  );
  if (changed === "include") {
    multiSelectControls.explorerExcludeTags?.setSelected(excludeValues);
  } else {
    multiSelectControls.explorerIncludeTags?.setSelected(includeValues);
  }

  state.explorer.includeTags = includeValues;
  state.explorer.excludeTags = excludeValues;
}

async function hydrateAuthenticatedViews(preferredPoolTeamId = null, preferredAdminTeamId = null) {
  setTeamJoinFeedback("");
  await loadProfileFromApi();
  await loadPoolsFromApi(preferredPoolTeamId);
  await loadTeamsFromApi(preferredAdminTeamId);
  await loadTeamContextFromApi();
  await loadTagCatalogFromApi();
  await hydrateCompositionsWorkspaceFromApi();
  await loadInvitationsForUser();
  if (isAdminUser()) {
    await loadUsersFromApi();
  } else {
    state.api.users = [];
  }
  initializeTeamConfigControls();
  renderTeamAdmin();
  renderPlayerConfig();
  renderBuilder();
  renderChampionTagCatalog();
  renderTagsWorkspace();
  renderUsersWorkspace();
  renderCompositionsWorkspace();
  renderChampionTagEditor();
  validateTeamSelections();
  void fetchBuilderDraftContext(state.builder.teamId).then(() => {
    validateTeamSelections();
    renderTeamConfig();
    renderBuilder();
  });
}

function getAuthCredentials(mode = "login") {
  const email = typeof elements.authEmail.value === "string" ? elements.authEmail.value.trim() : "";
  const password = typeof elements.authPassword.value === "string" ? elements.authPassword.value : "";

  if (!email || !password) {
    throw new Error("Email and password are required.");
  }

  if (mode !== "register") {
    return { email, password };
  }

  const gameName =
    typeof elements.authGameName.value === "string" ? elements.authGameName.value.trim() : "";
  const tagline =
    typeof elements.authTagline.value === "string" ? elements.authTagline.value.trim() : "";
  if (!gameName || !tagline) {
    throw new Error("Game Name and Tagline are required for registration.");
  }

  const firstName =
    typeof elements.authFirstName?.value === "string" ? elements.authFirstName.value.trim() : "";
  const lastName =
    typeof elements.authLastName?.value === "string" ? elements.authLastName.value.trim() : "";

  return {
    email,
    password,
    gameName,
    tagline,
    firstName,
    lastName
  };
}

function clearAuthForm() {
  const inputIds = [
    "auth-email", "auth-password", "auth-retype-password",
    "auth-game-name", "auth-tagline", "auth-first-name", "auth-last-name",
    "auth-reset-token", "auth-new-password", "auth-confirm-new-password"
  ];
  for (const id of inputIds) {
    const el = runtimeDocument.querySelector(`#${id}`);
    if (el) el.value = "";
  }
  // Reset all password show/hide toggles back to hidden state
  runtimeDocument.querySelectorAll(".password-toggle").forEach((btn) => {
    const targetId = btn.dataset.target;
    const input = targetId ? runtimeDocument.querySelector(`#${targetId}`) : null;
    if (input) input.type = "password";
    btn.classList.remove("is-visible");
    btn.setAttribute("aria-label", "Show password");
  });
  // Clear any field-error states
  runtimeDocument.querySelectorAll(".auth-card label.field-error").forEach((label) => {
    label.classList.remove("field-error");
  });
}

async function handleAuthSubmit(path, mode = "login") {
  setAuthMode(mode);
  const credentials = getAuthCredentials(mode);
  const payload = await apiRequest(path, {
    method: "POST",
    body: credentials
  });

  if (!payload?.token || !payload?.user) {
    throw new Error("Auth response did not include token and user.");
  }

  state.auth.token = payload.token;
  state.auth.user = payload.user;
  saveAuthSession();
  clearAuthForm();
  setAuthMode("login");
  setTab(resolvePostLoginTab(payload.user), { syncRoute: true });
  setAuthFeedback("");
  renderAuth();
  await hydrateAuthenticatedViews();
}

function attachEvents() {
  const NodeCtor = runtimeWindow.Node ?? globalThis.Node;

  runtimeDocument.querySelectorAll(".password-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const input = targetId ? runtimeDocument.querySelector(`#${targetId}`) : null;
      if (!input) return;
      const isVisible = input.type === "text";
      input.type = isVisible ? "password" : "text";
      btn.classList.toggle("is-visible", !isVisible);
      btn.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
    });
  });

  runtimeDocument.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!NodeCtor || !(target instanceof NodeCtor)) {
      closeCheckboxMultiDetails();
      return;
    }
    if (target.closest(".checkbox-multi")) {
      return;
    }
    closeCheckboxMultiDetails();
  });

  elements.authRegister.addEventListener("click", () => {
    if (state.auth.mode !== "register") {
      setAuthMode("register");
      setAuthFeedback("");
      renderAuth();
      return;
    }
    const password = elements.authPassword?.value ?? "";
    const retype = elements.authRetypePassword?.value ?? "";
    if (password !== retype) {
      setAuthFeedback("Passwords do not match.");
      if (elements.authRetypePasswordGroup) {
        elements.authRetypePasswordGroup.classList.add("field-error");
      }
      renderAuth();
      return;
    }
    if (elements.authRetypePasswordGroup) {
      elements.authRetypePasswordGroup.classList.remove("field-error");
    }
    void handleAuthSubmit("/auth/register", "register").catch((error) => {
      setAuthFeedback(normalizeApiErrorMessage(error, "Registration failed."));
      renderAuth();
    });
  });

  elements.authLogin.addEventListener("click", () => {
    if (isAuthenticated()) {
      renderAuth();
      return;
    }
    setAuthMode("login");
    void handleAuthSubmit("/auth/login", "login").catch((error) => {
      setAuthFeedback(normalizeApiErrorMessage(error, "Login failed."));
      renderAuth();
    });
  });

  if (elements.authForgotLink) {
    elements.authForgotLink.addEventListener("click", () => {
      setAuthMode("forgot");
      setAuthFeedback("");
      renderAuth();
    });
  }

  if (elements.authBackToLogin) {
    elements.authBackToLogin.addEventListener("click", () => {
      setAuthMode("login");
      setAuthFeedback("");
      renderAuth();
    });
  }

  if (elements.authRequestReset) {
    elements.authRequestReset.addEventListener("click", () => {
      const email = elements.authEmail?.value?.trim() ?? "";
      if (!email) {
        setAuthFeedback("Enter your email address.");
        renderAuth();
        return;
      }
      elements.authRequestReset.disabled = true;
      void apiRequest("/auth/request-password-reset", {
        method: "POST",
        body: { email }
      }).then((payload) => {
        const token = payload?.resetToken;
        if (token && elements.authResetToken) {
          elements.authResetToken.value = token;
        }
        setAuthMode("reset");
        setAuthFeedback(token
          ? "Token issued. It has been pre-filled below (no email service configured)."
          : (payload?.message ?? "Check your email for a reset token.")
        );
        renderAuth();
      }).catch((error) => {
        setAuthFeedback(normalizeApiErrorMessage(error, "Request failed."));
        renderAuth();
      }).finally(() => {
        if (elements.authRequestReset) {
          elements.authRequestReset.disabled = false;
        }
      });
    });
  }

  if (elements.authSubmitReset) {
    elements.authSubmitReset.addEventListener("click", () => {
      const token = elements.authResetToken?.value?.trim() ?? "";
      const newPassword = elements.authNewPassword?.value ?? "";
      if (!token || !newPassword) {
        setAuthFeedback("Enter both the reset token and your new password.");
        renderAuth();
        return;
      }
      elements.authSubmitReset.disabled = true;
      void apiRequest("/auth/reset-password", {
        method: "POST",
        body: { token, newPassword }
      }).then(() => {
        setAuthMode("login");
        setAuthFeedback("Password updated. You can now log in.");
        if (elements.authResetToken) {
          elements.authResetToken.value = "";
        }
        if (elements.authNewPassword) {
          elements.authNewPassword.value = "";
        }
        renderAuth();
      }).catch((error) => {
        setAuthFeedback(normalizeApiErrorMessage(error, "Reset failed."));
        renderAuth();
      }).finally(() => {
        if (elements.authSubmitReset) {
          elements.authSubmitReset.disabled = false;
        }
      });
    });
  }

  elements.authLogout.addEventListener("click", () => {
    clearAuthSession("");
    setTab(DEFAULT_TAB_ROUTE, { syncRoute: true, replaceRoute: true });
    clearApiPoolState();
    state.api.teams = [];
    state.api.membersByTeamId = {};
    state.api.selectedTeamId = "";
    initializeTeamConfigControls();
    renderTeamAdmin();
    renderPlayerConfig();
    setProfileRolesFeedback("");
    renderBuilder();
    renderUsersWorkspace();
    renderCompositionsWorkspace();
    renderAuth();
  });

  if (elements.authSignupLink) {
    elements.authSignupLink.addEventListener("click", () => {
      setAuthMode("register");
      setAuthFeedback("");
      renderAuth();
    });
  }

  if (elements.authToLogin) {
    elements.authToLogin.addEventListener("click", () => {
      setAuthMode("login");
      setAuthFeedback("");
      renderAuth();
    });
  }

  if (elements.authRetypePassword) {
    elements.authRetypePassword.addEventListener("input", () => {
      const password = elements.authPassword?.value ?? "";
      const retype = elements.authRetypePassword.value;
      const mismatch = retype.length > 0 && password !== retype;
      if (elements.authRetypePasswordGroup) {
        elements.authRetypePasswordGroup.classList.toggle("field-error", mismatch);
      }
    });
  }

  if (elements.authChangePassword) {
    elements.authChangePassword.addEventListener("click", () => {
      const newPassword = elements.authNewPassword?.value ?? "";
      const confirm = elements.authConfirmNewPassword?.value ?? "";
      if (!newPassword || !confirm) {
        setAuthFeedback("Enter and confirm your new password.");
        renderAuth();
        return;
      }
      if (newPassword !== confirm) {
        setAuthFeedback("Passwords do not match.");
        if (elements.authConfirmNewPasswordGroup) {
          elements.authConfirmNewPasswordGroup.classList.add("field-error");
        }
        renderAuth();
        return;
      }
      if (elements.authConfirmNewPasswordGroup) {
        elements.authConfirmNewPasswordGroup.classList.remove("field-error");
      }
      elements.authChangePassword.disabled = true;
      void apiRequest("/auth/change-password", {
        method: "POST",
        body: { newPassword },
        auth: true
      }).then(() => {
        if (elements.authNewPassword) elements.authNewPassword.value = "";
        if (elements.authConfirmNewPassword) elements.authConfirmNewPassword.value = "";
        setAuthMode("login");
        setAuthFeedback("");
        renderAuth();
        setTab("profile", { syncRoute: true });
      }).catch((error) => {
        setAuthFeedback(normalizeApiErrorMessage(error, "Password change failed."));
        renderAuth();
      }).finally(() => {
        if (elements.authChangePassword) elements.authChangePassword.disabled = false;
      });
    });
  }

  if (elements.authCancelChange) {
    elements.authCancelChange.addEventListener("click", () => {
      if (elements.authNewPassword) elements.authNewPassword.value = "";
      if (elements.authConfirmNewPassword) elements.authConfirmNewPassword.value = "";
      setAuthMode("login");
      setAuthFeedback("");
      renderAuth();
      setTab("profile", { syncRoute: true });
    });
  }

  if (elements.profileChangePassword) {
    elements.profileChangePassword.addEventListener("click", () => {
      setAuthMode("change-password");
      setAuthFeedback("");
      renderAuth();
    });
  }

  if (elements.profileSaveAccount) {
    elements.profileSaveAccount.addEventListener("click", async () => {
      const firstNameInput = runtimeDocument.querySelector("#profile-account-firstname");
      const lastNameInput = runtimeDocument.querySelector("#profile-account-lastname");
      const firstName = firstNameInput ? firstNameInput.value.trim() : "";
      const lastName = lastNameInput ? lastNameInput.value.trim() : "";

      if (elements.profileAccountFeedback) {
        elements.profileAccountFeedback.textContent = "Saving...";
        elements.profileAccountFeedback.style.color = "";
      }

      try {
        const payload = await apiRequest("/me/account", {
          method: "PUT",
          auth: true,
          body: { firstName, lastName }
        });
        const updatedUser = payload?.user;
        if (updatedUser && state.auth.user) {
          state.auth.user.firstName = updatedUser.firstName ?? "";
          state.auth.user.lastName = updatedUser.lastName ?? "";
          saveAuthSession();
        }
        if (elements.profileAccountFeedback) {
          elements.profileAccountFeedback.textContent = "Account saved.";
          elements.profileAccountFeedback.style.color = "";
        }
        renderPlayerConfig();
      } catch (error) {
        if (elements.profileAccountFeedback) {
          elements.profileAccountFeedback.textContent = normalizeApiErrorMessage(error, "Failed to save account.");
          elements.profileAccountFeedback.style.color = "var(--warn)";
        }
      }
    });
  }

  // Profile settings list — accordion toggle
  if (elements.profileSettingsList) {
    elements.profileSettingsList.addEventListener("click", (event) => {
      const row = event.target.closest(".profile-setting-row");
      if (!row) return;
      const item = row.closest(".profile-setting-item");
      if (!item) return;
      const settingName = item.dataset.setting;

      // Admin link navigates away instead of opening an editor
      if (settingName === "admin-users") {
        setTab("users", { syncRoute: true });
        return;
      }

      // Toggle accordion
      state.profile.openSetting = state.profile.openSetting === settingName ? null : settingName;
      renderPlayerConfig();
    });
  }

  // Avatar circle click opens avatar modal
  if (elements.profileAvatarDisplay) {
    elements.profileAvatarDisplay.addEventListener("click", () => {
      openAvatarModal();
    });
  }

  // Avatar modal — Cancel / Save / backdrop / search
  if (elements.avatarModalCancel) {
    elements.avatarModalCancel.addEventListener("click", closeAvatarModal);
  }
  if (elements.avatarModalSave) {
    elements.avatarModalSave.addEventListener("click", saveAvatarSelection);
  }
  if (elements.avatarModal) {
    elements.avatarModal.addEventListener("click", (event) => {
      if (event.target === elements.avatarModal) closeAvatarModal();
    });
  }
  if (elements.avatarModalSearch) {
    elements.avatarModalSearch.addEventListener("input", () => {
      state.profile.avatarFilter = elements.avatarModalSearch.value;
      renderAvatarModalGrid();
    });
  }

  // Role links — Profile page
  if (elements.profileSetPrimaryRole) {
    elements.profileSetPrimaryRole.addEventListener("click", (e) => {
      e.preventDefault();
      openPrimaryRoleModal();
    });
  }
  if (elements.profileSetOtherRoles) {
    elements.profileSetOtherRoles.addEventListener("click", (e) => {
      e.preventDefault();
      openOtherRolesModal();
    });
  }

  // Role links — My Champions page
  if (elements.myChampionsSetPrimary) {
    elements.myChampionsSetPrimary.addEventListener("click", (e) => {
      e.preventDefault();
      openPrimaryRoleModal();
    });
  }
  if (elements.myChampionsSetOthers) {
    elements.myChampionsSetOthers.addEventListener("click", (e) => {
      e.preventDefault();
      openOtherRolesModal();
    });
  }

  // Primary role modal — backdrop close
  if (elements.primaryRoleModal) {
    elements.primaryRoleModal.addEventListener("click", (event) => {
      if (event.target === elements.primaryRoleModal) closePrimaryRoleModal();
    });
  }

  // Other roles modal — backdrop close
  if (elements.otherRolesModal) {
    elements.otherRolesModal.addEventListener("click", (event) => {
      if (event.target === elements.otherRolesModal) closeOtherRolesModal();
    });
  }

  if (elements.authConfirmNewPassword) {
    elements.authConfirmNewPassword.addEventListener("input", () => {
      const newPassword = elements.authNewPassword?.value ?? "";
      const confirm = elements.authConfirmNewPassword.value;
      const mismatch = confirm.length > 0 && newPassword !== confirm;
      if (elements.authConfirmNewPasswordGroup) {
        elements.authConfirmNewPasswordGroup.classList.toggle("field-error", mismatch);
      }
    });
  }

  if (elements.updatesNavLink) {
    elements.updatesNavLink.addEventListener("click", (e) => {
      e.preventDefault();
      if (!hasAuthSession()) {
        setAuthFeedback("Login/Registration required to proceed.");
        return;
      }
      setTab("coming-soon", { syncRoute: true });
    });
  }

  elements.navToggle.addEventListener("click", () => {
    toggleNav();
  });
  if (elements.navDesktopToggle) {
    elements.navDesktopToggle.addEventListener("click", () => {
      toggleNav();
    });
  }
  elements.navOverlay.addEventListener("click", () => {
    setNavOpen(false);
  });
  if (elements.logoLightboxClose) {
    elements.logoLightboxClose.addEventListener("click", () => {
      closeLogoLightbox();
    });
  }
  if (elements.logoLightbox) {
    elements.logoLightbox.addEventListener("click", (event) => {
      if (event.target === elements.logoLightbox) {
        closeLogoLightbox();
      }
    });
  }
  runtimeWindow.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (elements.logoLightbox && !elements.logoLightbox.hidden) {
        closeLogoLightbox();
      }
      setNavOpen(false);
    }
  });
  runtimeWindow.addEventListener("resize", () => {
    syncNavLayout();
  });
  runtimeWindow.addEventListener("hashchange", () => {
    const route = parseTabRouteHash(runtimeWindow.location.hash);
    if (route.status === "valid") {
      setTab(route.tab, { syncRoute: route.shouldNormalize, replaceRoute: route.shouldNormalize });
      return;
    }
    setTab(DEFAULT_TAB_ROUTE, { syncRoute: true, replaceRoute: true });
  });

  for (const button of elements.tabTriggers) {
    button.addEventListener("click", () => {
      if (!hasAuthSession()) {
        setAuthFeedback("Login/Registration required to proceed.");
        return;
      }
      const targetTab = button.dataset.tab;
      if (hasChampionEditorUnsavedChanges()) {
        showNavWarning(() => {
          clearChampionTagEditorState();
          setTab(targetTab, { syncRoute: true });
        });
        return;
      }
      if (state.api.selectedChampionTagEditorId !== null) {
        clearChampionTagEditorState();
      }
      setTab(targetTab, { syncRoute: true });
    });
  }

  elements.explorerSearch.addEventListener("input", () => {
    state.explorer.search = elements.explorerSearch.value;
    renderExplorer();
  });

  elements.explorerScaling.addEventListener("change", () => {
    state.explorer.scaling = elements.explorerScaling.value;
    renderExplorer();
  });

  elements.explorerSort.addEventListener("change", () => {
    state.explorer.sortBy = elements.explorerSort.value;
    renderExplorer();
  });

  elements.explorerCatalogSearch.addEventListener("input", () => {
    renderChampionTagCatalog();
  });

  elements.explorerCatalogToggle.addEventListener("click", () => {
    const isOpen = !elements.explorerCatalogPanel.hidden;
    elements.explorerCatalogPanel.hidden = isOpen;
    elements.explorerCatalogToggle.setAttribute("aria-expanded", String(!isOpen));
    const caret = elements.explorerCatalogToggle.querySelector(".explorer-catalog-caret");
    if (caret) caret.textContent = isOpen ? "▾" : "▴";
  });

  elements.explorerSubNavBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.explorer.subTab = btn.dataset.explorerSub;
      applyExplorerSubTab();
      if (state.explorer.subTab === "my-champions") renderMyChampions();
      if (state.explorer.subTab === "edit-champions") renderExplorer();
    });
  });

  elements.explorerFilterToggle.addEventListener("click", () => {
    state.explorer.filtersOpen = !state.explorer.filtersOpen;
    elements.explorerFilterBody.classList.toggle("is-collapsed", !state.explorer.filtersOpen);
    elements.explorerFilterToggle.textContent = state.explorer.filtersOpen ? "▾ Filters" : "▸ Filters";
    elements.explorerFilterToggle.setAttribute("aria-expanded", String(state.explorer.filtersOpen));
  });

  elements.explorerClearSearch.addEventListener("click", () => {
    elements.explorerSearch.value = "";
    state.explorer.search = "";
    renderExplorer();
  });

  elements.explorerClearRole.addEventListener("click", () => {
    multiSelectControls.explorerRole?.setSelected([NO_FILTER]);
    state.explorer.roles = [];
    renderExplorer();
  });

  elements.explorerClearDamage.addEventListener("click", () => {
    multiSelectControls.explorerDamage?.setSelected([NO_FILTER]);
    state.explorer.damageTypes = [];
    renderExplorer();
  });

  elements.explorerClearScaling.addEventListener("click", () => {
    elements.explorerScaling.value = "";
    state.explorer.scaling = "";
    renderExplorer();
  });

  elements.explorerClearSort.addEventListener("click", () => {
    elements.explorerSort.value = "alpha-asc";
    state.explorer.sortBy = "alpha-asc";
    renderExplorer();
  });

  elements.explorerClearInclude.addEventListener("click", () => {
    multiSelectControls.explorerIncludeTags?.setSelected([]);
    state.explorer.includeTags = [];
    renderExplorer();
  });

  elements.explorerClearExclude.addEventListener("click", () => {
    multiSelectControls.explorerExcludeTags?.setSelected([]);
    state.explorer.excludeTags = [];
    renderExplorer();
  });

  elements.explorerClearAll.addEventListener("click", () => {
    clearExplorerFilters();
    renderExplorer();
  });

  if (elements.tagsManageSave) {
    elements.tagsManageSave.addEventListener("click", () => {
      void saveManagedTag();
    });
  }

  if (elements.tagsManageCancel) {
    elements.tagsManageCancel.addEventListener("click", () => {
      clearTagsManagerState();
      renderTagsWorkspace();
    });
  }

  if (elements.requirementsName) {
    elements.requirementsName.addEventListener("input", () => {
      state.api.requirementDefinitionDraft.name = elements.requirementsName.value;
    });
  }

  if (elements.requirementsDefinition) {
    elements.requirementsDefinition.addEventListener("input", () => {
      state.api.requirementDefinitionDraft.definition = elements.requirementsDefinition.value;
    });
  }

  if (elements.requirementsOpenEditor) {
    elements.requirementsOpenEditor.addEventListener("click", () => {
      state.api.isRequirementDefinitionEditorOpen = true;
      setRequirementDefinitionDraft(null);
      setRequirementsFeedback("");
      renderCompositionsWorkspace();
    });
  }

  if (elements.requirementsAddClause) {
    elements.requirementsAddClause.addEventListener("click", () => {
      const nextRules = Array.isArray(state.api.requirementDefinitionDraft.rules)
        ? [...state.api.requirementDefinitionDraft.rules]
        : [];
      for (const existingClause of nextRules) {
        existingClause.isOpen = false;
      }
      nextRules.push(createDefaultRequirementRuleClauseDraft());
      state.api.requirementDefinitionDraft.rules = nextRules;
      renderRequirementClauseEditor();
    });
  }

  if (elements.requirementsSave) {
    elements.requirementsSave.addEventListener("click", () => {
      void saveRequirementDefinitionFromWorkspace();
    });
  }

  if (elements.requirementsCancel) {
    elements.requirementsCancel.addEventListener("click", () => {
      setRequirementDefinitionDraft(null);
      state.api.isRequirementDefinitionEditorOpen = false;
      setRequirementsFeedback("");
      renderCompositionsWorkspace();
    });
  }

  if (elements.requirementsDelete) {
    elements.requirementsDelete.addEventListener("click", () => {
      void deleteRequirementDefinitionFromWorkspace();
    });
  }

  if (elements.compositionsName) {
    elements.compositionsName.addEventListener("input", () => {
      state.api.compositionBundleDraft.name = elements.compositionsName.value;
    });
  }

  if (elements.compositionsDescription) {
    elements.compositionsDescription.addEventListener("input", () => {
      state.api.compositionBundleDraft.description = elements.compositionsDescription.value;
    });
  }

  if (elements.compositionsIsActive) {
    elements.compositionsIsActive.addEventListener("change", () => {
      state.api.compositionBundleDraft.isActive = elements.compositionsIsActive.checked;
    });
  }

  if (elements.compositionsSave) {
    elements.compositionsSave.addEventListener("click", () => {
      void saveCompositionBundleFromWorkspace();
    });
  }

  if (elements.compositionsCancel) {
    elements.compositionsCancel.addEventListener("click", () => {
      setCompositionBundleDraft(null);
      setCompositionsFeedback("");
      renderCompositionsWorkspace();
    });
  }

  if (elements.compositionsDelete) {
    elements.compositionsDelete.addEventListener("click", () => {
      void deleteCompositionBundleFromWorkspace();
    });
  }

  if (elements.championTagEditorScope) {
    elements.championTagEditorScope.addEventListener("change", () => {
      const selectedScope = normalizeChampionTagScope(elements.championTagEditorScope.value);
      state.api.championTagScope = selectedScope;
      if (selectedScope !== "team") {
        state.api.championTagTeamId = "";
      } else {
        const leadTeamOptions = getChampionTagLeadTeamOptions();
        const firstLeadTeamValue = leadTeamOptions[0]?.value ?? "";
        if (!state.api.championTagTeamId || !leadTeamOptions.some((option) => option.value === state.api.championTagTeamId)) {
          state.api.championTagTeamId = firstLeadTeamValue;
        }
      }
      renderChampionTagEditor();
      if (state.api.selectedChampionTagEditorId) {
        setChampionTagEditorFeedback("Loading champion tags...");
        void loadChampionScopedTags(state.api.selectedChampionTagEditorId).then(() => {
          renderChampionTagEditor();
        });
      }
    });
  }

  if (elements.championTagEditorTeam) {
    elements.championTagEditorTeam.addEventListener("change", () => {
      state.api.championTagTeamId = normalizeTeamEntityId(elements.championTagEditorTeam.value) ?? "";
      renderChampionTagEditor();
      if (state.api.selectedChampionTagEditorId) {
        setChampionTagEditorFeedback("Loading champion tags...");
        void loadChampionScopedTags(state.api.selectedChampionTagEditorId).then(() => {
          renderChampionTagEditor();
        });
      }
    });
  }

  if (elements.championTagEditorReviewed) {
    elements.championTagEditorReviewed.addEventListener("change", () => {
      state.api.championReviewedDraft = elements.championTagEditorReviewed.checked;
      renderChampionTagEditor();
    });
  }

  if (elements.championTagEditorSave) {
    elements.championTagEditorSave.addEventListener("click", () => {
      void saveChampionTagEditor();
    });
  }

  if (elements.championTagEditorClear) {
    elements.championTagEditorClear.addEventListener("click", () => {
      if (hasChampionEditorUnsavedChanges()) {
        showNavWarning(() => clearChampionTagEditorState());
      } else {
        clearChampionTagEditorState();
      }
    });
  }

  if (elements.cedTagsAvailableFilter) {
    elements.cedTagsAvailableFilter.addEventListener("input", () => {
      renderChampionTagEditorTagOptions();
    });
  }

  if (elements.cedTagsSelectedFilter) {
    elements.cedTagsSelectedFilter.addEventListener("input", () => {
      renderChampionTagEditorTagOptions();
    });
  }

  elements.builderActiveTeam.addEventListener("change", () => {
    state.builder.teamId = normalizeConfiguredTeamId(elements.builderActiveTeam.value);
    state.teamConfig.activeTeamId = state.builder.teamId;
    saveTeamConfig();
    setBuilderStage("setup");
    resetBuilderTreeState();
    validateTeamSelections();
    clearBuilderFeedback();
    renderTeamConfig();
    renderBuilder();
    void fetchBuilderDraftContext(state.builder.teamId).then(() => {
      validateTeamSelections();
      renderTeamConfig();
      renderBuilder();
    });
    if (isAuthenticated()) {
      void saveTeamContextToApi().then(() => {
        saveTeamConfig();
        renderTeamConfig();
        renderBuilder();
      });
    }
  });

  if (elements.builderActiveComposition) {
    elements.builderActiveComposition.addEventListener("change", () => {
      state.builder.activeCompositionId = resolveBuilderActiveCompositionId(elements.builderActiveComposition.value);
      setBuilderStage("setup");
      resetBuilderTreeState();
      clearBuilderFeedback();
      renderBuilder();
    });
  }

  elements.treeDensity.addEventListener("change", () => {
    state.builder.treeDensity = elements.treeDensity.value === "detailed" ? "detailed" : "summary";
    renderTree();
    renderTreeMap();
  });

  elements.treeSearch.addEventListener("input", () => {
    state.builder.treeSearch = elements.treeSearch.value;
    renderTree();
    renderTreeMap();
  });

  elements.treeMinScore.addEventListener("change", () => {
    const parsed = Number.parseInt(elements.treeMinScore.value, 10);
    state.builder.treeMinScore = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    elements.treeMinScore.value = String(state.builder.treeMinScore);
    renderTree();
    renderTreeMap();
  });

  elements.treeValidLeavesOnly.addEventListener("change", () => {
    state.builder.treeValidLeavesOnly = Boolean(elements.treeValidLeavesOnly.checked);
    renderTree();
    renderTreeMap();
  });

  if (elements.treeMinCandidateScore) {
    elements.treeMinCandidateScore.addEventListener("change", () => {
      const parsed = Number.parseInt(elements.treeMinCandidateScore.value, 10);
      state.builder.treeMinCandidateScore = Number.isFinite(parsed) ? Math.max(0, parsed) : 1;
      elements.treeMinCandidateScore.value = String(state.builder.treeMinCandidateScore);
      setBuilderStage("setup");
      resetBuilderTreeState();
      renderBuilder();
    });
  }

  if (elements.treeRankGoal) {
    elements.treeRankGoal.addEventListener("change", () => {
      state.builder.treeRankGoal = normalizeBuilderRankGoal(elements.treeRankGoal.value);
      elements.treeRankGoal.value = state.builder.treeRankGoal;
      setBuilderStage("setup");
      resetBuilderTreeState();
      renderBuilder();
    });
  }

  const bindBuilderScoringWeightInput = (element, { key, fallback, min = null }) => {
    if (!element) {
      return;
    }
    element.addEventListener("change", () => {
      const nextValue = applyBuilderScoringWeightChange(key, element.value, fallback, { min });
      element.value = String(nextValue);
      setBuilderStage("setup");
      resetBuilderTreeState();
      renderBuilder();
    });
  };
  bindBuilderScoringWeightInput(elements.treeCandidateRedundancyPenalty, {
    key: "redundancyPenalty",
    fallback: BUILDER_DEFAULT_CANDIDATE_SCORING_WEIGHTS.redundancyPenalty,
    min: 0
  });

  elements.builderExcludedSearch.addEventListener("input", () => {
    state.builder.excludedSearch = elements.builderExcludedSearch.value;
    renderExcludedOptions();
  });

  elements.builderExcludedClear?.addEventListener("click", () => {
    if (state.builder.excludedChampions.length === 0) return;
    state.builder.excludedChampions = [];
    state.builder.excludedSearch = "";
    elements.builderExcludedSearch.value = "";
    resetBuilderTreeState();
    setBuilderStage("setup");
    validateTeamSelections();
    renderTeamConfig();
    renderBuilder();
  });

  elements.builderMaxBranch.addEventListener("change", () => {
    state.builder.maxBranch = Math.max(1, Number.parseInt(elements.builderMaxBranch.value, 10) || 1);
    elements.builderMaxBranch.value = String(state.builder.maxBranch);
    setBuilderStage("setup");
    resetBuilderTreeState();
    renderBuilder();
  });

  elements.builderContinueValidate.addEventListener("click", () => {
    if (!generateTreeFromCurrentState({ scrollToResults: true })) {
      return;
    }
    setSetupFeedback("");
  });

  elements.builderGenerate.addEventListener("click", () => {
    generateTreeFromCurrentState({ scrollToResults: true });
  });

  elements.builderClear.addEventListener("click", () => {
    state.builder.teamState = createEmptyTeamState();
    resetBuilderTreeState();
    setBuilderStage("setup");
    validateTeamSelections();
    clearBuilderFeedback();
    renderTeamConfig();
    renderBuilder();
  });

  elements.treeExpandAll.addEventListener("click", () => {
    setAllTreeDetails(true);
  });

  elements.treeCollapseAll.addEventListener("click", () => {
    setAllTreeDetails(false);
  });

  if (elements.teamConfigActiveTeam) {
    elements.teamConfigActiveTeam.addEventListener("change", () => {
      state.teamConfig.activeTeamId = resolveConfiguredTeamSelection(elements.teamConfigActiveTeam.value);
      state.builder.teamId = state.teamConfig.activeTeamId;
      setBuilderStage("setup");
      resetBuilderTreeState();
      validateTeamSelections();
      saveTeamConfig();
      renderTeamConfig();
      renderBuilder();
      clearBuilderFeedback();
      if (isAuthenticated()) {
        void saveTeamContextToApi().then(() => {
          saveTeamConfig();
          renderTeamConfig();
          renderBuilder();
        });
      }
    });
  }

  for (const button of elements.teamWorkspaceTabButtons) {
    button.addEventListener("click", () => {
      setTeamWorkspaceTab(button.dataset.teamWorkspaceTab);
    });
  }

  for (const button of elements.updatesReleaseTabButtons) {
    button.addEventListener("click", () => {
      setUpdatesReleaseTab(button.dataset.updatesReleaseTab);
    });
  }

  for (const button of elements.teamManageActionButtons) {
    button.addEventListener("click", () => {
      setTeamManageAction(button.dataset.teamManageAction);
    });
  }
  for (const button of elements.teamManageCancelButtons) {
    button.addEventListener("click", () => {
      openTeamManageAction(null);
    });
  }

  elements.playerConfigTeam.addEventListener("change", () => {
    state.playerConfig.teamId = normalizePlayerConfigTeamId(elements.playerConfigTeam.value);
    if (isAuthenticated()) {
      renderMyChampions();
      return;
    }
    const saved = savePlayerConfig();
    renderMyChampions();
    renderPlayerConfigFeedback(
      saved ? "" : "Player-config team selection changed in memory, but local storage is unavailable.",
      !saved
    );
  });

  if (elements.playerConfigSavePool) {
    elements.playerConfigSavePool.addEventListener("click", () => {
      void saveActivePlayerPoolSelection();
    });
  }

  elements.profilePrimaryRole.addEventListener("change", () => {
    state.profile.primaryRole = normalizeProfileRole(elements.profilePrimaryRole.value);
    state.profile.secondaryRoles = normalizeSecondaryRoles(state.profile.secondaryRoles, state.profile.primaryRole);
    state.playerConfig.teamId = buildRolePoolTeamId(state.profile.primaryRole);
    renderPlayerConfig();
  });

  elements.profileSaveRoles.addEventListener("click", () => {
    if (!isAuthenticated()) {
      return;
    }
    if (state.profile.isSavingRoles) {
      return;
    }
    if (!SLOTS.includes(state.profile.primaryRole)) {
      if (elements.otherRolesModalFeedback) {
        elements.otherRolesModalFeedback.textContent = "Primary role is required.";
        elements.otherRolesModalFeedback.style.color = "var(--warn)";
      }
      return;
    }

    state.profile.isSavingRoles = true;
    if (elements.otherRolesModalFeedback) elements.otherRolesModalFeedback.textContent = "Saving...";
    renderProfileRolesSection();

    void apiRequest("/me/profile", {
      method: "PUT",
      auth: true,
      body: {
        primaryRole: state.profile.primaryRole,
        secondaryRoles: state.profile.secondaryRoles
      }
    })
      .then(async (payload) => {
        const profile = payload?.profile ?? {};
        const primaryRole = normalizeProfileRole(profile.primaryRole);
        state.profile.primaryRole = primaryRole;
        state.profile.secondaryRoles = normalizeSecondaryRoles(profile.secondaryRoles, primaryRole);
        state.playerConfig.teamId = buildRolePoolTeamId(primaryRole);
        if (state.auth.user && typeof state.auth.user === "object") {
          state.auth.user.primaryRole = state.profile.primaryRole;
          state.auth.user.secondaryRoles = [...state.profile.secondaryRoles];
          saveAuthSession();
        }
        closeOtherRolesModal();
        renderPlayerConfig();
        await hydrateAuthenticatedViews(state.playerConfig.teamId, state.api.selectedTeamId);
      })
      .catch((error) => {
        if (elements.otherRolesModalFeedback) {
          elements.otherRolesModalFeedback.textContent = normalizeApiErrorMessage(error, "Failed to save profile roles.");
          elements.otherRolesModalFeedback.style.color = "var(--warn)";
        }
      })
      .finally(() => {
        state.profile.isSavingRoles = false;
        renderProfileRolesSection();
      });
  });

  elements.teamAdminTeamSelect.addEventListener("change", () => {
    state.api.selectedTeamId = elements.teamAdminTeamSelect.value;
    state.api.joinRequestsByTeamId[state.api.selectedTeamId] = [];
    void loadTeamMembersForSelectedTeam().then(() => {
      renderTeamAdmin();
    });
  });

  if (elements.teamJoinDiscoverSelect) {
    elements.teamJoinDiscoverSelect.addEventListener("change", () => {
      state.api.selectedDiscoverTeamId = elements.teamJoinDiscoverSelect.value;
      renderTeamAdmin();
    });
  }

  elements.teamAdminCreate.addEventListener("click", () => {
    void createTeamFromTeamAdmin();
  });

  if (elements.teamAdminRefresh) {
    elements.teamAdminRefresh.addEventListener("click", () => {
      void loadTeamsFromApi(state.api.selectedTeamId).then(() => {
        renderTeamAdmin();
      });
    });
  }

  if (elements.teamJoinLoadDiscover) {
    elements.teamJoinLoadDiscover.addEventListener("click", () => {
      void loadDiscoverTeamsFromApi().then(() => {
        setTeamJoinFeedback("Discover teams loaded.");
        renderTeamAdmin();
      });
    });
  }

  if (elements.teamJoinRequest) {
    elements.teamJoinRequest.addEventListener("click", () => {
      const selectedDiscoverTeam = findDiscoverTeamById(state.api.selectedDiscoverTeamId);
      if (!selectedDiscoverTeam) {
        setTeamJoinFeedback("Select a discoverable team first.");
        return;
      }
      const note = typeof elements.teamJoinNote?.value === "string" ? elements.teamJoinNote.value.trim() : "";
      void apiRequest(`/teams/${selectedDiscoverTeam.id}/join-requests`, {
        method: "POST",
        auth: true,
        body: note ? { note } : {}
      })
        .then(async () => {
          if (elements.teamJoinNote) {
            elements.teamJoinNote.value = "";
          }
          setTeamJoinFeedback(`Submitted join request for ${formatTeamCardTitle(selectedDiscoverTeam)}.`);
          await loadDiscoverTeamsFromApi();
          renderTeamAdmin();
        })
        .catch((error) => {
          setTeamJoinFeedback(normalizeApiErrorMessage(error, "Failed to submit join request."));
        });
    });
  }

  if (elements.teamJoinCancel) {
    elements.teamJoinCancel.addEventListener("click", () => {
      const selectedDiscoverTeam = findDiscoverTeamById(state.api.selectedDiscoverTeamId);
      const requestId = Number.parseInt(String(selectedDiscoverTeam?.pending_join_request_id ?? ""), 10);
      if (!selectedDiscoverTeam || !Number.isInteger(requestId) || requestId <= 0) {
        setTeamJoinFeedback("No pending join request to cancel for the selected team.");
        return;
      }
      void apiRequest(`/teams/${selectedDiscoverTeam.id}/join-requests/${requestId}`, {
        method: "DELETE",
        auth: true
      })
        .then(async () => {
          setTeamJoinFeedback(`Canceled pending request for ${formatTeamCardTitle(selectedDiscoverTeam)}.`);
          await loadDiscoverTeamsFromApi();
          renderTeamAdmin();
        })
        .catch((error) => {
          setTeamJoinFeedback(normalizeApiErrorMessage(error, "Failed to cancel join request."));
        });
    });
  }

  if (elements.teamJoinLoadReview) {
    elements.teamJoinLoadReview.addEventListener("click", () => {
      void loadPendingJoinRequestsForSelectedTeam().then(() => {
        setTeamJoinFeedback("Pending join requests loaded.");
        renderTeamAdmin();
      });
    });
  }

  if (elements.teamJoinReviewList) {
    elements.teamJoinReviewList.addEventListener("click", (event) => {
      const actionButton = event.target.closest("button[data-team-join-review-action]");
      if (!actionButton || actionButton.disabled) {
        return;
      }
      const selectedTeam = getSelectedAdminTeam();
      if (!selectedTeam) {
        setTeamJoinFeedback("Select a team first.");
        return;
      }
      const requestId = Number.parseInt(String(actionButton.dataset.requestId ?? ""), 10);
      if (!Number.isInteger(requestId) || requestId <= 0) {
        setTeamJoinFeedback("Could not resolve the selected join request.");
        return;
      }
      const action = actionButton.dataset.teamJoinReviewAction;
      const status = action === "approve" ? "approved" : (action === "reject" ? "rejected" : "");
      if (!status) {
        setTeamJoinFeedback("Unsupported join-request action.");
        return;
      }

      void apiRequest(`/teams/${selectedTeam.id}/join-requests/${requestId}`, {
        method: "PUT",
        auth: true,
        body: { status }
      })
        .then(async () => {
          setTeamJoinFeedback(status === "approved" ? "Approved join request." : "Rejected join request.");
          await loadPendingJoinRequestsForSelectedTeam();
          await loadTeamsFromApi(selectedTeam.id);
          renderTeamAdmin();
        })
        .catch((error) => {
          setTeamJoinFeedback(normalizeApiErrorMessage(error, "Failed to update join request."));
        });
    });
  }

  if (elements.teamInviteLoad) {
    elements.teamInviteLoad.addEventListener("click", () => {
      void loadMemberInvitationsForSelectedTeam().then(() => {
        renderTeamInviteList(getSelectedAdminTeam());
      });
    });
  }

  if (elements.teamInviteSend) {
    elements.teamInviteSend.addEventListener("click", () => {
      void sendTeamInvitation().then(() => {
        renderTeamInviteList(getSelectedAdminTeam());
      });
    });
  }

  if (elements.teamInviteClear) {
    elements.teamInviteClear.addEventListener("click", () => {
      clearTeamInviteForm();
      setTeamInviteFeedback("");
    });
  }

  if (elements.teamInviteList) {
    elements.teamInviteList.addEventListener("click", (event) => {
      const actionButton = event.target.closest("button[data-team-invite-action]");
      if (!actionButton || actionButton.disabled) {
        return;
      }
      const invitationId = Number.parseInt(actionButton.dataset.teamInviteId ?? "", 10);
      const selectedTeam = getSelectedAdminTeam();
      if (!selectedTeam || !Number.isFinite(invitationId) || invitationId <= 0) {
        setTeamInviteFeedback("Could not resolve the selected invitation.");
        return;
      }
      const action = actionButton.dataset.teamInviteAction;
      if (action === "cancel") {
        void updateTeamInvitationStatus(selectedTeam.id, invitationId, "canceled", "Invitation canceled.");
      }
    });
  }

  if (elements.teamInviteUserLoad) {
    elements.teamInviteUserLoad.addEventListener("click", () => {
      void loadInvitationsForUser().then(() => {
        renderTeamInviteUserList();
      });
    });
  }

  if (elements.teamInviteUserList) {
    elements.teamInviteUserList.addEventListener("click", (event) => {
      const actionButton = event.target.closest("button[data-team-invite-user-action]");
      if (!actionButton || actionButton.disabled) {
        return;
      }
      const invitationId = Number.parseInt(actionButton.dataset.teamInviteId ?? "", 10);
      const teamId = Number.parseInt(actionButton.dataset.teamId ?? "", 10);
      if (!Number.isFinite(invitationId) || invitationId <= 0 || !Number.isFinite(teamId) || teamId <= 0) {
        setTeamInviteUserFeedback("Could not resolve the selected invitation.");
        return;
      }
      const action = actionButton.dataset.teamInviteUserAction;
      if (action === "accept" || action === "reject") {
        const status = action === "accept" ? "accepted" : "rejected";
        const feedbackMsg = action === "accept" ? "Invitation accepted." : "Invitation rejected.";
        void updateTeamInvitationStatus(teamId, invitationId, status, feedbackMsg, { suppressTeamFeedback: true }).then(() => {
          setTeamInviteUserFeedback(feedbackMsg);
        });
      }
    });
  }

  if (elements.teamAdminOpenEdit) {
    elements.teamAdminOpenEdit.addEventListener("click", () => {
      openTeamManageAction(TEAM_MANAGE_ACTION_TEAM_SETTINGS);
    });
  }

  if (elements.teamAdminMembers) {
    elements.teamAdminMembers.addEventListener("click", (event) => {
      const actionButton = event.target.closest("button[data-roster-quick-action]");
      if (!actionButton) {
        return;
      }

      const selectedTeam = getSelectedAdminTeam();
      if (!selectedTeam || actionButton.disabled) {
        return;
      }

      const riotId = actionButton.dataset.riotId ?? "";
      const nextTeamRole = actionButton.dataset.teamRole;
      const lane = actionButton.dataset.lane ?? "";
      const quickAction = actionButton.dataset.rosterQuickAction;

      if (quickAction === "open-add-member") {
        openTeamManageAction(TEAM_MANAGE_ACTION_ADD_MEMBER, { lane });
        elements.teamAdminAddRole.value = DEFAULT_MEMBER_ROLE;
        elements.teamAdminAddTeamRole.value = TEAM_MEMBER_TYPE_OPTIONS.includes(nextTeamRole)
          ? nextTeamRole
          : "primary";
        elements.teamAdminAddRiotId.value = "";
        setTeamAdminFeedback("");
        elements.teamAdminAddRiotId.focus();
        return;
      }

      if (!riotId) {
        setTeamAdminFeedback("Riot ID is missing for that roster member.");
        return;
      }

      if (quickAction === "remove-member") {
        openTeamManageAction(TEAM_MANAGE_ACTION_REMOVE_MEMBER, { lane });
        elements.teamAdminRemoveRiotId.value = riotId;
        setTeamAdminFeedback("");
        elements.teamAdminRemoveRiotId.focus();
        return;
      }

      if (quickAction === "promote-lead") {
        openTeamManageAction(TEAM_MANAGE_ACTION_UPDATE_MEMBER_ROLE, { lane });
        elements.teamAdminRoleRiotId.value = riotId;
        elements.teamAdminRole.value = "lead";
        setTeamAdminFeedback("");
        elements.teamAdminRoleRiotId.focus();
        return;
      }

      if (quickAction === "move-team-role") {
        openTeamManageAction(TEAM_MANAGE_ACTION_UPDATE_TEAM_ROLE, { lane });
        elements.teamAdminTeamRoleRiotId.value = riotId;
        elements.teamAdminTeamRole.value = TEAM_MEMBER_TYPE_OPTIONS.includes(nextTeamRole)
          ? nextTeamRole
          : DEFAULT_TEAM_MEMBER_TYPE;
        setTeamAdminFeedback("");
        elements.teamAdminTeamRoleRiotId.focus();
      }
    });
  }

  if (elements.teamAdminCurrentLogoOpen) {
    elements.teamAdminCurrentLogoOpen.addEventListener("click", () => {
      const logoUrl = elements.teamAdminCurrentLogoOpen.dataset.logoUrl;
      const caption = elements.teamAdminCurrentLogoOpen.dataset.logoCaption ?? "";
      openLogoLightbox(logoUrl, caption);
    });
  }

  if (elements.teamAdminRenameLogoUrl && elements.teamAdminRenameRemoveLogo) {
    elements.teamAdminRenameLogoUrl.addEventListener("change", () => {
      const hasLogoFile = Boolean(readTeamLogoFile(elements.teamAdminRenameLogoUrl));
      if (hasLogoFile) {
        elements.teamAdminRenameRemoveLogo.checked = false;
      }
    });

    elements.teamAdminRenameRemoveLogo.addEventListener("change", () => {
      if (!elements.teamAdminRenameRemoveLogo.checked) {
        return;
      }
      if (elements.teamAdminRenameLogoUrl) {
        elements.teamAdminRenameLogoUrl.value = "";
      }
    });
  }

  elements.teamAdminRename.addEventListener("click", () => {
    const selectedTeam = getSelectedAdminTeam();
    if (!selectedTeam) {
      setTeamAdminFeedback("Select a team first.");
      return;
    }
    const payload = readTeamUpdateFormValues();
    const requestConfig = buildTeamMutationRequest({
      name: payload.name,
      tag: payload.tag,
      logoFile: payload.logoFile,
      removeLogo: payload.removeLogo,
      allowRemoveLogo: true
    });
    if (requestConfig.error) {
      setTeamAdminFeedback(requestConfig.error);
      return;
    }

    void apiRequest(`/teams/${selectedTeam.id}`, {
      method: "PATCH",
      auth: true,
      body: requestConfig.body,
      isFormData: requestConfig.isFormData
    })
      .then(async () => {
        setTeamAdminFeedback(`Updated team '${payload.name}'.`);
        if (elements.teamAdminRenameLogoUrl) {
          elements.teamAdminRenameLogoUrl.value = "";
        }
        if (elements.teamAdminRenameRemoveLogo) {
          elements.teamAdminRenameRemoveLogo.checked = false;
        }
        await hydrateAuthenticatedViews(state.playerConfig.teamId, selectedTeam.id);
      })
      .catch((error) => {
        setTeamAdminFeedback(normalizeApiErrorMessage(error, "Failed to rename team."));
      });
  });

  elements.teamAdminDelete.addEventListener("click", () => {
    const selectedTeam = getSelectedAdminTeam();
    if (!selectedTeam) {
      setTeamAdminFeedback("Select a team first.");
      return;
    }

    void apiRequest(`/teams/${selectedTeam.id}`, {
      method: "DELETE",
      auth: true
    })
      .then(async () => {
        setTeamAdminFeedback("Deleted team.");
        await hydrateAuthenticatedViews(state.playerConfig.teamId, null);
      })
      .catch((error) => {
        setTeamAdminFeedback(normalizeApiErrorMessage(error, "Failed to delete team."));
      });
  });

  elements.teamAdminAddMember.addEventListener("click", () => {
    const selectedTeam = getSelectedAdminTeam();
    if (!selectedTeam) {
      setTeamAdminFeedback("Select a team first.");
      return;
    }
    const parsedRiotId = parseRiotIdInput(elements.teamAdminAddRiotId.value);
    if (!parsedRiotId) {
      setTeamAdminFeedback("Enter a Riot ID in the format GameName#NA1.");
      return;
    }
    const role = MEMBER_ROLE_OPTIONS.includes(elements.teamAdminAddRole.value)
      ? elements.teamAdminAddRole.value
      : DEFAULT_MEMBER_ROLE;
    const teamRole = TEAM_MEMBER_TYPE_OPTIONS.includes(elements.teamAdminAddTeamRole.value)
      ? elements.teamAdminAddTeamRole.value
      : DEFAULT_TEAM_MEMBER_TYPE;

    void apiRequest(`/teams/${selectedTeam.id}/members`, {
      method: "POST",
      auth: true,
      body: { riot_id: parsedRiotId.display, role, team_role: teamRole }
    })
      .then(async () => {
        elements.teamAdminAddRiotId.value = "";
        setTeamAdminFeedback(`Added ${parsedRiotId.display} as ${role}/${teamRole}.`);
        await loadTeamsFromApi(selectedTeam.id);
        renderTeamAdmin();
      })
      .catch((error) => {
        setTeamAdminFeedback(normalizeApiErrorMessage(error, "Failed to add member."));
      });
  });

  elements.teamAdminUpdateRole.addEventListener("click", () => {
    const selectedTeam = getSelectedAdminTeam();
    if (!selectedTeam) {
      setTeamAdminFeedback("Select a team first.");
      return;
    }
    const lookup = resolveSelectedTeamMemberByRiotId(elements.teamAdminRoleRiotId.value);
    if (lookup.error || !lookup.member) {
      setTeamAdminFeedback(lookup.error || "Team member not found.");
      return;
    }
    const userId = resolveMemberUserId(lookup.member);
    if (!Number.isInteger(userId) || userId <= 0) {
      setTeamAdminFeedback("Could not resolve that member to an internal user ID.");
      return;
    }
    const role = MEMBER_ROLE_OPTIONS.includes(elements.teamAdminRole.value)
      ? elements.teamAdminRole.value
      : DEFAULT_MEMBER_ROLE;

    void apiRequest(`/teams/${selectedTeam.id}/members/${userId}/role`, {
      method: "PUT",
      auth: true,
      body: { role }
    })
      .then(async () => {
        setTeamAdminFeedback(`Updated ${lookup.riotId} role to ${role}.`);
        await loadTeamsFromApi(selectedTeam.id);
        renderTeamAdmin();
      })
      .catch((error) => {
        setTeamAdminFeedback(normalizeApiErrorMessage(error, "Failed to update member role."));
      });
  });

  elements.teamAdminUpdateTeamRole.addEventListener("click", () => {
    const selectedTeam = getSelectedAdminTeam();
    if (!selectedTeam) {
      setTeamAdminFeedback("Select a team first.");
      return;
    }
    const lookup = resolveSelectedTeamMemberByRiotId(elements.teamAdminTeamRoleRiotId.value);
    if (lookup.error || !lookup.member) {
      setTeamAdminFeedback(lookup.error || "Team member not found.");
      return;
    }
    const userId = resolveMemberUserId(lookup.member);
    if (!Number.isInteger(userId) || userId <= 0) {
      setTeamAdminFeedback("Could not resolve that member to an internal user ID.");
      return;
    }
    const teamRole = TEAM_MEMBER_TYPE_OPTIONS.includes(elements.teamAdminTeamRole.value)
      ? elements.teamAdminTeamRole.value
      : DEFAULT_TEAM_MEMBER_TYPE;

    void apiRequest(`/teams/${selectedTeam.id}/members/${userId}/team-role`, {
      method: "PUT",
      auth: true,
      body: { team_role: teamRole }
    })
      .then(async () => {
        setTeamAdminFeedback(`Updated ${lookup.riotId} team role to ${teamRole}.`);
        await loadTeamsFromApi(selectedTeam.id);
        renderTeamAdmin();
      })
      .catch((error) => {
        setTeamAdminFeedback(normalizeApiErrorMessage(error, "Failed to update member team role."));
      });
  });

  elements.teamAdminRemoveMember.addEventListener("click", () => {
    const selectedTeam = getSelectedAdminTeam();
    if (!selectedTeam) {
      setTeamAdminFeedback("Select a team first.");
      return;
    }
    const lookup = resolveSelectedTeamMemberByRiotId(elements.teamAdminRemoveRiotId.value);
    if (lookup.error || !lookup.member) {
      setTeamAdminFeedback(lookup.error || "Team member not found.");
      return;
    }
    const userId = resolveMemberUserId(lookup.member);
    if (!Number.isInteger(userId) || userId <= 0) {
      setTeamAdminFeedback("Could not resolve that member to an internal user ID.");
      return;
    }
    const teamMembers = state.api.membersByTeamId[String(selectedTeam.id)] ?? [];
    if (teamMembers.length <= 1) {
      setTeamAdminFeedback("Cannot remove the last team member.");
      return;
    }

    void apiRequest(`/teams/${selectedTeam.id}/members/${userId}`, {
      method: "DELETE",
      auth: true
    })
      .then(async () => {
        elements.teamAdminRemoveRiotId.value = "";
        setTeamAdminFeedback(`Removed ${lookup.riotId} from team.`);
        await loadTeamsFromApi(selectedTeam.id);
        renderTeamAdmin();
      })
      .catch((error) => {
        setTeamAdminFeedback(normalizeApiErrorMessage(error, "Failed to remove member."));
      });
  });
}

async function init() {
  try {
    applyUiCopy();
    loadStoredUiState();
    syncNavLayout();
    loadStoredAuthSession();
    restoreAvatarChampionId();
    renderAuthGate();
    const initialRoute = parseTabRouteHash(runtimeWindow.location.hash);
    // Apply the correct initial tab before any awaits so the browser never
    // paints the default Composer tab when the user was on a different page.
    const initialTab =
      initialRoute.status === "valid"
        ? initialRoute.tab
        : initialRoute.status === "invalid"
          ? DEFAULT_TAB_ROUTE
          : state.activeTab;
    setTab(initialTab, {
      syncRoute: true,
      replaceRoute: initialRoute.status !== "valid" || initialRoute.shouldNormalize
    });
    await loadMvpData();
    await loadTagCatalogFromApi();
    let loadedTeamContextFromApi = false;
    if (isAuthenticated()) {
      await loadProfileFromApi();
      await loadPoolsFromApi();
      await loadTeamsFromApi();
      loadedTeamContextFromApi = await loadTeamContextFromApi();
      await hydrateCompositionsWorkspaceFromApi();
      if (isAdminUser()) {
        await loadUsersFromApi();
      }
    } else {
      loadStoredPlayerConfig();
      setPoolApiFeedback("Sign in to manage API-backed pools.");
      setTeamAdminFeedback("Sign in to manage teams.");
      setTeamJoinFeedback("Sign in to request or review team join requests.");
      setProfileRolesFeedback("");
      setUsersFeedback("Sign in as admin to manage users.");
      setRequirementsFeedback("Sign in to load requirement definitions.");
      setCompositionsFeedback("Sign in to load compositions.");
    }
    if (!loadedTeamContextFromApi) {
      loadStoredTeamConfig();
    }
    initializeExplorerControls();
    initializeBuilderControls();
    initializeTeamConfigControls();
    initializePlayerConfigControls();
    renderUpdatesReleaseTabs();
    resetBuilderToDefaults();

    attachEvents();
    setTab(initialTab, {
      syncRoute: true,
      replaceRoute: initialRoute.status !== "valid" || initialRoute.shouldNormalize
    });
    validateTeamSelections();
    renderTeamConfig();
    renderTeamAdmin();
    renderPlayerConfig();
    renderBuilder();
    renderChampionTagCatalog();
    renderTagsWorkspace();
    renderUsersWorkspace();
    renderCompositionsWorkspace();
    renderChampionTagEditor();
    renderAuth();
    clearBuilderFeedback();
    void fetchBuilderDraftContext(state.builder.teamId).then(() => {
      validateTeamSelections();
      renderTeamConfig();
      renderBuilder();
    });
  } catch (error) {
    setSetupFeedback(error instanceof Error ? error.message : "Failed to initialize app.");
  }
}

function createFallbackMatchMedia() {
  return (query) => ({
    matches: false,
    media: query,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {}
  });
}

export async function initApp(deps = {}) {
  runtimeDocument = deps.document ?? globalThis.document ?? null;
  runtimeWindow =
    deps.window ??
    runtimeDocument?.defaultView ??
    globalThis.window ??
    null;
  runtimeFetch =
    deps.fetchImpl ??
    runtimeWindow?.fetch?.bind(runtimeWindow) ??
    globalThis.fetch?.bind(globalThis) ??
    null;
  runtimeStorage = deps.storage ?? runtimeWindow?.localStorage ?? null;
  runtimeMatchMedia =
    deps.matchMediaImpl ??
    runtimeWindow?.matchMedia?.bind(runtimeWindow) ??
    createFallbackMatchMedia();
  runtimeApiBaseUrl = normalizeApiBaseUrl(
    deps.apiBaseUrl ??
      runtimeWindow?.DRAFTENGINE_API_BASE_URL ??
      runtimeWindow?.__DRAFTENGINE_API_BASE_URL__ ??
      runtimeDocument
        ?.querySelector("meta[name='draftengine-api-base-url']")
        ?.getAttribute("content") ??
      ""
  );

  if (!runtimeDocument || !runtimeWindow) {
    throw new Error("initApp requires browser-like window and document dependencies.");
  }
  if (!runtimeFetch) {
    throw new Error("initApp requires a fetch implementation.");
  }
  if (!runtimeApiBaseUrl) {
    throw new Error("initApp requires a configured API base URL.");
  }

  state = createInitialState();
  elements = createElements();
  checkboxMultiDetailsRegistry.clear();
  for (const key of Object.keys(multiSelectControls)) {
    delete multiSelectControls[key];
  }

  await init();
  return { state, elements };
}

export function getAppState() {
  return state;
}
