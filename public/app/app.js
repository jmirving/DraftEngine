import {
  BOOLEAN_TAGS,
  DAMAGE_TYPES,
  DEFAULT_RECOMMENDATION_WEIGHTS,
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
const TEAM_MEMBER_SEARCH_MIN_LENGTH = 2;
const CHAMPION_TAG_SCOPES = Object.freeze(["self", "team", "all"]);
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
const RECENT_SUGGESTION_WINDOW_DAYS = 30;
const MAX_PROMOTION_COMMENT_LENGTH = 500;
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
const BUILDER_SCOPE_RESOURCES = Object.freeze([
  "champion_metadata",
  "champion_tags",
  "tag_definitions",
  "requirements",
  "compositions"
]);
const BUILDER_SCOPE_RESOURCE_LABELS = Object.freeze({
  champion_metadata: "Champion Metadata",
  champion_tags: "Champion Tags",
  tag_definitions: "Tag Definitions",
  requirements: "Requirements",
  compositions: "Compositions"
});
const BUILDER_SCOPE_PRECEDENCE_OPTIONS = Object.freeze([
  { value: "user_team_global", label: "User > Team > Global" },
  { value: "team_user_global", label: "Team > User > Global" },
  { value: "user_global", label: "User > Global" },
  { value: "team_global", label: "Team > Global" },
  { value: "global_only", label: "Global only" }
]);
const BUILDER_SCOPE_PRECEDENCE_SET = new Set(BUILDER_SCOPE_PRECEDENCE_OPTIONS.map((option) => option.value));
const BUILDER_SCOPE_DEFAULT_PRECEDENCE = "user_team_global";
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

function normalizeBuilderScopePrecedence(value, fallback = BUILDER_SCOPE_DEFAULT_PRECEDENCE) {
  return BUILDER_SCOPE_PRECEDENCE_SET.has(value) ? value : fallback;
}

function createDefaultBuilderScopeResourceSettings() {
  return Object.fromEntries(
    BUILDER_SCOPE_RESOURCES.map((resource) => [
      resource,
      {
        enabled: true,
        precedence: BUILDER_SCOPE_DEFAULT_PRECEDENCE
      }
    ])
  );
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
        subtitle: "Search champions and edit user, team, or global champion metadata."
      },
      tags: {
        title: "Tags",
        subtitle: "Manage shared tag definitions and champion coverage."
      },
      users: {
        title: "Users",
        subtitle: "Admin-only directory for permissions, scoped access, and one-time Riot ID corrections."
      },
      "champion-core": {
        title: "Champion Core",
        subtitle: "Verify the imported Riot/Data Dragon baseline champion dataset."
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
    meta: "Jump between Composer, Teams, Profile, Champions, Tags, Users, Champion Core, Requirements, Compositions, and Updates.",
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
    usersMeta: "Admin-only user directory, permission management, scoped access visibility, one-time Riot ID corrections, and authorization matrix visibility.",
    championCoreTitle: "Champion Core",
    championCoreMeta: "Admin-only verification view for the imported Riot/Data Dragon champion baseline.",
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
        panelTitle: "Draft Setup",
        panelMeta: "Choose team context and lock known picks."
      },
      {
        key: "inspect",
        panelTitle: "Draft Review",
        panelMeta: "Run checks and inspect generated branches."
      }
    ],
    continueLabel: "Review Composition",
    generateLabel: "Start Draft",
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
  "champion-core",
  "requirements",
  "compositions",
  "coming-soon"
]);
const TAB_ROUTE_SET = new Set(TAB_ROUTES);
const LANE_ORDER = Object.freeze(["Top", "Jungle", "Mid", "ADC", "Support"]);
const DEFAULT_ISSUE_REPORTING_FALLBACK_URL = "https://github.com/jmirving/DraftEngine/issues/new/choose";
const ISSUE_REPORT_PAGE_LABELS = Object.freeze({
  workflow: "Composer",
  "team-config": "Teams",
  profile: "Profile",
  explorer: "Champions",
  tags: "Champion Tags",
  users: "Users",
  "champion-core": "Champion Core",
  requirements: "Requirements",
  compositions: "Compositions",
  "coming-soon": "Updates"
});
const ISSUE_REPORT_TEAM_TAB_LABELS = Object.freeze({
  [TEAM_WORKSPACE_TAB_MEMBER]: "Member",
  [TEAM_WORKSPACE_TAB_MANAGE]: "Manage",
  [TEAM_WORKSPACE_TAB_CREATE]: "Create"
});
const ISSUE_REPORT_UPDATES_TAB_LABELS = Object.freeze({
  [UPDATES_RELEASE_TAB_WHATS_NEW]: "What's New",
  [UPDATES_RELEASE_TAB_COMING_SOON]: "Coming Soon",
  [UPDATES_RELEASE_TAB_PREVIOUS]: "Previous Release Notes"
});
const ISSUE_REPORT_EXPLORER_TAB_LABELS = Object.freeze({
  "my-champions": "My Champions",
  "edit-champions": "Edit Champions"
});
const ISSUE_REPORT_PROFILE_TAB_LABELS = Object.freeze({
  account: "Account",
  "display-team": "Display Team",
  roles: "Roles",
  "admin-users": "Admin Users",
  "admin-champion-core": "Champion Core"
});
const ISSUE_REPORT_TEAM_ACTION_LABELS = Object.freeze({
  [TEAM_MANAGE_ACTION_TEAM_SETTINGS]: "Team Settings",
  [TEAM_MANAGE_ACTION_ADD_MEMBER]: "Add Member",
  [TEAM_MANAGE_ACTION_UPDATE_MEMBER_ROLE]: "Update Member Role",
  [TEAM_MANAGE_ACTION_UPDATE_TEAM_ROLE]: "Update Team Role",
  [TEAM_MANAGE_ACTION_REMOVE_MEMBER]: "Remove Member"
});

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
const POWER_SPIKE_MIN_LEVEL = 1;
const POWER_SPIKE_MAX_LEVEL = 18;
const POWER_SPIKE_MAX_RANGES = 2;

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

function createEmptyChampionCompositionSynergiesDraft() {
  return {
    definition: "",
    rules: []
  };
}

function createEmptyChampionMetadataDraft() {
  return {
    roles: [],
    roleProfiles: {},
    useSharedRoleProfile: false,
    compositionSynergies: createEmptyChampionCompositionSynergiesDraft()
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

function createEmptyIssueReportingState() {
  return {
    enabled: false,
    repository: "jmirving/DraftEngine",
    fallbackUrl: DEFAULT_ISSUE_REPORTING_FALLBACK_URL,
    isLoading: false,
    isSubmitting: false,
    isOpen: false,
    lastIssueUrl: "",
    sourceContext: null
  };
}

function createEmptyConfirmationState() {
  return {
    isOpen: false,
    title: "Confirm Action",
    message: "",
    confirmLabel: "Confirm",
    cancelLabel: "Cancel"
  };
}

function normalizeDraftSetupSaveMode(rawValue) {
  return rawValue === "settings_only" ? "settings_only" : "full";
}

function createInitialState() {
  return {
    data: null,
    activeTab: DEFAULT_TAB_ROUTE,
    ui: {
      isNavOpen: false,
      isNavCollapsed: false,
      showGettingStarted: true,
      gettingStartedDismissed: false,
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
      isSavingAvatar: false,
      isSavingDisplayTeam: false,
      championStats: createEmptyChampionStatsState(),
      championSuggestions: [],
      isChampionSuggestionNoticeOpen: false,
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
      discoverTeamsLoadedAt: null,
      isLoadingDiscoverTeams: false,
      membersByTeamId: {},
      joinRequestsByTeamId: {},
      joinRequestsLoadedAtByTeamId: {},
      isLoadingJoinRequests: false,
      invitationsByTeamId: {},
      teamInvitationsLoadedAtByTeamId: {},
      teamInvitationsLoadErrorByTeamId: {},
      userInvitations: [],
      userInvitationsLoadedAt: null,
      userInvitationsLoadError: false,
      isLoadingTeamInvitations: false,
      isLoadingUserInvitations: false,
      issueReporting: createEmptyIssueReportingState(),
      confirmation: createEmptyConfirmationState(),
      selectedTeamId: "",
      selectedDiscoverTeamId: "",
      isCreatingTeam: false,
      tags: [],
      tagById: {},
      tagsWorkspaceCatalog: [],
      tagsWorkspaceTagById: {},
      tagsCatalogScope: "all",
      tagsCatalogTeamId: "",
      tagPromotionRequests: [],
      tagPromotionReviewQueue: [],
      isLoadingTagPromotions: false,
      isSubmittingTagPromotion: false,
      isTagPromotionModalOpen: false,
      isTagsManageModalOpen: false,
      tagPromotionDraftComment: "",
      championEditorTags: [],
      championEditorTagById: {},
      selectedChampionTagEditorId: null,
      selectedChampionTagIds: [],
      championTagScope: "self",
      championTagTeamId: "",
      compositionCatalogScope: "all",
      compositionCatalogTeamId: "",
      championEditorTab: CHAMPION_EDITOR_TAB_COMPOSITION,
      championMetadataDraft: createEmptyChampionMetadataDraft(),
      championReviewedDraft: false,
      championMetadataHasCustom: false,
      championMetadataResolvedScope: "all",
      championEditorSavedSnapshot: null,
      championProfileActiveRole: null,
      isLoadingChampionTags: false,
      isSavingChampionTags: false,
      selectedTagManagerId: null,
      isSavingTagCatalog: false,
      users: [],
      championCore: [],
      championCoreSearch: "",
      isLoadingChampionCore: false,
      isLoadingUsers: false,
      authorizationMatrix: null,
      isLoadingAuthorizationMatrix: false,
      usersSearch: "",
      usersRoleFilter: "",
      selectedUserIds: new Set(),
      bulkUserRole: "member",
      isBulkSavingUserRoles: false,
      savingUserRoleId: null,
      savingUserRiotIdId: null,
      deletingUserId: null,
      teamAdminAddMemberSearchQuery: "",
      teamAdminAddMemberSearchResults: [],
      isLoadingTeamAdminAddMemberSearch: false,
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
      scaling: [],
      metadataScopeFilter: "",
      includeTags: [],
      excludeTags: [],
      sortBy: "alpha-asc",
      filtersOpen: true,
      activeCardRole: {},
      activeMetadataScopeByChampionId: {},
      scopedMetadataByChampionId: {},
      subTab: "my-champions"
    },
    teamConfig: {
      activeTeamId: null
    },
    playerConfig: {
      teamId: null,
      byTeam: {},
      dirtyPoolByTeamId: {},
      isSavingPool: false,
      selectorFilter: "",
      selectorPending: [],
      cardFilter: "",
      comfortFilter: []
    },
    builder: {
      stage: "setup",
      showOptionalChecks: BUILDER_DEFAULTS.showOptionalChecksByDefault,
      teamId: "",
      activeCompositionId: null,
      composerContextRequirements: [],
      composerContextCompositions: [],
      composerTagById: {},
      composerTags: [],
      composerChampionsByName: {},
      useCustomScopes: false,
      defaultScopePrecedence: BUILDER_SCOPE_DEFAULT_PRECEDENCE,
      scopeResourceSettings: createDefaultBuilderScopeResourceSettings(),
      scopeLoadError: "",
      draftSetups: [],
      selectedDraftSetupId: null,
      draftSetupName: "",
      draftSetupDescription: "",
      draftSetupSaveMode: "full",
      draftSetupFeedback: "",
      isLoadingDraftSetups: false,
      isSavingDraftSetup: false,
      isSaveDraftModalOpen: false,
      isLoadDraftModalOpen: false,
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
      selectedNodeTitle: "Root Composition",
      draftPathSelections: {}
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
    reportIssueLink: runtimeDocument.querySelector("#report-issue-link"),
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
    tagsScope: runtimeDocument.querySelector("#tags-scope"),
    tagsScopeReadout: runtimeDocument.querySelector("#tags-scope-readout"),
    tagsScopeHelp: runtimeDocument.querySelector("#tags-scope-help"),
    tagsTeamGroup: runtimeDocument.querySelector("#tags-team-group"),
    tagsTeam: runtimeDocument.querySelector("#tags-team"),
    tagsManageAccess: runtimeDocument.querySelector("#tags-manage-access"),
    tagsManageName: runtimeDocument.querySelector("#tags-manage-name"),
    tagsManageDefinition: runtimeDocument.querySelector("#tags-manage-definition"),
    tagsManageSave: runtimeDocument.querySelector("#tags-manage-save"),
    tagsManageCancel: runtimeDocument.querySelector("#tags-manage-cancel"),
    tagsManageFeedback: runtimeDocument.querySelector("#tags-manage-feedback"),
    tagsPromotionOpen: runtimeDocument.querySelector("#tags-promotion-open"),
    tagsPromotionRefresh: runtimeDocument.querySelector("#tags-promotion-refresh"),
    tagsPromotionFeedback: runtimeDocument.querySelector("#tags-promotion-feedback"),
    tagsPromotionRequestList: runtimeDocument.querySelector("#tags-promotion-request-list"),
    tagsPromotionReviewList: runtimeDocument.querySelector("#tags-promotion-review-list"),
    usersTitle: runtimeDocument.querySelector("#users-title"),
    usersMeta: runtimeDocument.querySelector("#users-meta"),
    usersSearch: runtimeDocument.querySelector("#users-search"),
    usersRoleFilter: runtimeDocument.querySelector("#users-role-filter"),
    usersBulkRole: runtimeDocument.querySelector("#users-bulk-role"),
    usersBulkApply: runtimeDocument.querySelector("#users-bulk-apply"),
    usersSelectionClear: runtimeDocument.querySelector("#users-selection-clear"),
    usersSelectionMeta: runtimeDocument.querySelector("#users-selection-meta"),
    usersAccess: runtimeDocument.querySelector("#users-access"),
    usersList: runtimeDocument.querySelector("#users-list"),
    usersAuthorizationAccess: runtimeDocument.querySelector("#users-authorization-access"),
    usersAuthorizationRoles: runtimeDocument.querySelector("#users-authorization-roles"),
    usersAuthorizationPermissions: runtimeDocument.querySelector("#users-authorization-permissions"),
    usersAuthorizationAssignments: runtimeDocument.querySelector("#users-authorization-assignments"),
    usersFeedback: runtimeDocument.querySelector("#users-feedback"),
    championCoreTitle: runtimeDocument.querySelector("#champion-core-title"),
    championCoreMeta: runtimeDocument.querySelector("#champion-core-meta"),
    championCoreSearch: runtimeDocument.querySelector("#champion-core-search"),
    championCoreRefresh: runtimeDocument.querySelector("#champion-core-refresh"),
    championCoreAccess: runtimeDocument.querySelector("#champion-core-access"),
    championCoreList: runtimeDocument.querySelector("#champion-core-list"),
    championCoreFeedback: runtimeDocument.querySelector("#champion-core-feedback"),
    requirementsTitle: runtimeDocument.querySelector("#requirements-title"),
    requirementsMeta: runtimeDocument.querySelector("#requirements-meta"),
    requirementsScope: runtimeDocument.querySelector("#requirements-scope"),
    requirementsScopeReadout: runtimeDocument.querySelector("#requirements-scope-readout"),
    requirementsScopeHelp: runtimeDocument.querySelector("#requirements-scope-help"),
    requirementsTeamGroup: runtimeDocument.querySelector("#requirements-team-group"),
    requirementsTeam: runtimeDocument.querySelector("#requirements-team"),
    compositionsTitle: runtimeDocument.querySelector("#compositions-title"),
    compositionsMeta: runtimeDocument.querySelector("#compositions-meta"),
    compositionsScope: runtimeDocument.querySelector("#compositions-scope"),
    compositionsScopeReadout: runtimeDocument.querySelector("#compositions-scope-readout"),
    compositionsScopeHelp: runtimeDocument.querySelector("#compositions-scope-help"),
    compositionsTeamGroup: runtimeDocument.querySelector("#compositions-team-group"),
    compositionsTeam: runtimeDocument.querySelector("#compositions-team"),
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
    requirementsCreateBtn: runtimeDocument.querySelector("#requirements-create-btn"),
    requirementsNavCompositions: runtimeDocument.querySelector("#requirements-nav-compositions"),
    requirementsNavComposer: runtimeDocument.querySelector("#requirements-nav-composer"),
    compositionsName: runtimeDocument.querySelector("#compositions-name"),
    compositionsDescription: runtimeDocument.querySelector("#compositions-description"),
    compositionsIsActive: runtimeDocument.querySelector("#compositions-is-active"),
    compositionsRequirementOptions: runtimeDocument.querySelector("#compositions-requirement-options"),
    compositionsSave: runtimeDocument.querySelector("#compositions-save"),
    compositionsCancel: runtimeDocument.querySelector("#compositions-cancel"),
    compositionsDelete: runtimeDocument.querySelector("#compositions-delete"),
    compositionsFeedback: runtimeDocument.querySelector("#compositions-feedback"),
    compositionsList: runtimeDocument.querySelector("#compositions-list"),
    compositionsCreateBtn: runtimeDocument.querySelector("#compositions-create-btn"),
    compositionsNavRequirements: runtimeDocument.querySelector("#compositions-nav-requirements"),
    compositionsNavComposer: runtimeDocument.querySelector("#compositions-nav-composer"),
    requirementsTourCallout: runtimeDocument.querySelector("#requirements-tour-callout"),
    requirementsTourBtn: runtimeDocument.querySelector("#requirements-tour-btn"),
    requirementsTourDismiss: runtimeDocument.querySelector("#requirements-tour-dismiss"),
    requirementsTourHide: runtimeDocument.querySelector("#requirements-tour-hide"),
    compositionsTourCallout: runtimeDocument.querySelector("#compositions-tour-callout"),
    compositionsTourBtn: runtimeDocument.querySelector("#compositions-tour-btn"),
    compositionsTourDismiss: runtimeDocument.querySelector("#compositions-tour-dismiss"),
    compositionsTourHide: runtimeDocument.querySelector("#compositions-tour-hide"),
    profileShowGettingStarted: runtimeDocument.querySelector("#profile-show-getting-started"),
    profileSaveGettingStarted: runtimeDocument.querySelector("#profile-save-getting-started"),
    profileGettingStartedFeedback: runtimeDocument.querySelector("#profile-getting-started-feedback"),
    profileSettingGettingStartedValue: runtimeDocument.querySelector("#profile-setting-getting-started-value"),
    comingSoonTitle: runtimeDocument.querySelector("#coming-soon-title"),
    comingSoonMeta: runtimeDocument.querySelector("#coming-soon-meta"),
    tabExplorer: runtimeDocument.querySelector("#tab-explorer"),
    tabWorkflow: runtimeDocument.querySelector("#tab-workflow"),
    tabTags: runtimeDocument.querySelector("#tab-tags"),
    tabUsers: runtimeDocument.querySelector("#tab-users"),
    tabChampionCore: runtimeDocument.querySelector("#tab-champion-core"),
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
    explorerMetadataScope: runtimeDocument.querySelector("#explorer-metadata-scope"),
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
    explorerClearMetadataScope: runtimeDocument.querySelector("#explorer-clear-metadata-scope"),
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
    championTagEditorScopeTipText: runtimeDocument.querySelector("#champion-tag-editor-scope-tip-text"),
    championTagEditorTeamGroup: runtimeDocument.querySelector("#champion-tag-editor-team-group"),
    championTagEditorTeam: runtimeDocument.querySelector("#champion-tag-editor-team"),
    cedChampImage: runtimeDocument.querySelector("#ced-champ-image"),
    cedChampRoles: runtimeDocument.querySelector("#ced-champ-roles"),
    championCompositionSynergyDefinition: runtimeDocument.querySelector("#champion-composition-synergy-definition"),
    championCompositionSynergyMeta: runtimeDocument.querySelector("#champion-composition-synergy-meta"),
    championCompositionSynergyClear: runtimeDocument.querySelector("#champion-composition-synergy-clear"),
    championCompositionSynergyEdit: runtimeDocument.querySelector("#champion-composition-synergy-edit"),
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
    builderSetupFeedback: runtimeDocument.querySelector("#builder-setup-feedback"),
    builderInspectFeedback: runtimeDocument.querySelector("#builder-inspect-feedback"),
    builderActiveTeam: runtimeDocument.querySelector("#builder-active-team"),
    builderActiveComposition: runtimeDocument.querySelector("#builder-active-composition"),
    builderCompEdit: runtimeDocument.querySelector("#builder-comp-edit"),
    builderCompCreate: runtimeDocument.querySelector("#builder-comp-create"),
    builderCompManage: runtimeDocument.querySelector("#builder-comp-manage"),
    builderReqManage: runtimeDocument.querySelector("#builder-req-manage"),
    builderTourCallout: runtimeDocument.querySelector("#builder-tour-callout"),
    builderTourBtn: runtimeDocument.querySelector("#builder-tour-btn"),
    builderTourDismiss: runtimeDocument.querySelector("#builder-tour-dismiss"),
    builderTourHide: runtimeDocument.querySelector("#builder-tour-hide"),
    builderDraftSetupSave: runtimeDocument.querySelector("#builder-draft-setup-save"),
    builderDraftSetupLoad: runtimeDocument.querySelector("#builder-draft-setup-load"),
    builderSaveDraftModal: runtimeDocument.querySelector("#builder-save-draft-modal"),
    builderSaveDraftName: runtimeDocument.querySelector("#builder-save-draft-name"),
    builderSaveDraftDescription: runtimeDocument.querySelector("#builder-save-draft-description"),
    builderSaveDraftSettingsOnly: runtimeDocument.querySelector("#builder-save-draft-settings-only"),
    builderSaveDraftCancel: runtimeDocument.querySelector("#builder-save-draft-cancel"),
    builderSaveDraftConfirm: runtimeDocument.querySelector("#builder-save-draft-confirm"),
    builderSaveDraftFeedback: runtimeDocument.querySelector("#builder-save-draft-feedback"),
    builderLoadDraftModal: runtimeDocument.querySelector("#builder-load-draft-modal"),
    builderLoadDraftList: runtimeDocument.querySelector("#builder-load-draft-list"),
    builderLoadDraftFeedback: runtimeDocument.querySelector("#builder-load-draft-feedback"),
    builderLoadDraftClose: runtimeDocument.querySelector("#builder-load-draft-close"),
    tagsManageModal: runtimeDocument.querySelector("#tags-manage-modal"),
    tagsManageModalClose: runtimeDocument.querySelector("#tags-manage-modal-close"),
    tagsManageOpen: runtimeDocument.querySelector("#tags-manage-open"),
    tagsPromotionModal: runtimeDocument.querySelector("#tags-promotion-modal"),
    tagsPromotionModalTitle: runtimeDocument.querySelector("#tags-promotion-modal-title"),
    tagsPromotionModalContext: runtimeDocument.querySelector("#tags-promotion-modal-context"),
    tagsPromotionModalComment: runtimeDocument.querySelector("#tags-promotion-modal-comment"),
    tagsPromotionModalCancel: runtimeDocument.querySelector("#tags-promotion-modal-cancel"),
    tagsPromotionModalSubmit: runtimeDocument.querySelector("#tags-promotion-modal-submit"),
    tagsPromotionModalFeedback: runtimeDocument.querySelector("#tags-promotion-modal-feedback"),
    builderTeamHelp: runtimeDocument.querySelector("#builder-team-help"),
    builderStageSetupTitle: runtimeDocument.querySelector("#builder-stage-setup-title"),
    builderStageSetupMeta: runtimeDocument.querySelector("#builder-stage-setup-meta"),
    builderStageInspectTitle: runtimeDocument.querySelector("#builder-stage-inspect-title"),
    builderStageInspectMeta: runtimeDocument.querySelector("#builder-stage-inspect-meta"),
    builderChecksReadiness: runtimeDocument.querySelector("#builder-checks-readiness"),
    builderStageSetup: runtimeDocument.querySelector("#builder-stage-setup"),
    builderStageInspect: runtimeDocument.querySelector("#builder-stage-inspect"),
    builderAdvancedControls: runtimeDocument.querySelector("#builder-advanced-controls"),
    builderCustomScopesEnabled: runtimeDocument.querySelector("#builder-custom-scopes-enabled"),
    builderScopeModeSelect: runtimeDocument.querySelector("#builder-scope-mode-select"),
    builderScopeConfigureBtn: runtimeDocument.querySelector("#builder-scope-configure-btn"),
    builderScopeControls: runtimeDocument.querySelector("#builder-scope-controls"),
    builderScopeDefaultPrecedence: runtimeDocument.querySelector("#builder-scope-default-precedence"),
    builderScopeResourceList: runtimeDocument.querySelector("#builder-scope-resource-list"),
    builderScopeFeedback: runtimeDocument.querySelector("#builder-scope-feedback"),
    builderExcludedSearch: runtimeDocument.querySelector("#builder-excluded-search"),
    builderExcludedOptions: runtimeDocument.querySelector("#builder-excluded-options"),
    builderExcludedPills: runtimeDocument.querySelector("#builder-excluded-pills"),
    builderExcludedClear: runtimeDocument.querySelector("#builder-excluded-clear"),
    builderMaxBranch: runtimeDocument.querySelector("#builder-max-branch"),
    builderGenerate: runtimeDocument.querySelector("#builder-generate"),
    builderClearSticky: runtimeDocument.querySelector("#builder-clear-sticky"),
    builderStatsBtn: runtimeDocument.querySelector("#builder-stats-btn"),
    builderRequiredChecks: runtimeDocument.querySelector("#builder-required-checks"),
    builderOptionalChecks: runtimeDocument.querySelector("#builder-optional-checks"),
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
    teamJoinDiscoverRefresh: runtimeDocument.querySelector("#team-join-discover-refresh"),
    teamJoinRequest: runtimeDocument.querySelector("#team-join-request"),
    teamJoinCancel: runtimeDocument.querySelector("#team-join-cancel"),
    teamJoinDiscoverMeta: runtimeDocument.querySelector("#team-join-discover-meta"),
    teamJoinReviewRefresh: runtimeDocument.querySelector("#team-join-review-refresh"),
    teamJoinReviewMeta: runtimeDocument.querySelector("#team-join-review-meta"),
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
    teamInviteRefresh: runtimeDocument.querySelector("#team-invite-refresh"),
    teamInviteList: runtimeDocument.querySelector("#team-invite-list"),
    teamInviteListMeta: runtimeDocument.querySelector("#team-invite-list-meta"),
    teamInviteListFeedback: runtimeDocument.querySelector("#team-invite-list-feedback"),
    teamInviteUserRefresh: runtimeDocument.querySelector("#team-invite-user-refresh"),
    teamInviteUserMeta: runtimeDocument.querySelector("#team-invite-user-meta"),
    teamInviteUserList: runtimeDocument.querySelector("#team-invite-user-list"),
    teamInviteUserFeedback: runtimeDocument.querySelector("#team-invite-user-feedback"),
    issueReportModal: runtimeDocument.querySelector("#issue-report-modal"),
    issueReportPanel: runtimeDocument.querySelector("#issue-report-panel"),
    issueReportTitle: runtimeDocument.querySelector("#issue-report-title"),
    issueReportMeta: runtimeDocument.querySelector("#issue-report-meta"),
    issueReportSource: runtimeDocument.querySelector("#issue-report-source"),
    issueReportFallbackLink: runtimeDocument.querySelector("#issue-report-fallback-link"),
    issueReportType: runtimeDocument.querySelector("#issue-report-type"),
    issueReportEmail: runtimeDocument.querySelector("#issue-report-email"),
    issueReportGameName: runtimeDocument.querySelector("#issue-report-game-name"),
    issueReportSubject: runtimeDocument.querySelector("#issue-report-subject"),
    issueReportDescription: runtimeDocument.querySelector("#issue-report-description"),
    issueReportCancel: runtimeDocument.querySelector("#issue-report-cancel"),
    issueReportSubmit: runtimeDocument.querySelector("#issue-report-submit"),
    issueReportFeedback: runtimeDocument.querySelector("#issue-report-feedback"),
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
    teamAdminAddRiotIdOptions: runtimeDocument.querySelector("#team-admin-add-riot-id-options"),
    teamAdminAddRole: runtimeDocument.querySelector("#team-admin-add-role"),
    teamAdminAddTeamRole: runtimeDocument.querySelector("#team-admin-add-team-role"),
    teamAdminAddMember: runtimeDocument.querySelector("#team-admin-add-member"),
    teamAdminUpdateRoleTitle: runtimeDocument.querySelector("#team-admin-update-role-title"),
    teamAdminRoleRiotId: runtimeDocument.querySelector("#team-admin-role-riot-id"),
    teamAdminRoleRiotIdOptions: runtimeDocument.querySelector("#team-admin-role-riot-id-options"),
    teamAdminRole: runtimeDocument.querySelector("#team-admin-role"),
    teamAdminUpdateRole: runtimeDocument.querySelector("#team-admin-update-role"),
    teamAdminUpdateTeamRoleTitle: runtimeDocument.querySelector("#team-admin-update-team-role-title"),
    teamAdminTeamRoleRiotId: runtimeDocument.querySelector("#team-admin-team-role-riot-id"),
    teamAdminTeamRoleRiotIdOptions: runtimeDocument.querySelector("#team-admin-team-role-riot-id-options"),
    teamAdminTeamRole: runtimeDocument.querySelector("#team-admin-team-role"),
    teamAdminUpdateTeamRole: runtimeDocument.querySelector("#team-admin-update-team-role"),
    teamAdminRemoveTitle: runtimeDocument.querySelector("#team-admin-remove-title"),
    teamAdminRemoveRiotId: runtimeDocument.querySelector("#team-admin-remove-riot-id"),
    teamAdminRemoveRiotIdOptions: runtimeDocument.querySelector("#team-admin-remove-riot-id-options"),
    teamAdminRemoveMember: runtimeDocument.querySelector("#team-admin-remove-member"),
    teamManageCancelButtons: Array.from(runtimeDocument.querySelectorAll("button[data-team-manage-cancel]")),
    teamAdminFeedback: runtimeDocument.querySelector("#team-admin-feedback"),
    poolApiFeedback: runtimeDocument.querySelector("#pool-api-feedback"),
    playerConfigTeam: runtimeDocument.querySelector("#player-config-team"),
    profilePrimaryRole: runtimeDocument.querySelector("#profile-primary-role"),
    profileSecondaryRoles: runtimeDocument.querySelector("#profile-secondary-roles"),
    profileSaveRoles: runtimeDocument.querySelector("#profile-save-roles"),
    profileCancelRoles: runtimeDocument.querySelector("#profile-cancel-roles"),
    profileRolesFeedback: runtimeDocument.querySelector("#profile-roles-feedback"),
    profileRiotStatsSummary: runtimeDocument.querySelector("#profile-riot-stats-summary"),
    profileRiotTopChampion: runtimeDocument.querySelector("#profile-riot-top-champion"),
    profileRiotStatsList: runtimeDocument.querySelector("#profile-riot-stats-list"),
    myChampionsSuggestionsPanel: runtimeDocument.querySelector("#my-champions-suggestions-panel"),
    myChampionsSuggestionsSummary: runtimeDocument.querySelector("#my-champions-suggestions-summary"),
    myChampionsSuggestionsList: runtimeDocument.querySelector("#my-champions-suggestions-list"),
    profileIdentity: runtimeDocument.querySelector("#profile-identity"),
    profileAvatarDisplay: runtimeDocument.querySelector("#profile-avatar-display"),
    navAvatarDisplay: runtimeDocument.querySelector("#nav-avatar-display"),
    profileSummonerName: runtimeDocument.querySelector("#profile-summoner-name"),
    profileRolesDisplay: runtimeDocument.querySelector("#profile-roles-display"),
    profileTeamDisplay: runtimeDocument.querySelector("#profile-team-display"),
    profileSettingsList: runtimeDocument.querySelector("#profile-settings-list"),
    profileSettingRolesValue: runtimeDocument.querySelector("#profile-setting-roles-value"),
    profileSettingAccountValue: runtimeDocument.querySelector("#profile-setting-account-value"),
    profileSettingDisplayTeamValue: runtimeDocument.querySelector("#profile-setting-display-team-value"),
    profileSettingRolesEditor: runtimeDocument.querySelector("#profile-setting-roles-editor"),
    profileSettingAccountEditor: runtimeDocument.querySelector("#profile-setting-account-editor"),
    profileSettingDisplayTeamEditor: runtimeDocument.querySelector("#profile-setting-display-team-editor"),
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
    avatarModalFeedback: runtimeDocument.querySelector("#avatar-modal-feedback"),
    profileAccountFields: runtimeDocument.querySelector("#profile-account-fields"),
    profileSaveAccount: runtimeDocument.querySelector("#profile-save-account"),
    profileAccountFeedback: runtimeDocument.querySelector("#profile-account-feedback"),
    profileDisplayTeamSelect: runtimeDocument.querySelector("#profile-display-team-select"),
    profileSaveDisplayTeam: runtimeDocument.querySelector("#profile-save-display-team"),
    profileDisplayTeamFeedback: runtimeDocument.querySelector("#profile-display-team-feedback"),
    profileAdminLink: runtimeDocument.querySelector("#profile-admin-link"),
    profileAdminChampionCoreLink: runtimeDocument.querySelector("#profile-admin-champion-core-link"),
    avatarModal: runtimeDocument.querySelector("#avatar-modal"),
    avatarModalSearch: runtimeDocument.querySelector("#avatar-modal-search"),
    avatarModalGrid: runtimeDocument.querySelector("#avatar-modal-grid"),
    playerConfigSavePool: runtimeDocument.querySelector("#player-config-save-pool"),
    playerConfigFeedback: runtimeDocument.querySelector("#player-config-feedback"),
    playerConfigGrid: runtimeDocument.querySelector("#player-config-grid"),
    myChampionsAddBtn: runtimeDocument.querySelector("#my-champions-add-btn"),
    myChampionsCardGrid: runtimeDocument.querySelector("#my-champions-card-grid"),
    myChampionsSearch: runtimeDocument.querySelector("#my-champions-search"),
    myChampionsComfortFilter: runtimeDocument.querySelector("#my-champions-comfort-filter"),
    championSelectorModal: runtimeDocument.querySelector("#champion-selector-modal"),
    championSelectorSearch: runtimeDocument.querySelector("#champion-selector-search"),
    championSelectorAvailable: runtimeDocument.querySelector("#champion-selector-available"),
    championSelectorSelected: runtimeDocument.querySelector("#champion-selector-selected"),
    championSelectorClear: runtimeDocument.querySelector("#champion-selector-clear"),
    championSelectorCancel: runtimeDocument.querySelector("#champion-selector-cancel"),
    championSelectorDone: runtimeDocument.querySelector("#champion-selector-done"),
    confirmationModal: runtimeDocument.querySelector("#confirmation-modal"),
    confirmationPanel: runtimeDocument.querySelector("#confirmation-panel"),
    confirmationTitle: runtimeDocument.querySelector("#confirmation-title"),
    confirmationMessage: runtimeDocument.querySelector("#confirmation-message"),
    confirmationCancel: runtimeDocument.querySelector("#confirmation-cancel"),
    confirmationConfirm: runtimeDocument.querySelector("#confirmation-confirm"),
    logoLightbox: runtimeDocument.querySelector("#logo-lightbox"),
    logoLightboxClose: runtimeDocument.querySelector("#logo-lightbox-close"),
    logoLightboxImage: runtimeDocument.querySelector("#logo-lightbox-image"),
    logoLightboxCaption: runtimeDocument.querySelector("#logo-lightbox-caption"),
  };
}

let state = null;
let elements = null;
let _pendingConfirmationResolver = null;
let _teamAdminAddMemberSearchRequestId = 0;

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

function setTeamInviteListFeedback(message) {
  if (elements.teamInviteListFeedback) {
    elements.teamInviteListFeedback.textContent = message;
  }
}

function setTeamInviteUserFeedback(message) {
  if (elements.teamInviteUserFeedback) {
    elements.teamInviteUserFeedback.textContent = message;
  }
}

function setIssueReportFeedback(message) {
  if (elements.issueReportFeedback) {
    elements.issueReportFeedback.textContent = message;
  }
}

function setChampionTagEditorFeedback(message) {
  if (elements.championTagEditorFeedback) {
    elements.championTagEditorFeedback.textContent = message;
  }
}

function setChampionTagEditorMeta(message) {
  if (elements.championTagEditorMeta) {
    elements.championTagEditorMeta.textContent = message;
  }
}

function setTagsManageFeedback(message) {
  if (elements.tagsManageFeedback) {
    elements.tagsManageFeedback.textContent = message;
  }
}

function setTagPromotionFeedback(message) {
  if (elements.tagsPromotionFeedback) {
    elements.tagsPromotionFeedback.textContent = message;
  }
}

function setTagPromotionModalFeedback(message) {
  if (elements.tagsPromotionModalFeedback) {
    elements.tagsPromotionModalFeedback.textContent = message;
  }
}

function setBuilderDraftSetupFeedback(message) {
  if (state?.builder) {
    state.builder.draftSetupFeedback = message;
  }
  if (elements.builderSaveDraftFeedback) {
    elements.builderSaveDraftFeedback.textContent = message;
  }
  if (elements.builderLoadDraftFeedback) {
    elements.builderLoadDraftFeedback.textContent = message;
  }
}

function setBuilderScopeFeedback(message) {
  if (elements.builderScopeFeedback) {
    elements.builderScopeFeedback.textContent = message;
  }
}

function setUsersFeedback(message) {
  if (elements.usersFeedback) {
    elements.usersFeedback.textContent = message;
  }
}

function formatTimestampMeta(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return "";
  }
  const asDate = new Date(normalized);
  if (Number.isNaN(asDate.getTime())) {
    return "";
  }
  return asDate.toLocaleString();
}

function buildIdentityLabel(identity, fallback = "") {
  const gameName =
    typeof identity?.game_name === "string"
      ? identity.game_name.trim()
      : typeof identity?.gameName === "string"
        ? identity.gameName.trim()
        : "";
  const tagline = typeof identity?.tagline === "string" ? identity.tagline.trim() : "";
  const riotId =
    typeof identity?.riot_id === "string"
      ? identity.riot_id.trim()
      : (gameName && tagline ? `${gameName}#${tagline}` : "");
  if (riotId) {
    return riotId;
  }
  const email = typeof identity?.email === "string" ? identity.email.trim() : "";
  if (email) {
    return email;
  }
  return fallback;
}

function resolveUserDisplayLabel(userId, displayName = "") {
  const normalizedDisplayName = typeof displayName === "string" ? displayName.trim() : "";
  if (normalizedDisplayName) {
    return normalizedDisplayName;
  }
  if (Number.isInteger(userId) && state?.auth?.user?.id === userId) {
    return buildIdentityLabel(state.auth.user, state.auth.user.email ?? `User ${userId}`);
  }
  const knownUser = Array.isArray(state?.api?.users)
    ? state.api.users.find((candidate) => candidate.id === userId)
    : null;
  if (knownUser) {
    return buildIdentityLabel(knownUser, knownUser.email ?? `User ${userId}`);
  }
  return Number.isInteger(userId) ? `User ${userId}` : "Unknown user";
}

function formatAuditMeta(prefix, userId, displayName, timestamp) {
  const actorLabel = resolveUserDisplayLabel(userId, displayName);
  const formattedTimestamp = formatTimestampMeta(timestamp);
  if (!actorLabel && !formattedTimestamp) {
    return "";
  }
  if (actorLabel && formattedTimestamp) {
    return `${prefix} by ${actorLabel} on ${formattedTimestamp}`;
  }
  if (actorLabel) {
    return `${prefix} by ${actorLabel}`;
  }
  return `${prefix} on ${formattedTimestamp}`;
}

function replaceDatalistOptions(datalist, options) {
  if (!datalist) {
    return;
  }
  datalist.innerHTML = "";
  for (const option of Array.isArray(options) ? options : []) {
    const value = typeof option?.value === "string" ? option.value.trim() : "";
    if (!value) {
      continue;
    }
    const entry = runtimeDocument.createElement("option");
    entry.value = value;
    const label = typeof option?.label === "string" ? option.label.trim() : "";
    if (label) {
      entry.label = label;
      entry.textContent = label;
    }
    datalist.append(entry);
  }
}

function setChampionCoreFeedback(message) {
  if (elements.championCoreFeedback) {
    elements.championCoreFeedback.textContent = message;
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

function normalizeBuilderScopeResourceSettings(rawValue) {
  const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
    ? rawValue
    : {};
  const normalized = createDefaultBuilderScopeResourceSettings();
  for (const resource of BUILDER_SCOPE_RESOURCES) {
    const config = source[resource];
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      continue;
    }
    normalized[resource] = {
      enabled: config.enabled !== false,
      precedence: normalizeBuilderScopePrecedence(config.precedence)
    };
  }
  return normalized;
}

function getBuilderRequirementDefinitions() {
  return Array.isArray(state.builder.composerContextRequirements) && state.builder.composerContextRequirements.length > 0
    ? state.builder.composerContextRequirements
    : (Array.isArray(state.api.requirementDefinitions) ? state.api.requirementDefinitions : []);
}

function getBuilderCompositionBundles() {
  return Array.isArray(state.builder.composerContextCompositions) && state.builder.composerContextCompositions.length > 0
    ? state.builder.composerContextCompositions
    : (Array.isArray(state.api.compositionBundles) ? state.api.compositionBundles : []);
}

function getBuilderTagById() {
  return state.builder.composerTagById && Object.keys(state.builder.composerTagById).length > 0
    ? state.builder.composerTagById
    : state.api.tagById;
}

function getBuilderChampionsByName() {
  return state.builder.composerChampionsByName && Object.keys(state.builder.composerChampionsByName).length > 0
    ? state.builder.composerChampionsByName
    : state.data.championsByName;
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

function getChampionProfileScopeOptions() {
  const options = [];
  if (isAuthenticated()) {
    options.push({ value: "self", label: "User" });
  }
  if (getChampionTagLeadTeamOptions().length > 0) {
    options.push({ value: "team", label: "Team" });
  }
  if (isGlobalTagEditorUser()) {
    options.push({ value: "all", label: "Global" });
  }
  return options;
}

function getChampionProfileDefaultScope() {
  if (isGlobalTagEditorUser()) {
    return "all";
  }
  if (getChampionTagLeadTeamOptions().length > 0) {
    return "team";
  }
  return "self";
}

function getCompositionCatalogScopeOptions() {
  const options = [];
  if (isAuthenticated()) {
    options.push({ value: "self", label: "User" });
  }
  if (getChampionTagLeadTeamOptions().length > 0) {
    options.push({ value: "team", label: "Team" });
  }
  if (isGlobalTagEditorUser()) {
    options.push({ value: "all", label: "Global" });
  }
  return options;
}

function getCompositionCatalogDefaultScope() {
  if (isGlobalTagEditorUser()) {
    return "all";
  }
  return "self";
}

function getTagCatalogScopeOptions() {
  return getCompositionCatalogScopeOptions();
}

function getTagCatalogDefaultScope() {
  if (isGlobalTagEditorUser()) {
    return "all";
  }
  return "self";
}

function resolveTagCatalogTeamId() {
  const teamOptions = getChampionTagLeadTeamOptions();
  if (teamOptions.length < 1) {
    return "";
  }

  const activeTeamId = normalizeTeamEntityId(state.teamConfig.activeTeamId);
  const activeTeamValue = activeTeamId ? String(activeTeamId) : "";
  if (activeTeamValue && teamOptions.some((option) => option.value === activeTeamValue)) {
    return activeTeamValue;
  }

  const selectedTeamValue = String(state.api.tagsCatalogTeamId ?? "");
  if (teamOptions.some((option) => option.value === selectedTeamValue)) {
    return selectedTeamValue;
  }

  return teamOptions[0]?.value ?? "";
}

function syncTagCatalogScopeState() {
  const scopeOptions = getTagCatalogScopeOptions();
  const scopeValues = new Set(scopeOptions.map((option) => option.value));
  if (scopeValues.size < 1) {
    state.api.tagsCatalogScope = "all";
    state.api.tagsCatalogTeamId = "";
    return;
  }

  const normalizedScope = normalizeChampionTagScope(state.api.tagsCatalogScope);
  state.api.tagsCatalogScope = scopeValues.has(normalizedScope)
    ? normalizedScope
    : getTagCatalogDefaultScope();

  if (state.api.tagsCatalogScope === "team") {
    state.api.tagsCatalogTeamId = resolveTagCatalogTeamId();
    if (!state.api.tagsCatalogTeamId) {
      state.api.tagsCatalogScope = scopeValues.has("self")
        ? "self"
        : scopeValues.has("all")
          ? "all"
          : scopeOptions[0].value;
    }
  }

  if (state.api.tagsCatalogScope !== "team") {
    state.api.tagsCatalogTeamId = "";
  }
}

function getTagCatalogScopeRequestContext() {
  syncTagCatalogScopeState();
  const scope = normalizeChampionTagScope(state.api.tagsCatalogScope);
  if (scope === "team") {
    return {
      scope,
      teamId: resolveTagCatalogTeamId()
    };
  }
  return {
    scope,
    teamId: ""
  };
}

function canWriteTagCatalogScope() {
  if (!isAuthenticated()) {
    return false;
  }
  const context = getTagCatalogScopeRequestContext();
  if (context.scope === "self") {
    return true;
  }
  if (context.scope === "team") {
    return context.teamId !== "";
  }
  return isGlobalTagEditorUser();
}

function renderTagCatalogScopeControls() {
  syncTagCatalogScopeState();
  const scopeOptions = getTagCatalogScopeOptions();
  const teamOptions = getChampionTagLeadTeamOptions();
  const context = getTagCatalogScopeRequestContext();
  const activeScopeLabel = scopeOptions.find((option) => option.value === context.scope)?.label ?? "Global";
  const activeTeamLabel = context.teamId
    ? teamOptions.find((option) => option.value === context.teamId)?.label ?? "Selected team"
    : "";

  const scopeHelp = context.scope === "team"
    ? `Reading and writing team-scoped tag definitions${activeTeamLabel ? ` for ${activeTeamLabel}` : ""}.`
    : context.scope === "self"
      ? "Reading and writing your personal tag definitions with global fallback."
      : "Reading and writing the shared global tag catalog.";

  if (elements.tagsScope) {
    replaceOptions(elements.tagsScope, scopeOptions);
    elements.tagsScope.value = context.scope;
    elements.tagsScope.disabled = scopeOptions.length <= 1;
  }
  if (elements.tagsScopeReadout) {
    elements.tagsScopeReadout.textContent =
      context.scope === "team" && activeTeamLabel ? `${activeScopeLabel}: ${activeTeamLabel}` : activeScopeLabel;
  }
  if (elements.tagsScopeHelp) {
    elements.tagsScopeHelp.textContent = scopeHelp;
  }
  if (elements.tagsTeamGroup) {
    elements.tagsTeamGroup.hidden = context.scope !== "team";
  }
  if (elements.tagsTeam) {
    replaceOptions(elements.tagsTeam, teamOptions, false, "No lead teams available");
    elements.tagsTeam.value = context.teamId;
    elements.tagsTeam.disabled = context.scope !== "team" || teamOptions.length < 1;
  }
}

function resolveCompositionCatalogTeamId() {
  const teamOptions = getChampionTagLeadTeamOptions();
  if (teamOptions.length < 1) {
    return "";
  }

  const activeTeamId = normalizeTeamEntityId(state.teamConfig.activeTeamId);
  const activeTeamValue = activeTeamId ? String(activeTeamId) : "";
  if (activeTeamValue && teamOptions.some((option) => option.value === activeTeamValue)) {
    return activeTeamValue;
  }

  const selectedTeamValue = String(state.api.compositionCatalogTeamId ?? "");
  if (teamOptions.some((option) => option.value === selectedTeamValue)) {
    return selectedTeamValue;
  }

  return teamOptions[0]?.value ?? "";
}

function syncCompositionCatalogScopeState() {
  const scopeOptions = getCompositionCatalogScopeOptions();
  const scopeValues = new Set(scopeOptions.map((option) => option.value));
  if (scopeValues.size < 1) {
    state.api.compositionCatalogScope = "all";
    state.api.compositionCatalogTeamId = "";
    return;
  }

  const normalizedScope = normalizeChampionTagScope(state.api.compositionCatalogScope);
  state.api.compositionCatalogScope = scopeValues.has(normalizedScope)
    ? normalizedScope
    : getCompositionCatalogDefaultScope();

  if (state.api.compositionCatalogScope === "team") {
    state.api.compositionCatalogTeamId = resolveCompositionCatalogTeamId();
    if (!state.api.compositionCatalogTeamId) {
      state.api.compositionCatalogScope = scopeValues.has("self")
        ? "self"
        : scopeValues.has("all")
          ? "all"
          : scopeOptions[0].value;
    }
  }

  if (state.api.compositionCatalogScope !== "team") {
    state.api.compositionCatalogTeamId = "";
  }
}

function getCompositionCatalogScopeRequestContext() {
  syncCompositionCatalogScopeState();
  const scope = normalizeChampionTagScope(state.api.compositionCatalogScope);
  if (scope === "team") {
    const teamId = resolveCompositionCatalogTeamId();
    return {
      scope,
      teamId
    };
  }
  return {
    scope,
    teamId: ""
  };
}

function canWriteCompositionCatalogScope() {
  if (!isAuthenticated()) {
    return false;
  }
  const context = getCompositionCatalogScopeRequestContext();
  if (context.scope === "self") {
    return true;
  }
  if (context.scope === "team") {
    return context.teamId !== "";
  }
  return isGlobalTagEditorUser();
}

function buildCompositionCatalogQuery() {
  const context = getCompositionCatalogScopeRequestContext();
  const query = new URLSearchParams({ scope: context.scope });
  if (context.scope === "team" && context.teamId) {
    query.set("team_id", context.teamId);
  }
  return query;
}

function renderCompositionCatalogScopeControls() {
  syncCompositionCatalogScopeState();
  const scopeOptions = getCompositionCatalogScopeOptions();
  const teamOptions = getChampionTagLeadTeamOptions();
  const context = getCompositionCatalogScopeRequestContext();
  const activeScopeLabel = scopeOptions.find((option) => option.value === context.scope)?.label ?? "Global";
  const activeTeamLabel = context.teamId
    ? teamOptions.find((option) => option.value === context.teamId)?.label ?? "Selected team"
    : "";

  const scopeHelp = context.scope === "team"
    ? `Reading and writing team-scoped requirements and compositions${activeTeamLabel ? ` for ${activeTeamLabel}` : ""}.`
    : context.scope === "self"
      ? "Reading and writing your personal requirement and composition catalog."
      : "Reading and writing the shared global requirement and composition catalog.";

  for (const controlSet of [
    {
      scopeSelect: elements.requirementsScope,
      scopeReadout: elements.requirementsScopeReadout,
      scopeHelp: elements.requirementsScopeHelp,
      teamGroup: elements.requirementsTeamGroup,
      teamSelect: elements.requirementsTeam
    },
    {
      scopeSelect: elements.compositionsScope,
      scopeReadout: elements.compositionsScopeReadout,
      scopeHelp: elements.compositionsScopeHelp,
      teamGroup: elements.compositionsTeamGroup,
      teamSelect: elements.compositionsTeam
    }
  ]) {
    if (controlSet.scopeSelect) {
      replaceOptions(controlSet.scopeSelect, scopeOptions);
      controlSet.scopeSelect.value = context.scope;
      controlSet.scopeSelect.disabled = scopeOptions.length <= 1;
    }
    if (controlSet.scopeReadout) {
      controlSet.scopeReadout.textContent =
        context.scope === "team" && activeTeamLabel ? `${activeScopeLabel}: ${activeTeamLabel}` : activeScopeLabel;
    }
    if (controlSet.scopeHelp) {
      controlSet.scopeHelp.textContent = scopeHelp;
    }
    if (controlSet.teamGroup) {
      controlSet.teamGroup.hidden = context.scope !== "team";
    }
    if (controlSet.teamSelect) {
      replaceOptions(controlSet.teamSelect, teamOptions, false, "No lead teams available");
      controlSet.teamSelect.value = context.teamId;
      controlSet.teamSelect.disabled = context.scope !== "team" || teamOptions.length < 1;
    }
  }
}

function getExplorerTeamScopeTeamId() {
  const selectedTeam = getSelectedAdminTeam();
  if (selectedTeam && String(selectedTeam.membership_role ?? "").toLowerCase() === "lead") {
    return String(selectedTeam.id);
  }
  return getChampionTagLeadTeamOptions()[0]?.value ?? "";
}

function canReadExplorerMetadataScope(scope) {
  const normalizedScope = normalizeChampionTagScope(scope);
  if (normalizedScope === "all") {
    return true;
  }
  if (normalizedScope === "self") {
    return isAuthenticated();
  }
  if (normalizedScope === "team") {
    return getExplorerTeamScopeTeamId() !== "";
  }
  return false;
}

function getExplorerScopedMetadataCacheKey(scope) {
  const normalizedScope = normalizeChampionTagScope(scope);
  if (normalizedScope === "team") {
    const teamId = getExplorerTeamScopeTeamId();
    return teamId ? `team:${teamId}` : "team";
  }
  return normalizedScope;
}

function getExplorerScopedMetadataCacheEntry(championId, scope) {
  if (!Number.isInteger(championId) || championId <= 0) {
    return null;
  }
  const championCache = state.explorer.scopedMetadataByChampionId[String(championId)];
  if (!championCache || typeof championCache !== "object" || Array.isArray(championCache)) {
    return null;
  }
  const cacheKey = getExplorerScopedMetadataCacheKey(scope);
  const entry = championCache[cacheKey];
  return entry && typeof entry === "object" && !Array.isArray(entry) ? entry : null;
}

function cacheExplorerScopedMetadataPayload(championId, scope, payload) {
  if (!Number.isInteger(championId) || championId <= 0) {
    return null;
  }
  const metadata =
    payload?.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? payload.metadata
      : {};
  const roles = normalizeChampionMetadataRoles(metadata.roles);
  const entry = {
    scope: normalizeChampionTagScope(scope),
    hasCustomMetadata: payload?.has_custom_metadata === true || payload?.hasCustomMetadata === true,
    resolvedScope: normalizeChampionTagScope(payload?.resolved_scope ?? payload?.resolvedScope ?? "all"),
    reviewed: payload?.reviewed === true,
    roles,
    roleProfiles: normalizeRoleProfilesFromMetadata(metadata.roleProfiles, roles),
    compositionSynergies: normalizeChampionCompositionSynergiesFromMetadata(metadata.compositionSynergies)
  };

  const championKey = String(championId);
  const cacheKey = getExplorerScopedMetadataCacheKey(scope);
  const championCache =
    state.explorer.scopedMetadataByChampionId[championKey] &&
    typeof state.explorer.scopedMetadataByChampionId[championKey] === "object" &&
    !Array.isArray(state.explorer.scopedMetadataByChampionId[championKey])
      ? { ...state.explorer.scopedMetadataByChampionId[championKey] }
      : {};

  if (entry.hasCustomMetadata) {
    championCache[cacheKey] = entry;
  } else {
    delete championCache[cacheKey];
  }

  if (Object.keys(championCache).length === 0) {
    delete state.explorer.scopedMetadataByChampionId[championKey];
  } else {
    state.explorer.scopedMetadataByChampionId[championKey] = championCache;
  }

  return entry;
}

function syncExplorerScopedMetadataState() {
  const championIds = new Set(
    Array.isArray(state.data?.champions)
      ? state.data.champions
          .filter((champion) => Number.isInteger(champion.id) && champion.id > 0)
          .map((champion) => String(champion.id))
      : []
  );

  state.explorer.activeMetadataScopeByChampionId = Object.fromEntries(
    Object.entries(state.explorer.activeMetadataScopeByChampionId).filter(([championId, scope]) => {
      if (!championIds.has(championId)) {
        return false;
      }
      if (normalizeChampionTagScope(scope) === "all") {
        return true;
      }
      const champion = getChampionById(Number.parseInt(championId, 10));
      const metadataScopes = normalizeChampionMetadataScopes(champion?.metadataScopes);
      const normalizedScope = normalizeChampionTagScope(scope);
      return metadataScopes[normalizedScope] === true;
    })
  );

  state.explorer.scopedMetadataByChampionId = Object.fromEntries(
    Object.entries(state.explorer.scopedMetadataByChampionId).filter(([championId]) => championIds.has(championId))
  );
}

function getExplorerMetadataScopeFilterOptions() {
  const options = [{ value: "", label: "Any custom metadata" }];
  if (isAuthenticated()) {
    options.push({ value: "self-present", label: "User metadata present" });
    options.push({ value: "self-missing", label: "User metadata not present" });
  }
  if (getChampionTagLeadTeamOptions().length > 0) {
    options.push({ value: "team-present", label: "Team metadata present" });
    options.push({ value: "team-missing", label: "Team metadata not present" });
  }
  return options;
}

function refreshExplorerMetadataScopeFilterOptions() {
  if (!elements.explorerMetadataScope) {
    return;
  }
  const options = getExplorerMetadataScopeFilterOptions();
  const optionValues = new Set(options.map((option) => option.value));
  if (!optionValues.has(state.explorer.metadataScopeFilter)) {
    state.explorer.metadataScopeFilter = "";
  }
  replaceOptions(elements.explorerMetadataScope, options);
  elements.explorerMetadataScope.value = state.explorer.metadataScopeFilter;
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
    powerSpikes: []
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

function normalizePowerSpikeRange(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const start = Number(raw.start);
  const end = Number(raw.end);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  const clampedStart = Math.max(POWER_SPIKE_MIN_LEVEL, Math.min(POWER_SPIKE_MAX_LEVEL, start));
  const clampedEnd = Math.max(POWER_SPIKE_MIN_LEVEL, Math.min(POWER_SPIKE_MAX_LEVEL, end));
  return { start: Math.min(clampedStart, clampedEnd), end: Math.max(clampedStart, clampedEnd) };
}

function normalizePowerSpikes(raw) {
  if (!Array.isArray(raw)) return [];
  const parsed = [];
  for (const item of raw) {
    const range = normalizePowerSpikeRange(item);
    if (range) parsed.push(range);
  }
  // Sort by start then merge overlapping/adjacent ranges
  parsed.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of parsed) {
    const prev = merged[merged.length - 1];
    if (prev && r.start <= prev.end + 1) {
      prev.end = Math.max(prev.end, r.end);
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }
  return merged.slice(0, POWER_SPIKE_MAX_RANGES);
}

function powerSpikesFromLegacyEffectiveness(eff) {
  if (!eff || typeof eff !== "object" || Array.isArray(eff)) return [];
  const ranges = [];
  const early = normalizeApiEffectivenessLevel(eff.early);
  const mid = normalizeApiEffectivenessLevel(eff.mid);
  const late = normalizeApiEffectivenessLevel(eff.late);
  if (early === "strong") ranges.push({ start: 1, end: 6 });
  if (mid === "strong") ranges.push({ start: 7, end: 12 });
  if (late === "strong") ranges.push({ start: 13, end: 18 });
  if (ranges.length === 0 && (early === "neutral" || mid === "neutral" || late === "neutral")) {
    if (mid === "neutral") ranges.push({ start: 7, end: 12 });
    else if (early === "neutral") ranges.push({ start: 1, end: 6 });
    else if (late === "neutral") ranges.push({ start: 13, end: 18 });
  }
  return ranges.slice(0, POWER_SPIKE_MAX_RANGES);
}

function levelInPowerSpikes(level, powerSpikes) {
  if (!Array.isArray(powerSpikes)) return false;
  return powerSpikes.some((r) => r && level >= r.start && level <= r.end);
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
    let powerSpikes = normalizePowerSpikes(profile.powerSpikes ?? profile.power_spikes);
    if (powerSpikes.length === 0 && profile.effectiveness) {
      powerSpikes = powerSpikesFromLegacyEffectiveness(profile.effectiveness);
    }
    profiles[role] = {
      primaryDamageType: normalizedPrimaryDamageType,
      powerSpikes
    };
  }
  return profiles;
}

function cloneRoleProfileDraft(profile) {
  const source = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
  let powerSpikes = normalizePowerSpikes(source.powerSpikes ?? source.power_spikes);
  if (powerSpikes.length === 0 && source.effectiveness) {
    powerSpikes = powerSpikesFromLegacyEffectiveness(source.effectiveness);
  }
  return {
    primaryDamageType: normalizeApiPrimaryDamageType(source.primaryDamageType ?? source.primary_damage_type) ?? "mixed",
    powerSpikes
  };
}

function roleProfilesMatch(leftProfile, rightProfile) {
  const left = cloneRoleProfileDraft(leftProfile);
  const right = cloneRoleProfileDraft(rightProfile);
  if (left.primaryDamageType !== right.primaryDamageType) return false;
  if (left.powerSpikes.length !== right.powerSpikes.length) return false;
  for (let i = 0; i < left.powerSpikes.length; i++) {
    if (left.powerSpikes[i].start !== right.powerSpikes[i].start) return false;
    if (left.powerSpikes[i].end !== right.powerSpikes[i].end) return false;
  }
  return true;
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
  // New powerSpikes format: derive phase from level ranges
  const rawSpikes = profile?.powerSpikes ?? profile?.power_spikes;
  if (Array.isArray(rawSpikes) && rawSpikes.length > 0) {
    const phaseCoverage = { early: 0, mid: 0, late: 0 };
    for (const spike of rawSpikes) {
      if (!spike || typeof spike !== "object") continue;
      const start = Number(spike.start);
      const end = Number(spike.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      for (let lvl = Math.max(1, start); lvl <= Math.min(18, end); lvl++) {
        if (lvl <= 6) phaseCoverage.early++;
        else if (lvl <= 12) phaseCoverage.mid++;
        else phaseCoverage.late++;
      }
    }
    let bestPhase = "mid";
    let bestCount = 0;
    for (const phase of EFFECTIVENESS_PHASES) {
      if (phaseCoverage[phase] > bestCount) {
        bestCount = phaseCoverage[phase];
        bestPhase = phase;
      }
    }
    if (bestPhase === "early") return "Early";
    if (bestPhase === "late") return "Late";
    return "Mid";
  }
  // Legacy effectiveness format
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

function initializeChampionMetadataDraftFromMetadata(metadata, reviewed = false) {
  const metadataObject = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const roles = normalizeChampionMetadataRoles(metadataObject.roles);
  const roleProfiles = normalizeRoleProfilesFromMetadata(metadataObject.roleProfiles, roles);
  const useSharedRoleProfile = selectedRoleProfilesAreUniform(roles, roleProfiles);
  state.api.championMetadataDraft = {
    roles,
    roleProfiles,
    useSharedRoleProfile,
    compositionSynergies: normalizeChampionCompositionSynergyDraft(metadataObject.compositionSynergies)
  };
  ensureChampionMetadataRoleProfiles();
  state.api.championReviewedDraft = reviewed === true;
}

function initializeChampionMetadataDraft(champion) {
  if (!champion) {
    state.api.championMetadataDraft = createEmptyChampionMetadataDraft();
    state.api.championReviewedDraft = false;
    return;
  }
  initializeChampionMetadataDraftFromMetadata(
    {
      roles: champion.roles,
      roleProfiles: champion.roleProfiles
    },
    champion.reviewed === true
  );
}

function updateChampionMetadataScopeIndicator(championId, scope, isEnabled) {
  const champion = getChampionById(championId);
  if (!champion) {
    return;
  }
  champion.metadataScopes = normalizeChampionMetadataScopes(champion.metadataScopes);
  champion.metadataScopes[scope] = isEnabled === true;
  champion.metadataScopes.all = true;
}

function syncChampionMetadataDraftToState(championId, payload) {
  if (!Number.isInteger(championId) || championId <= 0 || !payload || typeof payload !== "object") {
    return;
  }
  const champion = getChampionById(championId);
  if (!champion) {
    return;
  }

  const metadata =
    payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? payload.metadata
      : {};
  const scope = normalizeChampionTagScope(payload.scope);
  const hasCustomMetadata = payload.has_custom_metadata === true || payload.hasCustomMetadata === true;
  const resolvedScope = normalizeChampionTagScope(payload.resolved_scope ?? payload.resolvedScope ?? "all");

  if (scope === "all") {
    const nextRoles = normalizeChampionMetadataRoles(metadata.roles);
    const nextRoleProfiles = normalizeRoleProfilesFromMetadata(metadata.roleProfiles, nextRoles);
    if (nextRoles.length > 0) {
      champion.roles = nextRoles;
    }
    champion.roleProfiles = nextRoleProfiles;
    champion.compositionSynergies = normalizeChampionCompositionSynergiesFromMetadata(metadata.compositionSynergies);
    const previewProfile = getChampionRoleProfile(champion, champion.roles[0]);
    champion.damageType = deriveDisplayDamageTypeFromProfile(previewProfile);
    champion.scaling = deriveLegacyScalingFromProfile(previewProfile);
    const payloadTagIds = payload.tagIds ?? payload.tag_ids;
    if (payloadTagIds !== undefined) {
      champion.tagIds = normalizeChampionTagIdArray(payloadTagIds);
    }
  }
  if (payload.reviewed !== undefined) {
    champion.reviewed = payload.reviewed === true;
  }
  updateChampionMetadataScopeIndicator(championId, scope, hasCustomMetadata);
  cacheExplorerScopedMetadataPayload(championId, scope, payload);
  if (!hasCustomMetadata && state.explorer.activeMetadataScopeByChampionId[String(championId)] === scope) {
    state.explorer.activeMetadataScopeByChampionId[String(championId)] = "all";
  } else if (hasCustomMetadata && scope !== "all") {
    state.explorer.activeMetadataScopeByChampionId[String(championId)] = scope;
  }
  state.api.championMetadataHasCustom = hasCustomMetadata;
  state.api.championMetadataResolvedScope = resolvedScope;
  initializeChampionMetadataDraftFromMetadata(metadata, payload.reviewed === true || champion.reviewed === true);
}

function getChampionEditorSnapshot() {
  return JSON.stringify({
    tagIds: [...(state.api.selectedChampionTagIds ?? [])].sort((a, b) => a - b),
    roles: [...(state.api.championMetadataDraft?.roles ?? [])],
    roleProfiles: state.api.championMetadataDraft?.roleProfiles ?? {},
    compositionSynergies: state.api.championMetadataDraft?.compositionSynergies ?? createEmptyChampionCompositionSynergiesDraft(),
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
  state.api.championTagScope = "self";
  state.api.championTagTeamId = "";
  state.api.championEditorTab = CHAMPION_EDITOR_TAB_COMPOSITION;
  state.api.championMetadataDraft = createEmptyChampionMetadataDraft();
  state.api.championReviewedDraft = false;
  state.api.championMetadataHasCustom = false;
  state.api.championMetadataResolvedScope = "all";
  state.api.championEditorSavedSnapshot = null;
  state.api.championProfileActiveRole = null;
  state.api.championEditorTags = [];
  state.api.championEditorTagById = {};
  state.api.isLoadingChampionTags = false;
  state.api.isSavingChampionTags = false;
  setChampionTagEditorMeta("");
  setChampionTagEditorFeedback("");
  closeChampionTagEditor();
}

function clearTagsManagerState({ clearInputs = true, closeManageModal = false } = {}) {
  state.api.selectedTagManagerId = null;
  state.api.isSavingTagCatalog = false;
  state.api.isTagPromotionModalOpen = false;
  state.api.tagPromotionDraftComment = "";
  if (closeManageModal) {
    state.api.isTagsManageModalOpen = false;
  }
  setTagsManageFeedback("");
  setTagPromotionModalFeedback("");
  if (clearInputs) {
    if (elements.tagsManageName) {
      elements.tagsManageName.value = "";
    }
    if (elements.tagsManageDefinition) {
      elements.tagsManageDefinition.value = "";
    }
  }
}

function openTagsManageModal() {
  state.api.isTagsManageModalOpen = true;
  renderTagsManageModal();
  runtimeWindow.setTimeout(() => {
    elements.tagsManageName?.focus();
  }, 0);
}

function closeTagsManageModal() {
  state.api.isTagsManageModalOpen = false;
  state.api.tagManageSnapshot = null;
  clearTagsManagerState();
  renderTagsManageModal();
}

async function confirmAndCloseTagsManageModal() {
  const isEditing = Boolean(getManagedTagById(state.api.selectedTagManagerId));
  if (isEditing) {
    const snapshot = state.api.tagManageSnapshot;
    const currentName = (elements.tagsManageName?.value ?? "").trim();
    const currentDef = (elements.tagsManageDefinition?.value ?? "").trim();
    const isDirty = currentName !== (snapshot?.name ?? "") || currentDef !== (snapshot?.definition ?? "");
    if (isDirty) {
      const confirmed = await showUSSConfirm({
        title: "Unsaved Tag Changes",
        body: "You have unsaved changes to this tag. Discard them?",
        affirmLabel: "Discard",
        cancelLabel: "Keep Editing",
        destructive: true
      });
      if (!confirmed) return;
    }
  } else {
    const hasContent = (elements.tagsManageName?.value ?? "").trim() !== "";
    if (hasContent) {
      const confirmed = await showUSSConfirm({
        title: "Unsaved Tag",
        body: "You have unsaved tag changes. Discard them?",
        affirmLabel: "Discard",
        cancelLabel: "Keep Editing",
        destructive: true
      });
      if (!confirmed) return;
    }
  }
  closeTagsManageModal();
}

function renderTagsManageModal() {
  if (!elements.tagsManageModal) {
    return;
  }
  elements.tagsManageModal.hidden = !state.api.isTagsManageModalOpen;
  if (state.api.isTagsManageModalOpen) {
    renderTagsManagerControls();
  }
  updateBodyModalState();
}

function getTagPromotionScopeLabel(scope) {
  return getTagCatalogScopeOptions().find((option) => option.value === scope)?.label ?? "Global";
}

function getTagPromotionUiState() {
  const context = getTagCatalogScopeRequestContext();
  const canManageTags = canWriteTagCatalogScope();
  const selectedTag = getManagedTagById(state.api.selectedTagManagerId);
  const targetScope = context.scope === "self" ? "team" : "all";
  const showButton = isAuthenticated() && canManageTags && context.scope !== "all";
  const hasScopedDefinition = Boolean(selectedTag?.hasCustomDefinition);
  const canRequestPromotion = showButton && hasScopedDefinition;
  const actionLabel = context.scope === "team" ? "Request Global Promotion" : "Request Team Promotion";
  let disabledReason = "";
  if (showButton && !selectedTag) {
    disabledReason = "Save a scoped tag before requesting promotion.";
  } else if (showButton && !hasScopedDefinition) {
    disabledReason = "Save this inherited tag as a scoped definition before requesting promotion.";
  }
  return {
    context,
    selectedTag,
    targetScope,
    showButton,
    canRequestPromotion,
    actionLabel,
    disabledReason
  };
}

function closeTagPromotionModal({ clearDraft = true } = {}) {
  if (!state?.api) {
    return;
  }
  state.api.isTagPromotionModalOpen = false;
  if (clearDraft) {
    state.api.tagPromotionDraftComment = "";
  }
  setTagPromotionModalFeedback("");
  renderTagsWorkspace();
}

function openTagPromotionModal() {
  const promotionUi = getTagPromotionUiState();
  if (!promotionUi.showButton) {
    return;
  }
  if (!promotionUi.canRequestPromotion) {
    setTagPromotionFeedback(promotionUi.disabledReason || "Save a scoped tag before requesting promotion.");
    return;
  }
  state.api.isTagPromotionModalOpen = true;
  state.api.tagPromotionDraftComment = "";
  setTagPromotionModalFeedback("");
  renderTagsWorkspace();
  runtimeWindow.setTimeout(() => {
    elements.tagsPromotionModalComment?.focus();
  }, 0);
}

function formatTeamCardTitle(team) {
  const name = typeof team?.name === "string" ? team.name : "Unnamed Team";
  const tag = typeof team?.tag === "string" ? team.tag.trim() : "";
  return tag ? `${name} (${tag})` : name;
}

function normalizePositiveInteger(rawValue) {
  if (typeof rawValue === "string" && rawValue.trim() !== "") {
    const parsed = Number.parseInt(rawValue, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  if (Number.isInteger(rawValue) && rawValue > 0) {
    return rawValue;
  }
  return null;
}

function normalizeTeamEntityId(rawValue) {
  const normalizedId = normalizePositiveInteger(rawValue);
  return normalizedId === null ? null : String(normalizedId);
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
    topChampion: null,
    champions: [],
    fetchedAt: "",
    message: ""
  };
}

function normalizeChampionStatsEntry(entry) {
  const championId = Number.parseInt(String(entry?.championId), 10);
  const championLevel = Number.parseInt(String(entry?.championLevel), 10);
  const championPoints = Number.parseInt(String(entry?.championPoints), 10);
  const championName = typeof entry?.championName === "string" ? entry.championName.trim() : "";
  const lastPlayedAt = typeof entry?.lastPlayedAt === "string" ? entry.lastPlayedAt : null;

  if (!Number.isInteger(championId)) {
    return null;
  }

  return {
    championId,
    championName,
    championLevel: Number.isInteger(championLevel) ? championLevel : 0,
    championPoints: Number.isInteger(championPoints) ? championPoints : 0,
    lastPlayedAt
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
    normalized.champions = rawStats.champions.map(normalizeChampionStatsEntry).filter(Boolean);
  }

  normalized.topChampion = normalizeChampionStatsEntry(rawStats.topChampion) ?? normalized.champions[0] ?? null;

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
  state.profile.isSavingAvatar = false;
  state.profile.isSavingDisplayTeam = false;
  state.profile.championStats = createEmptyChampionStatsState();
  state.profile.isChampionSuggestionNoticeOpen = false;
  state.profile.avatarChampionId = null;
  state.profile.pendingAvatarId = null;
  state.profile.displayTeamId = null;
  state.profile.avatarFilter = "";
  state.api.isCreatingTeam = false;
  state.api.discoverTeams = [];
  state.api.discoverTeamsLoadedAt = null;
  state.api.isLoadingDiscoverTeams = false;
  state.api.joinRequestsByTeamId = {};
  state.api.joinRequestsLoadedAtByTeamId = {};
  state.api.isLoadingJoinRequests = false;
  state.api.invitationsByTeamId = {};
  state.api.teamInvitationsLoadedAtByTeamId = {};
  state.api.teamInvitationsLoadErrorByTeamId = {};
  state.api.userInvitations = [];
  state.api.userInvitationsLoadedAt = null;
  state.api.userInvitationsLoadError = false;
  state.api.selectedDiscoverTeamId = "";
  state.api.users = [];
  state.api.championCore = [];
  state.api.championCoreSearch = "";
  state.api.isLoadingChampionCore = false;
  state.api.isLoadingUsers = false;
  state.api.issueReporting = {
    ...state.api.issueReporting,
    isOpen: false,
    isSubmitting: false,
    lastIssueUrl: "",
    sourceContext: null
  };
  state.api.confirmation = createEmptyConfirmationState();
  state.api.usersSearch = "";
  state.api.usersRoleFilter = "";
  state.api.bulkUserRole = "member";
  state.api.selectedUserIds = new Set();
  state.api.isBulkSavingUserRoles = false;
  state.api.authorizationMatrix = null;
  state.api.isLoadingAuthorizationMatrix = false;
  state.api.savingUserRoleId = null;
  state.api.savingUserRiotIdId = null;
  state.api.deletingUserId = null;
  state.api.teamAdminAddMemberSearchQuery = "";
  state.api.teamAdminAddMemberSearchResults = [];
  state.api.isLoadingTeamAdminAddMemberSearch = false;
  _pendingConfirmationResolver = null;
  state.api.requirementDefinitions = [];
  state.api.selectedRequirementDefinitionId = null;
  state.api.requirementDefinitionDraft = createEmptyRequirementDefinitionDraft();
  state.api.compositionCatalogScope = "all";
  state.api.compositionCatalogTeamId = "";
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
  resetIssueReportForm({ preserveIdentity: false });
  setIssueReportFeedback("");
  renderConfirmationModal();
  updateBodyModalState();
  setUsersFeedback("");
  setChampionCoreFeedback("");
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
    renderIssueReportingPanel();
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
  renderIssueReportingPanel();
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
  if (elements.championCoreTitle) {
    elements.championCoreTitle.textContent = UI_COPY.panels.championCoreTitle;
  }
  if (elements.championCoreMeta) {
    elements.championCoreMeta.textContent = UI_COPY.panels.championCoreMeta;
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
  state.builder.draftPathSelections = {};
}

function renderBuilderStageGuide() {
  elements.builderStageSetupTitle.textContent = UI_COPY.builder.stages[0].panelTitle;
  elements.builderStageSetupMeta.textContent = UI_COPY.builder.stages[0].panelMeta;
  elements.builderStageInspectTitle.textContent = UI_COPY.builder.stages[1].panelTitle;
  elements.builderStageInspectMeta.textContent = UI_COPY.builder.stages[1].panelMeta;
  elements.builderGenerate.textContent = UI_COPY.builder.generateLabel;

  elements.builderStageSetup.hidden = false;
  elements.builderStageInspect.hidden = false;

  elements.builderGenerate.disabled = false;
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

async function setTab(tabName, { syncRoute = false, replaceRoute = false } = {}) {
  const requestedTab = typeof tabName === "string" ? tabName : "";
  const normalizedRequestedTab = resolveTabRoute(requestedTab);
  const resolvedTab = hasAuthSession() ? normalizedRequestedTab : DEFAULT_TAB_ROUTE;
  const shouldNormalizeRoute = requestedTab !== resolvedTab || resolveTabRoute(requestedTab) !== requestedTab;
  const shouldSyncRoute = syncRoute || shouldNormalizeRoute;
  const tabChanged = state.activeTab !== resolvedTab;

  // Close open modals on tab change (with dirty checks)
  if (tabChanged) {
    const canNavigate = await closeAllModalsOnNavigate();
    if (!canNavigate) return;
  }

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
  const navAvatarLink = runtimeDocument.querySelector(".nav-avatar-link");
  if (navAvatarLink) navAvatarLink.classList.toggle("is-active", resolvedTab === "profile");

  elements.tabExplorer.classList.toggle("is-active", resolvedTab === "explorer");
  elements.tabWorkflow.classList.toggle("is-active", resolvedTab === "workflow");
  elements.tabTags.classList.toggle("is-active", resolvedTab === "tags");
  elements.tabUsers.classList.toggle("is-active", resolvedTab === "users");
  elements.tabChampionCore.classList.toggle("is-active", resolvedTab === "champion-core");
  elements.tabRequirements.classList.toggle("is-active", resolvedTab === "requirements");
  elements.tabCompositions.classList.toggle("is-active", resolvedTab === "compositions");
  elements.tabTeamConfig.classList.toggle("is-active", resolvedTab === "team-config");
  elements.tabProfile.classList.toggle("is-active", resolvedTab === "profile");
  elements.tabComingSoon.classList.toggle("is-active", resolvedTab === "coming-soon");
  applyHeroCopy(resolvedTab);

  if (tabChanged && !String(runtimeWindow?.navigator?.userAgent ?? "").toLowerCase().includes("jsdom")) {
    runtimeWindow?.scrollTo?.(0, 0);
  }

  if (resolvedTab === "team-config" && state.data) {
    renderTeamConfig();
    renderTeamAdmin();
    if (isAuthenticated() && tabChanged) {
      void refreshTeamWorkspaceDataForActiveTab();
    }
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
  if (resolvedTab === "champion-core") {
    if (isAdminUser() && state.api.championCore.length === 0 && !state.api.isLoadingChampionCore) {
      void loadChampionCoreFromApi();
    }
    renderChampionCoreWorkspace();
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

function normalizeChampionMetadataScopes(rawValue) {
  const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
    ? rawValue
    : {};
  return {
    self: source.self === true,
    team: source.team === true,
    all: source.all !== false
  };
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
  const compositionSynergies = normalizeChampionCompositionSynergiesFromMetadata(metadata.compositionSynergies);
  const reviewed = rawChampion.reviewed === true || metadata.reviewed === true;
  const reviewedByUserId = normalizeApiEntityId(rawChampion.reviewed_by_user_id ?? rawChampion.reviewedByUserId);
  const reviewedByDisplayName =
    typeof rawChampion.reviewed_by_display_name === "string"
      ? rawChampion.reviewed_by_display_name.trim()
      : typeof rawChampion.reviewedByDisplayName === "string"
        ? rawChampion.reviewedByDisplayName.trim()
        : "";
  const reviewedAt =
    typeof rawChampion.reviewed_at === "string"
      ? rawChampion.reviewed_at
      : typeof rawChampion.reviewedAt === "string"
        ? rawChampion.reviewedAt
        : "";

  return {
    id: normalizeApiEntityId(rawChampion.id),
    name,
    roles: normalizedRoles,
    damageType,
    scaling,
    roleProfiles,
    tags: deriveApiTagsFromTagIds(tagIds),
    tagIds,
    compositionSynergies,
    reviewed,
    reviewed_by_user_id: reviewedByUserId,
    reviewed_by_display_name: reviewedByDisplayName,
    reviewed_at: reviewedAt,
    metadataScopes: normalizeChampionMetadataScopes(rawChampion.metadataScopes ?? rawChampion.metadata_scopes)
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
  const payload = await apiRequest("/champions", { auth: isAuthenticated() });
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

async function refreshChampionDataFromApi() {
  const championData = await loadChampionsData();
  state.data = {
    ...state.data,
    champions: championData.champions,
    championsByName: championData.championsByName,
    championIdsByName: championData.championIdsByName ?? {},
    championNamesById: championData.championNamesById ?? {},
    noneTeamPools: buildNoneTeamPools(championData.champions)
  };
  syncExplorerScopedMetadataState();
}

function getExplorerChampionActiveMetadataScope(champion) {
  const activeScope = normalizeChampionTagScope(
    state.explorer.activeMetadataScopeByChampionId[String(champion?.id)] ?? "all"
  );
  if (activeScope === "all") {
    return "all";
  }
  if (!canReadExplorerMetadataScope(activeScope)) {
    return "all";
  }
  const metadataScopes = normalizeChampionMetadataScopes(champion?.metadataScopes);
  return metadataScopes[activeScope] === true ? activeScope : "all";
}

function getExplorerChampionMetadataPreview(champion, scope) {
  const normalizedScope = normalizeChampionTagScope(scope);
  if (normalizedScope !== "all") {
    const entry = getExplorerScopedMetadataCacheEntry(champion.id, normalizedScope);
    if (entry?.hasCustomMetadata) {
      const roles = normalizeChampionMetadataRoles(entry.roles);
      if (roles.length > 0) {
        return {
          roles,
          roleProfiles: normalizeRoleProfilesFromMetadata(entry.roleProfiles, roles)
        };
      }
    }
  }

  const roles = normalizeChampionMetadataRoles(champion?.roles);
  return {
    roles,
    roleProfiles: normalizeRoleProfilesFromMetadata(champion?.roleProfiles, roles)
  };
}

async function loadExplorerScopedMetadata(championId, scope) {
  const normalizedScope = normalizeChampionTagScope(scope);
  if (!isAuthenticated() || !Number.isInteger(championId) || championId <= 0 || normalizedScope === "all") {
    return null;
  }
  if (!canReadExplorerMetadataScope(normalizedScope)) {
    return null;
  }

  const query = new URLSearchParams({ scope: normalizedScope });
  if (normalizedScope === "team") {
    const teamId = getExplorerTeamScopeTeamId();
    if (!teamId) {
      return null;
    }
    query.set("team_id", teamId);
  }

  const payload = await apiRequest(`/champions/${championId}/metadata?${query.toString()}`, { auth: true });
  updateChampionMetadataScopeIndicator(
    championId,
    normalizedScope,
    payload?.has_custom_metadata === true || payload?.hasCustomMetadata === true
  );
  return cacheExplorerScopedMetadataPayload(championId, normalizedScope, payload);
}

async function selectExplorerChampionMetadataScope(championId, scope) {
  if (!Number.isInteger(championId) || championId <= 0) {
    return;
  }
  const champion = getChampionById(championId);
  if (!champion) {
    return;
  }
  const normalizedScope = normalizeChampionTagScope(scope);
  const championKey = String(championId);
  if (normalizedScope === "all") {
    state.explorer.activeMetadataScopeByChampionId[championKey] = "all";
    renderExplorer();
    return;
  }

  const metadataScopes = normalizeChampionMetadataScopes(champion.metadataScopes);
  if (metadataScopes[normalizedScope] !== true || !canReadExplorerMetadataScope(normalizedScope)) {
    return;
  }

  const cached = getExplorerScopedMetadataCacheEntry(championId, normalizedScope);
  if (cached?.hasCustomMetadata) {
    state.explorer.activeMetadataScopeByChampionId[championKey] = normalizedScope;
    renderExplorer();
    return;
  }

  try {
    const loaded = await loadExplorerScopedMetadata(championId, normalizedScope);
    state.explorer.activeMetadataScopeByChampionId[championKey] = loaded?.hasCustomMetadata ? normalizedScope : "all";
    renderExplorer();
  } catch (_error) {
    state.explorer.activeMetadataScopeByChampionId[championKey] = "all";
    renderExplorer();
  }
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
  return {
    id,
    name,
    definition,
    resolvedScope: normalizeChampionTagScope(rawTag.resolved_scope ?? rawTag.resolvedScope ?? "all"),
    hasCustomDefinition:
      rawTag.has_custom_definition === true ||
      rawTag.hasCustomDefinition === true ||
      (
        rawTag.has_custom_definition === undefined &&
        rawTag.hasCustomDefinition === undefined &&
        normalizeChampionTagScope(rawTag.resolved_scope ?? rawTag.resolvedScope ?? "all") === "all"
      ),
    updatedByUserId: normalizeApiEntityId(rawTag.updated_by_user_id ?? rawTag.updatedByUserId),
    updatedAt:
      typeof rawTag.updated_at === "string"
        ? rawTag.updated_at
        : typeof rawTag.updatedAt === "string"
          ? rawTag.updatedAt
          : ""
  };
}

async function loadTagCatalogFromApi() {
  try {
    const payload = await apiRequest("/tags", { auth: isAuthenticated() });
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

function buildTagCatalogQuery({
  scope = "all",
  teamId = "",
  includeFallback = true
} = {}) {
  const normalizedScope = normalizeChampionTagScope(scope);
  const query = new URLSearchParams({ scope: normalizedScope });
  if (normalizedScope === "team") {
    const normalizedTeamId = normalizeTeamEntityId(teamId);
    if (!normalizedTeamId) {
      return null;
    }
    query.set("team_id", normalizedTeamId);
  }
  if (includeFallback === false) {
    query.set("include_fallback", "false");
  }
  return query;
}

async function loadScopedTagCatalogIntoState(stateKeys, { scope = "all", teamId = "", includeFallback = true } = {}) {
  const query = buildTagCatalogQuery({ scope, teamId, includeFallback });
  if (!query) {
    state.api[stateKeys.tags] = [];
    state.api[stateKeys.tagById] = {};
    return false;
  }
  try {
    const payload = await apiRequest(`/tags?${query.toString()}`, { auth: isAuthenticated() });
    const source = Array.isArray(payload?.tags) ? payload.tags : [];
    const tags = source.map(normalizeTagCatalogEntry).filter(Boolean);
    state.api[stateKeys.tags] = tags;
    state.api[stateKeys.tagById] = Object.fromEntries(tags.map((tag) => [String(tag.id), tag]));
    return true;
  } catch (_error) {
    state.api[stateKeys.tags] = [];
    state.api[stateKeys.tagById] = {};
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
  const context = getTagCatalogScopeRequestContext();
  const source =
    context.scope === "all" && state.api.tagsWorkspaceCatalog.length < 1
      ? state.api.tags
      : state.api.tagsWorkspaceCatalog;
  return source.find((tag) => tag.id === tagId) ?? null;
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
  state.api.tagManageSnapshot = { name: tag.name, definition: String(tag.definition ?? "") };
  if (elements.tagsManageName) {
    elements.tagsManageName.value = tag.name;
  }
  if (elements.tagsManageDefinition) {
    elements.tagsManageDefinition.value = String(tag.definition ?? "");
  }
  const context = getTagCatalogScopeRequestContext();
  const scopeLabel = getTagCatalogScopeOptions().find((option) => option.value === context.scope)?.label ?? "Global";
  if (tag.hasCustomDefinition || context.scope === "all") {
    setTagsManageFeedback(`Editing '${tag.name}' in ${scopeLabel.toLowerCase()} scope.`);
  } else {
    setTagsManageFeedback(
      `Editing inherited '${tag.name}'. Saving will create a ${scopeLabel.toLowerCase()} tag definition.`
    );
  }
  state.api.isTagsManageModalOpen = true;
  renderTagsWorkspace();
}

function renderTagsManagerControls() {
  const canManageTags = canWriteTagCatalogScope();
  if (
    Number.isInteger(state.api.selectedTagManagerId) &&
    state.api.selectedTagManagerId > 0 &&
    !getManagedTagById(state.api.selectedTagManagerId)
  ) {
    state.api.selectedTagManagerId = null;
  }
  const selectedTag = getManagedTagById(state.api.selectedTagManagerId);
  const isEditing = Boolean(selectedTag);
  const isUpdatingExact = Boolean(selectedTag && selectedTag.hasCustomDefinition);
  const controlsDisabled = !canManageTags || state.api.isSavingTagCatalog;
  const context = getTagCatalogScopeRequestContext();
  const scopeLabel = getTagCatalogScopeOptions().find((option) => option.value === context.scope)?.label ?? "Global";

  if (elements.tagsManageAccess) {
    if (!isAuthenticated()) {
      elements.tagsManageAccess.textContent = "Sign in to manage tags.";
    } else if (!canManageTags) {
      elements.tagsManageAccess.textContent =
        context.scope === "all"
          ? "Your role is read-only for global tag definitions."
          : "Switch to a writable scope to manage tag definitions.";
    } else if (context.scope === "self") {
      elements.tagsManageAccess.textContent = "User scope enabled: create personal tags or override global definitions.";
    } else if (context.scope === "team") {
      elements.tagsManageAccess.textContent = "Team scope enabled: create team tags or override global definitions.";
    } else if (!isAdminUser()) {
      elements.tagsManageAccess.textContent = "Global editor mode enabled: manage global tag definitions.";
    } else {
      elements.tagsManageAccess.textContent = "Admin mode enabled: create, update, and delete global tags.";
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
    elements.tagsManageSave.textContent = !isEditing
      ? "Create Tag"
      : isUpdatingExact || context.scope === "all"
        ? "Update Tag"
        : `Save to Create ${scopeLabel} Tag`;
  }
  if (elements.tagsManageCancel) {
    elements.tagsManageCancel.disabled = controlsDisabled;
    elements.tagsManageCancel.textContent = isEditing ? "Cancel Edit" : "Clear";
  }
  if (elements.tagsPromotionOpen) {
    const promotionUi = getTagPromotionUiState();
    elements.tagsPromotionOpen.hidden = !promotionUi.showButton;
    elements.tagsPromotionOpen.disabled =
      state.api.isLoadingTagPromotions ||
      state.api.isSubmittingTagPromotion ||
      !promotionUi.canRequestPromotion;
    elements.tagsPromotionOpen.textContent = promotionUi.actionLabel;
    elements.tagsPromotionOpen.title = promotionUi.canRequestPromotion ? "" : promotionUi.disabledReason;
  }
}

async function refreshTagCatalogViews() {
  await loadTagCatalogFromApi();
  await loadScopedTagCatalogIntoState(
    {
      tags: "tagsWorkspaceCatalog",
      tagById: "tagsWorkspaceTagById"
    },
    {
      ...getTagCatalogScopeRequestContext(),
      includeFallback: true
    }
  );
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

  const tag = getManagedTagById(state.api.selectedTagManagerId);
  const tagId = tag?.id ?? null;
  const isEditing = Boolean(tag);
  const isUpdatingExact = Boolean(tag?.hasCustomDefinition);
  const context = getTagCatalogScopeRequestContext();
  state.api.isSavingTagCatalog = true;
  setTagsManageFeedback(isEditing ? "Saving tag definition..." : "Creating tag...");
  renderTagsWorkspace();

  try {
    const payload = await apiRequest(isEditing && isUpdatingExact ? `/tags/${tagId}` : "/tags", {
      method: isEditing && isUpdatingExact ? "PUT" : "POST",
      auth: true,
      body: {
        ...draft,
        scope: context.scope,
        ...(context.scope === "team" && context.teamId ? { team_id: Number(context.teamId) } : {})
      }
    });

    await refreshTagCatalogViews();
    closeTagsManageModal();
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
  const tag = getManagedTagById(tagId);
  const tagLabel = tag?.name ?? `tag #${tagId}`;
  const context = getTagCatalogScopeRequestContext();
  const scopeLabel = getTagCatalogScopeOptions().find((option) => option.value === context.scope)?.label ?? "Global";
  const confirmed = await confirmAction({
    title: "Confirm Tag Deletion",
    message:
      context.scope === "all"
        ? `Delete global tag '${tagLabel}'? This removes it from the shared catalog.`
        : `Delete the ${scopeLabel.toLowerCase()} tag definition for '${tagLabel}'?`,
    confirmLabel: "Delete Tag"
  });
  if (!confirmed) {
    return;
  }

  state.api.isSavingTagCatalog = true;
  setTagsManageFeedback("Deleting tag...");
  renderTagsWorkspace();

  try {
    const query = buildTagCatalogQuery({
      scope: context.scope,
      teamId: context.teamId,
      includeFallback: true
    });
    await apiRequest(`/tags/${tagId}?${query?.toString() ?? ""}`, {
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

  renderTagCatalogScopeControls();
  if (elements.tagsManageOpen) {
    elements.tagsManageOpen.hidden = !isAuthenticated() || !canWriteTagCatalogScope();
  }
  renderTagsManageModal();
  renderTagPromotionPanels();
  renderTagPromotionModal();
  const context = getTagCatalogScopeRequestContext();
  const tags = Array.isArray(state.api.tagsWorkspaceCatalog) && state.api.tagsWorkspaceCatalog.length > 0
    ? state.api.tagsWorkspaceCatalog
    : context.scope === "all" && Array.isArray(state.api.tags)
      ? state.api.tags
      : [];
  const usageByTagId = buildChampionUsageByTagId();
  const scopeLabel = getTagCatalogScopeOptions().find((option) => option.value === context.scope)?.label ?? "Global";
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
  elements.tagsWorkspaceSummary.textContent =
    context.scope === "all"
      ? `${tags.length} tags in the shared catalog.`
      : `${tags.length} tags visible in ${scopeLabel.toLowerCase()} scope (with global fallback).`;

  const list = runtimeDocument.createElement("ul");
  list.className = "tags-workspace-list";
  for (const tag of sortedTags) {
    const item = runtimeDocument.createElement("li");
    item.className = "tags-workspace-item";

    const usageCount = (usageByTagId.get(tag.id) ?? []).length;

    const header = runtimeDocument.createElement("div");
    header.className = "tags-workspace-header";

    const name = runtimeDocument.createElement("p");
    name.className = "tags-workspace-name";
    name.textContent = tag.name;

    let usageTitle = "";
    if (context.scope === "all") {
      usageTitle = usageCount === 1 ? "Used by 1 champion" : `Used by ${usageCount} champions`;
    } else if (tag.hasCustomDefinition) {
      usageTitle =
        tag.resolvedScope === context.scope
          ? `Custom ${scopeLabel.toLowerCase()} definition`
          : `Resolved from ${tag.resolvedScope === "all" ? "global" : tag.resolvedScope} scope`;
    } else {
      usageTitle = "Inherited from global definition";
    }

    const usageBtn = runtimeDocument.createElement("span");
    usageBtn.className = "uss-stats-btn tags-workspace-usage-icon";
    usageBtn.title = usageTitle;
    usageBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
    header.append(name, usageBtn);

    const content = runtimeDocument.createElement("div");
    content.className = "tags-workspace-content";

    const definition = runtimeDocument.createElement("p");
    definition.className = "meta tags-workspace-definition";
    definition.textContent = String(tag.definition ?? "").trim() || "No definition set.";

    content.append(definition);
    item.append(header, content);

    if (canWriteTagCatalogScope()) {
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
      deleteButton.hidden = context.scope !== "all" && !tag.hasCustomDefinition;
      if (!deleteButton.hidden) {
        deleteButton.addEventListener("click", () => {
          void deleteManagedTag(tag.id);
        });
      }

      actions.append(editButton, deleteButton);
      item.append(actions);
    }
    list.append(item);
  }
  elements.tagsWorkspaceCategories.append(list);
}

function renderTagPromotionPanels() {
  if (!elements.tagsPromotionRequestList || !elements.tagsPromotionReviewList) {
    return;
  }

  if (elements.tagsPromotionRefresh) {
    elements.tagsPromotionRefresh.disabled = !isAuthenticated() || state.api.isLoadingTagPromotions;
  }

  const renderPromotionCards = (target, requests, { reviewMode = false } = {}) => {
    target.innerHTML = "";
    if (!isAuthenticated()) {
      const empty = runtimeDocument.createElement("p");
      empty.className = "meta";
      empty.textContent = "Sign in to view tag promotion activity.";
      target.append(empty);
      return;
    }
    if (state.api.isLoadingTagPromotions) {
      const loading = runtimeDocument.createElement("p");
      loading.className = "meta";
      loading.textContent = "Loading tag promotions...";
      target.append(loading);
      return;
    }
    if (!Array.isArray(requests) || requests.length < 1) {
      const empty = runtimeDocument.createElement("p");
      empty.className = "meta";
      empty.textContent = reviewMode ? "No tag promotions awaiting review." : "No submitted tag promotions yet.";
      target.append(empty);
      return;
    }

    for (const request of requests) {
      const card = runtimeDocument.createElement("article");
      card.className = "summary-card";

      const title = runtimeDocument.createElement("strong");
      title.textContent = request.payloadJson?.tag_name || `Tag #${request.resourceId}`;

      const route = runtimeDocument.createElement("p");
      route.className = "meta";
      const statusLabel = request.status ? `${request.status.charAt(0).toUpperCase()}${request.status.slice(1)}` : "Pending";
      route.textContent =
        `${getTagPromotionScopeLabel(request.sourceScope)} -> ${getTagPromotionScopeLabel(request.targetScope)} | ${statusLabel}`;

      const requestComment = runtimeDocument.createElement("p");
      requestComment.className = "meta";
      requestComment.textContent = request.requestComment || "No promotion note.";

      card.append(title, route, requestComment);

      const createdMeta = formatTimestampMeta(request.createdAt);
      if (createdMeta) {
        const created = runtimeDocument.createElement("p");
        created.className = "meta";
        created.textContent = `Submitted ${createdMeta}`;
        card.append(created);
      }

      if (reviewMode && request.status === "pending") {
        const reviewInput = runtimeDocument.createElement("input");
        reviewInput.type = "text";
        reviewInput.maxLength = MAX_PROMOTION_COMMENT_LENGTH;
        reviewInput.placeholder = "Review note (optional)";

        const actions = runtimeDocument.createElement("div");
        actions.className = "button-row";

        const approve = runtimeDocument.createElement("button");
        approve.type = "button";
        approve.textContent = "Approve";
        approve.addEventListener("click", () => {
          void reviewTagPromotion(request.id, "approved", reviewInput.value);
        });

        const reject = runtimeDocument.createElement("button");
        reject.type = "button";
        reject.className = "ghost";
        reject.textContent = "Reject";
        reject.addEventListener("click", () => {
          void reviewTagPromotion(request.id, "rejected", reviewInput.value);
        });

        actions.append(approve, reject);
        card.append(reviewInput, actions);
      } else if (!reviewMode && request.status === "pending") {
        const actions = runtimeDocument.createElement("div");
        actions.className = "button-row";

        const cancel = runtimeDocument.createElement("button");
        cancel.type = "button";
        cancel.className = "ghost";
        cancel.textContent = "Cancel Request";
        cancel.addEventListener("click", () => {
          void cancelTagPromotion(request.id);
        });

        actions.append(cancel);
        card.append(actions);
      } else if (request.reviewComment) {
        const reviewComment = runtimeDocument.createElement("p");
        reviewComment.className = "meta";
        reviewComment.textContent = `Review: ${request.reviewComment}`;
        card.append(reviewComment);
      }

      target.append(card);
    }
  };

  renderPromotionCards(elements.tagsPromotionRequestList, state.api.tagPromotionRequests, { reviewMode: false });
  renderPromotionCards(elements.tagsPromotionReviewList, state.api.tagPromotionReviewQueue, { reviewMode: true });
}

function renderTagPromotionModal() {
  if (!elements.tagsPromotionModal) {
    return;
  }

  const promotionUi = getTagPromotionUiState();
  if (state.api.isTagPromotionModalOpen && !promotionUi.canRequestPromotion) {
    state.api.isTagPromotionModalOpen = false;
    state.api.tagPromotionDraftComment = "";
    setTagPromotionModalFeedback("");
  }

  elements.tagsPromotionModal.hidden = !state.api.isTagPromotionModalOpen;
  if (elements.tagsPromotionModalTitle) {
    elements.tagsPromotionModalTitle.textContent = promotionUi.actionLabel;
  }
  if (elements.tagsPromotionModalContext) {
    if (promotionUi.selectedTag) {
      elements.tagsPromotionModalContext.textContent =
        `Promote '${promotionUi.selectedTag.name}' from ${getTagPromotionScopeLabel(promotionUi.context.scope).toLowerCase()} ` +
        `scope to ${getTagPromotionScopeLabel(promotionUi.targetScope).toLowerCase()} scope.`;
    } else {
      elements.tagsPromotionModalContext.textContent = "";
    }
  }
  if (elements.tagsPromotionModalComment) {
    elements.tagsPromotionModalComment.value = state.api.tagPromotionDraftComment ?? "";
    elements.tagsPromotionModalComment.disabled = state.api.isSubmittingTagPromotion;
  }
  if (elements.tagsPromotionModalCancel) {
    elements.tagsPromotionModalCancel.disabled = state.api.isSubmittingTagPromotion;
  }
  if (elements.tagsPromotionModalSubmit) {
    elements.tagsPromotionModalSubmit.disabled = state.api.isSubmittingTagPromotion || !promotionUi.canRequestPromotion;
    elements.tagsPromotionModalSubmit.textContent = state.api.isSubmittingTagPromotion ? "Submitting..." : "Submit Request";
  }
  updateBodyModalState();
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

function normalizeIssueReportingConfig(rawIssueReporting) {
  const source = rawIssueReporting && typeof rawIssueReporting === "object" && !Array.isArray(rawIssueReporting)
    ? rawIssueReporting
    : {};
  return {
    enabled: source.enabled === true,
    repository:
      typeof source.repository === "string" && source.repository.trim() !== ""
        ? source.repository.trim()
        : "jmirving/DraftEngine",
    fallbackUrl:
      typeof source.fallback_url === "string" && source.fallback_url.trim() !== ""
        ? source.fallback_url.trim()
        : DEFAULT_ISSUE_REPORTING_FALLBACK_URL
  };
}

function buildIssueSourceSummary(sourceContext) {
  if (!sourceContext || typeof sourceContext !== "object") {
    return "";
  }
  const parts = [
    typeof sourceContext.pageLabel === "string" ? sourceContext.pageLabel.trim() : "",
    typeof sourceContext.tabLabel === "string" ? sourceContext.tabLabel.trim() : "",
    typeof sourceContext.detailLabel === "string" ? sourceContext.detailLabel.trim() : ""
  ].filter(Boolean);
  return parts.join(" / ");
}

function captureIssueReportingSourceContext() {
  const page = resolveTabRoute(state.activeTab);
  const pageLabel = ISSUE_REPORT_PAGE_LABELS[page] ?? "DraftEngine";
  let tab = "";
  let tabLabel = "";
  let detailLabel = "";

  if (page === "team-config") {
    tab = TEAM_WORKSPACE_TAB_SET.has(state.ui.teamWorkspaceTab) ? state.ui.teamWorkspaceTab : TEAM_WORKSPACE_TAB_DEFAULT;
    tabLabel = ISSUE_REPORT_TEAM_TAB_LABELS[tab] ?? "Teams";
    if (tab === TEAM_WORKSPACE_TAB_MANAGE && TEAM_MANAGE_ACTION_SET.has(state.ui.teamManageAction)) {
      detailLabel = ISSUE_REPORT_TEAM_ACTION_LABELS[state.ui.teamManageAction] ?? "";
    }
  } else if (page === "coming-soon") {
    tab = UPDATES_RELEASE_TAB_SET.has(state.ui.updatesReleaseTab) ? state.ui.updatesReleaseTab : UPDATES_RELEASE_TAB_DEFAULT;
    tabLabel = ISSUE_REPORT_UPDATES_TAB_LABELS[tab] ?? "Updates";
  } else if (page === "explorer") {
    tab = typeof state.explorer.subTab === "string" ? state.explorer.subTab : "";
    tabLabel = ISSUE_REPORT_EXPLORER_TAB_LABELS[tab] ?? "";
  } else if (page === "profile") {
    tab = typeof state.profile.openSetting === "string" ? state.profile.openSetting : "";
    tabLabel = ISSUE_REPORT_PROFILE_TAB_LABELS[tab] ?? "";
  }

  const context = {
    page,
    pageLabel,
    routeHash: formatTabRouteHash(page)
  };
  if (tab) {
    context.tab = tab;
  }
  if (tabLabel) {
    context.tabLabel = tabLabel;
  }
  if (detailLabel) {
    context.detailLabel = detailLabel;
  }
  return context;
}

function updateBodyModalState() {
  if (!runtimeDocument?.body) {
    return;
  }
  const hasOpenModal =
    state?.api?.issueReporting?.isOpen === true ||
    state?.api?.confirmation?.isOpen === true ||
    state?.api?.isTagPromotionModalOpen === true ||
    state?.api?.isTagsManageModalOpen === true ||
    state?.builder?.isSaveDraftModalOpen === true ||
    state?.builder?.isLoadDraftModalOpen === true;
  runtimeDocument.body.classList.toggle("has-modal-open", hasOpenModal);
}

function renderConfirmationModal() {
  if (!elements.confirmationModal) {
    return;
  }
  const confirmation = state?.api?.confirmation ?? createEmptyConfirmationState();
  elements.confirmationModal.hidden = confirmation.isOpen !== true;
  if (elements.confirmationTitle) {
    elements.confirmationTitle.textContent = confirmation.title || "Confirm Action";
  }
  if (elements.confirmationMessage) {
    elements.confirmationMessage.textContent = confirmation.message || "";
  }
  if (elements.confirmationCancel) {
    elements.confirmationCancel.textContent = confirmation.cancelLabel || "Cancel";
  }
  if (elements.confirmationConfirm) {
    elements.confirmationConfirm.textContent = confirmation.confirmLabel || "Confirm";
  }
  updateBodyModalState();
}

function settleConfirmation(result) {
  const resolver = _pendingConfirmationResolver;
  _pendingConfirmationResolver = null;
  state.api.confirmation = createEmptyConfirmationState();
  renderConfirmationModal();
  if (typeof resolver === "function") {
    resolver(result === true);
  }
}

function confirmAction({
  title = "Confirm Action",
  message = "Are you sure you want to continue?",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel"
} = {}) {
  if (!elements.confirmationModal) {
    return Promise.resolve(runtimeWindow.confirm(message));
  }
  if (_pendingConfirmationResolver) {
    settleConfirmation(false);
  }
  state.api.confirmation = {
    isOpen: true,
    title,
    message,
    confirmLabel,
    cancelLabel
  };
  renderConfirmationModal();
  runtimeWindow.setTimeout(() => {
    elements.confirmationConfirm?.focus();
  }, 0);
  return new Promise((resolve) => {
    _pendingConfirmationResolver = resolve;
  });
}

function getAuthenticatedReporterGameName() {
  const gameName = typeof state?.auth?.user?.gameName === "string" ? state.auth.user.gameName.trim() : "";
  const tagline = typeof state?.auth?.user?.tagline === "string" ? state.auth.user.tagline.trim() : "";
  if (gameName && tagline) {
    return `${gameName}#${tagline}`;
  }
  return gameName;
}

function seedIssueReportIdentityFields() {
  if (elements.issueReportEmail && !elements.issueReportEmail.value.trim()) {
    const sessionEmail = typeof state?.auth?.user?.email === "string" ? state.auth.user.email.trim() : "";
    if (sessionEmail) {
      elements.issueReportEmail.value = sessionEmail;
    }
  }
  if (elements.issueReportGameName && !elements.issueReportGameName.value.trim()) {
    const gameName = getAuthenticatedReporterGameName();
    if (gameName) {
      elements.issueReportGameName.value = gameName;
    }
  }
}

function resetIssueReportForm({ preserveIdentity = true } = {}) {
  if (elements.issueReportType) {
    elements.issueReportType.value = "bug";
  }
  if (elements.issueReportSubject) {
    elements.issueReportSubject.value = "";
  }
  if (elements.issueReportDescription) {
    elements.issueReportDescription.value = "";
  }
  if (!preserveIdentity) {
    if (elements.issueReportEmail) {
      elements.issueReportEmail.value = "";
    }
    if (elements.issueReportGameName) {
      elements.issueReportGameName.value = "";
    }
  }
  seedIssueReportIdentityFields();
}

function getFilteredAdminUsers() {
  const allUsers = Array.isArray(state.api.users) ? state.api.users : [];
  const search = state.api.usersSearch.trim().toLowerCase();
  const rawRoleFilter = typeof state.api.usersRoleFilter === "string" ? state.api.usersRoleFilter.trim().toLowerCase() : "";
  const roleFilter = rawRoleFilter ? normalizeApiUserRole(rawRoleFilter) : "";

  return allUsers.filter((user) => {
    if (roleFilter && user.role !== roleFilter) {
      return false;
    }
    if (!search) {
      return true;
    }
    const haystack = [
      user.email,
      user.riot_id,
      user.game_name,
      user.tagline,
      user.role
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });
}

function clearSelectedAdminUsers() {
  state.api.selectedUserIds = new Set();
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

function renderIssueReportingPanel() {
  if (!elements.issueReportPanel || !elements.issueReportModal) {
    return;
  }

  seedIssueReportIdentityFields();
  const issueReporting = state.api.issueReporting ?? createEmptyIssueReportingState();
  const fallbackUrl = issueReporting.fallbackUrl || DEFAULT_ISSUE_REPORTING_FALLBACK_URL;
  const sourceSummary = buildIssueSourceSummary(issueReporting.sourceContext);

  elements.issueReportModal.hidden = !issueReporting.isOpen;
  updateBodyModalState();

  if (elements.issueReportFallbackLink) {
    elements.issueReportFallbackLink.href = fallbackUrl;
    elements.issueReportFallbackLink.hidden = false;
  }

  if (elements.issueReportMeta) {
    if (issueReporting.isLoading) {
      elements.issueReportMeta.textContent = "Checking whether in-app issue submission is available...";
    } else if (issueReporting.enabled) {
      elements.issueReportMeta.textContent = `Issues submit directly to ${issueReporting.repository}. Include your email or game name so follow-up is possible.`;
    } else {
      elements.issueReportMeta.textContent = "Direct submission is unavailable on this deployment. Use the GitHub fallback link instead.";
    }
  }
  if (elements.issueReportSource) {
    elements.issueReportSource.textContent = sourceSummary
      ? `Opened from ${sourceSummary}.`
      : "Opened from DraftEngine.";
  }

  const canSubmit = issueReporting.enabled && !issueReporting.isLoading && !issueReporting.isSubmitting;
  for (const field of [
    elements.issueReportType,
    elements.issueReportEmail,
    elements.issueReportGameName,
    elements.issueReportSubject,
    elements.issueReportDescription
  ]) {
    if (field) {
      field.disabled = !canSubmit;
    }
  }
  if (elements.issueReportSubmit) {
    elements.issueReportSubmit.disabled = !canSubmit;
    elements.issueReportSubmit.textContent = issueReporting.isSubmitting ? "Submitting..." : "Submit Issue";
  }
  if (elements.issueReportCancel) {
    elements.issueReportCancel.disabled = issueReporting.isSubmitting;
  }
}

function openIssueReportingPanel() {
  state.api.issueReporting.sourceContext = captureIssueReportingSourceContext();
  state.api.issueReporting.isOpen = true;
  setIssueReportFeedback("");
  resetIssueReportForm();
  renderIssueReportingPanel();
  if (elements.issueReportSubject) {
    elements.issueReportSubject.focus();
  }
}

function closeIssueReportingPanel() {
  state.api.issueReporting.isOpen = false;
  state.api.issueReporting.isSubmitting = false;
  resetIssueReportForm();
  setIssueReportFeedback("");
  renderIssueReportingPanel();
}

async function loadIssueReportingStatusFromApi() {
  state.api.issueReporting.isLoading = true;
  renderIssueReportingPanel();
  try {
    const payload = await apiRequest("/issue-reporting");
    const normalized = normalizeIssueReportingConfig(payload?.issueReporting);
    state.api.issueReporting = {
      ...state.api.issueReporting,
      ...normalized,
      isLoading: false,
      isSubmitting: false
    };
    return true;
  } catch (_error) {
    state.api.issueReporting = {
      ...createEmptyIssueReportingState(),
      isLoading: false
    };
    return false;
  } finally {
    renderIssueReportingPanel();
  }
}

async function submitIssueReport() {
  const subject = elements.issueReportSubject ? elements.issueReportSubject.value.trim() : "";
  const description = elements.issueReportDescription ? elements.issueReportDescription.value.trim() : "";
  const reporterEmail = elements.issueReportEmail ? elements.issueReportEmail.value.trim() : "";
  const reporterGameName = elements.issueReportGameName ? elements.issueReportGameName.value.trim() : "";
  const type = elements.issueReportType ? elements.issueReportType.value : "bug";

  if (!subject) {
    setIssueReportFeedback("Title is required.");
    return;
  }
  if (!description) {
    setIssueReportFeedback("Description is required.");
    return;
  }
  if (!reporterEmail && !reporterGameName) {
    setIssueReportFeedback("Reporter email or game name is required.");
    return;
  }

  state.api.issueReporting.isSubmitting = true;
  setIssueReportFeedback("Submitting issue...");
  renderIssueReportingPanel();

  try {
    const payload = await apiRequest("/issue-reporting/issues", {
      method: "POST",
      auth: isAuthenticated(),
      body: {
        title: subject,
        description,
        type,
        reporterEmail,
        reporterGameName,
        sourceContext: state.api.issueReporting.sourceContext
      }
    });
    const issueUrl = typeof payload?.issue?.url === "string" ? payload.issue.url.trim() : "";
    state.api.issueReporting.lastIssueUrl = issueUrl;
    setIssueReportFeedback(
      issueUrl
        ? `Issue submitted successfully. ${issueUrl}`
        : "Issue submitted successfully."
    );
    resetIssueReportForm();
  } catch (error) {
    const fallbackUrl =
      typeof error?.payload?.error?.details?.fallback_url === "string" && error.payload.error.details.fallback_url.trim() !== ""
        ? error.payload.error.details.fallback_url.trim()
        : state.api.issueReporting.fallbackUrl;
    if (fallbackUrl && elements.issueReportFallbackLink) {
      elements.issueReportFallbackLink.href = fallbackUrl;
    }
    setIssueReportFeedback(normalizeApiErrorMessage(error, "Failed to submit issue."));
  } finally {
    state.api.issueReporting.isSubmitting = false;
    renderIssueReportingPanel();
  }
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
    const userIdSet = new Set(users.map((user) => user.id));
    state.api.selectedUserIds = new Set(
      [...(state.api.selectedUserIds instanceof Set ? state.api.selectedUserIds : new Set())]
        .filter((userId) => userIdSet.has(userId))
    );
    setUsersFeedback("");
    return true;
  } catch (error) {
    state.api.users = [];
    clearSelectedAdminUsers();
    setUsersFeedback(normalizeApiErrorMessage(error, "Failed to load users."));
    return false;
  } finally {
    state.api.isLoadingUsers = false;
    renderUsersWorkspace();
  }
}

async function loadChampionCoreFromApi() {
  if (!isAuthenticated() || !isAdminUser()) {
    state.api.championCore = [];
    state.api.isLoadingChampionCore = false;
    setChampionCoreFeedback("");
    return false;
  }

  state.api.isLoadingChampionCore = true;
  renderChampionCoreWorkspace();
  try {
    const payload = await apiRequest("/admin/champion-core", { auth: true });
    state.api.championCore = Array.isArray(payload?.champions)
      ? payload.champions.map(normalizeChampionCoreRow).filter(Boolean)
      : [];
    setChampionCoreFeedback("");
    return true;
  } catch (error) {
    state.api.championCore = [];
    setChampionCoreFeedback(normalizeApiErrorMessage(error, "Failed to load champion core data."));
    return false;
  } finally {
    state.api.isLoadingChampionCore = false;
    renderChampionCoreWorkspace();
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
  const existingUser = Array.isArray(state.api.users)
    ? state.api.users.find((candidate) => candidate.id === userId) ?? null
    : null;
  const currentRole = normalizeApiUserRole(existingUser?.role);
  const currentStoredRole = normalizeApiUserRole(existingUser?.stored_role ?? existingUser?.role);
  if (currentRole === normalizedRole && currentStoredRole === normalizedRole) {
    return;
  }
  const userLabel = buildIdentityLabel(existingUser, existingUser?.email ?? `user #${userId}`);
  const confirmed = await confirmAction({
    title: "Confirm Permission Change",
    message: `Change ${userLabel} permissions from ${currentRole} to ${normalizedRole}?`,
    confirmLabel: "Apply Permission"
  });
  if (!confirmed) {
    if (elements.usersList) {
      renderUsersWorkspace();
    }
    return;
  }
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
    state.api.selectedUserIds.delete(userId);
    setUsersFeedback("User permissions saved.");
  } catch (error) {
    setUsersFeedback(normalizeApiErrorMessage(error, "Failed to update user permissions."));
  } finally {
    state.api.savingUserRoleId = null;
    renderUsersWorkspace();
  }
}

async function applyBulkUserRoleFromWorkspace() {
  if (!isAuthenticated() || !isAdminUser()) {
    return;
  }

  const selectedIds = [...(state.api.selectedUserIds instanceof Set ? state.api.selectedUserIds : new Set())]
    .filter((userId) => Number.isInteger(userId) && userId > 0);
  if (selectedIds.length < 1) {
    setUsersFeedback("Select at least one user first.");
    return;
  }

  const normalizedRole = normalizeApiUserRole(state.api.bulkUserRole);
  const confirmed = await confirmAction({
    title: "Confirm Bulk Permission Change",
    message: `Apply ${normalizedRole} to ${selectedIds.length} selected user${selectedIds.length === 1 ? "" : "s"}?`,
    confirmLabel: "Apply Permissions"
  });
  if (!confirmed) {
    return;
  }
  state.api.isBulkSavingUserRoles = true;
  setUsersFeedback(`Applying '${normalizedRole}' to ${selectedIds.length} user${selectedIds.length === 1 ? "" : "s"}...`);
  renderUsersWorkspace();

  const failures = [];
  for (const userId of selectedIds) {
    const user = state.api.users.find((candidate) => candidate.id === userId);
    if (!user || user.is_owner_admin === true) {
      continue;
    }
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
    } catch (error) {
      failures.push(`${user.email}: ${normalizeApiErrorMessage(error, "Failed to update user permissions.")}`);
    }
  }

  clearSelectedAdminUsers();
  state.api.isBulkSavingUserRoles = false;
  setUsersFeedback(
    failures.length > 0
      ? `Bulk update completed with ${failures.length} failure${failures.length === 1 ? "" : "s"}. ${failures.join(" | ")}`
      : `Applied '${normalizedRole}' to selected users.`
  );
  renderUsersWorkspace();
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
  const confirmed = await confirmAction({
    title: "Confirm User Deletion",
    message: `Delete ${userLabel}? This permanently removes the account and dependent records.`,
    confirmLabel: "Delete User"
  });
  if (!confirmed) {
    return;
  }
  state.api.deletingUserId = userId;
  setUsersFeedback(`Deleting ${userLabel}...`);
  renderUsersWorkspace();

  try {
    await apiRequest(`/admin/users/${userId}`, {
      method: "DELETE",
      auth: true
    });
    state.api.users = state.api.users.filter((candidate) => candidate.id !== userId);
    state.api.selectedUserIds.delete(userId);
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
  const rolePermissionSets = new Map(
    combinedRoles.map((role) => [role.key, new Set(Array.isArray(combinedAssignments[role.key]) ? combinedAssignments[role.key] : [])])
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

  const SCOPED_PERMISSION_RESOURCE_LABELS = Object.freeze({
    tag_definitions: "Tag Definitions",
    champion_tags: "Champion Tags",
    champion_metadata: "Champion Metadata",
    requirements: "Requirements",
    compositions: "Compositions"
  });
  const parseScopedPermissionId = (permissionId) => {
    const parts = String(permissionId ?? "").split(".");
    if (parts.length !== 3) {
      return null;
    }
    const [resourceId, action, scope] = parts;
    if (!Object.prototype.hasOwnProperty.call(SCOPED_PERMISSION_RESOURCE_LABELS, resourceId)) {
      return null;
    }
    if ((action !== "read" && action !== "write") || (scope !== "self" && scope !== "team" && scope !== "global")) {
      return null;
    }
    return {
      resourceId,
      action,
      scope
    };
  };
  const formatGrantedRoleLabels = (roles) => {
    const labels = [...new Set((Array.isArray(roles) ? roles : []).map((role) => role.label || role.id).filter(Boolean))];
    return labels.length > 0 ? labels.join(", ") : "no roles";
  };
  const createScopedAccessCard = (title, scopedPermissions) => {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card users-authz-block";
    const scopedResourceIds = [...scopedPermissions.keys()];
    card.append(
      createBlockHeader(
        title,
        scopedResourceIds.length,
        "Effective access is the union of a user's global role and, when applicable, their team membership role on a team."
      )
    );
    if (scopedResourceIds.length === 0) {
      card.append(createMetaParagraph("No scoped permissions defined."));
      return card;
    }

    const scopeLabels = {
      self: "Self",
      team: "Team",
      global: "All"
    };
    const resourceGrid = runtimeDocument.createElement("div");
    resourceGrid.className = "users-authz-role-grid";

    scopedResourceIds.sort((left, right) => {
      const leftLabel = SCOPED_PERMISSION_RESOURCE_LABELS[left] ?? left;
      const rightLabel = SCOPED_PERMISSION_RESOURCE_LABELS[right] ?? right;
      return leftLabel.localeCompare(rightLabel);
    });

    for (const resourceId of scopedResourceIds) {
      const resourceSummary = scopedPermissions.get(resourceId);
      const resourceCard = runtimeDocument.createElement("article");
      resourceCard.className = "users-authz-role-card";
      const heading = runtimeDocument.createElement("strong");
      heading.textContent = SCOPED_PERMISSION_RESOURCE_LABELS[resourceId] ?? resourceId;
      resourceCard.append(heading);
      for (const scope of ["self", "team", "global"]) {
        const scopeSummary = resourceSummary?.[scope] ?? {};
        const copy = runtimeDocument.createElement("p");
        copy.className = "meta";
        copy.textContent = `${scopeLabels[scope]}: Read by ${formatGrantedRoleLabels(scopeSummary.read)}. Write by ${formatGrantedRoleLabels(scopeSummary.write)}.`;
        resourceCard.append(copy);
      }
      resourceGrid.append(resourceCard);
    }

    card.append(resourceGrid);
    return card;
  };

  const scopedPermissionsByResource = permissions.reduce((acc, permission) => {
    const parsedPermission = parseScopedPermissionId(permission.id);
    if (!parsedPermission) {
      return acc;
    }
    if (!acc.has(parsedPermission.resourceId)) {
      acc.set(parsedPermission.resourceId, {
        self: { read: [], write: [] },
        team: { read: [], write: [] },
        global: { read: [], write: [] }
      });
    }
    const grantedRoles = combinedRoles.filter((role) => (rolePermissionSets.get(role.key) ?? new Set()).has(permission.id));
    acc.get(parsedPermission.resourceId)[parsedPermission.scope][parsedPermission.action] = grantedRoles;
    return acc;
  }, new Map());
  if (scopedPermissionsByResource.size > 0) {
    elements.usersAuthorizationPermissions.hidden = false;
    elements.usersAuthorizationPermissions.append(createScopedAccessCard("Scoped Access", scopedPermissionsByResource));
  }

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
  if (elements.usersSearch && elements.usersSearch.value !== state.api.usersSearch) {
    elements.usersSearch.value = state.api.usersSearch;
  }
  if (elements.usersRoleFilter && elements.usersRoleFilter.value !== state.api.usersRoleFilter) {
    elements.usersRoleFilter.value = state.api.usersRoleFilter;
  }
  if (elements.usersBulkRole && elements.usersBulkRole.value !== state.api.bulkUserRole) {
    elements.usersBulkRole.value = state.api.bulkUserRole;
  }

  const selectedUserCount = state.api.selectedUserIds instanceof Set ? state.api.selectedUserIds.size : 0;
  const toolbarDisabled = !isAuthenticated() || !isAdminUser() || state.api.isLoadingUsers;
  if (elements.usersSearch) {
    elements.usersSearch.disabled = toolbarDisabled;
  }
  if (elements.usersRoleFilter) {
    elements.usersRoleFilter.disabled = toolbarDisabled;
  }
  if (elements.usersBulkRole) {
    elements.usersBulkRole.disabled = toolbarDisabled || state.api.isBulkSavingUserRoles;
  }
  if (elements.usersBulkApply) {
    elements.usersBulkApply.disabled = toolbarDisabled || state.api.isBulkSavingUserRoles || selectedUserCount < 1;
    elements.usersBulkApply.textContent = state.api.isBulkSavingUserRoles ? "Applying..." : "Apply to Selected";
  }
  if (elements.usersSelectionClear) {
    elements.usersSelectionClear.disabled = toolbarDisabled || selectedUserCount < 1 || state.api.isBulkSavingUserRoles;
  }
  if (elements.usersSelectionMeta) {
    elements.usersSelectionMeta.textContent = selectedUserCount > 0
      ? `${selectedUserCount} user${selectedUserCount === 1 ? "" : "s"} selected for bulk role changes.`
      : "Select users to apply the same role change in one pass.";
  }

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
  const filteredUsers = getFilteredAdminUsers();
  elements.usersAccess.textContent = `${filteredUsers.length} of ${users.length} users shown.`;
  if (users.length === 0) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "No users found.";
    elements.usersList.append(empty);
    return;
  }
  if (filteredUsers.length === 0) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "No users match the current search/filter.";
    elements.usersList.append(empty);
    return;
  }

  for (const user of filteredUsers) {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card";
    card.dataset.userId = String(user.id);
    const isSavingRole = state.api.savingUserRoleId === user.id;
    const isSavingRiotId = state.api.savingUserRiotIdId === user.id;
    const isDeletingUser = state.api.deletingUserId === user.id;
    const isSavingAnyUserAction = isSavingRole || isSavingRiotId || isDeletingUser || state.api.isBulkSavingUserRoles;
    const isOwnerAdmin = user.is_owner_admin === true;
    const ownerStoredRole = normalizeApiUserRole(user.stored_role);
    const ownerRoleNeedsSync = isOwnerAdmin && ownerStoredRole !== "admin";
    const isSelected = state.api.selectedUserIds instanceof Set && state.api.selectedUserIds.has(user.id);

    const title = runtimeDocument.createElement("strong");
    title.textContent = user.email;

    const riot = runtimeDocument.createElement("p");
    riot.className = "meta";
    riot.textContent = user.riot_id ? `Riot ID: ${user.riot_id}` : "Riot ID: not set";

    const selectionLabel = runtimeDocument.createElement("label");
    selectionLabel.className = "inline-checkbox user-selection-toggle";
    const selectionCheckbox = runtimeDocument.createElement("input");
    selectionCheckbox.type = "checkbox";
    selectionCheckbox.checked = isSelected;
    selectionCheckbox.disabled = isOwnerAdmin || isSavingAnyUserAction;
    selectionCheckbox.dataset.userId = String(user.id);
    selectionCheckbox.setAttribute("aria-label", `Select ${user.email} for bulk role changes`);
    selectionCheckbox.addEventListener("change", () => {
      if (!(state.api.selectedUserIds instanceof Set)) {
        state.api.selectedUserIds = new Set();
      }
      if (selectionCheckbox.checked) {
        state.api.selectedUserIds.add(user.id);
      } else {
        state.api.selectedUserIds.delete(user.id);
      }
      renderUsersWorkspace();
    });
    selectionLabel.append(selectionCheckbox, runtimeDocument.createTextNode("Select for bulk role change"));

    const roleLabel = runtimeDocument.createElement("label");
    roleLabel.className = "meta";
    roleLabel.textContent = "Permissions";

    const roleSelect = runtimeDocument.createElement("select");
    const options = isOwnerAdmin
      ? [{ value: "admin", label: "admin" }]
      : [
          { value: "member", label: "member" },
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
    card.append(selectionLabel, title, riot, roleLabel);
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

function renderChampionCoreWorkspace() {
  if (!elements.championCoreList || !elements.championCoreAccess) {
    return;
  }

  elements.championCoreList.innerHTML = "";

  if (elements.championCoreSearch && elements.championCoreSearch.value !== state.api.championCoreSearch) {
    elements.championCoreSearch.value = state.api.championCoreSearch;
  }
  if (elements.championCoreRefresh) {
    elements.championCoreRefresh.disabled = !isAuthenticated() || !isAdminUser() || state.api.isLoadingChampionCore;
    elements.championCoreRefresh.textContent = state.api.isLoadingChampionCore ? "Refreshing..." : "Refresh";
  }

  if (!isAuthenticated()) {
    elements.championCoreAccess.textContent = "Sign in to access champion core.";
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "Champion Core is available to admins only.";
    elements.championCoreList.append(empty);
    return;
  }

  if (!isAdminUser()) {
    elements.championCoreAccess.textContent = "Champion Core is admin-only.";
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "Your account does not have admin access.";
    elements.championCoreList.append(empty);
    return;
  }

  if (state.api.isLoadingChampionCore) {
    elements.championCoreAccess.textContent = "Loading champion core rows...";
    return;
  }

  const rows = getFilteredChampionCoreRows();
  const totalRows = Array.isArray(state.api.championCore) ? state.api.championCore.length : 0;
  elements.championCoreAccess.textContent = `${rows.length} of ${totalRows} champion core rows shown.`;

  if (rows.length === 0) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = totalRows === 0 ? "No champion core rows found." : "No champion core rows match the current search.";
    elements.championCoreList.append(empty);
    return;
  }

  for (const champion of rows) {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card";

    const title = runtimeDocument.createElement("strong");
    title.textContent = champion.name;

    const identity = runtimeDocument.createElement("p");
    identity.className = "meta";
    identity.textContent = `Riot ID ${champion.riot_champion_id} | Data Dragon ${champion.ddragon_id} | normalized ${champion.normalized_name}`;

    const tagRow = runtimeDocument.createElement("div");
    tagRow.className = "chip-row";
    for (const tag of champion.riot_tags) {
      const chip = runtimeDocument.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = tag;
      tagRow.append(chip);
    }

    const factualSummary = runtimeDocument.createElement("p");
    factualSummary.className = "meta";
    const attackProfile = Number(champion.attackrange) > 200 ? "Ranged" : "Melee";
    factualSummary.textContent =
      `${attackProfile} (${champion.attackrange}) | ${champion.resource_type ?? "No resource"} | ` +
      `HP ${champion.hp} | Armor ${champion.armor} | Move ${champion.movespeed}`;

    const detailPanel = runtimeDocument.createElement("details");
    detailPanel.className = "user-detail-panel";
    const detailSummary = runtimeDocument.createElement("summary");
    detailSummary.textContent = "Raw row";
    const rawPre = runtimeDocument.createElement("pre");
    rawPre.className = "champion-core-json";
    rawPre.textContent = JSON.stringify(champion, null, 2);
    detailPanel.append(detailSummary, rawPre);

    card.append(title, identity, tagRow, factualSummary, detailPanel);
    elements.championCoreList.append(card);
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
    rules,
    scope: normalizeChampionTagScope(rawRequirement.scope),
    team_id: normalizeTeamEntityId(rawRequirement.team_id),
    updated_by_user_id: normalizeApiEntityId(rawRequirement.updated_by_user_id),
    updated_by_display_name:
      typeof rawRequirement.updated_by_display_name === "string" ? rawRequirement.updated_by_display_name.trim() : "",
    updated_at: typeof rawRequirement.updated_at === "string" ? rawRequirement.updated_at : ""
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
    is_active: rawComposition.is_active === true,
    scope: normalizeChampionTagScope(rawComposition.scope),
    team_id: normalizeTeamEntityId(rawComposition.team_id),
    updated_by_user_id: normalizeApiEntityId(rawComposition.updated_by_user_id),
    updated_by_display_name:
      typeof rawComposition.updated_by_display_name === "string" ? rawComposition.updated_by_display_name.trim() : "",
    updated_at: typeof rawComposition.updated_at === "string" ? rawComposition.updated_at : ""
  };
}

function normalizeChampionCoreRow(rawChampion) {
  if (!rawChampion || typeof rawChampion !== "object" || Array.isArray(rawChampion)) {
    return null;
  }
  const id = normalizeApiEntityId(rawChampion.id);
  const name = typeof rawChampion.name === "string" ? rawChampion.name.trim() : "";
  const normalizedName = typeof rawChampion.normalized_name === "string" ? rawChampion.normalized_name.trim() : "";
  const ddragonId = typeof rawChampion.ddragon_id === "string" ? rawChampion.ddragon_id.trim() : "";
  const riotChampionId = Number.parseInt(String(rawChampion.riot_champion_id ?? ""), 10);
  if (!id || !name || !normalizedName || !ddragonId || !Number.isInteger(riotChampionId)) {
    return null;
  }

  return {
    ...rawChampion,
    id,
    name,
    normalized_name: normalizedName,
    ddragon_id: ddragonId,
    riot_champion_id: riotChampionId,
    riot_tags: Array.isArray(rawChampion.riot_tags) ? rawChampion.riot_tags.filter((value) => typeof value === "string") : []
  };
}

function getFilteredChampionCoreRows() {
  const rows = Array.isArray(state.api.championCore) ? state.api.championCore : [];
  const query = String(state.api.championCoreSearch ?? "").trim().toLowerCase();
  if (!query) {
    return rows;
  }

  return rows.filter((champion) => {
    const haystack = [
      champion.name,
      champion.normalized_name,
      champion.ddragon_id,
      String(champion.riot_champion_id),
      ...(Array.isArray(champion.riot_tags) ? champion.riot_tags : [])
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
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

function normalizeChampionCompositionSynergiesFromMetadata(rawValue) {
  const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const definition = typeof source.definition === "string" ? source.definition.trim() : "";
  const rules = Array.isArray(source.rules)
    ? source.rules
        .filter((rule) => rule && typeof rule === "object" && !Array.isArray(rule))
        .map((rule) => JSON.parse(JSON.stringify(rule)))
    : [];
  return {
    definition,
    rules
  };
}

function normalizeChampionCompositionSynergyDraft(rawValue) {
  const normalized = normalizeChampionCompositionSynergiesFromMetadata(rawValue);
  return {
    definition: normalized.definition,
    rules: normalized.rules.map((rule) => createRequirementRuleClauseDraft(rule))
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

function parseRequirementRulesFromDraftClauses(rawRules = null) {
  const rules = Array.isArray(rawRules)
    ? rawRules
    : Array.isArray(state.api.requirementDefinitionDraft.rules)
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
    state.api.isSavingCompositionBundle || state.api.isLoadingCompositionBundles || !canWriteCompositionCatalogScope();

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
  const controlsDisabled = state.api.isSavingRequirementDefinition || !canWriteCompositionCatalogScope();

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

  renderCompositionCatalogScopeControls();
  syncRequirementDefinitionInputsFromState();
  renderRequirementClauseEditor();

  const isEditing = Boolean(normalizeApiEntityId(state.api.selectedRequirementDefinitionId));
  const isEditorOpen = state.api.isRequirementDefinitionEditorOpen === true;
  const controlsDisabled = state.api.isSavingRequirementDefinition || !canWriteCompositionCatalogScope();
  const scopeContext = getCompositionCatalogScopeRequestContext();
  const scopeLabel =
    getCompositionCatalogScopeOptions().find((option) => option.value === scopeContext.scope)?.label ?? "Global";
  if (elements.requirementsMeta) {
    elements.requirementsMeta.textContent =
      scopeContext.scope === "team" && scopeContext.teamId
        ? `Define reusable requirement clauses for ${scopeLabel.toLowerCase()} scope (${getTeamDisplayLabel(scopeContext.teamId)}).`
        : `Define reusable requirement clauses for ${scopeLabel.toLowerCase()} scope.`;
  }
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

  if (elements.requirementsTourCallout) {
    elements.requirementsTourCallout.hidden = !state.ui.showGettingStarted || state.ui.gettingStartedDismissed;
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
    empty.textContent = "No requirement definitions in this scope yet.";
    elements.requirementsList.append(empty);
    return;
  }

  for (const requirement of requirements) {
    const card = runtimeDocument.createElement("article");
    card.className = "comp-card";

    const titleRow = runtimeDocument.createElement("div");
    titleRow.className = "comp-card-header";
    const title = runtimeDocument.createElement("strong");
    title.className = "comp-card-name";
    title.textContent = requirement.name;
    titleRow.append(title);

    if (canWriteCompositionCatalogScope()) {
      const editBtn = runtimeDocument.createElement("button");
      editBtn.type = "button";
      editBtn.className = "clause-edit-btn";
      editBtn.title = `Edit ${requirement.name}`;
      editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';
      editBtn.disabled = state.api.isSavingRequirementDefinition;
      editBtn.addEventListener("click", () => {
        openRequirementEditorModal(requirement);
      });
      titleRow.append(editBtn);
    }
    card.append(titleRow);

    if (requirement.definition) {
      const defEl = runtimeDocument.createElement("p");
      defEl.className = "meta comp-card-desc";
      defEl.textContent = requirement.definition;
      card.append(defEl);
    }

    const clauses = Array.isArray(requirement.rules) ? requirement.rules : [];
    if (clauses.length > 0) {
      const clauseList = runtimeDocument.createElement("ul");
      clauseList.className = "req-clause-list";
      for (const [idx, rule] of clauses.entries()) {
        const clauseDraft = createRequirementRuleClauseDraft(rule);
        const exprSummary = formatRequirementClauseExpressionSummary(clauseDraft);
        const minCount = Number.parseInt(String(clauseDraft.minCount), 10) || 1;
        const maxCountRaw = String(clauseDraft.maxCount ?? "").trim();
        const maxLabel = maxCountRaw === "" ? "no max" : `max ${maxCountRaw}`;
        const roleFilterCount = normalizeRequirementRoleFilter(clauseDraft.roleFilter).length;
        const separateCount = normalizeRequirementClauseReferenceIds(clauseDraft.separateFrom).length;

        const li = runtimeDocument.createElement("li");
        li.className = "clause-popover-anchor";

        const label = runtimeDocument.createElement("span");
        label.className = "req-clause-label";
        label.textContent = `Clause ${idx + 1}`;
        label.style.cursor = "help";
        li.append(label);

        const popoverCard = runtimeDocument.createElement("div");
        popoverCard.className = "clause-popover";
        const popoverInner = runtimeDocument.createElement("div");
        popoverInner.className = "clause-popover-item";
        const heading = runtimeDocument.createElement("strong");
        heading.textContent = `Clause ${idx + 1}`;
        popoverInner.append(heading);
        const detail = runtimeDocument.createElement("div");
        detail.className = "clause-popover-detail clause-popover-expr";
        const terms = normalizeRequirementClauseTerms(clauseDraft.terms);
        const termJoiners = normalizeRequirementClauseTermJoiners(clauseDraft.termJoiners, terms.length);
        for (let ti = 0; ti < terms.length; ti++) {
          if (ti > 0) {
            const joinerEl = runtimeDocument.createElement("span");
            joinerEl.className = "clause-popover-joiner";
            joinerEl.textContent = normalizeRequirementJoiner(termJoiners[ti - 1], "and").toUpperCase();
            detail.append(joinerEl);
          }
          const termEl = runtimeDocument.createElement("span");
          termEl.className = "clause-popover-term";
          termEl.textContent = formatRequirementClauseTermSummary(terms[ti]);
          detail.append(termEl);
        }
        if (terms.length === 0) {
          const emptyEl = runtimeDocument.createElement("span");
          emptyEl.className = "clause-popover-term";
          emptyEl.textContent = "No conditions selected.";
          detail.append(emptyEl);
        }
        popoverInner.append(detail);
        const constraints = [];
        constraints.push(`min ${minCount}`);
        constraints.push(maxLabel);
        if (roleFilterCount > 0) constraints.push(`${roleFilterCount} role filter${roleFilterCount === 1 ? "" : "s"}`);
        if (separateCount > 0) constraints.push(`separate from ${separateCount} clause${separateCount === 1 ? "" : "s"}`);
        const constraintEl = runtimeDocument.createElement("span");
        constraintEl.className = "clause-popover-constraints";
        constraintEl.textContent = constraints.join(" \u00b7 ");
        popoverInner.append(constraintEl);
        popoverCard.append(popoverInner);
        // Append popover to body on hover to avoid overflow clipping
        li.addEventListener("mouseenter", () => {
          const rect = li.getBoundingClientRect();
          popoverCard.style.position = "fixed";
          popoverCard.style.left = `${rect.right + 8}px`;
          popoverCard.style.top = `${rect.top}px`;
          runtimeDocument.body.append(popoverCard);
          popoverCard.style.display = "block";
        });
        li.addEventListener("mouseleave", () => {
          popoverCard.style.display = "none";
          popoverCard.remove();
        });
        clauseList.append(li);
      }
      card.append(clauseList);
    } else {
      const emptyClause = runtimeDocument.createElement("span");
      emptyClause.className = "req-clause-count";
      emptyClause.textContent = "No clauses";
      card.append(emptyClause);
    }

    const audit = formatAuditMeta(
      "Last edited",
      requirement.updated_by_user_id,
      requirement.updated_by_display_name,
      requirement.updated_at
    );
    if (audit) {
      const auditEl = runtimeDocument.createElement("p");
      auditEl.className = "meta";
      auditEl.style.margin = "0";
      auditEl.textContent = audit;
      card.append(auditEl);
    }

    elements.requirementsList.append(card);
  }
}

function renderCompositionBundlesWorkspace() {
  if (!elements.compositionsList) {
    return;
  }

  renderCompositionCatalogScopeControls();
  syncCompositionBundleInputsFromState();
  renderCompositionRequirementOptions();

  const isEditing = Boolean(normalizeApiEntityId(state.api.selectedCompositionBundleId));
  const controlsDisabled = state.api.isSavingCompositionBundle || !canWriteCompositionCatalogScope();
  const scopeContext = getCompositionCatalogScopeRequestContext();
  const scopeLabel =
    getCompositionCatalogScopeOptions().find((option) => option.value === scopeContext.scope)?.label ?? "Global";
  if (elements.compositionsMeta) {
    elements.compositionsMeta.textContent =
      scopeContext.scope === "team" && scopeContext.teamId
        ? `Group requirement definitions into reusable named composition bundles for ${getTeamDisplayLabel(scopeContext.teamId)}.`
        : `Group requirement definitions into reusable named composition bundles for ${scopeLabel.toLowerCase()} scope.`;
  }
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

  if (elements.compositionsTourCallout) {
    elements.compositionsTourCallout.hidden = !state.ui.showGettingStarted || state.ui.gettingStartedDismissed;
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
    empty.textContent = "No compositions in this scope yet.";
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
    card.className = `comp-card${composition.is_active ? " is-active" : ""}`;

    const titleRow = runtimeDocument.createElement("div");
    titleRow.className = "comp-card-header";
    const title = runtimeDocument.createElement("strong");
    title.className = "comp-card-name";
    title.textContent = composition.name;
    titleRow.append(title);

    if (canWriteCompositionCatalogScope()) {
      const editBtn = runtimeDocument.createElement("button");
      editBtn.type = "button";
      editBtn.className = "clause-edit-btn";
      editBtn.title = `Edit ${composition.name}`;
      editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';
      editBtn.disabled = state.api.isSavingCompositionBundle;
      editBtn.addEventListener("click", () => {
        openCompositionEditorModal(composition);
      });
      titleRow.append(editBtn);
    }

    card.append(titleRow);

    if (composition.description) {
      const desc = runtimeDocument.createElement("p");
      desc.className = "meta comp-card-desc";
      desc.textContent = composition.description;
      card.append(desc);
    }

    if (composition.requirement_ids.length > 0) {
      const pillRow = runtimeDocument.createElement("div");
      pillRow.className = "comp-card-pills";
      for (const reqId of composition.requirement_ids) {
        const reqDef = requirementById.get(reqId);
        const pill = runtimeDocument.createElement("span");
        pill.className = "clause-champ-pill";
        pill.textContent = reqDef?.name ?? `Req ${reqId}`;
        if (reqDef) {
          pill.title = reqDef.definition || reqDef.name;
        }
        pillRow.append(pill);
      }
      card.append(pillRow);
    } else {
      const noneText = runtimeDocument.createElement("p");
      noneText.className = "meta";
      noneText.textContent = "No requirements";
      card.append(noneText);
    }

    const statusRow = runtimeDocument.createElement("div");
    statusRow.className = "comp-card-status";
    const dot = runtimeDocument.createElement("span");
    dot.className = `clause-dot ${composition.is_active ? "is-passed" : ""}`;
    dot.textContent = "\u25CF";
    if (!composition.is_active) {
      dot.style.color = "var(--muted)";
    }
    const statusText = runtimeDocument.createElement("span");
    statusText.className = "meta";
    statusText.style.margin = "0";
    statusText.textContent = composition.is_active ? "Active" : "Inactive";
    statusRow.append(dot, statusText);
    card.append(statusRow);

    elements.compositionsList.append(card);
  }
}

function openCompositionEditorModal(composition = null) {
  closeDraftModal();
  const isEditing = Boolean(composition);
  const snapshotDraft = JSON.parse(JSON.stringify(state.api.compositionBundleDraft));
  const snapshotSelectedId = state.api.selectedCompositionBundleId;

  if (isEditing) {
    setCompositionBundleDraft(composition);
  } else {
    setCompositionBundleDraft(null);
  }
  const draftAtOpen = JSON.stringify(state.api.compositionBundleDraft);

  const overlay = runtimeDocument.createElement("div");
  overlay.className = "draft-modal-overlay";

  const dialog = runtimeDocument.createElement("div");
  dialog.className = "draft-modal";

  const header = runtimeDocument.createElement("div");
  header.className = "draft-modal-header";
  const title = runtimeDocument.createElement("h3");
  title.textContent = isEditing ? `Edit Composition — ${composition.name}` : "Create Composition";
  const close = runtimeDocument.createElement("button");
  close.type = "button";
  close.className = "draft-modal-close";
  close.textContent = "\u00D7";
  header.append(title, close);

  const body = runtimeDocument.createElement("div");
  body.className = "draft-modal-body";

  const nameLabel = runtimeDocument.createElement("label");
  nameLabel.textContent = "Name";
  const nameInput = runtimeDocument.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "e.g. Teamfight Core";
  nameInput.value = state.api.compositionBundleDraft.name;
  nameInput.addEventListener("input", () => {
    state.api.compositionBundleDraft.name = nameInput.value;
  });
  nameLabel.append(runtimeDocument.createElement("br"), nameInput);

  const descLabel = runtimeDocument.createElement("label");
  descLabel.textContent = "Description";
  const descInput = runtimeDocument.createElement("input");
  descInput.type = "text";
  descInput.placeholder = "Optional context for this bundle";
  descInput.value = state.api.compositionBundleDraft.description;
  descInput.addEventListener("input", () => {
    state.api.compositionBundleDraft.description = descInput.value;
  });
  descLabel.append(runtimeDocument.createElement("br"), descInput);

  const activeLabel = runtimeDocument.createElement("label");
  activeLabel.className = "inline-checkbox";
  const activeCheckbox = runtimeDocument.createElement("input");
  activeCheckbox.type = "checkbox";
  activeCheckbox.checked = state.api.compositionBundleDraft.isActive === true;
  activeCheckbox.addEventListener("change", () => {
    state.api.compositionBundleDraft.isActive = activeCheckbox.checked;
  });
  const activeText = runtimeDocument.createElement("span");
  activeText.textContent = " Set as active composition";
  activeLabel.append(activeCheckbox, activeText);

  const reqSection = runtimeDocument.createElement("div");
  const reqTitle = runtimeDocument.createElement("p");
  reqTitle.className = "meta";
  reqTitle.textContent = "Included requirement definitions";
  const reqOptionsContainer = runtimeDocument.createElement("div");
  reqOptionsContainer.className = "excluded-options";
  reqSection.append(reqTitle, reqOptionsContainer);

  renderCompositionRequirementOptionsInContainer(reqOptionsContainer);

  const feedbackEl = runtimeDocument.createElement("p");
  feedbackEl.className = "meta";

  body.append(nameLabel, descLabel, activeLabel, reqSection, feedbackEl);

  const footer = runtimeDocument.createElement("div");
  footer.className = "draft-modal-footer";

  const deleteBtn = runtimeDocument.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "ghost";
  deleteBtn.style.color = "var(--warn)";
  deleteBtn.textContent = "Delete";
  deleteBtn.hidden = !isEditing;
  deleteBtn.addEventListener("click", async () => {
    const confirmed = await showUSSConfirm({
      title: "Delete Composition",
      body: `Delete composition '${composition?.name ?? ""}'? This cannot be undone.`,
      affirmLabel: "Delete",
      cancelLabel: "Keep",
      destructive: true
    });
    if (!confirmed) return;
    state.api.isSavingCompositionBundle = true;
    feedbackEl.textContent = "Deleting...";
    try {
      await apiRequest(`/compositions/${composition.id}`, { method: "DELETE", auth: true });
      setCompositionBundleDraft(null);
      await loadCompositionBundlesFromApi();
      overlay.remove();
      renderCompositionBundlesWorkspace();
    } catch (error) {
      feedbackEl.textContent = normalizeApiErrorMessage(error, "Failed to delete.");
    } finally {
      state.api.isSavingCompositionBundle = false;
    }
  });

  const cancelBtn = runtimeDocument.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "ghost";
  cancelBtn.textContent = "Cancel";

  const saveBtn = runtimeDocument.createElement("button");
  saveBtn.type = "button";
  saveBtn.textContent = isEditing ? "Update" : "Create";

  async function handleClose() {
    const isDirty = JSON.stringify(state.api.compositionBundleDraft) !== draftAtOpen;
    if (isDirty) {
      const confirmed = await showUSSConfirm({
        title: "Unsaved Changes",
        body: "You have unsaved composition edits. Discard them?",
        affirmLabel: "Discard",
        cancelLabel: "Keep Editing",
        destructive: true
      });
      if (!confirmed) return;
    }
    state.api.compositionBundleDraft = JSON.parse(JSON.stringify(snapshotDraft));
    state.api.selectedCompositionBundleId = snapshotSelectedId;
    overlay.remove();
  }

  close.addEventListener("click", handleClose);
  cancelBtn.addEventListener("click", handleClose);
  overlay.addEventListener("click", (evt) => {
    if (evt.target === overlay) handleClose();
  });

  saveBtn.addEventListener("click", async () => {
    const name = String(state.api.compositionBundleDraft.name ?? "").trim();
    if (!name) {
      feedbackEl.textContent = "Composition name is required.";
      return;
    }
    const payload = {
      name,
      description: String(state.api.compositionBundleDraft.description ?? "").trim(),
      requirement_ids: normalizeApiTagIdArray(state.api.compositionBundleDraft.requirementIds),
      is_active: state.api.compositionBundleDraft.isActive === true
    };
    const scopeContext = getCompositionCatalogScopeRequestContext();
    payload.scope = scopeContext.scope;
    if (scopeContext.scope === "team") {
      if (!scopeContext.teamId) {
        feedbackEl.textContent = "Select a team before saving team-scoped compositions.";
        return;
      }
      payload.team_id = Number(scopeContext.teamId);
    }
    state.api.isSavingCompositionBundle = true;
    feedbackEl.textContent = isEditing ? "Saving..." : "Creating...";
    saveBtn.disabled = true;
    try {
      await apiRequest(
        isEditing ? `/compositions/${composition.id}` : "/compositions",
        { method: isEditing ? "PUT" : "POST", auth: true, body: payload }
      );
      await loadCompositionBundlesFromApi();
      state.api.compositionBundleDraft = JSON.parse(JSON.stringify(snapshotDraft));
      state.api.selectedCompositionBundleId = snapshotSelectedId;
      overlay.remove();
      renderCompositionBundlesWorkspace();
    } catch (error) {
      feedbackEl.textContent = normalizeApiErrorMessage(error, "Failed to save composition.");
      saveBtn.disabled = false;
    } finally {
      state.api.isSavingCompositionBundle = false;
    }
  });

  if (isEditing) {
    footer.append(deleteBtn);
    const separator = runtimeDocument.createElement("span");
    separator.className = "composer-btn-separator";
    footer.append(separator);
  }
  footer.append(cancelBtn, saveBtn);

  dialog.append(header, body, footer);
  overlay.append(dialog);
  runtimeDocument.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-open"));
}

function renderCompositionRequirementOptionsInContainer(container) {
  container.innerHTML = "";
  const requirements = Array.isArray(state.api.requirementDefinitions) ? state.api.requirementDefinitions : [];
  if (requirements.length < 1) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "Create at least one requirement definition first.";
    container.append(empty);
    return;
  }
  const selectedIdSet = new Set(normalizeApiTagIdArray(state.api.compositionBundleDraft.requirementIds));
  for (const requirement of requirements) {
    const label = runtimeDocument.createElement("label");
    label.className = "selection-option";
    const checkbox = runtimeDocument.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedIdSet.has(requirement.id);
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
    container.append(label);
  }
}

function openRequirementEditorModal(requirement = null) {
  closeDraftModal();
  const isEditing = Boolean(requirement);
  const snapshotDraft = JSON.parse(JSON.stringify(state.api.requirementDefinitionDraft));
  const snapshotSelectedId = state.api.selectedRequirementDefinitionId;

  if (isEditing) {
    setRequirementDefinitionDraft(requirement);
  } else {
    setRequirementDefinitionDraft(null);
  }
  // draftAtOpen captured after initial render to avoid false dirty flags from normalization
  let draftAtOpen = null;

  const overlay = runtimeDocument.createElement("div");
  overlay.className = "draft-modal-overlay";

  const dialog = runtimeDocument.createElement("div");
  dialog.className = "draft-modal clause-editor-modal";

  const header = runtimeDocument.createElement("div");
  header.className = "draft-modal-header";
  const title = runtimeDocument.createElement("h3");
  title.textContent = isEditing ? `Edit Requirement — ${requirement.name}` : "Create Requirement";
  const close = runtimeDocument.createElement("button");
  close.type = "button";
  close.className = "draft-modal-close";
  close.textContent = "\u00D7";
  header.append(title, close);

  const body = runtimeDocument.createElement("div");
  body.className = "draft-modal-body";

  const nameLabel = runtimeDocument.createElement("label");
  nameLabel.textContent = "Name";
  const nameInput = runtimeDocument.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "e.g. Frontline Anchor";
  nameInput.value = state.api.requirementDefinitionDraft.name;
  nameInput.addEventListener("input", () => {
    state.api.requirementDefinitionDraft.name = nameInput.value;
  });
  nameLabel.append(runtimeDocument.createElement("br"), nameInput);

  const defLabel = runtimeDocument.createElement("label");
  defLabel.textContent = "Definition";
  const defInput = runtimeDocument.createElement("input");
  defInput.type = "text";
  defInput.placeholder = "What this requirement enforces";
  defInput.value = state.api.requirementDefinitionDraft.definition;
  defInput.addEventListener("input", () => {
    state.api.requirementDefinitionDraft.definition = defInput.value;
  });
  defLabel.append(runtimeDocument.createElement("br"), defInput);

  const clauseSection = runtimeDocument.createElement("div");
  const clauseHeader = runtimeDocument.createElement("div");
  clauseHeader.className = "comp-card-header";
  clauseHeader.style.marginTop = "0.5rem";
  const clauseTitle = runtimeDocument.createElement("p");
  clauseTitle.className = "meta";
  clauseTitle.style.margin = "0";
  clauseTitle.textContent = "Clauses";
  const addClauseBtn = runtimeDocument.createElement("button");
  addClauseBtn.type = "button";
  addClauseBtn.className = "ghost comp-action-btn";
  addClauseBtn.textContent = "+ Add Clause";
  addClauseBtn.addEventListener("click", () => {
    const nextRules = Array.isArray(state.api.requirementDefinitionDraft.rules)
      ? [...state.api.requirementDefinitionDraft.rules]
      : [];
    for (const existingClause of nextRules) {
      existingClause.isOpen = false;
    }
    nextRules.push(createDefaultRequirementRuleClauseDraft());
    state.api.requirementDefinitionDraft.rules = nextRules;
    renderClauseEditorInModal(clauseContainer);
  });
  clauseHeader.append(clauseTitle, addClauseBtn);

  const clauseContainer = runtimeDocument.createElement("div");
  clauseContainer.className = "requirements-clause-list";
  clauseSection.append(clauseHeader, clauseContainer);

  const feedbackEl = runtimeDocument.createElement("p");
  feedbackEl.className = "meta";

  body.append(nameLabel, defLabel, clauseSection, feedbackEl);

  const footer = runtimeDocument.createElement("div");
  footer.className = "draft-modal-footer";

  const deleteBtn = runtimeDocument.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "ghost";
  deleteBtn.style.color = "var(--warn)";
  deleteBtn.textContent = "Delete";
  deleteBtn.hidden = !isEditing;
  deleteBtn.addEventListener("click", async () => {
    const confirmed = await showUSSConfirm({
      title: "Delete Requirement",
      body: `Delete requirement '${requirement?.name ?? ""}'? This also removes it from any compositions that include it.`,
      affirmLabel: "Delete",
      cancelLabel: "Keep",
      destructive: true
    });
    if (!confirmed) return;
    state.api.isSavingRequirementDefinition = true;
    feedbackEl.textContent = "Deleting...";
    try {
      await apiRequest(`/requirements/${requirement.id}`, { method: "DELETE", auth: true });
      setRequirementDefinitionDraft(null);
      state.api.isRequirementDefinitionEditorOpen = false;
      await hydrateCompositionsWorkspaceFromApi();
      overlay.remove();
      renderCompositionsWorkspace();
    } catch (error) {
      feedbackEl.textContent = normalizeApiErrorMessage(error, "Failed to delete.");
    } finally {
      state.api.isSavingRequirementDefinition = false;
    }
  });

  const cancelBtn = runtimeDocument.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "ghost";
  cancelBtn.textContent = "Cancel";

  const saveBtn = runtimeDocument.createElement("button");
  saveBtn.type = "button";
  saveBtn.textContent = isEditing ? "Update" : "Create";

  function stripTransientClauseFields(draftJson) {
    const parsed = JSON.parse(draftJson);
    if (Array.isArray(parsed.rules)) {
      for (const rule of parsed.rules) {
        delete rule.isOpen;
        delete rule.activeTermIndex;
        delete rule.termSearchByKind;
      }
    }
    return JSON.stringify(parsed);
  }

  async function handleClose() {
    const isDirty = stripTransientClauseFields(JSON.stringify(state.api.requirementDefinitionDraft)) !== stripTransientClauseFields(draftAtOpen);
    if (isDirty) {
      const confirmed = await showUSSConfirm({
        title: "Unsaved Changes",
        body: "You have unsaved requirement edits. Discard them?",
        affirmLabel: "Discard",
        cancelLabel: "Keep Editing",
        destructive: true
      });
      if (!confirmed) return;
    }
    state.api.requirementDefinitionDraft = JSON.parse(JSON.stringify(snapshotDraft));
    state.api.selectedRequirementDefinitionId = snapshotSelectedId;
    overlay.remove();
  }

  close.addEventListener("click", handleClose);
  cancelBtn.addEventListener("click", handleClose);
  overlay.addEventListener("click", (evt) => {
    if (evt.target === overlay) handleClose();
  });

  saveBtn.addEventListener("click", async () => {
    const name = String(state.api.requirementDefinitionDraft.name ?? "").trim();
    if (!name) {
      feedbackEl.textContent = "Requirement name is required.";
      return;
    }
    let parsedRules;
    try {
      parsedRules = parseRequirementRulesFromDraftClauses();
    } catch (error) {
      feedbackEl.textContent = error instanceof Error ? error.message : "Rules are invalid.";
      return;
    }
    const payload = {
      name,
      definition: String(state.api.requirementDefinitionDraft.definition ?? "").trim(),
      rules: parsedRules
    };
    const scopeContext = getCompositionCatalogScopeRequestContext();
    payload.scope = scopeContext.scope;
    if (scopeContext.scope === "team") {
      if (!scopeContext.teamId) {
        feedbackEl.textContent = "Select a team before saving team-scoped requirements.";
        return;
      }
      payload.team_id = Number(scopeContext.teamId);
    }
    state.api.isSavingRequirementDefinition = true;
    feedbackEl.textContent = isEditing ? "Saving..." : "Creating...";
    saveBtn.disabled = true;
    try {
      await apiRequest(
        isEditing ? `/requirements/${requirement.id}` : "/requirements",
        { method: isEditing ? "PUT" : "POST", auth: true, body: payload }
      );
      await hydrateCompositionsWorkspaceFromApi();
      state.api.requirementDefinitionDraft = JSON.parse(JSON.stringify(snapshotDraft));
      state.api.selectedRequirementDefinitionId = snapshotSelectedId;
      state.api.isRequirementDefinitionEditorOpen = false;
      overlay.remove();
      renderCompositionsWorkspace();
    } catch (error) {
      feedbackEl.textContent = normalizeApiErrorMessage(error, "Failed to save requirement.");
      saveBtn.disabled = false;
    } finally {
      state.api.isSavingRequirementDefinition = false;
    }
  });

  if (isEditing) {
    footer.append(deleteBtn);
    const separator = runtimeDocument.createElement("span");
    separator.className = "composer-btn-separator";
    footer.append(separator);
  }
  footer.append(cancelBtn, saveBtn);

  dialog.append(header, body, footer);
  overlay.append(dialog);
  runtimeDocument.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-open"));
  renderClauseEditorInModal(clauseContainer);
  // Snapshot after render so normalization side-effects are included in the baseline
  draftAtOpen = JSON.stringify(state.api.requirementDefinitionDraft);
}

function openChampionCompositionSynergyEditorModal() {
  closeDraftModal();
  const snapshotDraft = JSON.parse(JSON.stringify(state.api.requirementDefinitionDraft));
  const snapshotSelectedId = state.api.selectedRequirementDefinitionId;
  const snapshotSynergies = JSON.parse(
    JSON.stringify(state.api.championMetadataDraft?.compositionSynergies ?? createEmptyChampionCompositionSynergiesDraft())
  );
  const champion = getChampionById(state.api.selectedChampionTagEditorId);

  state.api.requirementDefinitionDraft = {
    name: "",
    definition: snapshotSynergies.definition ?? "",
    rules: Array.isArray(snapshotSynergies.rules) ? snapshotSynergies.rules : []
  };

  let draftAtOpen = null;

  const overlay = runtimeDocument.createElement("div");
  overlay.className = "draft-modal-overlay";

  const dialog = runtimeDocument.createElement("div");
  dialog.className = "draft-modal clause-editor-modal";

  const header = runtimeDocument.createElement("div");
  header.className = "draft-modal-header";
  const title = runtimeDocument.createElement("h3");
  title.textContent = champion
    ? `Edit Composition Synergies — ${champion.name}`
    : "Edit Composition Synergies";
  const close = runtimeDocument.createElement("button");
  close.type = "button";
  close.className = "draft-modal-close";
  close.textContent = "\u00D7";
  header.append(title, close);

  const body = runtimeDocument.createElement("div");
  body.className = "draft-modal-body";

  const defLabel = runtimeDocument.createElement("label");
  defLabel.textContent = "Summary";
  const defInput = runtimeDocument.createElement("textarea");
  defInput.rows = 2;
  defInput.placeholder = "What this champion wants from the surrounding comp";
  defInput.value = state.api.requirementDefinitionDraft.definition;
  defInput.addEventListener("input", () => {
    state.api.requirementDefinitionDraft.definition = defInput.value;
  });
  defLabel.append(runtimeDocument.createElement("br"), defInput);

  const clauseSection = runtimeDocument.createElement("div");
  const clauseHeader = runtimeDocument.createElement("div");
  clauseHeader.className = "comp-card-header";
  clauseHeader.style.marginTop = "0.5rem";
  const clauseTitle = runtimeDocument.createElement("p");
  clauseTitle.className = "meta";
  clauseTitle.style.margin = "0";
  clauseTitle.textContent = "Synergy Clauses";
  const addClauseBtn = runtimeDocument.createElement("button");
  addClauseBtn.type = "button";
  addClauseBtn.className = "ghost comp-action-btn";
  addClauseBtn.textContent = "+ Add Clause";
  addClauseBtn.addEventListener("click", () => {
    const nextRules = Array.isArray(state.api.requirementDefinitionDraft.rules)
      ? [...state.api.requirementDefinitionDraft.rules]
      : [];
    for (const existingClause of nextRules) {
      existingClause.isOpen = false;
    }
    nextRules.push(createDefaultRequirementRuleClauseDraft());
    state.api.requirementDefinitionDraft.rules = nextRules;
    renderClauseEditorInModal(clauseContainer);
  });
  clauseHeader.append(clauseTitle, addClauseBtn);

  const clauseContainer = runtimeDocument.createElement("div");
  clauseContainer.className = "requirements-clause-list";
  clauseSection.append(clauseHeader, clauseContainer);

  const feedbackEl = runtimeDocument.createElement("p");
  feedbackEl.className = "meta";
  feedbackEl.textContent =
    "These clauses are evaluated against the rest of the team, so the champion itself does not count toward its own synergies.";

  body.append(defLabel, clauseSection, feedbackEl);

  const footer = runtimeDocument.createElement("div");
  footer.className = "draft-modal-footer";

  const cancelBtn = runtimeDocument.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "ghost";
  cancelBtn.textContent = "Cancel";

  const saveBtn = runtimeDocument.createElement("button");
  saveBtn.type = "button";
  saveBtn.textContent = "Apply";

  function stripTransientClauseFields(draftJson) {
    const parsed = JSON.parse(draftJson);
    if (Array.isArray(parsed.rules)) {
      for (const rule of parsed.rules) {
        delete rule.isOpen;
        delete rule.activeTermIndex;
        delete rule.termSearchByKind;
      }
    }
    return JSON.stringify(parsed);
  }

  async function handleClose() {
    const isDirty = stripTransientClauseFields(JSON.stringify(state.api.requirementDefinitionDraft)) !== stripTransientClauseFields(draftAtOpen);
    if (isDirty) {
      const confirmed = await showUSSConfirm({
        title: "Unsaved Changes",
        body: "You have unsaved composition synergy edits. Discard them?",
        affirmLabel: "Discard",
        cancelLabel: "Keep Editing",
        destructive: true
      });
      if (!confirmed) return;
    }
    state.api.requirementDefinitionDraft = JSON.parse(JSON.stringify(snapshotDraft));
    state.api.selectedRequirementDefinitionId = snapshotSelectedId;
    overlay.remove();
  }

  close.addEventListener("click", handleClose);
  cancelBtn.addEventListener("click", handleClose);
  overlay.addEventListener("click", (evt) => {
    if (evt.target === overlay) handleClose();
  });

  saveBtn.addEventListener("click", () => {
    const definition = String(state.api.requirementDefinitionDraft.definition ?? "").trim();
    const draftRules = Array.isArray(state.api.requirementDefinitionDraft.rules)
      ? state.api.requirementDefinitionDraft.rules
      : [];
    if (draftRules.length < 1 && definition !== "") {
      feedbackEl.textContent = "Add at least one synergy clause or clear the summary.";
      return;
    }
    state.api.championMetadataDraft.compositionSynergies = {
      definition,
      rules: draftRules.length > 0 ? JSON.parse(JSON.stringify(draftRules)) : []
    };
    state.api.requirementDefinitionDraft = JSON.parse(JSON.stringify(snapshotDraft));
    state.api.selectedRequirementDefinitionId = snapshotSelectedId;
    overlay.remove();
    renderChampionTagEditor();
  });

  footer.append(cancelBtn, saveBtn);

  dialog.append(header, body, footer);
  overlay.append(dialog);
  runtimeDocument.body.append(overlay);
  const scheduleOpen = runtimeWindow?.requestAnimationFrame ?? ((callback) => callback());
  scheduleOpen(() => overlay.classList.add("is-open"));
  renderClauseEditorInModal(clauseContainer);
  draftAtOpen = JSON.stringify(state.api.requirementDefinitionDraft);
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

  const scopeContext = getCompositionCatalogScopeRequestContext();
  if (scopeContext.scope === "team" && !scopeContext.teamId) {
    state.api.requirementDefinitions = [];
    setRequirementDefinitionDraft(null);
    setRequirementsFeedback("Select a team to load team-scoped requirements.");
    renderCompositionsWorkspace();
    return false;
  }

  state.api.isLoadingRequirementDefinitions = true;
  renderCompositionsWorkspace();
  try {
    const payload = await apiRequest(`/requirements?${buildCompositionCatalogQuery().toString()}`, { auth: true });
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

  const scopeContext = getCompositionCatalogScopeRequestContext();
  if (scopeContext.scope === "team" && !scopeContext.teamId) {
    state.api.compositionBundles = [];
    setCompositionBundleDraft(null);
    setCompositionsFeedback("Select a team to load team-scoped compositions.");
    renderCompositionsWorkspace();
    return false;
  }

  state.api.isLoadingCompositionBundles = true;
  renderCompositionsWorkspace();
  try {
    const payload = await apiRequest(`/compositions?${buildCompositionCatalogQuery().toString()}`, { auth: true });
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

function buildComposerContextRequestBody() {
  return {
    team_id: state.builder.teamId && state.builder.teamId !== NONE_TEAM_ID
      ? Number.parseInt(String(state.builder.teamId), 10)
      : null,
    use_custom_scopes: state.builder.useCustomScopes,
    default_precedence: normalizeBuilderScopePrecedence(state.builder.defaultScopePrecedence),
    resources: Object.fromEntries(
      BUILDER_SCOPE_RESOURCES.map((resource) => [
        resource,
        {
          enabled: state.builder.scopeResourceSettings?.[resource]?.enabled !== false,
          precedence: normalizeBuilderScopePrecedence(
            state.builder.scopeResourceSettings?.[resource]?.precedence,
            state.builder.defaultScopePrecedence
          )
        }
      ])
    )
  };
}

async function loadComposerContextFromApi() {
  const payload = await apiRequest("/composer/context", {
    method: "POST",
    auth: isAuthenticated(),
    body: buildComposerContextRequestBody()
  });

  const tags = Array.isArray(payload?.tags) ? payload.tags.map(normalizeTagCatalogEntry).filter(Boolean) : [];
  const requirements = Array.isArray(payload?.requirements)
    ? payload.requirements.map(normalizeRequirementDefinition).filter(Boolean)
    : [];
  const compositions = Array.isArray(payload?.compositions)
    ? payload.compositions.map(normalizeCompositionBundle).filter(Boolean)
    : [];
  const champions = Array.isArray(payload?.champions)
    ? payload.champions.map(buildChampionFromApiRecord).filter(Boolean)
    : state.data.champions;

  state.builder.composerTags = tags;
  state.builder.composerTagById = Object.fromEntries(tags.map((tag) => [String(tag.id), tag]));
  state.builder.composerContextRequirements = requirements;
  state.builder.composerContextCompositions = compositions;
  state.builder.composerChampionsByName = Object.fromEntries(champions.map((champion) => [champion.name, champion]));
  state.builder.activeCompositionId = resolveBuilderActiveCompositionId(
    state.builder.activeCompositionId ?? payload?.active_composition_id ?? payload?.activeCompositionId ?? null
  );
  state.builder.scopeLoadError = "";
}

async function refreshBuilderComposerContext({ includeDraftContext = true } = {}) {
  try {
    if (includeDraftContext) {
      await fetchBuilderDraftContext(state.builder.teamId);
    }
    await loadComposerContextFromApi();
    validateTeamSelections();
  } catch (error) {
    state.builder.scopeLoadError = normalizeApiErrorMessage(error, "Failed to load Composer scope data.");
  } finally {
    renderTeamConfig();
    renderBuilder();
  }
}

function createDefaultDraftSetupState(saveMode = state.builder.draftSetupSaveMode) {
  const normalizedSaveMode = normalizeDraftSetupSaveMode(saveMode);
  const builderState = {
    maxBranch: state.builder.maxBranch,
    treeMinCandidateScore: state.builder.treeMinCandidateScore,
    treeRankGoal: state.builder.treeRankGoal,
    candidateScoringWeights: { ...state.builder.candidateScoringWeights },
    treeMinScore: state.builder.treeMinScore,
    treeValidLeavesOnly: state.builder.treeValidLeavesOnly,
    useCustomScopes: state.builder.useCustomScopes,
    defaultScopePrecedence: state.builder.defaultScopePrecedence,
    scopeResourceSettings: normalizeBuilderScopeResourceSettings(state.builder.scopeResourceSettings)
  };

  if (normalizedSaveMode !== "settings_only") {
    Object.assign(builderState, {
      teamId: state.builder.teamId,
      activeCompositionId: state.builder.activeCompositionId,
      teamState: { ...state.builder.teamState },
      draftOrder: [...state.builder.draftOrder],
      slotPoolRole: { ...state.builder.slotPoolRole },
      excludedChampions: [...state.builder.excludedChampions]
    });
  }

  return {
    saveMode: normalizedSaveMode,
    builder: builderState
  };
}

function normalizeDraftSetupRecord(rawSetup) {
  if (!rawSetup || typeof rawSetup !== "object" || Array.isArray(rawSetup)) {
    return null;
  }
  const id = normalizeApiEntityId(rawSetup.id);
  if (!id) {
    return null;
  }
  return {
    id,
    name: typeof rawSetup.name === "string" ? rawSetup.name.trim() : "",
    description: typeof rawSetup.description === "string" ? rawSetup.description.trim() : "",
    saveMode: normalizeDraftSetupSaveMode(rawSetup.save_mode ?? rawSetup.state_json?.saveMode ?? rawSetup.stateJson?.saveMode),
    stateJson:
      rawSetup.state_json && typeof rawSetup.state_json === "object" && !Array.isArray(rawSetup.state_json)
        ? rawSetup.state_json
        : rawSetup.stateJson && typeof rawSetup.stateJson === "object" && !Array.isArray(rawSetup.stateJson)
          ? rawSetup.stateJson
          : {},
    createdAt: rawSetup.created_at ?? rawSetup.createdAt ?? "",
    updatedAt: rawSetup.updated_at ?? rawSetup.updatedAt ?? ""
  };
}

function openBuilderSaveDraftModal() {
  if (!isAuthenticated()) {
    return;
  }
  state.builder.isLoadDraftModalOpen = false;
  state.builder.isSaveDraftModalOpen = true;
  setBuilderDraftSetupFeedback("");
  renderBuilder();
  runtimeWindow.setTimeout(() => {
    elements.builderSaveDraftName?.focus();
  }, 0);
}

function closeBuilderSaveDraftModal() {
  state.builder.isSaveDraftModalOpen = false;
  setBuilderDraftSetupFeedback("");
  renderBuilder();
}

function openBuilderLoadDraftModal() {
  if (!isAuthenticated()) {
    return;
  }
  state.builder.isSaveDraftModalOpen = false;
  state.builder.isLoadDraftModalOpen = true;
  setBuilderDraftSetupFeedback("");
  renderBuilder();
  void loadDraftSetupsFromApi();
}

function closeBuilderLoadDraftModal() {
  state.builder.isLoadDraftModalOpen = false;
  setBuilderDraftSetupFeedback("");
  renderBuilder();
}

async function loadDraftSetupsFromApi() {
  if (!isAuthenticated()) {
    state.builder.draftSetups = [];
    state.builder.selectedDraftSetupId = null;
    state.builder.draftSetupDescription = "";
    state.builder.draftSetupSaveMode = "full";
    state.builder.draftSetupFeedback = "";
    renderBuilder();
    return;
  }
  state.builder.isLoadingDraftSetups = true;
  renderBuilder();
  try {
    const payload = await apiRequest("/me/draft-setups", { auth: true });
    state.builder.draftSetups = Array.isArray(payload?.draft_setups)
      ? payload.draft_setups.map(normalizeDraftSetupRecord).filter(Boolean)
      : [];
    setBuilderDraftSetupFeedback("");
  } catch (error) {
    setBuilderDraftSetupFeedback(normalizeApiErrorMessage(error, "Failed to load Draft Setups."));
  } finally {
    state.builder.isLoadingDraftSetups = false;
    renderBuilder();
  }
}

async function applyDraftSetupState(setup) {
  const builderState = setup?.stateJson?.builder && typeof setup.stateJson.builder === "object"
    ? setup.stateJson.builder
    : {};
  const saveMode = normalizeDraftSetupSaveMode(setup?.saveMode ?? setup?.stateJson?.saveMode);
  state.builder.selectedDraftSetupId = setup.id;
  state.builder.draftSetupName = setup.name;
  state.builder.draftSetupDescription = setup.description ?? "";
  state.builder.draftSetupSaveMode = saveMode;
  if (saveMode !== "settings_only") {
    state.builder.teamId = normalizeConfiguredTeamId(builderState.teamId);
    state.teamConfig.activeTeamId = state.builder.teamId;
    saveTeamConfig();
    state.builder.activeCompositionId = normalizeApiEntityId(builderState.activeCompositionId);
    state.builder.teamState = normalizeTeamState(builderState.teamState);
    state.builder.draftOrder = Array.isArray(builderState.draftOrder) ? builderState.draftOrder.filter((role) => SLOTS.includes(role)) : [...SLOTS];
    state.builder.slotPoolRole = builderState.slotPoolRole && typeof builderState.slotPoolRole === "object"
      ? Object.fromEntries(SLOTS.map((slot) => [slot, builderState.slotPoolRole[slot] ?? slot]))
      : Object.fromEntries(SLOTS.map((slot) => [slot, slot]));
    state.builder.excludedChampions = Array.isArray(builderState.excludedChampions)
      ? builderState.excludedChampions.filter((name) => typeof name === "string")
      : [];
  }
  state.builder.maxBranch = Number.isFinite(Number(builderState.maxBranch))
    ? Math.max(1, Number(builderState.maxBranch))
    : state.builder.maxBranch;
  state.builder.treeMinCandidateScore = Number.isFinite(Number(builderState.treeMinCandidateScore))
    ? Math.max(0, Number(builderState.treeMinCandidateScore))
    : 1;
  state.builder.treeRankGoal = normalizeBuilderRankGoal(builderState.treeRankGoal);
  state.builder.candidateScoringWeights = normalizeBuilderCandidateScoringWeights(builderState.candidateScoringWeights);
  state.builder.treeMinScore = Number.isFinite(Number(builderState.treeMinScore))
    ? Math.max(0, Number(builderState.treeMinScore))
    : 0;
  state.builder.treeValidLeavesOnly = builderState.treeValidLeavesOnly !== false;
  state.builder.useCustomScopes = builderState.useCustomScopes === true;
  state.builder.defaultScopePrecedence = normalizeBuilderScopePrecedence(builderState.defaultScopePrecedence);
  state.builder.scopeResourceSettings = normalizeBuilderScopeResourceSettings(builderState.scopeResourceSettings);

  setBuilderStage("setup");
  resetBuilderTreeState();
  await refreshBuilderComposerContext({ includeDraftContext: true });
  closeBuilderLoadDraftModal();
  setBuilderDraftSetupFeedback(
    saveMode === "settings_only"
      ? `Applied settings from Draft Setup '${setup.name}'.`
      : `Loaded Draft Setup '${setup.name}'.`
  );
}

async function saveCurrentDraftSetup() {
  if (!isAuthenticated() || state.builder.isSavingDraftSetup) {
    return;
  }
  const name = String(elements.builderSaveDraftName?.value ?? state.builder.draftSetupName ?? "").trim();
  const description = String(
    elements.builderSaveDraftDescription?.value ?? state.builder.draftSetupDescription ?? ""
  ).trim();
  if (!name) {
    setBuilderDraftSetupFeedback("Draft Setup name is required.");
    return;
  }
  state.builder.draftSetupName = name;
  state.builder.draftSetupDescription = description;
  const saveMode = normalizeDraftSetupSaveMode(state.builder.draftSetupSaveMode);
  state.builder.isSavingDraftSetup = true;
  renderBuilder();
  try {
    const setupId = normalizeApiEntityId(state.builder.selectedDraftSetupId);
    const payload = await apiRequest(
      setupId ? `/me/draft-setups/${setupId}` : "/me/draft-setups",
      {
        method: setupId ? "PUT" : "POST",
        auth: true,
        body: {
          name,
          description,
          state_json: createDefaultDraftSetupState(saveMode)
        }
      }
    );
    const savedSetup = normalizeDraftSetupRecord(payload?.draft_setup);
    if (savedSetup) {
      state.builder.selectedDraftSetupId = savedSetup.id;
      state.builder.draftSetupName = savedSetup.name;
      state.builder.draftSetupDescription = savedSetup.description ?? "";
      state.builder.draftSetupSaveMode = savedSetup.saveMode;
    }
    await loadDraftSetupsFromApi();
    state.builder.isSaveDraftModalOpen = false;
    setBuilderDraftSetupFeedback(
      saveMode === "settings_only"
        ? (setupId ? "Settings-only draft updated." : "Settings-only draft saved.")
        : (setupId ? "Draft Setup updated." : "Draft Setup saved.")
    );
  } catch (error) {
    setBuilderDraftSetupFeedback(normalizeApiErrorMessage(error, "Failed to save Draft Setup."));
  } finally {
    state.builder.isSavingDraftSetup = false;
    renderBuilder();
  }
}

async function deleteDraftSetup(setupId) {
  try {
    await apiRequest(`/me/draft-setups/${setupId}`, {
      method: "DELETE",
      auth: true
    });
    if (state.builder.selectedDraftSetupId === setupId) {
      state.builder.selectedDraftSetupId = null;
      state.builder.draftSetupName = "";
      state.builder.draftSetupDescription = "";
      state.builder.draftSetupSaveMode = "full";
    }
    await loadDraftSetupsFromApi();
    setBuilderDraftSetupFeedback("Draft Setup deleted.");
  } catch (error) {
    setBuilderDraftSetupFeedback(normalizeApiErrorMessage(error, "Failed to delete Draft Setup."));
  }
}

function normalizeTagPromotionRequest(rawRequest) {
  if (!rawRequest || typeof rawRequest !== "object" || Array.isArray(rawRequest)) {
    return null;
  }
  const id = normalizeApiEntityId(rawRequest.id);
  if (!id) {
    return null;
  }
  return {
    id,
    entityType: typeof rawRequest.entity_type === "string" ? rawRequest.entity_type : "",
    resourceId: normalizeApiEntityId(rawRequest.resource_id),
    sourceScope: normalizeChampionTagScope(rawRequest.source_scope),
    sourceTeamId: normalizeApiEntityId(rawRequest.source_team_id),
    targetScope: normalizeChampionTagScope(rawRequest.target_scope),
    targetTeamId: normalizeApiEntityId(rawRequest.target_team_id),
    status: typeof rawRequest.status === "string" ? rawRequest.status.trim().toLowerCase() : "pending",
    requestComment: typeof rawRequest.request_comment === "string" ? rawRequest.request_comment : "",
    reviewComment: typeof rawRequest.review_comment === "string" ? rawRequest.review_comment : "",
    payloadJson:
      rawRequest.payload_json && typeof rawRequest.payload_json === "object" && !Array.isArray(rawRequest.payload_json)
        ? rawRequest.payload_json
        : {},
    createdAt: rawRequest.created_at ?? "",
    reviewedAt: rawRequest.reviewed_at ?? ""
  };
}

async function loadTagPromotionQueuesFromApi() {
  if (!isAuthenticated()) {
    state.api.tagPromotionRequests = [];
    state.api.tagPromotionReviewQueue = [];
    state.api.isTagPromotionModalOpen = false;
    state.api.tagPromotionDraftComment = "";
    renderTagsWorkspace();
    return;
  }
  state.api.isLoadingTagPromotions = true;
  renderTagsWorkspace();
  try {
    const requestedPayload = await apiRequest("/tags/promotion-requests?mode=requested", { auth: true });
    state.api.tagPromotionRequests = Array.isArray(requestedPayload?.promotion_requests)
      ? requestedPayload.promotion_requests.map(normalizeTagPromotionRequest).filter(Boolean)
      : [];

    const context = getTagCatalogScopeRequestContext();
    const reviewQuery = new URLSearchParams({
      mode: "review",
      scope: context.scope === "all" ? "all" : "team"
    });
    if (context.scope === "team" && context.teamId) {
      reviewQuery.set("team_id", context.teamId);
    }
    const reviewPayload = await apiRequest(`/tags/promotion-requests?${reviewQuery.toString()}`, { auth: true });
    state.api.tagPromotionReviewQueue = Array.isArray(reviewPayload?.promotion_requests)
      ? reviewPayload.promotion_requests.map(normalizeTagPromotionRequest).filter(Boolean)
      : [];
    setTagPromotionFeedback("");
  } catch (error) {
    state.api.tagPromotionReviewQueue = [];
    setTagPromotionFeedback(normalizeApiErrorMessage(error, "Failed to load tag promotions."));
  } finally {
    state.api.isLoadingTagPromotions = false;
    renderTagsWorkspace();
  }
}

async function requestTagPromotion() {
  if (!isAuthenticated() || state.api.isSubmittingTagPromotion) {
    return;
  }
  const promotionUi = getTagPromotionUiState();
  if (!promotionUi.canRequestPromotion) {
    setTagPromotionModalFeedback(promotionUi.disabledReason || "Save a scoped tag before requesting promotion.");
    renderTagsWorkspace();
    return;
  }
  const selectedTagId = normalizeApiEntityId(state.api.selectedTagManagerId);
  if (!selectedTagId) {
    setTagPromotionModalFeedback("Select a tag before requesting promotion.");
    return;
  }
  const context = promotionUi.context;
  if (context.scope === "all") {
    setTagPromotionModalFeedback("Global tags do not need promotion.");
    return;
  }
  const targetScope = promotionUi.targetScope;
  const body = {
    source_scope: context.scope,
    target_scope: targetScope,
    request_comment: String(state.api.tagPromotionDraftComment ?? "").trim()
  };
  if (context.scope === "team" && context.teamId) {
    body.team_id = Number.parseInt(context.teamId, 10);
  }
  if (targetScope === "team") {
    const targetTeamId = context.scope === "self"
      ? normalizeConfiguredTeamId(state.builder.teamId || state.teamConfig.activeTeamId)
      : context.teamId;
    if (!targetTeamId || targetTeamId === NONE_TEAM_ID) {
      setTagPromotionModalFeedback("Select an active team before requesting team promotion.");
      return;
    }
    body.target_team_id = Number.parseInt(targetTeamId, 10);
  }
  state.api.isSubmittingTagPromotion = true;
  setTagPromotionModalFeedback("Submitting promotion request...");
  renderTagsWorkspace();
  try {
    await apiRequest(`/tags/${selectedTagId}/promotion-requests`, {
      method: "POST",
      auth: true,
      body
    });
    state.api.tagPromotionDraftComment = "";
    state.api.isTagPromotionModalOpen = false;
    setTagPromotionModalFeedback("");
    await loadTagPromotionQueuesFromApi();
    setTagPromotionFeedback("Promotion request created.");
  } catch (error) {
    setTagPromotionModalFeedback(normalizeApiErrorMessage(error, "Failed to create promotion request."));
  } finally {
    state.api.isSubmittingTagPromotion = false;
    renderTagsWorkspace();
  }
}

async function reviewTagPromotion(requestId, decision, reviewComment = "") {
  try {
    await apiRequest(`/tags/promotion-requests/${requestId}/review`, {
      method: "POST",
      auth: true,
      body: {
        decision,
        review_comment: reviewComment
      }
    });
    await loadTagPromotionQueuesFromApi();
    setTagPromotionFeedback(`Promotion ${decision}.`);
  } catch (error) {
    setTagPromotionFeedback(normalizeApiErrorMessage(error, "Failed to review promotion request."));
  }
}

async function cancelTagPromotion(requestId) {
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return;
  }
  const confirmed = await confirmAction({
    title: "Cancel Promotion Request",
    message: "Cancel this pending tag promotion request?",
    confirmLabel: "Cancel Request"
  });
  if (!confirmed) {
    return;
  }

  try {
    await apiRequest(`/tags/promotion-requests/${requestId}`, {
      method: "DELETE",
      auth: true
    });
    await loadTagPromotionQueuesFromApi();
    setTagPromotionFeedback("Promotion request canceled.");
  } catch (error) {
    setTagPromotionFeedback(normalizeApiErrorMessage(error, "Failed to cancel promotion request."));
  }
}

async function hydrateCompositionsWorkspaceFromApi() {
  await loadRequirementDefinitionsFromApi();
  await loadCompositionBundlesFromApi();
  renderBuilder();
}

async function saveRequirementDefinitionFromWorkspace() {
  if (!isAuthenticated() || !canWriteCompositionCatalogScope() || state.api.isSavingRequirementDefinition) {
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
  const scopeContext = getCompositionCatalogScopeRequestContext();
  payload.scope = scopeContext.scope;
  if (scopeContext.scope === "team") {
    if (!scopeContext.teamId) {
      setRequirementsFeedback("Select a team before saving team-scoped requirements.");
      return;
    }
    payload.team_id = Number(scopeContext.teamId);
  }

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
  if (!isAuthenticated() || !canWriteCompositionCatalogScope() || state.api.isSavingRequirementDefinition) {
    return;
  }
  const selectedRequirement = getSelectedRequirementDefinition();
  if (!selectedRequirement) {
    setRequirementsFeedback("Select a requirement first.");
    return;
  }
  const confirmed = await confirmAction({
    title: "Confirm Requirement Deletion",
    message: `Delete requirement '${selectedRequirement.name}'? This also removes it from any compositions that include it.`,
    confirmLabel: "Delete Requirement"
  });
  if (!confirmed) {
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
  if (!isAuthenticated() || !canWriteCompositionCatalogScope() || state.api.isSavingCompositionBundle) {
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
  const scopeContext = getCompositionCatalogScopeRequestContext();
  payload.scope = scopeContext.scope;
  if (scopeContext.scope === "team") {
    if (!scopeContext.teamId) {
      setCompositionsFeedback("Select a team before saving team-scoped compositions.");
      return;
    }
    payload.team_id = Number(scopeContext.teamId);
  }

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
  if (!isAuthenticated() || !canWriteCompositionCatalogScope() || state.api.isSavingCompositionBundle) {
    return;
  }
  const selectedComposition = getSelectedCompositionBundle();
  if (!selectedComposition) {
    setCompositionsFeedback("Select a composition first.");
    return;
  }
  const confirmed = await confirmAction({
    title: "Confirm Composition Deletion",
    message: `Delete composition '${selectedComposition.name}'?`,
    confirmLabel: "Delete Composition"
  });
  if (!confirmed) {
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
  const allTags = Array.isArray(state.api.championEditorTags)
    ? state.api.championEditorTags
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

  // Power spike callbacks
  const onPowerSpikesChange = useSharedRoleProfile
    ? (nextSpikes) => {
        const normalized = normalizePowerSpikes(nextSpikes);
        for (const role of selectedRoles) {
          const roleProfile = state.api.championMetadataDraft.roleProfiles?.[role] ?? createDefaultRoleProfileDraft();
          state.api.championMetadataDraft.roleProfiles[role] = { ...roleProfile, powerSpikes: normalized };
        }
        renderChampionTagEditor();
      }
    : (nextSpikes) => {
        const roleProfile = state.api.championMetadataDraft.roleProfiles[validActiveRole] ?? createDefaultRoleProfileDraft();
        state.api.championMetadataDraft.roleProfiles[validActiveRole] = {
          ...roleProfile,
          powerSpikes: normalizePowerSpikes(nextSpikes)
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

  // Render power spike level bar into effectiveness slot (drag-to-select)
  if (elements.cedEffectivenessSlot) {
    const currentSpikes = normalizePowerSpikes(profile.powerSpikes);

    // Label row
    const labelRow = runtimeDocument.createElement("div");
    labelRow.className = "ced-spike-label-row";
    const sectionLabel = runtimeDocument.createElement("p");
    sectionLabel.className = "ced-section-label";
    sectionLabel.textContent = "Power Spikes (Level)";
    labelRow.append(sectionLabel);

    // Level bar with drag-to-select
    const levelBar = runtimeDocument.createElement("div");
    levelBar.className = "ced-level-bar";

    let dragStart = null;
    let isDragging = false;
    let editingRangeIndex = -1;

    const getCellLevel = (el) => {
      const cell = el.closest?.(".ced-level-cell");
      return cell ? parseInt(cell.dataset.level, 10) : null;
    };

    const findRangeIndex = (lvl) => currentSpikes.findIndex((r) => lvl >= r.start && lvl <= r.end);

    const updatePreview = (startLvl, endLvl) => {
      const lo = Math.min(startLvl, endLvl);
      const hi = Math.max(startLvl, endLvl);
      for (const cell of levelBar.children) {
        const lvl = parseInt(cell.dataset.level, 10);
        let active = false;
        for (let i = 0; i < currentSpikes.length; i++) {
          if (i === editingRangeIndex) continue;
          if (lvl >= currentSpikes[i].start && lvl <= currentSpikes[i].end) active = true;
        }
        const inPreview = lvl >= lo && lvl <= hi;
        cell.classList.toggle("is-active", active || inPreview);
        cell.classList.toggle("is-preview", inPreview && !active);
      }
    };

    const commitDrag = (startLvl, endLvl) => {
      const lo = Math.min(startLvl, endLvl);
      const hi = Math.max(startLvl, endLvl);

      // Editing an existing range
      if (editingRangeIndex >= 0) {
        // Single-click on a single-level range removes it
        if (startLvl === endLvl && currentSpikes[editingRangeIndex].start === currentSpikes[editingRangeIndex].end) {
          const next = currentSpikes.filter((_, i) => i !== editingRangeIndex);
          onPowerSpikesChange(next);
          return;
        }
        // Replace the range being edited
        const next = [...currentSpikes];
        next[editingRangeIndex] = { start: lo, end: hi };
        onPowerSpikesChange(next);
        return;
      }

      // New range on unselected territory
      const newRange = { start: lo, end: hi };
      if (currentSpikes.length < POWER_SPIKE_MAX_RANGES) {
        onPowerSpikesChange([...currentSpikes, newRange]);
      } else {
        // Replace the last range
        const next = [...currentSpikes];
        next[next.length - 1] = newRange;
        onPowerSpikesChange(next);
      }
    };

    for (let lvl = POWER_SPIKE_MIN_LEVEL; lvl <= POWER_SPIKE_MAX_LEVEL; lvl++) {
      const cell = runtimeDocument.createElement("div");
      cell.className = "ced-level-cell";
      cell.dataset.level = String(lvl);
      if (levelInPowerSpikes(lvl, currentSpikes)) cell.classList.add("is-active");
      const num = runtimeDocument.createElement("span");
      num.className = "ced-level-num";
      num.textContent = String(lvl);
      cell.append(num);
      levelBar.append(cell);
    }

    if (!state.api.isSavingChampionTags) {
      levelBar.addEventListener("pointerdown", (e) => {
        const lvl = getCellLevel(e.target);
        if (lvl == null) return;
        isDragging = true;
        dragStart = lvl;
        editingRangeIndex = findRangeIndex(lvl);
        levelBar.setPointerCapture(e.pointerId);
        updatePreview(lvl, lvl);
        e.preventDefault();
      });

      levelBar.addEventListener("pointermove", (e) => {
        if (!isDragging || dragStart == null) return;
        const el = runtimeDocument.elementFromPoint(e.clientX, e.clientY);
        const lvl = getCellLevel(el);
        if (lvl != null) {
          updatePreview(dragStart, lvl);
        }
      });

      levelBar.addEventListener("pointerup", (e) => {
        if (!isDragging || dragStart == null) return;
        isDragging = false;
        const el = runtimeDocument.elementFromPoint(e.clientX, e.clientY);
        const endLvl = getCellLevel(el) ?? dragStart;
        commitDrag(dragStart, endLvl);
        dragStart = null;
        editingRangeIndex = -1;
      });

      levelBar.addEventListener("pointercancel", () => {
        isDragging = false;
        dragStart = null;
        editingRangeIndex = -1;
        for (const cell of levelBar.children) {
          const lvl = parseInt(cell.dataset.level, 10);
          cell.classList.toggle("is-active", levelInPowerSpikes(lvl, currentSpikes));
          cell.classList.remove("is-preview");
        }
      });
    }

    // Hint row with Clear button at bottom right
    const hintRow = runtimeDocument.createElement("div");
    hintRow.className = "ced-spike-hint-row";
    const hint = runtimeDocument.createElement("p");
    hint.className = "ced-spike-hint meta";
    hint.textContent = currentSpikes.length >= POWER_SPIKE_MAX_RANGES
      ? "Max 2 ranges. Clear to start over, or drag to replace the last range."
      : "Click and drag across levels to set a range.";
    const clearBtn = runtimeDocument.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "ced-spike-clear-btn";
    clearBtn.textContent = "Clear";
    clearBtn.disabled = state.api.isSavingChampionTags || currentSpikes.length === 0;
    clearBtn.addEventListener("click", () => onPowerSpikesChange([]));
    hintRow.append(hint, clearBtn);

    elements.cedEffectivenessSlot.append(labelRow, levelBar, hintRow);
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
  }
  return true;
}

function renderChampionMetadataEditors() {
  ensureChampionMetadataRoleProfiles();
  renderChampionMetadataRoleOptions();
  renderChampionMetadataRoleProfileEditors();
}

function renderChampionCompositionSynergySection() {
  const compositionSynergies =
    state.api.championMetadataDraft?.compositionSynergies ?? createEmptyChampionCompositionSynergiesDraft();
  const clauseCount = Array.isArray(compositionSynergies.rules) ? compositionSynergies.rules.length : 0;
  const controlsDisabled = state.api.isSavingChampionTags || state.api.isLoadingChampionTags;

  if (elements.championCompositionSynergyDefinition) {
    elements.championCompositionSynergyDefinition.value = compositionSynergies.definition ?? "";
    elements.championCompositionSynergyDefinition.disabled = controlsDisabled;
  }

  if (elements.championCompositionSynergyMeta) {
    elements.championCompositionSynergyMeta.textContent =
      clauseCount > 0
        ? `${clauseCount} synergy clause${clauseCount === 1 ? "" : "s"} will be evaluated against the rest of the team, not this champion.`
        : "Add optional champion-specific synergy clauses for what this pick wants from the surrounding comp.";
  }

  if (elements.championCompositionSynergyEdit) {
    elements.championCompositionSynergyEdit.disabled = controlsDisabled;
    elements.championCompositionSynergyEdit.textContent =
      clauseCount > 0 ? `Edit Clauses (${clauseCount})` : "Add Synergy Clauses";
  }
  if (elements.championCompositionSynergyClear) {
    elements.championCompositionSynergyClear.disabled =
      controlsDisabled || (clauseCount < 1 && String(compositionSynergies.definition ?? "").trim() === "");
  }
}

function renderChampionTagEditor() {
  if (!elements.championTagEditor) {
    return;
  }

  const championId = state.api.selectedChampionTagEditorId;
  const champion = Number.isInteger(championId) ? getChampionById(championId) : null;
  const leadTeamOptions = getChampionTagLeadTeamOptions();
  const scopeOptions = getChampionProfileScopeOptions();
  const canRenderEditor = Boolean(champion && isAuthenticated() && scopeOptions.length > 0);
  if (!canRenderEditor) {
    return;
  }

  state.api.championTagScope = normalizeChampionTagScope(state.api.championTagScope);
  if (!scopeOptions.some((option) => option.value === state.api.championTagScope)) {
    state.api.championTagScope = getChampionProfileDefaultScope();
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

  const activeScopeOption = scopeOptions.find((option) => option.value === state.api.championTagScope);
  const scopeLabel = activeScopeOption?.label ?? "Scope";
  const teamLabel = state.api.championTagScope === "team"
    ? leadTeamOptions.find((option) => option.value === state.api.championTagTeamId)?.label ?? "selected team"
    : "";
  const scopeMeta = state.api.championMetadataHasCustom
    ? `Editing ${scopeLabel.toLowerCase()} metadata${teamLabel ? ` for ${teamLabel}` : ""}.`
    : `${scopeLabel}${teamLabel ? ` (${teamLabel})` : ""} is currently using global metadata. Save to create a custom profile.`;
  const reviewMeta = champion?.reviewed === true
    ? formatAuditMeta(
        "Last reviewed",
        champion.reviewed_by_user_id,
        champion.reviewed_by_display_name,
        champion.reviewed_at
      )
    : "";
  setChampionTagEditorMeta(reviewMeta ? `${scopeMeta} ${reviewMeta}` : scopeMeta);
  if (elements.championTagEditorScopeTipText) {
    elements.championTagEditorScopeTipText.textContent = state.api.championMetadataHasCustom
      ? `Changes will update this ${scopeLabel.toLowerCase()} profile${teamLabel ? ` for ${teamLabel}` : ""}.`
      : `No ${scopeLabel.toLowerCase()} profile exists yet${teamLabel ? ` for ${teamLabel}` : ""}. Saving will create one.`;
  }

  renderChampionEditorTabs();
  renderChampionTagEditorTagOptions();
  renderChampionMetadataEditors();
  renderChampionCompositionSynergySection();
  if (elements.championTagEditorReviewed) {
    elements.championTagEditorReviewed.checked = state.api.championReviewedDraft === true;
    elements.championTagEditorReviewed.disabled = state.api.isSavingChampionTags || state.api.isLoadingChampionTags;
  }

  const metadataDraftComplete = championMetadataDraftIsComplete();

  if (elements.championTagEditorSave) {
    elements.championTagEditorSave.textContent = "Save Champion Profile";
    const compositionSaveBlocked = state.api.isLoadingChampionTags;
    elements.championTagEditorSave.disabled =
      state.api.isSavingChampionTags ||
      compositionSaveBlocked ||
      !metadataDraftComplete;
  }
  if (elements.championTagEditorClear) {
    elements.championTagEditorClear.disabled = state.api.isSavingChampionTags;
  }
}

function buildChampionScopeQuery() {
  const scope = normalizeChampionTagScope(state.api.championTagScope);
  const query = new URLSearchParams({ scope });
  if (scope === "team") {
    const teamId = normalizeTeamEntityId(state.api.championTagTeamId);
    if (!teamId) {
      return null;
    }
    query.set("team_id", teamId);
  }
  return query;
}

async function loadChampionScopedTags(championId) {
  if (!isAuthenticated() || !Number.isInteger(championId) || championId <= 0) {
    return false;
  }

  const query = buildChampionScopeQuery();
  if (!query) {
    setChampionTagEditorFeedback("Select a team to load team-scoped champion data.");
    return false;
  }

  try {
    const payload = await apiRequest(`/champions/${championId}/tags?${query.toString()}`, { auth: true });
    const payloadTagIds = payload?.tag_ids ?? payload?.tagIds;
    if (payloadTagIds !== undefined) {
      const scopedTagIds = normalizeApiTagIdArray(payloadTagIds);
      state.api.selectedChampionTagIds = scopedTagIds;
      if (payload?.reviewed !== undefined) {
        state.api.championReviewedDraft = payload.reviewed === true;
      }
    }
    if (payload?.team_id !== undefined && payload?.team_id !== null) {
      state.api.championTagTeamId = String(payload.team_id);
    }
    return true;
  } catch (error) {
    setChampionTagEditorFeedback(normalizeApiErrorMessage(error, "Failed to load scoped champion tags."));
    return false;
  }
}

async function loadChampionEditorTagCatalog() {
  const query = buildTagCatalogQuery({
    scope: state.api.championTagScope,
    teamId: state.api.championTagTeamId,
    includeFallback: true
  });
  if (!query) {
    setChampionTagEditorFeedback("Select a team to load team-scoped tags.");
    state.api.championEditorTags = [];
    state.api.championEditorTagById = {};
    return false;
  }

  try {
    const payload = await apiRequest(`/tags?${query.toString()}`, { auth: true });
    const source = Array.isArray(payload?.tags) ? payload.tags : [];
    const tags = source.map(normalizeTagCatalogEntry).filter(Boolean);
    state.api.championEditorTags = tags;
    state.api.championEditorTagById = Object.fromEntries(tags.map((tag) => [String(tag.id), tag]));
    return true;
  } catch (error) {
    state.api.championEditorTags = [];
    state.api.championEditorTagById = {};
    setChampionTagEditorFeedback(normalizeApiErrorMessage(error, "Failed to load scoped tag catalog."));
    return false;
  }
}

async function loadChampionScopedMetadata(championId) {
  if (!isAuthenticated() || !Number.isInteger(championId) || championId <= 0) {
    return false;
  }

  const query = buildChampionScopeQuery();
  if (!query) {
    setChampionTagEditorFeedback("Select a team to load team-scoped champion data.");
    return false;
  }

  try {
    const payload = await apiRequest(`/champions/${championId}/metadata?${query.toString()}`, { auth: true });
    const metadata =
      payload?.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
        ? payload.metadata
        : {};
    if (payload?.team_id !== undefined && payload?.team_id !== null) {
      state.api.championTagTeamId = String(payload.team_id);
    }
    initializeChampionMetadataDraftFromMetadata(metadata, payload?.reviewed === true);
    state.api.championMetadataHasCustom = payload?.has_custom_metadata === true;
    state.api.championMetadataResolvedScope = normalizeChampionTagScope(payload?.resolved_scope ?? "all");
    updateChampionMetadataScopeIndicator(championId, normalizeChampionTagScope(payload?.scope), state.api.championMetadataHasCustom);
    return true;
  } catch (error) {
    setChampionTagEditorFeedback(normalizeApiErrorMessage(error, "Failed to load scoped champion metadata."));
    return false;
  }
}

async function loadChampionEditorScopeData(championId) {
  state.api.isLoadingChampionTags = true;
  renderChampionTagEditor();
  try {
    const [tagsLoaded, metadataLoaded, catalogLoaded] = await Promise.all([
      loadChampionScopedTags(championId),
      loadChampionScopedMetadata(championId),
      loadChampionEditorTagCatalog()
    ]);
    if (tagsLoaded && metadataLoaded && catalogLoaded) {
      setChampionTagEditorFeedback("");
    }
    return tagsLoaded && metadataLoaded && catalogLoaded;
  } finally {
    state.api.isLoadingChampionTags = false;
    renderChampionTagEditor();
  }
}

async function openChampionTagEditor(championId) {
  const leadTeamOptions = getChampionTagLeadTeamOptions();
  if (!isAuthenticated() || !Number.isInteger(championId) || championId <= 0) {
    return;
  }

  const champion = getChampionById(championId);
  const previousEditorChampionId = state.api.selectedChampionTagEditorId;
  state.api.selectedChampionTagEditorId = championId;
  const scopedTagIds = normalizeChampionTagIdArray(champion?.tagIds);
  state.api.selectedChampionTagIds = scopedTagIds;
  const cardScope = getExplorerChampionActiveMetadataScope(champion);
  const validScopeOptions = getChampionProfileScopeOptions();
  if (cardScope !== "all" && validScopeOptions.some((option) => option.value === cardScope)) {
    state.api.championTagScope = cardScope;
  } else if (
    !Number.isInteger(previousEditorChampionId) ||
    !validScopeOptions.some((option) => option.value === state.api.championTagScope)
  ) {
    state.api.championTagScope = getChampionProfileDefaultScope();
  }
  if (state.api.championTagScope === "team") {
    const selectedTeam = getSelectedAdminTeam();
    const hasSelectedLeadTeam = selectedTeam?.membership_role === "lead" ? String(selectedTeam.id) : "";
    const firstLeadTeamValue = leadTeamOptions[0]?.value ?? "";
    state.api.championTagTeamId = hasSelectedLeadTeam || firstLeadTeamValue;
  } else {
    state.api.championTagTeamId = "";
  }
  initializeChampionMetadataDraft(champion);
  state.api.championMetadataHasCustom = champion?.metadataScopes?.[state.api.championTagScope] === true;
  state.api.championMetadataResolvedScope = state.api.championMetadataHasCustom
    ? state.api.championTagScope
    : "all";
  setChampionTagEditorFeedback("Loading champion profile...");

  state.explorer._savedScrollTop = elements.explorerResults ? elements.explorerResults.scrollTop : 0;
  if (elements.championGridPanel) elements.championGridPanel.hidden = true;
  if (elements.championTagEditor) elements.championTagEditor.hidden = false;

  renderChampionTagEditor();
  await loadChampionEditorScopeData(championId);
  state.api.championEditorSavedSnapshot = getChampionEditorSnapshot();
  renderChampionTagEditor();
}

function closeChampionTagEditor() {
  // Sync editor scope back to the grid card's view scope
  const editorChampionId = state.api.selectedChampionTagEditorId;
  const editorScope = normalizeChampionTagScope(state.api.championTagScope);
  if (Number.isInteger(editorChampionId) && editorChampionId > 0) {
    state.explorer.activeMetadataScopeByChampionId[String(editorChampionId)] = editorScope;
  }
  if (elements.championTagEditor) elements.championTagEditor.hidden = true;
  if (elements.championGridPanel) elements.championGridPanel.hidden = false;
  if (state.data) renderExplorer();
  const savedScroll = state.explorer._savedScrollTop || 0;
  if (savedScroll > 0 && elements.explorerResults) {
    requestAnimationFrame(() => {
      elements.explorerResults.scrollTop = savedScroll;
    });
  }
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
    leaveBtn.className = "ghost";
    leaveBtn.style.color = "var(--warn)";
    leaveBtn.textContent = "Leave Anyway";

    const stayBtn = runtimeDocument.createElement("button");
    stayBtn.type = "button";
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

/** USS confirmation modal — returns a Promise that resolves true (affirm) or false (cancel). */
function showUSSConfirm({ title = "Unsaved Changes", body = "", affirmLabel = "Leave Anyway", cancelLabel = "Stay", destructive = true } = {}) {
  return new Promise((resolve) => {
    const overlay = runtimeDocument.createElement("div");
    overlay.className = "nav-warning-toast";
    const box = runtimeDocument.createElement("div");
    box.className = "nav-warning-box";

    const titleEl = runtimeDocument.createElement("p");
    titleEl.className = "nav-warning-title";
    titleEl.textContent = title;

    const bodyEl = runtimeDocument.createElement("p");
    bodyEl.className = "nav-warning-body";
    bodyEl.textContent = body;

    const btnRow = runtimeDocument.createElement("div");
    btnRow.className = "button-row";

    const affirmBtn = runtimeDocument.createElement("button");
    affirmBtn.type = "button";
    affirmBtn.className = "ghost";
    if (destructive) affirmBtn.style.color = "var(--warn)";
    affirmBtn.textContent = affirmLabel;

    const cancelBtn = runtimeDocument.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = cancelLabel;

    function cleanup(result) {
      overlay.remove();
      resolve(result);
    }

    affirmBtn.addEventListener("click", () => cleanup(true));
    cancelBtn.addEventListener("click", () => cleanup(false));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(false); });

    btnRow.append(affirmBtn, cancelBtn);
    box.append(titleEl, bodyEl, btnRow);
    overlay.append(box);
    runtimeDocument.body.append(overlay);
    overlay.hidden = false;
  });
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
    if (scope === "all") {
      champion.tagIds = [...state.api.selectedChampionTagIds];
      champion.tags = deriveApiTagsFromTagIds(champion.tagIds);
    }
    champion.reviewed = response?.reviewed === true;
    champion.reviewed_by_user_id = normalizeApiEntityId(response?.reviewed_by_user_id);
    champion.reviewed_by_display_name =
      typeof response?.reviewed_by_display_name === "string" ? response.reviewed_by_display_name.trim() : "";
    champion.reviewed_at = typeof response?.reviewed_at === "string" ? response.reviewed_at : "";
  }
}

async function saveChampionMetadataTab(championId) {
  ensureChampionMetadataRoleProfiles();
  const roleProfilesPayload = {};
  for (const role of state.api.championMetadataDraft.roles) {
    const profile = state.api.championMetadataDraft.roleProfiles?.[role] ?? createDefaultRoleProfileDraft();
    roleProfilesPayload[role] = {
      primary_damage_type: normalizeApiPrimaryDamageType(profile.primaryDamageType) ?? "mixed",
      power_spikes: normalizePowerSpikes(profile.powerSpikes)
    };
  }
  const payload = {
    scope: normalizeChampionTagScope(state.api.championTagScope),
    roles: [...state.api.championMetadataDraft.roles],
    role_profiles: roleProfilesPayload
  };
  const compositionSynergyDefinition = String(
    state.api.championMetadataDraft?.compositionSynergies?.definition ?? ""
  ).trim();
  const compositionSynergyDraftRules = Array.isArray(state.api.championMetadataDraft?.compositionSynergies?.rules)
    ? state.api.championMetadataDraft.compositionSynergies.rules
    : [];
  if (compositionSynergyDefinition !== "" || compositionSynergyDraftRules.length > 0) {
    if (compositionSynergyDraftRules.length < 1) {
      throw new Error("Add at least one composition synergy clause or clear the summary.");
    }
    payload.composition_synergies = {
      definition: compositionSynergyDefinition,
      rules: parseRequirementRulesFromDraftClauses(compositionSynergyDraftRules)
    };
  } else {
    payload.composition_synergies = {
      definition: "",
      rules: []
    };
  }
  if (payload.scope === "team") {
    const teamId = normalizeTeamEntityId(state.api.championTagTeamId);
    if (!teamId) {
      throw new Error("Select a team before saving team-scoped metadata.");
    }
    payload.team_id = Number.parseInt(teamId, 10);
  }

  const response = await apiRequest(`/champions/${championId}/metadata`, {
    method: "PUT",
    auth: true,
    body: payload
  });
  syncChampionMetadataDraftToState(championId, response);
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
    setChampionTagEditorFeedback("Wait for the champion profile to finish loading before saving.");
    renderChampionTagEditor();
    return;
  }
  state.api.isSavingChampionTags = true;
  setChampionTagEditorFeedback("Saving champion profile...");
  renderChampionTagEditor();

  try {
    await saveChampionCompositionTab(championId);
    setChampionTagEditorFeedback("Saving scoped metadata...");
    await saveChampionMetadataTab(championId);
    setChampionTagEditorFeedback("Champion profile saved.");
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

function normalizePassiveApiErrorMessage(error, fallbackMessage) {
  const message = normalizeApiErrorMessage(error, fallbackMessage);
  return message === "An unexpected error occurred." ? fallbackMessage : message;
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
    syncProfilePreferenceSessionFields({
      avatarChampionId: null,
      displayTeamId: null
    });
    return false;
  }

  try {
    const payload = await apiRequest("/me/profile", { auth: true });
    const profile = payload?.profile ?? {};
    const primaryRole = normalizeProfileRole(profile.primaryRole);
    const apiAvatarChampionId = normalizePositiveInteger(profile.avatarChampionId);
    const nextAvatarChampionId = apiAvatarChampionId ?? state.profile.avatarChampionId;
    const displayTeamId = normalizeTeamEntityId(profile.displayTeamId);
    state.profile.primaryRole = primaryRole;
    state.profile.secondaryRoles = normalizeSecondaryRoles(profile.secondaryRoles, primaryRole);
    state.profile.championStats = normalizeChampionStats(profile.championStats);
    syncProfilePreferenceSessionFields({
      avatarChampionId: nextAvatarChampionId,
      displayTeamId
    });
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

async function saveProfileDisplayTeamPreference() {
  if (!isAuthenticated()) {
    return false;
  }
  if (state.profile.isSavingDisplayTeam) {
    return false;
  }
  const selectedDisplayTeamId = normalizeTeamEntityId(elements.profileDisplayTeamSelect?.value);

  state.profile.isSavingDisplayTeam = true;
  if (elements.profileDisplayTeamFeedback) {
    elements.profileDisplayTeamFeedback.textContent = "Saving...";
    elements.profileDisplayTeamFeedback.style.color = "";
  }
  renderPlayerConfig();

  try {
    const payload = await apiRequest("/me/profile/display-team", {
      method: "PUT",
      auth: true,
      body: {
        displayTeamId: selectedDisplayTeamId ? Number.parseInt(selectedDisplayTeamId, 10) : null
      }
    });
    const profile = payload?.profile ?? {};
    syncProfilePreferenceSessionFields({
      avatarChampionId: normalizePositiveInteger(profile.avatarChampionId),
      displayTeamId: normalizeTeamEntityId(profile.displayTeamId)
    });
    if (elements.profileDisplayTeamFeedback) {
      elements.profileDisplayTeamFeedback.textContent = "Display team saved.";
      elements.profileDisplayTeamFeedback.style.color = "";
    }
    renderPlayerConfig();
    return true;
  } catch (error) {
    if (elements.profileDisplayTeamFeedback) {
      elements.profileDisplayTeamFeedback.textContent = normalizeApiErrorMessage(error, "Failed to save display team.");
      elements.profileDisplayTeamFeedback.style.color = "var(--warn)";
    }
    return false;
  } finally {
    state.profile.isSavingDisplayTeam = false;
    renderPlayerConfig();
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
    state.api.discoverTeamsLoadedAt = null;
    state.api.isLoadingDiscoverTeams = false;
    state.api.selectedDiscoverTeamId = "";
    return false;
  }

  state.api.isLoadingDiscoverTeams = true;
  renderTeamAdmin();
  try {
    const payload = await apiRequest("/teams/discover", { auth: true });
    state.api.discoverTeams = Array.isArray(payload?.teams) ? payload.teams : [];
    state.api.discoverTeamsLoadedAt = new Date().toISOString();
    const selectedDiscoverTeam = findDiscoverTeamById(state.api.selectedDiscoverTeamId);
    state.api.selectedDiscoverTeamId = selectedDiscoverTeam
      ? String(selectedDiscoverTeam.id)
      : (state.api.discoverTeams[0] ? String(state.api.discoverTeams[0].id) : "");
    return true;
  } catch (error) {
    state.api.discoverTeams = [];
    state.api.discoverTeamsLoadedAt = null;
    state.api.selectedDiscoverTeamId = "";
    setTeamJoinFeedback(normalizeApiErrorMessage(error, "Failed to load discoverable teams."));
    return false;
  } finally {
    state.api.isLoadingDiscoverTeams = false;
    renderTeamAdmin();
  }
}

function canReviewSelectedTeam(team = getSelectedAdminTeam()) {
  return Boolean(team) && (team.membership_role === "lead" || isAdminUser());
}

async function refreshTeamWorkspaceDataForActiveTab() {
  if (!isAuthenticated()) {
    return;
  }

  if (state.ui.teamWorkspaceTab === TEAM_WORKSPACE_TAB_MANAGE) {
    if (canReviewSelectedTeam()) {
      await Promise.all([
        loadPendingJoinRequestsForSelectedTeam(),
        loadMemberInvitationsForSelectedTeam()
      ]);
    }
    return;
  }

  if (state.ui.teamWorkspaceTab === TEAM_WORKSPACE_TAB_MEMBER) {
    const refreshJobs = [
      loadDiscoverTeamsFromApi(),
      loadInvitationsForUser()
    ];
    if (canReviewSelectedTeam()) {
      refreshJobs.push(loadMemberInvitationsForSelectedTeam());
    }
    await Promise.all(refreshJobs);
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

  state.api.isLoadingJoinRequests = true;
  renderTeamAdmin();
  try {
    const payload = await apiRequest(`/teams/${selectedTeam.id}/join-requests?status=pending`, { auth: true });
    state.api.joinRequestsByTeamId[selectedTeamId] = Array.isArray(payload?.requests) ? payload.requests : [];
    state.api.joinRequestsLoadedAtByTeamId[selectedTeamId] = new Date().toISOString();
    return true;
  } catch (error) {
    state.api.joinRequestsByTeamId[selectedTeamId] = [];
    setTeamJoinFeedback(normalizeApiErrorMessage(error, "Failed to load pending join requests."));
    return false;
  } finally {
    state.api.isLoadingJoinRequests = false;
    renderTeamAdmin();
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

  // Power Spike Level multi-select
  if (elements.explorerScaling) {
    const levelOptions = [];
    for (let lvl = POWER_SPIKE_MIN_LEVEL; lvl <= POWER_SPIKE_MAX_LEVEL; lvl++) {
      levelOptions.push({ value: String(lvl), label: String(lvl) });
    }
    multiSelectControls.explorerScaling = createCheckboxMultiControl({
      root: elements.explorerScaling,
      options: levelOptions,
      selectedValues: [],
      placeholder: "Any Power Spike Level",
      onChange(selectedValues) {
        state.explorer.scaling = selectedValues.map((v) => parseInt(v, 10)).filter(Number.isInteger);
        renderExplorer();
      }
    });
  }

  replaceOptions(
    elements.explorerSort,
    [
      { value: "alpha-asc", label: "Alphabetical (A-Z)" },
      { value: "alpha-desc", label: "Alphabetical (Z-A)" },
      { value: "role", label: "Primary Role, then Name" }
    ]
  );
  refreshExplorerMetadataScopeFilterOptions();

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
  state.explorer.scaling = [];
  state.explorer.metadataScopeFilter = "";
  state.explorer.includeTags = [];
  state.explorer.excludeTags = [];
  state.explorer.sortBy = "alpha-asc";

  elements.explorerSearch.value = "";
  multiSelectControls.explorerRole?.setSelected([NO_FILTER]);
  multiSelectControls.explorerDamage?.setSelected([NO_FILTER]);
  multiSelectControls.explorerScaling?.setSelected([]);
  elements.explorerSort.value = "alpha-asc";
  refreshExplorerMetadataScopeFilterOptions();
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
  if (Array.isArray(state.explorer.scaling) && state.explorer.scaling.length > 0) {
    pills.push({ label: "Power Spike Level", values: state.explorer.scaling.map(String) });
  }
  if (state.explorer.sortBy !== "alpha-asc") {
    const sortLabels = { "alpha-desc": "Alphabetical (Z-A)", role: "Primary Role, then Name" };
    pills.push({ label: "Sort Cards", values: [sortLabels[state.explorer.sortBy] ?? state.explorer.sortBy] });
  }
  if (state.explorer.metadataScopeFilter) {
    const scopeLabel = getExplorerMetadataScopeFilterOptions().find(
      (option) => option.value === state.explorer.metadataScopeFilter
    )?.label ?? state.explorer.metadataScopeFilter;
    pills.push({ label: "Custom Metadata", values: [scopeLabel] });
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
  const compositions = getBuilderCompositionBundles();
  return compositions.map((composition) => ({
    value: String(composition.id),
    label: composition.is_active ? `${composition.name} (Active)` : composition.name
  }));
}

function resolveBuilderActiveCompositionId(rawId = null) {
  const compositions = getBuilderCompositionBundles();
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
    getBuilderCompositionBundles().find(
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
    getBuilderRequirementDefinitions().map((requirement) => [
      requirement.id,
      requirement
    ])
  );
  return selectedComposition.requirement_ids
    .map((requirementId) => requirementById.get(requirementId) ?? null)
    .filter(Boolean);
}

function hasRequirements() {
  return Array.isArray(state.api.requirementDefinitions) && state.api.requirementDefinitions.length > 0;
}

function hasCompositions() {
  return Array.isArray(state.api.compositionBundles) && state.api.compositionBundles.length > 0;
}

function renderAllGettingStartedBars() {
  const tourHidden = !state.ui.showGettingStarted || state.ui.gettingStartedDismissed;

  /* All three pages now use tour callouts */
  if (elements.builderTourCallout) {
    elements.builderTourCallout.hidden = tourHidden;
  }
  if (elements.compositionsTourCallout) {
    elements.compositionsTourCallout.hidden = tourHidden;
  }
  if (elements.requirementsTourCallout) {
    elements.requirementsTourCallout.hidden = tourHidden;
  }

  /* Profile setting value */
  if (elements.profileSettingGettingStartedValue) {
    elements.profileSettingGettingStartedValue.textContent = state.ui.showGettingStarted ? "Visible" : "Hidden";
  }
}

/* ── Guided Tour System ── */

function runGuidedTour(steps, { onFinish = null } = {}) {
  let currentStep = 0;

  function cleanup() {
    const existing = runtimeDocument.querySelector(".tour-overlay");
    if (existing) existing.remove();
    const highlighted = runtimeDocument.querySelectorAll(".tour-highlight");
    for (const el of highlighted) el.classList.remove("tour-highlight");
  }

  function finish() {
    cleanup();
    if (onFinish) onFinish();
  }

  function restart() {
    cleanup();
    closeAllDraftModals();
    currentStep = 0;
    showStep();
  }

  function showStep() {
    cleanup();
    if (currentStep >= steps.length) return;

    const step = steps[currentStep];

    if (step.before) step.before();

    const resolveTarget = () =>
      typeof step.target === "function" ? step.target() : runtimeDocument.querySelector(step.target);

    const target = resolveTarget();

    if (!target) {
      runtimeWindow.setTimeout(() => {
        const retryTarget = resolveTarget();
        if (retryTarget) {
          renderPopover(retryTarget);
        } else {
          currentStep++;
          showStep();
        }
      }, 120);
      return;
    }

    renderPopover(target);
  }

  function renderPopover(target) {
    const step = steps[currentStep];
    target.classList.add("tour-highlight");
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });

    const overlay = runtimeDocument.createElement("div");
    overlay.className = "tour-overlay";

    const popover = runtimeDocument.createElement("div");
    popover.className = "tour-popover";

    const stepLabel = runtimeDocument.createElement("span");
    stepLabel.className = "tour-step-label";
    stepLabel.textContent = `Step ${currentStep + 1} of ${steps.length}`;

    const msg = runtimeDocument.createElement("p");
    msg.className = "tour-message";
    msg.textContent = step.message;

    const btnRow = runtimeDocument.createElement("div");
    btnRow.className = "tour-btn-row";

    const exitBtn = runtimeDocument.createElement("button");
    exitBtn.type = "button";
    exitBtn.className = "ghost tour-exit-btn";
    exitBtn.textContent = "Exit Tour";
    exitBtn.addEventListener("click", finish);

    const restartBtn = runtimeDocument.createElement("button");
    restartBtn.type = "button";
    restartBtn.className = "ghost tour-exit-btn";
    restartBtn.textContent = "Restart";
    restartBtn.addEventListener("click", restart);

    btnRow.append(exitBtn, restartBtn);

    if (currentStep < steps.length - 1) {
      const nextBtn = runtimeDocument.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "tour-next-btn";
      nextBtn.textContent = "Next";
      nextBtn.addEventListener("click", () => {
        currentStep++;
        showStep();
      });
      btnRow.append(nextBtn);
    } else {
      const finishBtn = runtimeDocument.createElement("button");
      finishBtn.type = "button";
      finishBtn.className = "tour-next-btn";
      finishBtn.textContent = "Finish";
      finishBtn.addEventListener("click", finish);
      btnRow.append(finishBtn);
    }

    popover.append(stepLabel, msg, btnRow);
    overlay.append(popover);
    runtimeDocument.body.append(overlay);

    requestAnimationFrame(() => {
      const rect = target.getBoundingClientRect();
      const popRect = popover.getBoundingClientRect();
      let top = rect.bottom + 8;
      let left = rect.left;

      if (top + popRect.height > runtimeWindow.innerHeight - 12) {
        top = rect.top - popRect.height - 8;
      }
      if (left + popRect.width > runtimeWindow.innerWidth - 12) {
        left = runtimeWindow.innerWidth - popRect.width - 12;
      }
      if (left < 12) left = 12;

      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
    });
  }

  showStep();
}

function closeAllDraftModals() {
  const overlays = runtimeDocument.querySelectorAll(".draft-modal-overlay");
  for (const o of overlays) o.remove();
}

async function closeAllModalsOnNavigate() {
  // Close body-appended popovers
  for (const p of runtimeDocument.body.querySelectorAll(":scope > .clause-popover")) p.remove();

  // Issue report: dirty check if title or description has user-entered content
  if (state.api.issueReporting.isOpen) {
    const hasContent = (elements.issueReportSubject?.value ?? "").trim() !== "" ||
      (elements.issueReportDescription?.value ?? "").trim() !== "";
    if (hasContent) {
      const confirmed = await showUSSConfirm({
        title: "Unsaved Issue Report",
        body: "You have unsaved issue report content. Discard it?",
        affirmLabel: "Discard",
        cancelLabel: "Keep Editing",
        destructive: true
      });
      if (!confirmed) return false;
    }
    closeIssueReportingPanel();
  }

  // Tags manage modal: dirty check if name has content (covers both create and edit)
  if (state.api.isTagsManageModalOpen) {
    const hasContent = (elements.tagsManageName?.value ?? "").trim() !== "";
    if (hasContent) {
      const confirmed = await showUSSConfirm({
        title: "Unsaved Tag",
        body: "You have unsaved tag changes. Discard them?",
        affirmLabel: "Discard",
        cancelLabel: "Keep Editing",
        destructive: true
      });
      if (!confirmed) return false;
    }
    closeTagsManageModal();
  }

  // Close tag promotion modal if open
  if (state.api.isTagPromotionModalOpen) {
    closeTagPromotionModal();
  }

  // Close all draft modals (compositions editor, requirement editor, etc.)
  closeAllDraftModals();
  return true;
}

function startRequirementsTour() {
  runGuidedTour([
    {
      target: "#requirements-create-btn",
      message: "Click \"+ New\" to open the requirement editor and start building a new requirement."
    },
    {
      target: () => runtimeDocument.querySelector(".draft-modal.clause-editor-modal .draft-modal-body label input[type='text'][placeholder*='Frontline']"),
      message: "Enter a name for your requirement — e.g. \"Frontline Anchor\" or \"AP Carry\".",
      before: () => {
        if (!runtimeDocument.querySelector(".draft-modal.clause-editor-modal")) {
          openRequirementEditorModal(null);
        }
      }
    },
    {
      target: () => runtimeDocument.querySelector(".draft-modal.clause-editor-modal .draft-modal-body label input[type='text'][placeholder*='enforces']"),
      message: "Add a short definition describing what this requirement enforces. This is optional but helps other team members."
    },
    {
      target: () => runtimeDocument.querySelector(".draft-modal.clause-editor-modal .comp-card-header .comp-action-btn"),
      message: "Click \"+ Add Clause\" to create your first clause. Clauses define which champions satisfy this requirement."
    },
    {
      target: () => runtimeDocument.querySelector(".draft-modal.clause-editor-modal .requirement-clause-card"),
      message: "Set the expression to define what champions must match — e.g. a specific tag, role, or damage type.",
      before: () => {
        if (!runtimeDocument.querySelector(".draft-modal.clause-editor-modal .requirement-clause-card")) {
          const addBtn = runtimeDocument.querySelector(".draft-modal.clause-editor-modal .comp-card-header .comp-action-btn");
          if (addBtn) addBtn.click();
        }
      }
    },
    {
      target: () => {
        const cards = runtimeDocument.querySelectorAll(".draft-modal.clause-editor-modal .requirement-clause-card");
        if (cards.length > 0) {
          const lastCard = cards[cards.length - 1];
          return lastCard.querySelector(".requirement-clause-summary") || lastCard;
        }
        return null;
      },
      message: "Set the min count (how many champions must satisfy this clause). Default is 1. You can also set max count, role filters, and separation rules."
    },
    {
      target: () => runtimeDocument.querySelector(".draft-modal.clause-editor-modal .draft-modal-footer button:not(.ghost)"),
      message: "Click \"Create\" to save your requirement. It will appear as a card on the Requirements page."
    }
  ], {
    onFinish: () => {
      closeAllDraftModals();
    }
  });
}

function startCompositionsTour() {
  runGuidedTour([
    {
      target: "#compositions-create-btn",
      message: "Click \"+ New\" to open the composition editor. A composition groups requirements together for use in drafting."
    },
    {
      target: () => runtimeDocument.querySelector(".draft-modal .draft-modal-body label input[type='text'][placeholder*='Teamfight']"),
      message: "Enter a name for your composition — e.g. \"Teamfight Core\" or \"Poke Comp\".",
      before: () => {
        if (!runtimeDocument.querySelector(".draft-modal")) {
          openCompositionEditorModal(null);
        }
      }
    },
    {
      target: () => runtimeDocument.querySelector(".draft-modal .draft-modal-body label input[type='text'][placeholder*='Optional context']"),
      message: "Add an optional description to provide context for this composition."
    },
    {
      target: () => runtimeDocument.querySelector(".draft-modal .draft-modal-body .inline-checkbox"),
      message: "Check this box to set this composition as the active one used during drafting. Only one composition can be active at a time."
    },
    {
      target: () => runtimeDocument.querySelector(".draft-modal .draft-modal-body .excluded-options"),
      message: "Select which requirements to include in this composition. Check each requirement that should be evaluated during a draft.",
      before: () => {
        /* Ensure requirement options are visible */
      }
    },
    {
      target: () => runtimeDocument.querySelector(".draft-modal .draft-modal-footer button:not(.ghost)"),
      message: "Click \"Create\" to save your composition. It will appear as a card on the Compositions page and can be selected in the Composer."
    }
  ], {
    onFinish: () => {
      closeAllDraftModals();
    }
  });
}

function startComposerTour() {
  runGuidedTour([
    {
      target: "#builder-active-team",
      message: "Select the team you want to draft for. This determines which player pools and scoped data are available."
    },
    {
      target: "#builder-active-composition",
      message: "Choose a composition to use during the draft. Compositions group requirements that will be evaluated as you pick champions."
    },
    {
      target: () => runtimeDocument.querySelector("#builder-stage-setup .comp-header-actions"),
      message: "Use these links to create or manage compositions and requirements if you haven't set them up yet."
    },
    {
      target: "#builder-generate",
      message: "Click \"Start Draft\" to begin drafting. The Draft Roster, Draft Selector, and Requirement Status panels will guide your picks."
    }
  ], {
    onFinish: () => {
      closeAllDraftModals();
    }
  });
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

  const selectedComposition = getBuilderSelectedComposition();

  /* Pencil icon: disable when nothing is selected */
  if (elements.builderCompEdit) {
    elements.builderCompEdit.disabled = !selectedComposition;
  }

  /* Tour callout visibility */
  if (elements.builderTourCallout) {
    elements.builderTourCallout.hidden = !state.ui.showGettingStarted || state.ui.gettingStartedDismissed;
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
    count.textContent = `${champions.length} champion${champions.length === 1 ? "" : "s"} in roster.`;

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
          generateTreeFromCurrentState({ scrollToResults: false });
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
      generateTreeFromCurrentState({ scrollToResults: false });
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
      generateTreeFromCurrentState({ scrollToResults: false });
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
    elements.teamJoinDiscoverSelect.disabled = !isAuthenticated() || state.api.isLoadingDiscoverTeams;
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
  if (elements.teamJoinDiscoverRefresh) {
    elements.teamJoinDiscoverRefresh.disabled = !isAuthenticated() || state.api.isLoadingDiscoverTeams;
  }

  if (elements.teamJoinDiscoverMeta) {
    const loadedAt = formatTimestampMeta(state.api.discoverTeamsLoadedAt);
    if (!isAuthenticated()) {
      elements.teamJoinDiscoverMeta.textContent = "Sign in to browse teams.";
    } else if (!selectedDiscoverTeam) {
      elements.teamJoinDiscoverMeta.textContent = loadedAt
        ? `Last refreshed ${loadedAt}.`
        : (state.api.isLoadingDiscoverTeams ? "Refreshing..." : "Not refreshed yet.");
    } else if (selectedMembershipRole) {
      elements.teamJoinDiscoverMeta.textContent = loadedAt
        ? `Last refreshed ${loadedAt}.`
        : `On ${formatTeamCardTitle(selectedDiscoverTeam)} as ${selectedMembershipRole}.`;
    } else if (hasPendingRequest) {
      elements.teamJoinDiscoverMeta.textContent = loadedAt
        ? `Last refreshed ${loadedAt}.`
        : `Pending request to ${formatTeamCardTitle(selectedDiscoverTeam)}.`;
    } else {
      elements.teamJoinDiscoverMeta.textContent = loadedAt
        ? `Last refreshed ${loadedAt}.`
        : "Not refreshed yet.";
    }
  }

  const canReview = Boolean(selectedTeam) && (selectedTeam.membership_role === "lead" || isAdminUser());
  if (elements.teamJoinReviewRefresh) {
    elements.teamJoinReviewRefresh.disabled = !isAuthenticated() || !canReview || state.api.isLoadingJoinRequests;
  }
  if (elements.teamJoinReviewMeta) {
    if (!isAuthenticated()) {
      elements.teamJoinReviewMeta.textContent = "Sign in to review join requests.";
    } else if (!selectedTeam) {
      elements.teamJoinReviewMeta.textContent = "Select a managed team.";
    } else if (!canReview) {
      elements.teamJoinReviewMeta.textContent = "Only leads and admins can review requests for this team.";
    } else {
      const requests = state.api.joinRequestsByTeamId[String(selectedTeam.id)] ?? [];
      const loadedAt = formatTimestampMeta(state.api.joinRequestsLoadedAtByTeamId[String(selectedTeam.id)]);
      elements.teamJoinReviewMeta.textContent = loadedAt
        ? `Last refreshed ${loadedAt}.`
        : (state.api.isLoadingJoinRequests ? "Refreshing..." : "Not refreshed yet.");
    }
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

  if (state.api.isLoadingJoinRequests) {
    const loading = runtimeDocument.createElement("p");
    loading.className = "meta";
    loading.textContent = "Loading pending join requests...";
    elements.teamJoinReviewList.append(loading);
    return;
  }

  const requests = state.api.joinRequestsByTeamId[String(selectedTeam.id)] ?? [];
  if (requests.length === 0) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "No pending requests.";
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

    const telemetry = runtimeDocument.createElement("p");
    telemetry.className = "meta";
    const submittedAt = formatTimestampMeta(request?.created_at);
    const requesterEmail = typeof request?.requester?.email === "string" ? request.requester.email.trim() : "";
    telemetry.textContent = [
      submittedAt ? `Submitted ${submittedAt}` : "",
      requesterEmail ? requesterEmail : ""
    ].filter(Boolean).join(" • ");

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
    card.append(title, lane, note);
    if (telemetry.textContent) {
      card.append(telemetry);
    }
    card.append(actions);
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
  const selectedTeamId = selectedTeam ? String(selectedTeam.id) : "";

  const isAuth = isAuthenticated();
  if (elements.teamInviteRefresh) {
    elements.teamInviteRefresh.disabled =
      !isAuth || !selectedTeam || state.api.isLoadingTeamInvitations;
  }
  if (elements.teamInviteListMeta) {
    if (!isAuth) {
      elements.teamInviteListMeta.textContent = "Sign in to view sent invites.";
    } else if (!selectedTeam) {
      elements.teamInviteListMeta.textContent = "Select a managed team.";
    } else {
      const loadedAt = formatTimestampMeta(state.api.teamInvitationsLoadedAtByTeamId[selectedTeamId]);
      const loadFailed = state.api.teamInvitationsLoadErrorByTeamId[selectedTeamId] === true;
      elements.teamInviteListMeta.textContent = loadedAt
        ? `Last refreshed ${loadedAt}.`
        : state.api.isLoadingTeamInvitations
          ? "Refreshing..."
          : loadFailed
            ? "Refresh failed."
            : "Not refreshed yet.";
    }
  }

  if (elements.teamInviteListFeedback) {
    const hasVisibleError = Boolean(selectedTeamId) && state.api.teamInvitationsLoadErrorByTeamId[selectedTeamId] === true;
    if (!isAuth || !hasVisibleError) {
      elements.teamInviteListFeedback.textContent = "";
    }
  }

  if (!isAuth) {
    const message = runtimeDocument.createElement("p");
    message.className = "meta";
    message.textContent = "Sign in to view sent invites.";
    elements.teamInviteList.append(message);
    return;
  }

  if (!selectedTeam) {
    const message = runtimeDocument.createElement("p");
    message.className = "meta";
    message.textContent = "Select a managed team.";
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
    empty.textContent = "No sent invites.";
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

    const telemetry = runtimeDocument.createElement("p");
    telemetry.className = "meta";
    const createdAt = formatTimestampMeta(invitation?.created_at);
    const reviewedAt = formatTimestampMeta(invitation?.reviewed_at);
    telemetry.textContent = [
      createdAt ? `Created ${createdAt}` : "",
      reviewedAt ? `Reviewed ${reviewedAt}` : ""
    ].filter(Boolean).join(" • ");

    card.append(title, lane, note, status);
    if (telemetry.textContent) {
      card.append(telemetry);
    }

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
  if (elements.teamInviteUserRefresh) {
    elements.teamInviteUserRefresh.disabled = !isAuthenticated() || state.api.isLoadingUserInvitations;
  }
  if (elements.teamInviteUserMeta && !isAuthenticated()) {
    elements.teamInviteUserMeta.textContent = "Sign in to review invites.";
  }

  if (!isAuthenticated()) {
    const message = runtimeDocument.createElement("p");
    message.className = "meta";
    message.textContent = "Sign in to review invites.";
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
  if (elements.teamInviteUserMeta) {
    const loadedAt = formatTimestampMeta(state.api.userInvitationsLoadedAt);
    elements.teamInviteUserMeta.textContent = loadedAt
      ? `Last refreshed ${loadedAt}.`
      : state.api.isLoadingUserInvitations
        ? "Refreshing..."
        : state.api.userInvitationsLoadError
          ? "Refresh failed."
          : "Not refreshed yet.";
  }
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

    const telemetry = runtimeDocument.createElement("p");
    telemetry.className = "meta";
    const createdAt = formatTimestampMeta(invitation?.created_at);
    const reviewedAt = formatTimestampMeta(invitation?.reviewed_at);
    telemetry.textContent = [
      createdAt ? `Created ${createdAt}` : "",
      reviewedAt ? `Reviewed ${reviewedAt}` : ""
    ].filter(Boolean).join(" • ");

    card.append(title, lane, note, status);
    if (telemetry.textContent) {
      card.append(telemetry);
    }

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
  state.api.teamInvitationsLoadErrorByTeamId[String(teamId)] = false;
  renderTeamInviteList(selectedTeam);

  try {
    const payload = await apiRequest(`/teams/${teamId}/member-invitations?status=${status}`, { auth: true });
    const invitations = Array.isArray(payload?.invitations) ? payload.invitations : [];
    state.api.invitationsByTeamId[String(teamId)] = invitations;
    state.api.teamInvitationsLoadedAtByTeamId[String(teamId)] = new Date().toISOString();
    setTeamInviteFeedback("");
    setTeamInviteListFeedback("");
    return true;
  } catch (error) {
    const message = normalizePassiveApiErrorMessage(error, "Couldn't refresh sent invites. Try again.");
    state.api.invitationsByTeamId[String(teamId)] = [];
    state.api.teamInvitationsLoadErrorByTeamId[String(teamId)] = true;
    setTeamInviteFeedback(message);
    setTeamInviteListFeedback(message);
    return false;
  } finally {
    state.api.isLoadingTeamInvitations = false;
    renderTeamInviteList(selectedTeam);
  }
}

async function loadInvitationsForUser({ status = "pending" } = {}) {
  if (!isAuthenticated()) {
    state.api.userInvitations = [];
    state.api.userInvitationsLoadedAt = null;
    state.api.userInvitationsLoadError = false;
    return false;
  }

  state.api.isLoadingUserInvitations = true;
  state.api.userInvitationsLoadError = false;
  renderTeamInviteUserList();

  try {
    const payload = await apiRequest(`/me/member-invitations?status=${status}`, { auth: true });
    state.api.userInvitations = Array.isArray(payload?.invitations) ? payload.invitations : [];
    state.api.userInvitationsLoadedAt = new Date().toISOString();
    state.api.userInvitationsLoadError = false;
    setTeamInviteUserFeedback("");
    return true;
  } catch (error) {
    state.api.userInvitations = [];
    state.api.userInvitationsLoadedAt = null;
    state.api.userInvitationsLoadError = true;
    setTeamInviteUserFeedback(normalizePassiveApiErrorMessage(error, "Couldn't refresh invites. Try again."));
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

function normalizeTeamMemberSearchCandidate(rawCandidate) {
  if (!rawCandidate || typeof rawCandidate !== "object" || Array.isArray(rawCandidate)) {
    return null;
  }
  const userId = normalizeApiEntityId(rawCandidate.user_id ?? rawCandidate.id);
  if (!userId) {
    return null;
  }
  const gameName = typeof rawCandidate.game_name === "string" ? rawCandidate.game_name.trim() : "";
  const tagline = typeof rawCandidate.tagline === "string" ? rawCandidate.tagline.trim() : "";
  const riotId =
    typeof rawCandidate.riot_id === "string"
      ? rawCandidate.riot_id.trim()
      : (gameName && tagline ? `${gameName}#${tagline}` : "");
  if (!riotId) {
    return null;
  }
  return {
    user_id: userId,
    riot_id: riotId,
    email: typeof rawCandidate.email === "string" ? rawCandidate.email.trim() : "",
    display_name: typeof rawCandidate.display_name === "string" ? rawCandidate.display_name.trim() : riotId,
    primary_role: typeof rawCandidate.primary_role === "string" ? rawCandidate.primary_role.trim() : ""
  };
}

function renderTeamMemberRiotIdOptions() {
  const selectedTeam = getSelectedAdminTeam();
  const members = selectedTeam ? state.api.membersByTeamId[String(selectedTeam.id)] ?? [] : [];
  const memberOptions = members
    .map((member) => {
      const riotId = resolveMemberRiotId(member);
      if (!riotId) {
        return null;
      }
      const meta = [
        typeof member?.team_role === "string" ? member.team_role : "",
        typeof member?.lane === "string" ? member.lane : ""
      ].filter(Boolean).join(" • ");
      return {
        value: riotId,
        label: meta ? `${member.display_name ?? riotId} • ${meta}` : (member.display_name ?? riotId)
      };
    })
    .filter(Boolean);
  replaceDatalistOptions(elements.teamAdminRoleRiotIdOptions, memberOptions);
  replaceDatalistOptions(elements.teamAdminTeamRoleRiotIdOptions, memberOptions);
  replaceDatalistOptions(elements.teamAdminRemoveRiotIdOptions, memberOptions);

  const addOptions = (Array.isArray(state.api.teamAdminAddMemberSearchResults)
    ? state.api.teamAdminAddMemberSearchResults
    : [])
    .map((candidate) => ({
      value: candidate.riot_id,
      label: [candidate.display_name, candidate.email, candidate.primary_role].filter(Boolean).join(" • ")
    }));
  replaceDatalistOptions(elements.teamAdminAddRiotIdOptions, addOptions);
}

async function loadTeamAdminAddMemberSearchResults(rawQuery) {
  const selectedTeam = getSelectedAdminTeam();
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  state.api.teamAdminAddMemberSearchQuery = query;
  if (!selectedTeam || query.length < TEAM_MEMBER_SEARCH_MIN_LENGTH) {
    state.api.teamAdminAddMemberSearchResults = [];
    state.api.isLoadingTeamAdminAddMemberSearch = false;
    renderTeamMemberRiotIdOptions();
    return;
  }

  const requestId = ++_teamAdminAddMemberSearchRequestId;
  state.api.isLoadingTeamAdminAddMemberSearch = true;
  try {
    const params = new URLSearchParams({ q: query });
    const payload = await apiRequest(`/teams/${selectedTeam.id}/member-search?${params.toString()}`, { auth: true });
    if (requestId !== _teamAdminAddMemberSearchRequestId || state.api.teamAdminAddMemberSearchQuery !== query) {
      return;
    }
    state.api.teamAdminAddMemberSearchResults = Array.isArray(payload?.users)
      ? payload.users.map(normalizeTeamMemberSearchCandidate).filter(Boolean)
      : [];
  } catch (error) {
    if (requestId !== _teamAdminAddMemberSearchRequestId) {
      return;
    }
    state.api.teamAdminAddMemberSearchResults = [];
    setTeamAdminFeedback(normalizeApiErrorMessage(error, "Failed to search team members."));
  } finally {
    if (requestId === _teamAdminAddMemberSearchRequestId) {
      state.api.isLoadingTeamAdminAddMemberSearch = false;
      renderTeamMemberRiotIdOptions();
    }
  }
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
  if (!adminEnabled) {
    state.api.teamAdminAddMemberSearchResults = [];
    state.api.isLoadingTeamAdminAddMemberSearch = false;
  }
  renderTeamMemberRiotIdOptions();
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

  const pillRow = runtimeDocument.createElement("div");
  pillRow.className = "other-roles-pill-row";
  for (const role of secondaryCandidates) {
    const btn = runtimeDocument.createElement("button");
    btn.type = "button";
    btn.className = "role-pill";
    if (selectedSecondary.has(role)) btn.classList.add("is-active");
    btn.textContent = role;
    btn.disabled = !authenticated || isSavingRoles;
    btn.addEventListener("click", () => {
      if (selectedSecondary.has(role)) {
        selectedSecondary.delete(role);
      } else {
        selectedSecondary.add(role);
      }
      state.profile.secondaryRoles = normalizeSecondaryRoles(
        Array.from(selectedSecondary),
        state.profile.primaryRole
      );
      btn.classList.toggle("is-active", selectedSecondary.has(role));
    });
    pillRow.append(btn);
  }
  elements.profileSecondaryRoles.append(pillRow);
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
  const topChampion = championStats.topChampion;

  if (status === "ok") {
    if (champions.length === 0) {
      return "No Riot champion mastery data returned for this account.";
    }
    const championLabel =
      topChampion && typeof topChampion.championName === "string" && topChampion.championName.trim() !== ""
        ? topChampion.championName
        : `Champion #${champions[0].championId}`;
    return `Most played champion: ${championLabel}. Showing top ${champions.length} mastery entr${champions.length === 1 ? "y" : "ies"} from Riot.`;
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

  return "Riot champion stats are not available yet for this profile.";
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

function getProfileChampionLabel(champion) {
  if (champion?.championName && champion.championName.trim() !== "") {
    return champion.championName;
  }
  return `Champion #${champion?.championId}`;
}

function renderProfileChampionPortrait(champion, className) {
  const portraitWrap = runtimeDocument.createElement("div");
  portraitWrap.className = className;

  const label = getProfileChampionLabel(champion);
  if (champion?.championName && champion.championName.trim() !== "") {
    const image = runtimeDocument.createElement("img");
    image.src = getChampionSquareUrl(champion.championName);
    image.alt = `${champion.championName} portrait`;
    image.addEventListener("error", () => {
      image.src = championImageFallback(champion.championName);
    });
    portraitWrap.append(image);
    return portraitWrap;
  }

  const fallback = runtimeDocument.createElement("span");
  fallback.textContent = String(label).slice(0, 2).toUpperCase();
  portraitWrap.append(fallback);
  return portraitWrap;
}

function renderProfileChampionStatCard(champion, { rank = null, featured = false } = {}) {
  const card = runtimeDocument.createElement("article");
  card.className = featured ? "profile-riot-featured-card" : "summary-card profile-riot-secondary-card";

  const header = runtimeDocument.createElement("div");
  header.className = featured ? "profile-riot-featured-header" : "profile-riot-secondary-header";

  if (featured) {
    header.append(renderProfileChampionPortrait(champion, "profile-riot-featured-media"));
  }

  const body = runtimeDocument.createElement("div");
  body.className = featured ? "profile-riot-featured-body" : "profile-riot-secondary-body";

  const kicker = runtimeDocument.createElement("p");
  kicker.className = "panel-kicker";
  kicker.textContent = featured ? "" : `#${rank}`;
  if (featured) kicker.hidden = true;

  const title = runtimeDocument.createElement("strong");
  title.textContent = getProfileChampionLabel(champion);

  const mastery = runtimeDocument.createElement("p");
  mastery.className = "meta";
  mastery.textContent = `Mastery ${champion.championLevel} | ${NUMBER_FORMATTER.format(champion.championPoints)} pts`;

  const played = runtimeDocument.createElement("p");
  played.className = "meta";
  played.textContent = formatLastPlayedText(champion.lastPlayedAt);

  body.append(kicker, title, mastery, played);
  header.append(body);
  card.append(header);

  return card;
}

function renderProfileChampionStatsSection() {
  if (!elements.profileRiotStatsSummary || !elements.profileRiotStatsList || !elements.profileRiotTopChampion) {
    return;
  }

  const authenticated = isAuthenticated();
  const championStats = normalizeChampionStats(state.profile.championStats);

  // Only show summary text for non-ok states
  if (!authenticated || championStats.status !== "ok" || championStats.champions.length === 0) {
    elements.profileRiotStatsSummary.textContent = formatProfileChampionStatsSummary(championStats, authenticated);
  } else {
    elements.profileRiotStatsSummary.textContent = "";
  }

  elements.profileRiotTopChampion.innerHTML = "";
  elements.profileRiotStatsList.innerHTML = "";

  if (!authenticated || championStats.status !== "ok" || championStats.champions.length === 0) {
    return;
  }

  // Container label
  const label = runtimeDocument.createElement("p");
  label.className = "panel-kicker profile-riot-top-label";
  label.textContent = "Most Played Champions";
  elements.profileRiotTopChampion.append(label);

  // Top 3 champions, all rendered as featured cards with portrait
  const topThree = championStats.champions.slice(0, 3);
  const grid = runtimeDocument.createElement("div");
  grid.className = "profile-riot-top-grid";
  for (const champion of topThree) {
    grid.append(renderProfileChampionStatCard(champion, { featured: true }));
  }
  elements.profileRiotTopChampion.append(grid);
}

function buildProfileChampionSuggestions() {
  if (!isAuthenticated()) {
    return [];
  }
  const activeRole = parseRolePoolTeamId(state.playerConfig.teamId) ?? state.profile.primaryRole;
  if (!activeRole) {
    return [];
  }
  const activePlayer = getMyChampionsActivePlayer();
  if (!activePlayer) {
    return [];
  }

  const championStats = normalizeChampionStats(state.profile.championStats);
  if (championStats.status !== "ok" || championStats.champions.length < 1) {
    return [];
  }

  const currentRolePool = new Set(
    Array.isArray(activePlayer.champions) ? activePlayer.champions : []
  );
  const recentThresholdMs = RECENT_SUGGESTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  const suggestions = [];
  for (const masteryEntry of championStats.champions) {
    if (!isHighSignalMasteryEntry(masteryEntry)) {
      continue;
    }
    const playedAt = typeof masteryEntry.lastPlayedAt === "string" ? new Date(masteryEntry.lastPlayedAt) : null;
    if (!playedAt || Number.isNaN(playedAt.getTime()) || (nowMs - playedAt.getTime()) > recentThresholdMs) {
      continue;
    }
    const championName = getProfileChampionLabel(masteryEntry);
    const champion = state.data.championsByName?.[championName];
    if (!champion || currentRolePool.has(champion.name)) {
      continue;
    }
    if (!Array.isArray(champion.roles) || !champion.roles.includes(activeRole)) {
      continue;
    }
    suggestions.push({
      champion,
      masteryEntry,
      role: activeRole,
      familiarity: deriveFamiliarityFromMastery(masteryEntry),
      rationale: [
        `Mastery ${masteryEntry.championLevel} with ${NUMBER_FORMATTER.format(masteryEntry.championPoints)} points.`,
        `Played recently on ${playedAt.toLocaleDateString()}.`,
        `Fits your ${activeRole} pool.`
      ]
    });
  }

  return suggestions.slice(0, 3);
}

async function addSuggestedChampionToActiveRole(suggestion) {
  const activePlayer = getMyChampionsActivePlayer();
  if (!activePlayer || !suggestion?.champion?.name) {
    return;
  }
  if (activePlayer.champions.includes(suggestion.champion.name)) {
    renderMyChampions();
    return;
  }
  activePlayer.champions = [...activePlayer.champions, suggestion.champion.name].sort((left, right) => left.localeCompare(right));
  activePlayer.familiarityByChampion = normalizeFamiliarityByChampion(
    activePlayer.champions,
    {
      ...(activePlayer.familiarityByChampion ?? {}),
      [suggestion.champion.name]: suggestion.familiarity
    }
  );
  setPlayerPoolDirty(state.playerConfig.teamId, true);
  syncDerivedTeamDataFromPlayerConfig();
  syncConfiguredTeamSelection();
  setBuilderStage("setup");
  resetBuilderTreeState();
  validateTeamSelections();
  renderTeamConfig();
  renderBuilder();
  renderMyChampions();
  await saveActivePlayerPoolSelection();
}

function renderMyChampionsSuggestionsSection() {
  if (!elements.myChampionsSuggestionsPanel || !elements.myChampionsSuggestionsSummary || !elements.myChampionsSuggestionsList) {
    return;
  }

  const suggestions = buildProfileChampionSuggestions();
  state.profile.championSuggestions = suggestions;
  if (!elements.myChampionsSuggestionsPanel.dataset.toggleBound) {
    elements.myChampionsSuggestionsPanel.addEventListener("toggle", () => {
      state.profile.isChampionSuggestionNoticeOpen = Boolean(elements.myChampionsSuggestionsPanel.open);
    });
    elements.myChampionsSuggestionsPanel.dataset.toggleBound = "true";
  }
  elements.myChampionsSuggestionsPanel.hidden = true;
  elements.myChampionsSuggestionsPanel.open = false;
  elements.myChampionsSuggestionsSummary.textContent = "";
  elements.myChampionsSuggestionsList.innerHTML = "";
  if (suggestions.length < 1) {
    state.profile.isChampionSuggestionNoticeOpen = false;
    return;
  }

  const activeRole = suggestions[0]?.role ?? (parseRolePoolTeamId(state.playerConfig.teamId) ?? state.profile.primaryRole);
  elements.myChampionsSuggestionsPanel.hidden = false;
  elements.myChampionsSuggestionsSummary.textContent =
    suggestions.length === 1
      ? `1 recent ${activeRole} pickup is outside your current list.`
      : `${suggestions.length} recent ${activeRole} picks are outside your current list.`;
  elements.myChampionsSuggestionsPanel.open = Boolean(state.profile.isChampionSuggestionNoticeOpen);

  for (const suggestion of suggestions) {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card";

    const titleRow = runtimeDocument.createElement("div");
    titleRow.className = "branch-card-top";
    titleRow.append(renderProfileChampionPortrait(suggestion.masteryEntry, "profile-riot-featured-media"));

    const heading = runtimeDocument.createElement("strong");
    heading.textContent = suggestion.champion.name;
    titleRow.append(heading);

    const meta = runtimeDocument.createElement("p");
    meta.className = "meta";
    meta.textContent = suggestion.rationale.join(" ");

    const actions = runtimeDocument.createElement("div");
    actions.className = "button-row";
    const addButton = runtimeDocument.createElement("button");
    addButton.type = "button";
    addButton.textContent = `Add to ${suggestion.role}`;
    addButton.disabled = state.playerConfig.isSavingPool;
    addButton.addEventListener("click", () => {
      void addSuggestedChampionToActiveRole(suggestion);
    });
    actions.append(addButton);

    card.append(titleRow, meta, actions);
    elements.myChampionsSuggestionsList.append(card);
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
  const avatarChampion = state.profile.avatarChampionId && state.data
    ? (state.data.champions || []).find((c) => c.id === state.profile.avatarChampionId)
    : null;
  const placeholderChar = authenticated && user ? (user.gameName || "?")[0].toUpperCase() : "?";

  for (const container of [elements.profileAvatarDisplay, elements.navAvatarDisplay]) {
    if (!container) continue;
    container.innerHTML = "";
    if (avatarChampion) {
      const img = runtimeDocument.createElement("img");
      img.src = getChampionSquareUrl(avatarChampion.name);
      img.alt = avatarChampion.name;
      img.className = "profile-avatar-img";
      img.addEventListener("error", () => {
        img.src = championImageFallback(avatarChampion.name);
      }, { once: true });
      container.append(img);
    } else {
      const placeholder = runtimeDocument.createElement("span");
      placeholder.className = "profile-avatar-placeholder";
      placeholder.textContent = placeholderChar;
      container.append(placeholder);
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
      ? allTeams.find((team) => normalizeTeamEntityId(team.id) === state.profile.displayTeamId)
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
  if (elements.profileSettingDisplayTeamValue) {
    const allTeams = [...state.api.teams].sort((a, b) => a.name.localeCompare(b.name));
    const displayTeam = state.profile.displayTeamId
      ? allTeams.find((team) => normalizeTeamEntityId(team.id) === state.profile.displayTeamId)
      : allTeams[0] || null;
    elements.profileSettingDisplayTeamValue.textContent = displayTeam
      ? displayTeam.name
      : authenticated
        ? "No team"
        : "Not signed in";
  }

  // Getting Started setting
  if (elements.profileSettingGettingStartedValue) {
    elements.profileSettingGettingStartedValue.textContent = state.ui.showGettingStarted ? "Visible" : "Hidden";
  }
  if (elements.profileShowGettingStarted) {
    elements.profileShowGettingStarted.checked = state.ui.showGettingStarted;
  }

  // Admin link visibility
  if (elements.profileAdminLink) {
    elements.profileAdminLink.hidden = !isAdminUser();
  }
  if (elements.profileAdminChampionCoreLink) {
    elements.profileAdminChampionCoreLink.hidden = !isAdminUser();
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

  if (openSetting === "display-team" && elements.profileDisplayTeamSelect) {
    const allTeams = [...state.api.teams].sort((a, b) => a.name.localeCompare(b.name));
    elements.profileDisplayTeamSelect.innerHTML = "";
    const automaticOption = runtimeDocument.createElement("option");
    automaticOption.value = "";
    automaticOption.textContent = allTeams.length > 0 ? "Automatic (first available team)" : "No teams available";
    elements.profileDisplayTeamSelect.append(automaticOption);
    for (const team of allTeams) {
      const option = runtimeDocument.createElement("option");
      option.value = String(team.id);
      option.textContent = team.name;
      elements.profileDisplayTeamSelect.append(option);
    }
    elements.profileDisplayTeamSelect.value = state.profile.displayTeamId ?? "";
    elements.profileDisplayTeamSelect.disabled = !authenticated || state.profile.isSavingDisplayTeam || allTeams.length === 0;
    if (elements.profileSaveDisplayTeam) {
      elements.profileSaveDisplayTeam.disabled = !authenticated || state.profile.isSavingDisplayTeam || allTeams.length === 0;
      elements.profileSaveDisplayTeam.textContent = state.profile.isSavingDisplayTeam ? "Saving..." : "Save Display Team";
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
  if (elements.avatarModalFeedback) {
    elements.avatarModalFeedback.textContent = "";
    elements.avatarModalFeedback.style.color = "";
  }
  if (elements.avatarModal) elements.avatarModal.hidden = false;
  renderAvatarModalGrid();
}

function closeAvatarModal() {
  if (elements.avatarModal) elements.avatarModal.hidden = true;
  if (elements.avatarModalFeedback) {
    elements.avatarModalFeedback.textContent = "";
    elements.avatarModalFeedback.style.color = "";
  }
}

async function saveAvatarSelection() {
  const avatarChampionId = normalizePositiveInteger(state.profile.pendingAvatarId);

  if (!isAuthenticated()) {
    syncProfilePreferenceSessionFields({
      avatarChampionId,
      displayTeamId: state.profile.displayTeamId
    });
    persistAvatarChampionId();
    closeAvatarModal();
    renderPlayerConfig();
    return;
  }

  if (state.profile.isSavingAvatar) {
    return;
  }

  state.profile.isSavingAvatar = true;
  if (elements.avatarModalSave) {
    elements.avatarModalSave.disabled = true;
    elements.avatarModalSave.textContent = "Saving...";
  }
  if (elements.avatarModalFeedback) {
    elements.avatarModalFeedback.textContent = "Saving...";
    elements.avatarModalFeedback.style.color = "";
  }

  try {
    const payload = await apiRequest("/me/profile/avatar", {
      method: "PUT",
      auth: true,
      body: {
        avatarChampionId
      }
    });
    const profile = payload?.profile ?? {};
    syncProfilePreferenceSessionFields({
      avatarChampionId: normalizePositiveInteger(profile.avatarChampionId),
      displayTeamId: normalizeTeamEntityId(profile.displayTeamId)
    });
    persistAvatarChampionId();
    closeAvatarModal();
    renderPlayerConfig();
  } catch (error) {
    if (elements.avatarModalFeedback) {
      elements.avatarModalFeedback.textContent = normalizeApiErrorMessage(error, "Failed to save avatar.");
      elements.avatarModalFeedback.style.color = "var(--warn)";
    }
  } finally {
    state.profile.isSavingAvatar = false;
    if (elements.avatarModalSave) {
      elements.avatarModalSave.disabled = false;
      elements.avatarModalSave.textContent = "Save";
    }
  }
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
  if (state.profile.avatarChampionId != null) return;
  try {
    const stored = runtimeStorage.getItem(AVATAR_STORAGE_KEY);
    const parsed = normalizePositiveInteger(stored);
    if (parsed !== null) {
      state.profile.avatarChampionId = parsed;
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
    img.src = getChampionSquareUrl(champion.name);
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

let _otherRolesSnapshot = [];

function openOtherRolesModal() {
  if (!elements.otherRolesModal) return;
  _otherRolesSnapshot = [...state.profile.secondaryRoles];
  elements.otherRolesModal.hidden = false;
  if (elements.otherRolesModalFeedback) elements.otherRolesModalFeedback.textContent = "";
  renderProfileRolesSection();
}

function closeOtherRolesModal() {
  if (elements.otherRolesModal) elements.otherRolesModal.hidden = true;
}

function hasOtherRolesUnsavedChanges() {
  const current = [...state.profile.secondaryRoles].sort();
  const snapshot = [..._otherRolesSnapshot].sort();
  return current.length !== snapshot.length || current.some((r, i) => r !== snapshot[i]);
}

function cancelOtherRolesModal() {
  if (hasOtherRolesUnsavedChanges()) {
    showNavWarning(() => {
      state.profile.secondaryRoles = [..._otherRolesSnapshot];
      closeOtherRolesModal();
      renderPlayerConfig();
    });
  } else {
    closeOtherRolesModal();
  }
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
  state.ui.showGettingStarted = stored.showGettingStarted !== false;
}

function saveUiState() {
  return tryWriteJsonStorage(UI_STATE_STORAGE_KEY, {
    navCollapsed: state.ui.isNavCollapsed,
    showGettingStarted: state.ui.showGettingStarted
  });
}

function syncProfilePreferenceSessionFields({
  avatarChampionId = null,
  displayTeamId = null
} = {}) {
  state.profile.avatarChampionId = avatarChampionId;
  state.profile.displayTeamId = displayTeamId;
  if (state.auth.user && typeof state.auth.user === "object") {
    state.auth.user.avatarChampionId = avatarChampionId;
    state.auth.user.displayTeamId = displayTeamId;
    saveAuthSession();
  }
}

function loadStoredAuthSession() {
  const stored = readStoredAuthSession();
  state.auth.token = stored.token;
  state.auth.user = stored.user;
  state.activeTab = resolvePostLoginTab(stored.user);
  const primaryRole = normalizeProfileRole(stored.user?.primaryRole);
  state.profile.primaryRole = primaryRole;
  state.profile.secondaryRoles = normalizeSecondaryRoles(stored.user?.secondaryRoles, primaryRole);
  syncProfilePreferenceSessionFields({
    avatarChampionId: normalizePositiveInteger(stored.user?.avatarChampionId),
    displayTeamId: normalizeTeamEntityId(stored.user?.displayTeamId)
  });
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
  state.builder.useCustomScopes = false;
  state.builder.defaultScopePrecedence = BUILDER_SCOPE_DEFAULT_PRECEDENCE;
  state.builder.scopeResourceSettings = createDefaultBuilderScopeResourceSettings();
  state.builder.selectedDraftSetupId = null;
  state.builder.draftSetupName = "";
  state.builder.draftSetupDescription = "";
  state.builder.draftSetupSaveMode = "full";
  state.builder.draftSetupFeedback = "";
  state.builder.isSaveDraftModalOpen = false;
  state.builder.isLoadDraftModalOpen = false;

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
      championsByName: getBuilderChampionsByName(),
      requirements,
      tagById: getBuilderTagById(),
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

function getChampionSquareUrl(name) {
  const key = championImageKey(name);
  return `https://ddragon.leagueoflegends.com/cdn/15.6.1/img/champion/${key}.png`;
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

// ── Champion Selector Modal ──────────────────────────────────────────

function getMyChampionsActivePlayer() {
  const activeRole = parseRolePoolTeamId(state.playerConfig.teamId) ?? state.profile.primaryRole;
  const players = state.playerConfig.byTeam[state.playerConfig.teamId] ?? [];
  return players.find((player) => player.role === activeRole) ?? null;
}

function openChampionSelectorModal() {
  const activePlayer = getMyChampionsActivePlayer();
  if (!activePlayer) return;
  state.playerConfig.selectorPending = [...activePlayer.champions];
  state.playerConfig.selectorFilter = "";
  if (elements.championSelectorSearch) elements.championSelectorSearch.value = "";
  if (elements.championSelectorModal) elements.championSelectorModal.hidden = false;
  renderChampionSelectorGrid();
}

function hasChampionSelectorChanges() {
  const activePlayer = getMyChampionsActivePlayer();
  if (!activePlayer) return false;
  const current = [...activePlayer.champions].sort().join(",");
  const pending = [...state.playerConfig.selectorPending].sort().join(",");
  return current !== pending;
}

function closeChampionSelectorModal(cancel) {
  if (cancel) {
    if (hasChampionSelectorChanges()) {
      showNavWarning(() => {
        if (elements.championSelectorModal) elements.championSelectorModal.hidden = true;
      });
      return;
    }
    if (elements.championSelectorModal) elements.championSelectorModal.hidden = true;
    return;
  }

  const activePlayer = getMyChampionsActivePlayer();
  if (!activePlayer) return;
  activePlayer.champions = Array.from(new Set(state.playerConfig.selectorPending)).sort((a, b) => a.localeCompare(b));
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
  renderMyChampions();
  if (elements.championSelectorModal) elements.championSelectorModal.hidden = true;
  void saveActivePlayerPoolSelection();
}

function renderChampionSelectorGrid() {
  if (!elements.championSelectorAvailable || !elements.championSelectorSelected) return;
  const activeRole = parseRolePoolTeamId(state.playerConfig.teamId) ?? state.profile.primaryRole;
  const roleEligible = (state.data.noneTeamPools[activeRole] ?? []).slice().sort((a, b) => a.localeCompare(b));
  const filter = state.playerConfig.selectorFilter.trim().toLowerCase();
  const pendingSet = new Set(state.playerConfig.selectorPending);

  const filtered = filter
    ? roleEligible.filter((name) => name.toLowerCase().includes(filter))
    : roleEligible;
  const available = filtered.filter((name) => !pendingSet.has(name));
  const selected = filtered.filter((name) => pendingSet.has(name));

  const renderColumn = (container, names, isSelectedColumn) => {
    container.innerHTML = "";
    if (names.length === 0) {
      const empty = runtimeDocument.createElement("p");
      empty.className = "meta";
      empty.textContent = isSelectedColumn ? "No champions selected." : "No champions available.";
      container.append(empty);
      return;
    }
    for (const championName of names) {
      const btn = runtimeDocument.createElement("button");
      btn.type = "button";
      btn.className = "champion-selector-option" + (isSelectedColumn ? " is-selected" : "");

      const img = runtimeDocument.createElement("img");
      img.className = "avatar-option-img";
      img.src = getChampionSquareUrl(championName);
      img.alt = championName;
      img.loading = "lazy";
      img.addEventListener("error", () => { img.src = championImageFallback(championName); }, { once: true });

      const label = runtimeDocument.createElement("span");
      label.className = "avatar-option-name";
      label.textContent = championName;

      btn.append(img, label);
      btn.addEventListener("click", () => {
        const pending = new Set(state.playerConfig.selectorPending);
        if (isSelectedColumn) {
          pending.delete(championName);
        } else {
          pending.add(championName);
        }
        state.playerConfig.selectorPending = [...pending];
        renderChampionSelectorGrid();
      });
      container.append(btn);
    }
  };

  renderColumn(elements.championSelectorAvailable, available, false);
  renderColumn(elements.championSelectorSelected, selected, true);
}

// ── My Champions Card Grid ───────────────────────────────────────────

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

  const activePlayer = getMyChampionsActivePlayer();
  if (activePlayer) {
    activePlayer.familiarityByChampion = normalizeFamiliarityByChampion(
      activePlayer.champions,
      activePlayer.familiarityByChampion
    );
  }
  if (elements.myChampionsAddBtn) {
    const count = activePlayer ? activePlayer.champions.length : 0;
    elements.myChampionsAddBtn.textContent = `Add Champions (${count} selected)`;
  }
  renderMyChampionsSuggestionsSection();

  const grid = elements.myChampionsCardGrid ?? elements.playerConfigGrid;
  grid.innerHTML = "";
  if (!activePlayer || activePlayer.champions.length === 0) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = !activePlayer
      ? (isAuthenticated() ? `No champions selected for ${activeRole}.` : "Sign in to load API-backed pools.")
      : `No champions selected for ${activeRole}. Click "Add Champions" to get started.`;
    grid.append(empty);
    return;
  }

  // Build mastery lookup
  const masteryByName = {};
  if (state.profile.championStats?.status === "ok" && Array.isArray(state.profile.championStats.champions)) {
    for (const entry of state.profile.championStats.champions) {
      if (entry.championName) {
        masteryByName[entry.championName] = entry;
      }
    }
  }

  // Apply card filters
  const nameFilter = (state.playerConfig.cardFilter ?? "").trim().toLowerCase();
  const comfortFilterSet = new Set(Array.isArray(state.playerConfig.comfortFilter) ? state.playerConfig.comfortFilter : []);

  const sortedNames = [...activePlayer.champions].sort((a, b) => a.localeCompare(b));
  const filteredNames = sortedNames.filter((championName) => {
    if (nameFilter && !championName.toLowerCase().includes(nameFilter)) return false;
    if (comfortFilterSet.size > 0) {
      const grade = getFamiliarityGrade(normalizeFamiliarityLevel(activePlayer.familiarityByChampion[championName]));
      if (!comfortFilterSet.has(grade)) return false;
    }
    return true;
  });

  if (filteredNames.length === 0) {
    const noMatch = runtimeDocument.createElement("p");
    noMatch.className = "meta";
    noMatch.textContent = "No champions match the current filters.";
    grid.append(noMatch);
    return;
  }

  for (const championName of filteredNames) {
    const champion = state.data.championsByName?.[championName] ?? null;
    const mastery = masteryByName[championName] ?? null;
    const currentLevel = normalizeFamiliarityLevel(activePlayer.familiarityByChampion[championName]);
    const currentGrade = getFamiliarityGrade(currentLevel);

    const card = runtimeDocument.createElement("article");
    card.className = "champ-card my-champ-card";

    // ── Header: image + name ──────────────────────────────────────────
    const cardHeader = runtimeDocument.createElement("div");
    cardHeader.className = "champ-card-header";

    const image = runtimeDocument.createElement("img");
    image.className = "champ-thumb";
    image.alt = `${championName} portrait`;
    image.src = getChampionImageUrl(championName);
    image.loading = "lazy";
    image.addEventListener("error", () => { image.src = championImageFallback(championName); }, { once: true });

    const nameWrap = runtimeDocument.createElement("div");
    nameWrap.className = "champ-card-name-wrap";
    const nameEl = runtimeDocument.createElement("p");
    nameEl.className = "champ-name";
    nameEl.textContent = championName;
    nameWrap.append(nameEl);

    cardHeader.append(image, nameWrap);

    // ── Comfort Level select dropdown (pill-styled) ───────────────────
    const comfortSection = runtimeDocument.createElement("div");
    comfortSection.className = "champ-meta-section";
    const comfortLabel = runtimeDocument.createElement("p");
    comfortLabel.className = "champ-meta-label";
    comfortLabel.textContent = "Comfort Level";

    const comfortSelect = runtimeDocument.createElement("select");
    comfortSelect.className = "comfort-select";
    for (const grade of FAMILIARITY_GRADES) {
      const opt = runtimeDocument.createElement("option");
      opt.value = grade;
      opt.textContent = grade;
      opt.title = FAMILIARITY_GRADE_LABELS[grade] ?? "";
      comfortSelect.append(opt);
    }
    comfortSelect.value = currentGrade;
    comfortSelect.addEventListener("change", () => {
      const nextLevel = familiarityGradeToLevel(comfortSelect.value);
      activePlayer.familiarityByChampion = normalizeFamiliarityByChampion(
        activePlayer.champions,
        { ...(activePlayer.familiarityByChampion ?? {}), [championName]: nextLevel }
      );
      setPlayerPoolDirty(state.playerConfig.teamId, true);
      void saveActivePlayerPoolSelection();
    });
    comfortSection.append(comfortLabel, comfortSelect);

    // ── Mastery stats (if available) ──────────────────────────────────
    const metaSection = runtimeDocument.createElement("div");
    metaSection.className = "champ-card-meta";
    metaSection.append(comfortSection);

    if (mastery) {
      const masterySection = runtimeDocument.createElement("div");
      masterySection.className = "champ-meta-section my-champ-mastery";
      const masteryLabel = runtimeDocument.createElement("p");
      masteryLabel.className = "champ-meta-label";
      masteryLabel.textContent = "Mastery";
      const masteryText = runtimeDocument.createElement("p");
      masteryText.className = "my-champ-mastery-text";
      masteryText.textContent = `Level ${mastery.championLevel} | ${NUMBER_FORMATTER.format(mastery.championPoints)} pts`;
      masterySection.append(masteryLabel, masteryText);
      metaSection.append(masterySection);
    }

    // ── Tags panel (read-only, collapsible) ───────────────────────────
    const tagDetails = runtimeDocument.createElement("details");
    tagDetails.className = "champ-card-tags-panel";
    const tagSummary = runtimeDocument.createElement("summary");

    const tagIds = champion?.tagIds ?? [];
    const tagNames = Array.isArray(tagIds)
      ? tagIds
          .map((tagId) => {
            const tag = state.api.tagById[String(tagId)];
            return tag ? { name: tag.name, definition: tag.definition ?? "" } : null;
          })
          .filter(Boolean)
      : [];
    tagSummary.textContent = `Champion Tags (${tagNames.length})`;
    tagDetails.append(tagSummary);

    const tagFilter = runtimeDocument.createElement("input");
    tagFilter.type = "search";
    tagFilter.className = "champ-card-tag-filter";
    tagFilter.placeholder = "Filter tags\u2026";
    tagDetails.append(tagFilter);

    const tagList = runtimeDocument.createElement("div");
    tagList.className = "champ-card-tag-list";
    if (tagNames.length > 0) {
      for (const { name: tagName, definition } of tagNames) {
        const chip = runtimeDocument.createElement("span");
        chip.className = "chip champ-tag-chip";
        chip.dataset.tagName = tagName.toLowerCase();
        chip.textContent = tagName;
        if (definition) chip.title = definition;
        tagList.append(chip);
      }
    } else {
      const emptyTags = runtimeDocument.createElement("span");
      emptyTags.className = "meta";
      emptyTags.textContent = "No tags assigned.";
      tagList.append(emptyTags);
    }
    tagDetails.append(tagList);

    tagFilter.addEventListener("input", () => {
      const q = tagFilter.value.trim().toLowerCase();
      for (const chip of tagList.querySelectorAll(".champ-tag-chip")) {
        chip.hidden = q.length > 0 && !chip.dataset.tagName.includes(q);
      }
    });

    card.append(cardHeader, metaSection, tagDetails);
    grid.append(card);
  }
}

function renderExplorer() {
  refreshExplorerMetadataScopeFilterOptions();
  renderActivePills();
  renderChampionTagCatalog();
  renderChampionTagEditor();

  const query = state.explorer.search.trim().toLowerCase();
  const includeTags = new Set(state.explorer.includeTags);
  const excludeTags = new Set(state.explorer.excludeTags);
  const metadataScopeFilter = state.explorer.metadataScopeFilter;

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
    if (Array.isArray(state.explorer.scaling) && state.explorer.scaling.length > 0) {
      const champRoles = Array.isArray(champion.roles) ? champion.roles : [];
      const champRoleProfiles =
        champion.roleProfiles && typeof champion.roleProfiles === "object" && !Array.isArray(champion.roleProfiles)
          ? champion.roleProfiles
          : {};
      const activeRole = state.explorer.activeCardRole[champion.id] ?? champRoles[0];
      const prof = champRoleProfiles[activeRole] ?? champRoleProfiles[champRoles[0]];
      let spikes = normalizePowerSpikes(prof?.powerSpikes ?? prof?.power_spikes);
      if (spikes.length === 0 && prof?.effectiveness) {
        spikes = powerSpikesFromLegacyEffectiveness(prof.effectiveness);
      }
      const matchesAny = state.explorer.scaling.some((lvl) => levelInPowerSpikes(lvl, spikes));
      if (!matchesAny) {
        return false;
      }
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
    const metadataScopes = normalizeChampionMetadataScopes(champion.metadataScopes);
    if (metadataScopeFilter === "self-present" && metadataScopes.self !== true) {
      return false;
    }
    if (metadataScopeFilter === "self-missing" && metadataScopes.self === true) {
      return false;
    }
    if (metadataScopeFilter === "team-present" && metadataScopes.team !== true) {
      return false;
    }
    if (metadataScopeFilter === "team-missing" && metadataScopes.team === true) {
      return false;
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
    const metadataScopes = normalizeChampionMetadataScopes(champion.metadataScopes);
    const activeMetadataScope = getExplorerChampionActiveMetadataScope(champion);
    const activeMetadataPreview = getExplorerChampionMetadataPreview(champion, activeMetadataScope);

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
      const reviewedMeta = formatAuditMeta(
        "Last reviewed",
        champion.reviewed_by_user_id,
        champion.reviewed_by_display_name,
        champion.reviewed_at
      );
      if (reviewedMeta) {
        const reviewDetails = runtimeDocument.createElement("p");
        reviewDetails.className = "meta";
        reviewDetails.textContent = reviewedMeta;
        nameWrap.append(reviewDetails);
      }
    }
    cardHeader.append(image, nameWrap);

    // ── Pencil edit button ───────────────────────────────────────────────
    const canEdit =
      isAuthenticated() &&
      Number.isInteger(champion.id) &&
      champion.id > 0;
    if (canEdit) {
      const editBtn = runtimeDocument.createElement("button");
      editBtn.type = "button";
      editBtn.className = "champ-card-edit-btn";
      editBtn.title = "Edit Champion Profile";
      editBtn.setAttribute("aria-label", `Edit champion profile for ${champion.name}`);
      editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';
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
    const champRoles = activeMetadataPreview.roles ?? [];
    const champRoleProfiles = activeMetadataPreview.roleProfiles ?? {};
    const allRoleProfilesSame = (() => {
      if (champRoles.length <= 1) return true;
      const profiles = champRoles.map((r) => champRoleProfiles?.[r]);
      if (profiles.some((p) => !p)) return false;
      const first = JSON.stringify(profiles[0]);
      return profiles.every((p) => JSON.stringify(p) === first);
    })();

    const buildCardMeta = (activeRoleKey) => {
      const meta = runtimeDocument.createElement("div");
      meta.className = "champ-card-meta";

      // ── Scope selector: "View" label + pill dropdown ───────────────────
      const scopeOptions = [
        { value: "self", label: "User" },
        { value: "team", label: "Team" },
        { value: "all", label: "Global" }
      ];
      const activeOption = scopeOptions.find((o) => o.value === activeMetadataScope) ?? scopeOptions[2];

      const scopeSection = runtimeDocument.createElement("div");
      scopeSection.className = "champ-meta-section";

      const scopeLabel = runtimeDocument.createElement("p");
      scopeLabel.className = "champ-meta-label";
      scopeLabel.textContent = "View";
      scopeSection.append(scopeLabel);

      const scopeWrap = runtimeDocument.createElement("div");
      scopeWrap.className = "champ-scope-dropdown";

      const scopeTrigger = runtimeDocument.createElement("button");
      scopeTrigger.type = "button";
      scopeTrigger.className = "champ-scope-trigger";
      scopeTrigger.textContent = activeOption.label;
      scopeTrigger.setAttribute("aria-haspopup", "listbox");
      scopeTrigger.setAttribute("aria-expanded", "false");
      scopeTrigger.setAttribute("aria-label", `Scope: ${activeOption.label}. Click to change.`);

      const scopeMenu = runtimeDocument.createElement("div");
      scopeMenu.className = "champ-scope-menu";
      scopeMenu.setAttribute("role", "listbox");
      scopeMenu.hidden = true;

      for (const opt of scopeOptions) {
        const isPresent = opt.value === "all" || metadataScopes[opt.value] === true;
        const isSelected = activeMetadataScope === opt.value;
        const canSelect = opt.value === "all" || (isPresent && canReadExplorerMetadataScope(opt.value));

        const item = runtimeDocument.createElement("button");
        item.type = "button";
        item.className = "champ-scope-option" + (isSelected ? " is-active" : "") + (!isPresent ? " is-unavailable" : "");
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(isSelected));
        item.textContent = opt.label;
        item.disabled = !canSelect;
        if (!isPresent) {
          item.title = `${opt.label} metadata is not present for ${champion.name}.`;
        }
        if (canSelect && !isSelected) {
          item.addEventListener("click", (e) => {
            e.stopPropagation();
            scopeMenu.hidden = true;
            scopeTrigger.setAttribute("aria-expanded", "false");
            void selectExplorerChampionMetadataScope(champion.id, opt.value);
          });
        }
        scopeMenu.append(item);
      }

      scopeTrigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const opening = scopeMenu.hidden;
        for (const m of runtimeDocument.querySelectorAll(".champ-scope-menu:not([hidden])")) {
          m.hidden = true;
          m.previousElementSibling?.setAttribute("aria-expanded", "false");
        }
        scopeMenu.hidden = !opening;
        scopeTrigger.setAttribute("aria-expanded", String(opening));
        if (opening) {
          const closeOnOutside = (ev) => {
            if (!scopeWrap.contains(ev.target)) {
              scopeMenu.hidden = true;
              scopeTrigger.setAttribute("aria-expanded", "false");
              runtimeDocument.removeEventListener("click", closeOnOutside);
            }
          };
          runtimeDocument.addEventListener("click", closeOnOutside);
        }
      });

      scopeWrap.append(scopeTrigger, scopeMenu);
      scopeSection.append(scopeWrap);
      meta.append(scopeSection);

      // Role pills — clickable if more than one role and profiles differ
      const roleBtns = champRoles.map((r) => {
        const btn = runtimeDocument.createElement("button");
        btn.type = "button";
        const isActive = allRoleProfilesSame || r === activeRoleKey;
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
      const profile = champRoleProfiles?.[activeRoleKey];
      const damageType = profile
        ? deriveDisplayDamageTypeFromProfile(profile)
        : champion.damageType;

      // Power Spikes: compact level bar
      let cardPowerSpikes = normalizePowerSpikes(profile?.powerSpikes ?? profile?.power_spikes);
      if (cardPowerSpikes.length === 0 && profile?.effectiveness) {
        cardPowerSpikes = powerSpikesFromLegacyEffectiveness(profile.effectiveness);
      }

      const damagePills = damageType
        ? [makePill(damageType, `champ-damage-${damageType.toLowerCase()}`)]
        : [];

      meta.append(
        makeMetaSection("Role(s)", roleBtns, "champ-role-pill-row"),
        makeMetaSection("Damage Type", damagePills)
      );

      // Power Spikes: ruler-style level bar — appended directly to meta for full width
      const spikeLabel = runtimeDocument.createElement("p");
      spikeLabel.className = "champ-meta-label";
      spikeLabel.textContent = "Power Spikes";
      const ruler = runtimeDocument.createElement("div");
      ruler.className = "champ-ruler";
      const track = runtimeDocument.createElement("div");
      track.className = "champ-ruler-track";
      for (const range of cardPowerSpikes) {
        const bar = runtimeDocument.createElement("div");
        bar.className = "champ-ruler-bar";
        const leftPct = ((range.start - 1) / POWER_SPIKE_MAX_LEVEL) * 100;
        const widthPct = ((range.end - range.start + 1) / POWER_SPIKE_MAX_LEVEL) * 100;
        bar.style.left = `${leftPct}%`;
        bar.style.width = `${widthPct}%`;
        track.append(bar);
      }
      ruler.append(track);
      // Tick marks with level numbers
      const ticks = runtimeDocument.createElement("div");
      ticks.className = "champ-ruler-ticks";
      for (let lvl = POWER_SPIKE_MIN_LEVEL; lvl <= POWER_SPIKE_MAX_LEVEL; lvl++) {
        const tick = runtimeDocument.createElement("span");
        tick.className = "champ-ruler-tick";
        tick.textContent = String(lvl);
        ticks.append(tick);
      }
      ruler.append(ticks);
      meta.append(spikeLabel, ruler);
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

function evaluateComposerRequirements() {
  const selectedRequirements = getBuilderSelectedRequirements();
  const { teamId, teamPools } = getEnginePoolContext();
  return evaluateCompositionRequirements({
    teamState: state.builder.teamState,
    championsByName: getBuilderChampionsByName(),
    requirements: selectedRequirements,
    teamPools,
    teamId,
    excludedChampions: state.builder.excludedChampions,
    tagById: getBuilderTagById()
  });
}

function getComposerRedundancyPenalty() {
  return normalizeBuilderCandidateScoringWeights(state.builder.candidateScoringWeights).redundancyPenalty;
}

function buildComposerRequirementScoreBreakdown(requirementEvaluation) {
  return buildRequirementScoreBreakdown(requirementEvaluation, getComposerRedundancyPenalty());
}

function formatRequirementHeadline(requirementResult, requirementScore = null) {
  const clauses = Array.isArray(requirementResult?.clauses) ? requirementResult.clauses : [];
  const totalUnderBy = Number.isFinite(requirementScore?.totalUnderBy)
    ? requirementScore.totalUnderBy
    : clauses.reduce((sum, clause) => sum + (clause?.underBy ?? 0), 0);
  const totalOverBy = Number.isFinite(requirementScore?.totalOverBy)
    ? requirementScore.totalOverBy
    : clauses.reduce((sum, clause) => sum + (clause?.overBy ?? 0), 0);
  if (totalUnderBy > 0) {
    return `Missing ${totalUnderBy} required match${totalUnderBy === 1 ? "" : "es"}.`;
  }
  if (totalOverBy > 0) {
    return `Meets minimums, but has ${totalOverBy} redundant extra match${totalOverBy === 1 ? "" : "es"}.`;
  }
  return "Currently in range.";
}

function buildRequirementStatusCard(requirementResult, requirementScore = null) {
  const status = requirementResult.status;
  const passed = status === "pass";
  const card = runtimeDocument.createElement("div");
  card.className = `req-card ${passed ? "is-passed" : "is-failed"}`;
  if (requirementResult.definition) {
    card.title = requirementResult.definition;
  }

  const nameEl = runtimeDocument.createElement("strong");
  nameEl.className = "req-card-name";
  nameEl.textContent = requirementResult.name;

  const badge = runtimeDocument.createElement("span");
  badge.className = `req-card-badge ${passed ? "is-passed" : "is-failed"}`;
  if (passed) {
    badge.textContent = "\u2713 Pass";
  } else {
    const clauses = Array.isArray(requirementResult.clauses) ? requirementResult.clauses : [];
    const totalUnderBy = Number.isFinite(requirementScore?.totalUnderBy)
      ? requirementScore.totalUnderBy
      : clauses.reduce((sum, clause) => sum + (clause?.underBy ?? 0), 0);
    badge.textContent = totalUnderBy > 0 ? `\u2717 ${totalUnderBy} fail` : "\u2717 Fail";
  }

  card.append(nameEl, badge);
  card.addEventListener("click", () => {
    openClauseDetailModal(requirementResult, requirementScore);
  });
  card.style.cursor = "pointer";
  return card;
}

function openClauseDetailModal(requirementResult, requirementScore) {
  closeDraftModal();
  const passed = requirementResult.status === "pass";

  const overlay = runtimeDocument.createElement("div");
  overlay.className = "draft-modal-overlay";
  function closeModal() {
    for (const p of runtimeDocument.body.querySelectorAll(":scope > .clause-popover")) p.remove();
    overlay.remove();
  }
  overlay.addEventListener("click", (evt) => {
    if (evt.target === overlay) closeModal();
  });

  const dialog = runtimeDocument.createElement("div");
  dialog.className = "draft-modal";

  const header = runtimeDocument.createElement("div");
  header.className = "draft-modal-header";
  const title = runtimeDocument.createElement("h3");
  title.textContent = requirementResult.name;
  const close = runtimeDocument.createElement("button");
  close.type = "button";
  close.className = "draft-modal-close";
  close.textContent = "\u00D7";
  close.addEventListener("click", closeModal);
  header.append(title, close);

  const body = runtimeDocument.createElement("div");
  body.className = "draft-modal-body";

  const statusBadge = runtimeDocument.createElement("span");
  statusBadge.className = `req-card-badge ${passed ? "is-passed" : "is-failed"}`;
  statusBadge.textContent = passed ? "\u2713 Pass" : "\u2717 Fail";
  body.append(statusBadge);

  if (requirementResult.definition) {
    const defEl = runtimeDocument.createElement("p");
    defEl.className = "meta";
    defEl.style.marginTop = "0.5rem";
    defEl.textContent = requirementResult.definition;
    body.append(defEl);
  }

  const clauseScoreById = new Map(
    Array.isArray(requirementScore?.clauses)
      ? requirementScore.clauses.map((clause) => [clause.id, clause])
      : []
  );
  const originalReqDef = getBuilderRequirementDefinitions().find((r) => r.id === requirementResult.id);

  if (Array.isArray(requirementResult.clauses) && requirementResult.clauses.length > 0) {
    const originalRules = Array.isArray(originalReqDef?.rules) ? originalReqDef.rules : [];

    const clauseList = runtimeDocument.createElement("div");
    clauseList.className = "clause-detail-list";
    const claimedChampions = new Set();

    for (const [index, clause] of requirementResult.clauses.entries()) {
      const clauseId =
        typeof clause?.id === "string" && clause.id.trim() !== ""
          ? clause.id.trim()
          : `clause-${index + 1}`;
      const clauseScore = clauseScoreById.get(clauseId) ?? null;
      const clauseMet = (clause.underBy ?? 0) === 0 && clauseScore?.countsTowardAggregate !== false;

      const row = runtimeDocument.createElement("div");
      row.className = "clause-detail-row";

      const dot = runtimeDocument.createElement("span");
      dot.className = `clause-dot ${clauseMet ? "is-passed" : "is-failed"}`;
      dot.textContent = "\u25CF";

      const label = runtimeDocument.createElement("span");
      label.className = "clause-detail-label";
      const rangeLabel = clause.maxCount === null ? `${clause.minCount}+` : `${clause.minCount}-${clause.maxCount}`;
      const pieces = [`C${index + 1}: ${clause.currentMatches}/${rangeLabel}`];
      if (clauseScore?.countsTowardAggregate === false) {
        pieces.push("inactive");
      } else if ((clause.underBy ?? 0) > 0) {
        pieces.push(`needs ${clause.underBy}`);
      } else {
        pieces.push("met");
      }
      if ((clauseScore?.countsTowardAggregate !== false) && (clause.overBy ?? 0) > 0) {
        pieces.push(`overflow ${clause.overBy}`);
      }
      label.textContent = pieces.join(" | ");

      row.append(dot, label);
      if (originalReqDef) {
        const editBtn = runtimeDocument.createElement("button");
        editBtn.type = "button";
        editBtn.className = "clause-edit-btn";
        editBtn.title = `Edit Clause ${index + 1}`;
        editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';
        editBtn.addEventListener("click", (evt) => {
          evt.stopPropagation();
          for (const p of runtimeDocument.body.querySelectorAll(":scope > .clause-popover")) p.remove();
          overlay.remove();
          openClauseEditorModal(requirementResult, requirementScore, index);
        });
        row.append(editBtn);
      }

      // Clause expression popover on hover (converts API expr to draft terms)
      const clauseRaw = originalRules[index];
      if (clauseRaw) {
        const clauseDraft = createRequirementRuleClauseDraft(clauseRaw);
        const popover = runtimeDocument.createElement("div");
        popover.className = "clause-popover";
        const popoverInner = runtimeDocument.createElement("div");
        popoverInner.className = "clause-popover-item";
        const popoverHeading = runtimeDocument.createElement("strong");
        popoverHeading.textContent = `Clause ${index + 1}`;
        popoverInner.append(popoverHeading);
        const popoverExpr = runtimeDocument.createElement("div");
        popoverExpr.className = "clause-popover-detail clause-popover-expr";
        const defTerms = normalizeRequirementClauseTerms(clauseDraft.terms);
        const defJoiners = normalizeRequirementClauseTermJoiners(clauseDraft.termJoiners, defTerms.length);
        for (let ti = 0; ti < defTerms.length; ti++) {
          if (ti > 0) {
            const j = runtimeDocument.createElement("span");
            j.className = "clause-popover-joiner";
            j.textContent = normalizeRequirementJoiner(defJoiners[ti - 1], "and").toUpperCase();
            popoverExpr.append(j);
          }
          const t = runtimeDocument.createElement("span");
          t.className = "clause-popover-term";
          t.textContent = formatRequirementClauseTermSummary(defTerms[ti]);
          popoverExpr.append(t);
        }
        if (defTerms.length === 0) {
          const empty = runtimeDocument.createElement("span");
          empty.className = "clause-popover-term";
          empty.textContent = "No conditions selected.";
          popoverExpr.append(empty);
        }
        popoverInner.append(popoverExpr);
        const roleFilterCount = normalizeRequirementRoleFilter(clauseDraft.roleFilter).length;
        const separateCount = normalizeRequirementClauseReferenceIds(clauseDraft.separateFrom).length;
        const constraintParts = [
          `min ${Number.parseInt(String(clauseDraft.minCount), 10) || 1}`,
          String(clauseDraft.maxCount ?? "").trim() === "" ? "no max" : `max ${String(clauseDraft.maxCount).trim()}`,
          roleFilterCount > 0 ? `${roleFilterCount} role filter${roleFilterCount === 1 ? "" : "s"}` : null,
          separateCount > 0 ? `separate from ${separateCount} clause${separateCount === 1 ? "" : "s"}` : null
        ].filter(Boolean);
        const cEl = runtimeDocument.createElement("span");
        cEl.className = "clause-popover-constraints";
        cEl.textContent = constraintParts.join(" \u00b7 ");
        popoverInner.append(cEl);
        popover.append(popoverInner);

        row.style.cursor = "help";
        row.addEventListener("mouseenter", () => {
          const rect = row.getBoundingClientRect();
          popover.style.position = "fixed";
          popover.style.left = `${rect.right + 8}px`;
          popover.style.top = `${rect.top}px`;
          runtimeDocument.body.append(popover);
          popover.style.display = "block";
        });
        row.addEventListener("mouseleave", () => {
          popover.style.display = "none";
          popover.remove();
        });
      }

      if (clauseMet && Array.isArray(clause.currentMatchSlots) && clause.currentMatchSlots.length > 0) {
        const pillRow = runtimeDocument.createElement("div");
        pillRow.className = "clause-champ-pills";
        for (const role of clause.currentMatchSlots) {
          const champName = state.builder.teamState[role];
          if (champName && !claimedChampions.has(champName)) {
            claimedChampions.add(champName);
            const pill = runtimeDocument.createElement("span");
            pill.className = "clause-champ-pill";
            pill.textContent = champName;
            pillRow.append(pill);
          }
        }
        const wrapper = runtimeDocument.createElement("div");
        wrapper.className = "clause-detail-row-wrap";
        wrapper.append(row, pillRow);
        clauseList.append(wrapper);
      } else {
        clauseList.append(row);
      }
    }
    body.append(clauseList);
  }

  if (requirementScore) {
    const scoreMeta = runtimeDocument.createElement("p");
    scoreMeta.className = "meta";
    scoreMeta.style.marginTop = "0.5rem";
    scoreMeta.textContent =
      `Missing matches ${requirementScore.totalUnderBy} | redundancy overflow ${requirementScore.totalOverBy}.`;
    body.append(scoreMeta);
  }

  dialog.append(header, body);
  overlay.append(dialog);
  runtimeDocument.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-open"));
}

function openClauseEditorModal(requirementResult, requirementScore, clauseIndex) {
  const requirementDef = (Array.isArray(state.api.requirementDefinitions) ? state.api.requirementDefinitions : [])
    .find((def) => def.id === requirementResult.id);
  if (!requirementDef) {
    openClauseDetailModal(requirementResult, requirementScore);
    return;
  }

  const snapshot = JSON.parse(JSON.stringify(state.api.requirementDefinitionDraft));
  const previousSelectedId = state.api.selectedRequirementDefinitionId;

  setRequirementDefinitionDraft(requirementDef);

  if (Array.isArray(state.api.requirementDefinitionDraft.rules)) {
    for (const rule of state.api.requirementDefinitionDraft.rules) {
      rule.isOpen = false;
    }
    if (clauseIndex >= 0 && clauseIndex < state.api.requirementDefinitionDraft.rules.length) {
      state.api.requirementDefinitionDraft.rules[clauseIndex].isOpen = true;
    }
  }

  let draftAtOpen = null;

  const overlay = runtimeDocument.createElement("div");
  overlay.className = "draft-modal-overlay";

  const dialog = runtimeDocument.createElement("div");
  dialog.className = "draft-modal clause-editor-modal";

  const header = runtimeDocument.createElement("div");
  header.className = "draft-modal-header";
  const title = runtimeDocument.createElement("h3");
  title.textContent = `Edit Clause ${clauseIndex + 1} — ${requirementResult.name}`;
  const close = runtimeDocument.createElement("button");
  close.type = "button";
  close.className = "draft-modal-close";
  close.textContent = "\u00D7";

  function stripTransientClauseFields(draftJson) {
    const parsed = JSON.parse(draftJson);
    if (Array.isArray(parsed.rules)) {
      for (const rule of parsed.rules) {
        delete rule.isOpen;
        delete rule.activeTermIndex;
        delete rule.termSearchByKind;
      }
    }
    return JSON.stringify(parsed);
  }

  async function handleClose() {
    const isDirty = stripTransientClauseFields(JSON.stringify(state.api.requirementDefinitionDraft)) !== stripTransientClauseFields(draftAtOpen);
    if (isDirty) {
      const confirmed = await showUSSConfirm({
        title: "Unsaved Changes",
        body: "You have unsaved clause edits. Discard them?",
        affirmLabel: "Discard",
        cancelLabel: "Keep Editing",
        destructive: true
      });
      if (!confirmed) return;
    }
    state.api.requirementDefinitionDraft = JSON.parse(JSON.stringify(snapshot));
    state.api.selectedRequirementDefinitionId = previousSelectedId;
    overlay.remove();
    const freshEval = evaluateComposerRequirements();
    const freshScore = buildComposerRequirementScoreBreakdown(freshEval);
    const freshResult = freshEval.requirements.find((r) => r.id === requirementResult.id) ?? requirementResult;
    const freshReqScore = freshScore.requirements.find((r) => r.requirementId === requirementResult.id) ?? requirementScore;
    openClauseDetailModal(freshResult, freshReqScore);
  }

  close.addEventListener("click", handleClose);
  overlay.addEventListener("click", (evt) => {
    if (evt.target === overlay) handleClose();
  });
  header.append(title, close);

  const body = runtimeDocument.createElement("div");
  body.className = "draft-modal-body";

  const clauseContainer = runtimeDocument.createElement("div");
  clauseContainer.id = "clause-editor-modal-clauses";
  clauseContainer.className = "requirements-clause-list";
  body.append(clauseContainer);

  const footer = runtimeDocument.createElement("div");
  footer.className = "draft-modal-footer";
  const cancelBtn = runtimeDocument.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "ghost";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", handleClose);

  const saveBtn = runtimeDocument.createElement("button");
  saveBtn.type = "button";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", async () => {
    let parsedRules;
    try {
      parsedRules = parseRequirementRulesFromDraftClauses();
    } catch (err) {
      setInspectFeedback(err instanceof Error ? err.message : "Rules are invalid.");
      return;
    }
    const updatedDef = { ...requirementDef, rules: parsedRules };
    const defIndex = state.api.requirementDefinitions.findIndex((d) => d.id === requirementDef.id);
    if (defIndex >= 0) {
      state.api.requirementDefinitions[defIndex] = updatedDef;
    }
    state.api.requirementDefinitionDraft = JSON.parse(JSON.stringify(snapshot));
    state.api.selectedRequirementDefinitionId = previousSelectedId;
    overlay.remove();
    renderChecks();
    const freshEval = evaluateComposerRequirements();
    const freshScore = buildComposerRequirementScoreBreakdown(freshEval);
    const freshResult = freshEval.requirements.find((r) => r.id === requirementResult.id) ?? requirementResult;
    const freshReqScore = freshScore.requirements.find((r) => r.requirementId === requirementResult.id) ?? requirementScore;
    openClauseDetailModal(freshResult, freshReqScore);
  });

  footer.append(cancelBtn, saveBtn);

  dialog.append(header, body, footer);
  overlay.append(dialog);
  runtimeDocument.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-open"));

  renderClauseEditorInModal(clauseContainer);
  draftAtOpen = JSON.stringify(state.api.requirementDefinitionDraft);
}

function renderClauseEditorInModal(container) {
  container.innerHTML = "";
  const clauses = Array.isArray(state.api.requirementDefinitionDraft.rules)
    ? state.api.requirementDefinitionDraft.rules
    : [];
  const controlsDisabled = state.api.isSavingRequirementDefinition;

  if (clauses.length < 1) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "Add at least one clause.";
    container.append(empty);
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
      renderClauseEditorInModal(container);
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
      renderClauseEditorInModal(container);
    });
    summaryControls.append(removeButton);

    summaryRow.append(summaryText, summaryControls);
    card.append(summaryRow);

    if (!clause.isOpen) {
      container.append(card);
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
      termButton.disabled = controlsDisabled;
      termButton.addEventListener("click", () => {
        clause.activeTermIndex = termIndex;
        renderClauseEditorInModal(container);
      });
      termChain.append(termButton);

      if (clause.terms.length > 1) {
        const removeTermButton = runtimeDocument.createElement("button");
        removeTermButton.type = "button";
        removeTermButton.className = "ghost requirement-inline-button";
        removeTermButton.textContent = "x";
        removeTermButton.disabled = controlsDisabled;
        removeTermButton.addEventListener("click", () => {
          clause.terms = clause.terms.filter((_term, ci) => ci !== termIndex);
          clause.termJoiners = normalizeRequirementClauseTermJoiners(
            clause.termJoiners.filter((_joiner, ci) => ci !== termIndex - 1),
            clause.terms.length
          );
          clause.activeTermIndex = Math.max(0, Math.min(clause.activeTermIndex, clause.terms.length - 1));
          renderClauseEditorInModal(container);
        });
        termChain.append(removeTermButton);
      }
    }

    const addTermButton = runtimeDocument.createElement("button");
    addTermButton.type = "button";
    addTermButton.className = "ghost requirement-inline-button";
    addTermButton.textContent = "Add Condition";
    addTermButton.disabled = controlsDisabled;
    addTermButton.addEventListener("click", () => {
      clause.terms = [...clause.terms, createEmptyRequirementClauseTerm()];
      clause.termJoiners = [...normalizeRequirementClauseTermJoiners(clause.termJoiners, clause.terms.length - 1), "and"];
      clause.activeTermIndex = clause.terms.length - 1;
      renderClauseEditorInModal(container);
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
      termFilterInput.disabled = controlsDisabled;
      termFilterInput.addEventListener("input", () => {
        clause.termSearchByKind[conditionKind] = termFilterInput.value;
        renderClauseEditorInModal(container);
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
          optionItem.textContent = option.label;
          if (option.description) {
            optionItem.title = option.description;
          }
          if (!controlsDisabled) {
            optionItem.addEventListener("click", () => {
              clause.terms[clause.activeTermIndex] = { kind: conditionKind, value: option.value };
              renderClauseEditorInModal(container);
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
      renderClauseEditorInModal(container);
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
        if (candidateIndex === index) continue;
        const candidateId =
          typeof candidateClause.clauseId === "string" && candidateClause.clauseId.trim() !== ""
            ? candidateClause.clauseId.trim()
            : "";
        if (!candidateId) continue;
        const candidateLabel = runtimeDocument.createElement("label");
        candidateLabel.className = "selection-option";
        const candidateCheckbox = runtimeDocument.createElement("input");
        candidateCheckbox.type = "checkbox";
        candidateCheckbox.checked = selectedReferenceSet.has(candidateId);
        candidateCheckbox.disabled = controlsDisabled;
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
    container.append(card);
  }
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
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
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
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "Selected composition has no requirements.";
    elements.builderRequiredChecks.append(empty);
    return;
  }
  for (const requirementResult of requirementResults) {
    const requirementScore =
      scoreBreakdown.requirements.find((candidate) => candidate.requirementId === requirementResult.id) ?? null;
    elements.builderRequiredChecks.append(buildRequirementStatusCard(requirementResult, requirementScore));
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

function syncDraftPathSelectionsFromTeamState() {
  if (!state.builder.tree) return;
  const root = getNodeById("0");
  if (!root) return;
  const rootSlots = normalizeTeamState(root.teamSlots);
  const sel = {};
  for (const slot of SLOTS) {
    const current = state.builder.teamState[slot];
    const wasPreFilled = !!rootSlots[slot];
    if (current && !wasPreFilled) {
      sel[slot] = current;
    }
  }
  state.builder.draftPathSelections = sel;
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
  syncDraftPathSelectionsFromTeamState();
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
      if ((clause?.effectiveUnderBy ?? 0) > 0) {
        lines.push(`${requirement.requirementName} ${clause.label}: needs ${clause.effectiveUnderBy}`);
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
    return normalizeBuilderRankGoal(state.builder.treeRankGoal) === BUILDER_RANK_GOAL_CANDIDATE_SCORE
      ? "No immediate clause coverage change; ranked via immediate candidate score."
      : "No immediate clause coverage change; ranked via downstream viable finishes.";
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

function getNodeCandidateScore(node) {
  const value = Number(node?.candidateScore);
  return Number.isFinite(value) ? value : 0;
}

function getDraftPathMetricMeta(node, data = {}) {
  const viableCount = data.viableCount ?? data.totalValidLeaves ?? 0;
  if (normalizeBuilderRankGoal(state.builder.treeRankGoal) === BUILDER_RANK_GOAL_CANDIDATE_SCORE) {
    const candidateScore = getNodeCandidateScore(node);
    return {
      badgeText: String(candidateScore),
      badgeTitle: `Candidate score ${candidateScore}`,
      headline: `Candidate score ${candidateScore} | ${viableCount} viable finish${viableCount === 1 ? "" : "es"}`
    };
  }
  return {
    badgeText: String(viableCount),
    badgeTitle: `${viableCount} viable finish${viableCount === 1 ? "" : "es"}`,
    headline: `${viableCount} viable finish${viableCount === 1 ? "" : "es"}`
  };
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
  action.textContent = "Select";
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

function openDraftModal(titleText, contentEl) {
  closeDraftModal();
  const overlay = runtimeDocument.createElement("div");
  overlay.className = "draft-modal-overlay";
  overlay.addEventListener("click", (evt) => {
    if (evt.target === overlay) closeDraftModal();
  });

  const dialog = runtimeDocument.createElement("div");
  dialog.className = "draft-modal";

  const header = runtimeDocument.createElement("div");
  header.className = "draft-modal-header";
  const title = runtimeDocument.createElement("h3");
  title.textContent = titleText;
  const close = runtimeDocument.createElement("button");
  close.type = "button";
  close.className = "draft-modal-close";
  close.textContent = "\u00D7";
  close.addEventListener("click", closeDraftModal);
  header.append(title, close);

  const body = runtimeDocument.createElement("div");
  body.className = "draft-modal-body";
  body.append(contentEl);

  dialog.append(header, body);
  overlay.append(dialog);
  runtimeDocument.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-open"));
}

function closeDraftModal() {
  const existing = runtimeDocument.querySelector(".draft-modal-overlay");
  if (existing) existing.remove();
}


function buildGenerationStatsContent(generationStats) {
  const container = runtimeDocument.createElement("div");
  container.className = "draft-stats-grid";
  const entries = [
    ["Nodes Visited", generationStats.nodesVisited],
    ["Nodes Kept", generationStats.nodesKept],
    ["Candidate Calls", generationStats.candidateGenerationCalls ?? 0],
    ["Candidates Evaluated", generationStats.candidatesEvaluated ?? 0],
    ["Candidates Selected", generationStats.candidatesSelected ?? 0],
    ["Pruned: Unreachable", generationStats.prunedUnreachable],
    ["Pruned: Low Score", generationStats.prunedLowCandidateScore],
    ["Pruned: Relative Score", generationStats.prunedRelativeCandidateScore ?? 0],
    ["Fallback Candidates", generationStats.fallbackCandidatesUsed ?? 0],
    ["Fallback Nodes", generationStats.fallbackNodes ?? 0],
    ["Complete Draft Leaves", generationStats.completeDraftLeaves],
    ["Incomplete Draft Leaves", generationStats.incompleteDraftLeaves],
    ["Valid Leaves", generationStats.validLeaves],
    ["Incomplete Leaves", generationStats.incompleteLeaves]
  ];
  for (const [label, value] of entries) {
    const row = runtimeDocument.createElement("div");
    row.className = "draft-stats-row";
    const lbl = runtimeDocument.createElement("span");
    lbl.className = "draft-stats-label";
    lbl.textContent = label;
    const val = runtimeDocument.createElement("span");
    val.className = "draft-stats-value";
    val.textContent = String(value);
    row.append(lbl, val);
    container.append(row);
  }
  return container;
}

function renderTreeSummary(root, rootNodeId, visibleIds) {
  if (!state.builder.tree || !root) {
    if (elements.builderStatsBtn) elements.builderStatsBtn.hidden = true;
    setInspectFeedback("");
    return;
  }
  const generationStats = state.builder.tree.generationStats ?? null;

  // Show/hide stats icon in Review header
  if (elements.builderStatsBtn) {
    elements.builderStatsBtn.hidden = !generationStats;
    elements.builderStatsBtn.onclick = generationStats
      ? () => openDraftModal("Generation Stats", buildGenerationStatsContent(generationStats))
      : null;
  }

  if (generationStats && generationStats.completeDraftLeaves === 0) {
    const reasons = collectIncompleteDraftReasons(root);
    let reason;
    if (reasons.unreachableRequired.length > 0) {
      reason = `Fail-fast: required checks become unreachable on every leaf (${reasons.unreachableRequired.join(", ")}).`;
    } else {
      const topRole = getTopCountEntry(reasons.blockedRoles);
      const topReason = getTopCountEntry(reasons.blockedReasons);
      reason = topRole
        ? formatBlockedReason(topReason?.key, topRole.key)
        : "No branch can finish all five roles with current pools and constraints.";
    }
    setInspectFeedback(`All outcomes result in incomplete drafts. ${reason}`);
  } else if (root.children.length === 0) {
    setInspectFeedback("No viable branches were generated. Adjust slot picks, exclusions, or active composition requirements.");
  } else {
    setInspectFeedback("");
  }
}

function openDraftPicksModal(root, rootNodeId, nextRole) {
  closeDraftModal();
  const overlay = runtimeDocument.createElement("div");
  overlay.className = "draft-modal-overlay";
  overlay.addEventListener("click", (evt) => {
    if (evt.target === overlay) closeDraftModal();
  });

  const dialog = runtimeDocument.createElement("div");
  dialog.className = "draft-modal";

  const header = runtimeDocument.createElement("div");
  header.className = "draft-modal-header";
  const title = runtimeDocument.createElement("h3");
  title.textContent = `Draft Picks \u2014 ${nextRole}`;
  const close = runtimeDocument.createElement("button");
  close.type = "button";
  close.className = "draft-modal-close";
  close.textContent = "\u00D7";
  close.addEventListener("click", closeDraftModal);
  header.append(title, close);

  // Filter toolbar inside modal
  const toolbar = runtimeDocument.createElement("div");
  toolbar.className = "draft-modal-filters";

  const searchLabel = runtimeDocument.createElement("label");
  searchLabel.textContent = "Search";
  const searchInput = runtimeDocument.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Champion, role, or slot";
  searchInput.value = state.builder.treeSearch;
  searchLabel.append(searchInput);

  const scoreLabel = runtimeDocument.createElement("label");
  scoreLabel.textContent = "Min Score";
  const scoreInput = runtimeDocument.createElement("input");
  scoreInput.type = "number";
  scoreInput.step = "1";
  scoreInput.min = "0";
  scoreInput.value = String(state.builder.treeMinScore);
  scoreLabel.append(scoreInput);

  const validLabel = runtimeDocument.createElement("label");
  validLabel.className = "inline-checkbox";
  const validCheck = runtimeDocument.createElement("input");
  validCheck.type = "checkbox";
  validCheck.checked = state.builder.treeValidLeavesOnly;
  validLabel.append(validCheck);
  validLabel.append(" Valid leaves only");

  toolbar.append(searchLabel, scoreLabel, validLabel);

  const body = runtimeDocument.createElement("div");
  body.className = "draft-modal-body";

  function rebuildCards() {
    const ids = new Set();
    collectVisibleNodeIds(
      root, rootNodeId, ids,
      state.builder.treeMinScore,
      state.builder.treeSearch,
      SLOTS,
      state.builder.treeValidLeavesOnly
    );
    const branches = root.children
      .map((node, index) => ({
        node,
        id: `${rootNodeId}.${index}`,
        title: `${node.addedRole}: ${node.addedChampion}`
      }))
      .filter((entry) => ids.has(entry.id))
      .slice(0, 8);

    body.innerHTML = "";
    const list = runtimeDocument.createElement("div");
    list.className = "summary-card-list";
    if (branches.length === 0) {
      const empty = runtimeDocument.createElement("p");
      empty.className = "meta";
      empty.textContent = "No branches match current filters.";
      list.append(empty);
    }
    for (const entry of branches) {
      list.append(buildBranchCard(entry, branches, nextRole));
    }
    body.append(list);

    // Sync the hidden HTML elements so renderTree stays consistent
    elements.treeSearch.value = state.builder.treeSearch;
    elements.treeMinScore.value = String(state.builder.treeMinScore);
    elements.treeValidLeavesOnly.checked = state.builder.treeValidLeavesOnly;
    renderTreeMap();
  }

  searchInput.addEventListener("input", () => {
    state.builder.treeSearch = searchInput.value;
    rebuildCards();
  });
  scoreInput.addEventListener("change", () => {
    const parsed = Number.parseInt(scoreInput.value, 10);
    state.builder.treeMinScore = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    scoreInput.value = String(state.builder.treeMinScore);
    rebuildCards();
  });
  validCheck.addEventListener("change", () => {
    state.builder.treeValidLeavesOnly = Boolean(validCheck.checked);
    rebuildCards();
  });

  rebuildCards();

  dialog.append(header, toolbar, body);
  overlay.append(dialog);
  runtimeDocument.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-open"));
}

function buildBranchCard(entry, allEntries, selectorRole = null) {
  const card = runtimeDocument.createElement("article");
  card.className = "summary-card branch-card";

  const cardTop = runtimeDocument.createElement("div");
  cardTop.className = "branch-card-top";
  const rank = runtimeDocument.createElement("span");
  rank.className = "branch-rank";
  rank.textContent = `#${allEntries.indexOf(entry) + 1}`;
  const title = runtimeDocument.createElement("strong");
  title.textContent = entry.title;
  cardTop.append(rank, title);

  const headline = runtimeDocument.createElement("p");
  headline.className = "branch-headline";
  const metric = getDraftPathMetricMeta(entry.node, {
    totalValidLeaves: entry.node.branchPotential?.validLeafCount ?? 0
  });
  headline.textContent = `${metric.headline} | ${getBranchStatusLine(entry.node)}.`;

  const impact = runtimeDocument.createElement("p");
  impact.className = "branch-impact-summary";
  impact.textContent = getBranchImpactSummary(entry.node.candidateBreakdown);

  const benefits = runtimeDocument.createElement("ul");
  benefits.className = "branch-benefit-list";
  const candidateBenefitMeta = getCandidateBenefitMeta(entry.node.candidateBreakdown, 2);
  const benefitLines =
    candidateBenefitMeta.lines.length > 0
      ? candidateBenefitMeta.lines
      : [
          normalizeBuilderRankGoal(state.builder.treeRankGoal) === BUILDER_RANK_GOAL_CANDIDATE_SCORE
            ? "No immediate clause coverage gain; ranked via immediate candidate score."
            : "No immediate clause coverage gain; ranked via downstream viable finishes."
        ];
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
  inspect.textContent = "Select";
  inspect.addEventListener("click", () => {
    closeDraftModal();
    if (selectorRole) {
      // From Draft Selector — only set the clicked role, not the entire team
      state.builder.draftPathSelections[selectorRole] = entry.node.addedChampion;
      state.builder.teamState[selectorRole] = entry.node.addedChampion;
      renderTeamConfig();
      renderChecks();
      renderTreeMap();
    } else {
      inspectNode(entry.node, entry.id, entry.title);
    }
  });
  actions.append(inspect);

  if (remaining) {
    card.append(cardTop, headline, impact, benefits, remaining, debugDetails, actions);
  } else {
    card.append(cardTop, headline, impact, benefits, debugDetails, actions);
  }
  return card;
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

let draftPathTooltipEl = null;

function showDraftPathTooltip(evt, node, champName, data) {
  hideDraftPathTooltip();
  const tip = runtimeDocument.createElement("div");
  tip.className = "draft-path-tooltip";

  const viableCount = data.viableCount ?? data.totalValidLeaves ?? 0;
  const pathCount = data.pathCount ?? data.count ?? 1;
  const statusLine = getBranchStatusLine(node);
  const impactLine = getBranchImpactSummary(node.candidateBreakdown);
  const benefitMeta = getCandidateBenefitMeta(node.candidateBreakdown, 2);
  const coverageMeta = getRemainingCoverageMeta(node.scoreBreakdown, 2);

  const lines = [];
  if (normalizeBuilderRankGoal(state.builder.treeRankGoal) === BUILDER_RANK_GOAL_CANDIDATE_SCORE) {
    lines.push(`${champName} — candidate score ${getNodeCandidateScore(node)}`);
    lines.push(`${viableCount} viable finish${viableCount === 1 ? "" : "es"}`);
  } else {
    lines.push(`${champName} — ${viableCount} viable finish${viableCount === 1 ? "" : "es"}`);
  }
  lines.push(statusLine);
  if (impactLine) lines.push(impactLine);
  if (benefitMeta.lines.length > 0) {
    for (const line of benefitMeta.lines) lines.push(line);
    if (benefitMeta.hiddenCount > 0) lines.push(`+${benefitMeta.hiddenCount} more`);
  }
  if (coverageMeta.lines.length > 0) {
    lines.push("Missing: " + coverageMeta.lines.join(" | "));
  }
  if (pathCount > 1) {
    lines.push(`Appears in ${pathCount} branches (showing best)`);
  }

  for (const line of lines) {
    const row = runtimeDocument.createElement("div");
    row.textContent = line;
    tip.append(row);
  }

  runtimeDocument.body.append(tip);
  draftPathTooltipEl = tip;

  const rect = evt.currentTarget.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  let left = rect.right + 8;
  let top = rect.top;
  if (left + tipRect.width > window.innerWidth - 8) {
    left = rect.left - tipRect.width - 8;
  }
  if (top + tipRect.height > window.innerHeight - 8) {
    top = window.innerHeight - tipRect.height - 8;
  }
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideDraftPathTooltip() {
  if (draftPathTooltipEl) {
    draftPathTooltipEl.remove();
    draftPathTooltipEl = null;
  }
}

function collectDraftPaths(node, nodeId = "0", current = [], all = []) {
  const step = { node, id: nodeId, role: node.addedRole ?? null, champion: node.addedChampion ?? null };
  const path = [...current, step];
  if (node.children.length === 0) {
    all.push(path);
  } else {
    for (let i = 0; i < node.children.length; i += 1) {
      collectDraftPaths(node.children[i], `${nodeId}.${i}`, path, all);
    }
  }
  return all;
}

function renderTreeMap() {
  elements.builderTreeMap.innerHTML = "";
  if (!state.builder.tree) {
    return;
  }

  const root = getNodeById("0");
  if (!root) {
    return;
  }

  const allPaths = collectDraftPaths(root, "0");
  if (allPaths.length === 0) {
    return;
  }

  // Determine role order from tree structure (skip root at depth 0)
  const roleOrder = [];
  const roleSeen = new Set();
  for (const path of allPaths) {
    for (const step of path) {
      if (step.role && !roleSeen.has(step.role)) {
        roleSeen.add(step.role);
        roleOrder.push(step.role);
      }
    }
  }

  if (roleOrder.length === 0) {
    return;
  }

  // Filter paths by current Draft Selector selections
  const selections = state.builder.draftPathSelections ?? {};
  const hasSelections = Object.values(selections).some((v) => v);

  const filteredPaths = hasSelections
    ? allPaths.filter((path) =>
        path.every((step) => !step.role || !selections[step.role] || selections[step.role] === step.champion)
      )
    : allPaths;

  // Optionally filter to valid-leaves-only
  const viablePaths = state.builder.treeValidLeavesOnly
    ? filteredPaths.filter((path) => {
        const leaf = path[path.length - 1].node;
        return leaf.viability?.isTerminalValid || (leaf.branchPotential?.validLeafCount ?? 0) > 0;
      })
    : filteredPaths;

  // Build one column per role
  for (const role of roleOrder) {
    const champMap = new Map();

    for (const path of viablePaths) {
      for (const step of path) {
        if (step.role !== role) continue;
        const name = step.champion;
        if (!name) continue;
        const leaf = path[path.length - 1].node;
        const isViable = leaf.viability?.isTerminalValid;
        const existing = champMap.get(name);
        if (!existing) {
          champMap.set(name, { bestNode: step.node, bestId: step.id, viableCount: isViable ? 1 : 0, pathCount: 1 });
        } else {
          existing.pathCount += 1;
          if (isViable) existing.viableCount += 1;
          const existingPrimary = normalizeBuilderRankGoal(state.builder.treeRankGoal) === BUILDER_RANK_GOAL_CANDIDATE_SCORE
            ? getNodeCandidateScore(existing.bestNode)
            : existing.bestNode.branchPotential?.validLeafCount ?? 0;
          const nextPrimary = normalizeBuilderRankGoal(state.builder.treeRankGoal) === BUILDER_RANK_GOAL_CANDIDATE_SCORE
            ? getNodeCandidateScore(step.node)
            : step.node.branchPotential?.validLeafCount ?? 0;
          const existingSecondary = existing.bestNode.branchPotential?.validLeafCount ?? 0;
          const nextSecondary = step.node.branchPotential?.validLeafCount ?? 0;
          if (nextPrimary > existingPrimary || (nextPrimary === existingPrimary && nextSecondary > existingSecondary)) {
            existing.bestNode = step.node;
            existing.bestId = step.id;
          }
        }
      }
    }

    const sorted = [...champMap.entries()].sort((a, b) => {
      const primaryDelta = normalizeBuilderRankGoal(state.builder.treeRankGoal) === BUILDER_RANK_GOAL_CANDIDATE_SCORE
        ? getNodeCandidateScore(b[1].bestNode) - getNodeCandidateScore(a[1].bestNode)
        : b[1].viableCount - a[1].viableCount;
      if (primaryDelta !== 0) {
        return primaryDelta;
      }
      return b[1].viableCount - a[1].viableCount;
    });
    const isSelected = !!selections[role];

    const col = runtimeDocument.createElement("div");
    col.className = "draft-path-column";
    if (isSelected) col.classList.add("is-locked");

    const header = runtimeDocument.createElement("div");
    header.className = "draft-path-column-header";
    const headerLabel = runtimeDocument.createElement("span");
    headerLabel.textContent = role;
    header.append(headerLabel);

    const actionRow = runtimeDocument.createElement("div");
    actionRow.className = "draft-path-action-row";

    const clearBtn = runtimeDocument.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "ghost draft-path-action-btn draft-path-action-clear";
    clearBtn.textContent = "Clear";
    clearBtn.title = `Clear ${role} selection`;
    clearBtn.disabled = !isSelected;
    clearBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      delete state.builder.draftPathSelections[role];
      state.builder.teamState[role] = null;
      renderTeamConfig();
      renderChecks();
      renderTreeMap();
    });

    const detailBtn = runtimeDocument.createElement("button");
    detailBtn.type = "button";
    detailBtn.className = "draft-path-action-btn draft-path-action-detail";
    detailBtn.textContent = "Detailed View";
    detailBtn.title = `Draft Picks for ${role}`;
    detailBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      // Build a virtual root whose children are all nodes for this role
      const roleNodes = [];
      const seenChampions = new Set();
      for (const path of viablePaths) {
        for (const step of path) {
          if (step.role === role && !seenChampions.has(step.champion)) {
            seenChampions.add(step.champion);
            roleNodes.push(step.node);
          }
        }
      }
      const virtualRoot = { children: roleNodes };
      openDraftPicksModal(virtualRoot, "0", role);
    });

    actionRow.append(clearBtn, detailBtn);
    col.append(header, actionRow);

    const list = runtimeDocument.createElement("ul");
    list.className = "draft-path-list";

    for (const [champName, data] of sorted) {
      const node = data.bestNode;
      const status = getNodeStatus(node);
      const viableCount = data.viableCount;

      const li = runtimeDocument.createElement("li");
      li.className = `draft-path-item is-${status}`;
      if (selections[role] === champName) {
        li.classList.add("is-selected");
      }

      const nameSpan = runtimeDocument.createElement("span");
      nameSpan.className = "draft-path-champ-name";
      nameSpan.textContent = champName;

      const leafBadge = runtimeDocument.createElement("span");
      leafBadge.className = "draft-path-leaf-badge";
      const metric = getDraftPathMetricMeta(node, data);
      leafBadge.textContent = metric.badgeText;
      leafBadge.title = metric.badgeTitle;

      li.append(nameSpan, leafBadge);

      li.addEventListener("click", () => {
        if (selections[role] === champName) {
          delete state.builder.draftPathSelections[role];
          state.builder.teamState[role] = null;
        } else {
          state.builder.draftPathSelections[role] = champName;
          state.builder.teamState[role] = champName;
        }
        renderTeamConfig();
        renderChecks();
        renderTreeMap();
      });

      li.addEventListener("mouseenter", (evt) => {
        showDraftPathTooltip(evt, node, champName, data);
      });
      li.addEventListener("mouseleave", hideDraftPathTooltip);

      list.append(li);
    }

    if (sorted.length === 0) {
      const empty = runtimeDocument.createElement("li");
      empty.className = "draft-path-empty";
      empty.textContent = "No viable options";
      list.append(empty);
    }

    col.append(list);
    elements.builderTreeMap.append(col);
  }

  // Legend
  if (elements.treeMapLegend) {
    const selCount = Object.values(selections).filter((v) => v).length;
    const parts = [];
    parts.push(getRankGoalLabel());
    parts.push(`${roleOrder.length} role${roleOrder.length === 1 ? "" : "s"}`);
    if (selCount > 0) parts.push(`${selCount} selected`);
    elements.treeMapLegend.textContent = parts.join(" | ") + ". Click to filter, click again to clear.";
  }
}

function renderBuilderScopeControls() {
  if (!elements.builderCustomScopesEnabled || !elements.builderScopeDefaultPrecedence || !elements.builderScopeResourceList) {
    return;
  }

  elements.builderCustomScopesEnabled.checked = state.builder.useCustomScopes;
  if (elements.builderScopeModeSelect) {
    elements.builderScopeModeSelect.value = state.builder.useCustomScopes ? "custom" : "global";
  }
  if (elements.builderScopeControls) {
    elements.builderScopeControls.hidden = true;
  }
  elements.builderScopeDefaultPrecedence.value = normalizeBuilderScopePrecedence(state.builder.defaultScopePrecedence);
  elements.builderScopeDefaultPrecedence.disabled = !state.builder.useCustomScopes;
  elements.builderScopeResourceList.innerHTML = "";

  for (const resource of BUILDER_SCOPE_RESOURCES) {
    const config = state.builder.scopeResourceSettings?.[resource] ?? {
      enabled: true,
      precedence: BUILDER_SCOPE_DEFAULT_PRECEDENCE
    };
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card";

    const label = runtimeDocument.createElement("strong");
    label.textContent = BUILDER_SCOPE_RESOURCE_LABELS[resource] ?? resource;

    const checkboxLabel = runtimeDocument.createElement("label");
    checkboxLabel.className = "inline-checkbox";
    const checkbox = runtimeDocument.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = config.enabled !== false;
    checkbox.disabled = !state.builder.useCustomScopes;
    checkbox.addEventListener("change", () => {
      state.builder.scopeResourceSettings[resource] = {
        ...state.builder.scopeResourceSettings[resource],
        enabled: checkbox.checked
      };
      void refreshBuilderComposerContext({ includeDraftContext: false });
    });
    checkboxLabel.append(checkbox, runtimeDocument.createTextNode("Use custom scope"));

    const selectLabel = runtimeDocument.createElement("label");
    selectLabel.className = "advanced-compact-label";
    selectLabel.textContent = "Scope order";
    const select = runtimeDocument.createElement("select");
    replaceOptions(select, BUILDER_SCOPE_PRECEDENCE_OPTIONS, false);
    select.value = normalizeBuilderScopePrecedence(config.precedence, state.builder.defaultScopePrecedence);
    select.disabled = !state.builder.useCustomScopes || config.enabled === false;
    select.addEventListener("change", () => {
      state.builder.scopeResourceSettings[resource] = {
        ...state.builder.scopeResourceSettings[resource],
        precedence: normalizeBuilderScopePrecedence(select.value, state.builder.defaultScopePrecedence)
      };
      void refreshBuilderComposerContext({ includeDraftContext: false });
    });
    selectLabel.append(select);

    card.append(label, checkboxLabel, selectLabel);
    elements.builderScopeResourceList.append(card);
  }

  setBuilderScopeFeedback(state.builder.scopeLoadError || "");
}

function openScopeConfigModal() {
  closeDraftModal();

  // Snapshot current settings so we can revert on cancel
  const snapshot = {
    defaultScopePrecedence: state.builder.defaultScopePrecedence,
    scopeResourceSettings: JSON.parse(JSON.stringify(state.builder.scopeResourceSettings))
  };
  // Working copy the modal edits manipulate
  const draft = {
    defaultScopePrecedence: snapshot.defaultScopePrecedence,
    resources: JSON.parse(JSON.stringify(snapshot.scopeResourceSettings))
  };

  function isDirty() {
    return draft.defaultScopePrecedence !== snapshot.defaultScopePrecedence
      || JSON.stringify(draft.resources) !== JSON.stringify(snapshot.scopeResourceSettings);
  }

  async function handleCancel() {
    if (isDirty()) {
      const leave = await showUSSConfirm({
        title: "Unsaved Changes",
        body: "You have unsaved scope changes. Leaving now will discard them.",
        affirmLabel: "Leave Anyway",
        cancelLabel: "Stay",
        destructive: true
      });
      if (!leave) return;
    }
    state.builder.defaultScopePrecedence = snapshot.defaultScopePrecedence;
    state.builder.scopeResourceSettings = JSON.parse(JSON.stringify(snapshot.scopeResourceSettings));
    closeDraftModal();
  }

  function handleUpdate() {
    state.builder.defaultScopePrecedence = draft.defaultScopePrecedence;
    state.builder.scopeResourceSettings = JSON.parse(JSON.stringify(draft.resources));
    setBuilderStage("setup");
    resetBuilderTreeState();
    void refreshBuilderComposerContext({ includeDraftContext: false });
    closeDraftModal();
  }

  const overlay = runtimeDocument.createElement("div");
  overlay.className = "draft-modal-overlay";
  overlay.addEventListener("click", (evt) => {
    if (evt.target === overlay) handleCancel();
  });

  const dialog = runtimeDocument.createElement("div");
  dialog.className = "draft-modal";

  const header = runtimeDocument.createElement("div");
  header.className = "draft-modal-header";
  const title = runtimeDocument.createElement("h3");
  title.textContent = "Configure Custom Scopes";
  const close = runtimeDocument.createElement("button");
  close.type = "button";
  close.className = "draft-modal-close";
  close.textContent = "\u00D7";
  close.addEventListener("click", handleCancel);
  header.append(title, close);

  const body = runtimeDocument.createElement("div");
  body.className = "draft-modal-body";

  // Default Scope Order
  const defaultLabel = runtimeDocument.createElement("label");
  defaultLabel.className = "advanced-compact-label";
  defaultLabel.textContent = "Default Scope Order";
  const defaultSelect = runtimeDocument.createElement("select");
  replaceOptions(defaultSelect, BUILDER_SCOPE_PRECEDENCE_OPTIONS, false);
  defaultSelect.value = normalizeBuilderScopePrecedence(draft.defaultScopePrecedence);
  defaultSelect.addEventListener("change", () => {
    draft.defaultScopePrecedence = normalizeBuilderScopePrecedence(defaultSelect.value);
    for (const resource of BUILDER_SCOPE_RESOURCES) {
      draft.resources[resource] = {
        ...draft.resources[resource],
        precedence: normalizeBuilderScopePrecedence(
          draft.resources[resource]?.precedence, draft.defaultScopePrecedence
        )
      };
    }
    rebuildResourceCards();
  });
  defaultLabel.append(defaultSelect);
  body.append(defaultLabel);

  const resourceList = runtimeDocument.createElement("div");
  resourceList.className = "summary-card-list scope-config-resources";

  function rebuildResourceCards() {
    resourceList.innerHTML = "";
    for (const resource of BUILDER_SCOPE_RESOURCES) {
      const config = draft.resources[resource] ?? {
        enabled: true,
        precedence: BUILDER_SCOPE_DEFAULT_PRECEDENCE
      };
      const card = runtimeDocument.createElement("article");
      card.className = "summary-card";

      const label = runtimeDocument.createElement("strong");
      label.textContent = BUILDER_SCOPE_RESOURCE_LABELS[resource] ?? resource;

      const checkboxLabel = runtimeDocument.createElement("label");
      checkboxLabel.className = "inline-checkbox";
      const checkbox = runtimeDocument.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = config.enabled !== false;
      checkbox.addEventListener("change", () => {
        draft.resources[resource] = { ...draft.resources[resource], enabled: checkbox.checked };
        rebuildResourceCards();
      });
      checkboxLabel.append(checkbox, runtimeDocument.createTextNode("Use custom scope"));

      const selectLabel = runtimeDocument.createElement("label");
      selectLabel.className = "advanced-compact-label";
      selectLabel.textContent = "Scope order";
      const select = runtimeDocument.createElement("select");
      replaceOptions(select, BUILDER_SCOPE_PRECEDENCE_OPTIONS, false);
      select.value = normalizeBuilderScopePrecedence(config.precedence, draft.defaultScopePrecedence);
      select.disabled = config.enabled === false;
      select.addEventListener("change", () => {
        draft.resources[resource] = {
          ...draft.resources[resource],
          precedence: normalizeBuilderScopePrecedence(select.value, draft.defaultScopePrecedence)
        };
      });
      selectLabel.append(select);

      card.append(label, checkboxLabel, selectLabel);
      resourceList.append(card);
    }
  }

  rebuildResourceCards();
  body.append(resourceList);

  if (state.builder.scopeLoadError) {
    const feedback = runtimeDocument.createElement("p");
    feedback.className = "meta";
    feedback.textContent = state.builder.scopeLoadError;
    body.append(feedback);
  }

  // Footer with Cancel / Update
  const footer = runtimeDocument.createElement("div");
  footer.className = "draft-modal-footer";
  const cancelBtn = runtimeDocument.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "ghost";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", handleCancel);
  const updateBtn = runtimeDocument.createElement("button");
  updateBtn.type = "button";
  updateBtn.textContent = "Update";
  updateBtn.addEventListener("click", handleUpdate);
  footer.append(cancelBtn, updateBtn);

  dialog.append(header, body, footer);
  overlay.append(dialog);
  runtimeDocument.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-open"));
}

function renderBuilderDraftSetups() {
  if (!elements.builderDraftSetupSave || !elements.builderDraftSetupLoad) {
    return;
  }

  const canUseDraftSetups = isAuthenticated();
  elements.builderDraftSetupSave.disabled = !canUseDraftSetups;
  elements.builderDraftSetupLoad.disabled = !canUseDraftSetups;

  if (elements.builderSaveDraftModal) {
    elements.builderSaveDraftModal.hidden = !state.builder.isSaveDraftModalOpen;
  }
  if (elements.builderSaveDraftName) {
    elements.builderSaveDraftName.value = state.builder.draftSetupName ?? "";
  }
  if (elements.builderSaveDraftDescription) {
    elements.builderSaveDraftDescription.value = state.builder.draftSetupDescription ?? "";
  }
  if (elements.builderSaveDraftSettingsOnly) {
    elements.builderSaveDraftSettingsOnly.checked = normalizeDraftSetupSaveMode(state.builder.draftSetupSaveMode) === "settings_only";
    elements.builderSaveDraftSettingsOnly.disabled = state.builder.isSavingDraftSetup;
  }
  if (elements.builderSaveDraftConfirm) {
    elements.builderSaveDraftConfirm.disabled = state.builder.isSavingDraftSetup;
    elements.builderSaveDraftConfirm.textContent = state.builder.isSavingDraftSetup ? "Saving..." : "Save Draft";
  }
  if (elements.builderSaveDraftFeedback) {
    elements.builderSaveDraftFeedback.textContent = state.builder.draftSetupFeedback || "";
  }

  if (elements.builderLoadDraftModal) {
    elements.builderLoadDraftModal.hidden = !state.builder.isLoadDraftModalOpen;
  }
  if (elements.builderLoadDraftFeedback) {
    elements.builderLoadDraftFeedback.textContent = state.builder.draftSetupFeedback || "";
  }
  if (!elements.builderLoadDraftList) {
    updateBodyModalState();
    return;
  }

  elements.builderLoadDraftList.innerHTML = "";

  if (!canUseDraftSetups) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "Sign in to load saved drafts.";
    elements.builderLoadDraftList.append(empty);
    updateBodyModalState();
    return;
  }

  if (state.builder.isLoadingDraftSetups) {
    const loading = runtimeDocument.createElement("p");
    loading.className = "meta";
    loading.textContent = "Loading saved drafts...";
    elements.builderLoadDraftList.append(loading);
    updateBodyModalState();
    return;
  }

  if (!Array.isArray(state.builder.draftSetups) || state.builder.draftSetups.length < 1) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "No saved drafts yet.";
    elements.builderLoadDraftList.append(empty);
    updateBodyModalState();
    return;
  }

  for (const setup of state.builder.draftSetups) {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card";

    const title = runtimeDocument.createElement("strong");
    title.textContent = setup.name;

    const meta = runtimeDocument.createElement("p");
    meta.className = "meta";
    const metaParts = [];
    if (setup.id === state.builder.selectedDraftSetupId) {
      metaParts.push("Currently loaded");
    }
    if (setup.saveMode === "settings_only") {
      metaParts.push("Settings only");
    }
    metaParts.push(setup.updatedAt ? `Updated ${formatTimestampMeta(setup.updatedAt)}` : "Saved draft");
    meta.textContent = metaParts.join(" | ");

    card.append(title, meta);
    if (setup.description) {
      const description = runtimeDocument.createElement("p");
      description.className = "draft-setup-card-description";
      description.textContent = setup.description;
      card.append(description);
    }

    const actions = runtimeDocument.createElement("div");
    actions.className = "button-row";

    const loadButton = runtimeDocument.createElement("button");
    loadButton.type = "button";
    loadButton.textContent = "Load";
    loadButton.addEventListener("click", () => {
      void confirmAction({
        title: setup.saveMode === "settings_only" ? "Apply Draft Settings" : "Load Draft",
        message:
          setup.saveMode === "settings_only"
            ? `Apply Composer settings from '${setup.name}'? Current team, composition, picks, and exclusions will stay in place.`
            : `Replace the current Composer state with '${setup.name}'?`,
        confirmLabel: setup.saveMode === "settings_only" ? "Apply Settings" : "Load"
      }).then((confirmed) => {
        if (confirmed) {
          void applyDraftSetupState(setup);
        }
      });
    });

    const deleteButton = runtimeDocument.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "ghost";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => {
      void confirmAction({
        title: "Delete Draft",
        message: `Delete '${setup.name}' permanently?`,
        confirmLabel: "Delete"
      }).then((confirmed) => {
        if (confirmed) {
          void deleteDraftSetup(setup.id);
        }
      });
    });

    actions.append(loadButton, deleteButton);
    card.append(actions);
    elements.builderLoadDraftList.append(card);
  }

  updateBodyModalState();
}

function renderBuilder() {
  state.builder.candidateScoringWeights = normalizeBuilderCandidateScoringWeights(state.builder.candidateScoringWeights);
  renderBuilderStageGuide();
  replaceOptions(elements.builderActiveTeam, getTeamSelectOptions());
  elements.builderActiveTeam.value = state.builder.teamId;
  syncBuilderCompositionControls();
  renderBuilderDraftSetups();
  renderBuilderScopeControls();
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
  elements.treeSearch.disabled = !state.builder.tree;
  elements.treeMinScore.disabled = !state.builder.tree;
  elements.treeValidLeavesOnly.disabled = !state.builder.tree;
  updateTeamHelpAndSlotLabels();
  renderChecks();
  renderExcludedOptions();
  renderExcludedPills();
  renderTree();
  renderTreeMap();
}

function scrollReviewResultsIntoView() {
  const prefersReducedMotion = runtimeMatchMedia("(prefers-reduced-motion: reduce)").matches;
  elements.builderTreeMap.scrollIntoView({
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
  await refreshChampionDataFromApi();
  await loadProfileFromApi();
  await loadPoolsFromApi(preferredPoolTeamId);
  await loadTeamsFromApi(preferredAdminTeamId);
  await loadTeamContextFromApi();
  await loadTagCatalogFromApi();
  await loadScopedTagCatalogIntoState(
    {
      tags: "tagsWorkspaceCatalog",
      tagById: "tagsWorkspaceTagById"
    },
    {
      ...getTagCatalogScopeRequestContext(),
      includeFallback: true
    }
  );
  await hydrateCompositionsWorkspaceFromApi();
  const teamWorkspaceRefreshJobs = [
    loadDiscoverTeamsFromApi(),
    loadInvitationsForUser()
  ];
  if (canReviewSelectedTeam()) {
    teamWorkspaceRefreshJobs.push(loadPendingJoinRequestsForSelectedTeam());
    teamWorkspaceRefreshJobs.push(loadMemberInvitationsForSelectedTeam());
  }
  await Promise.all(teamWorkspaceRefreshJobs);
  if (isAdminUser()) {
    await loadUsersFromApi();
  } else {
    state.api.users = [];
  }
  initializeTeamConfigControls();
  await loadDraftSetupsFromApi();
  await loadTagPromotionQueuesFromApi();
  await fetchBuilderDraftContext(state.builder.teamId);
  await loadComposerContextFromApi();
  renderTeamAdmin();
  renderPlayerConfig();
  renderBuilder();
  renderChampionTagCatalog();
  renderTagsWorkspace();
  renderUsersWorkspace();
  renderCompositionsWorkspace();
  renderChampionTagEditor();
  validateTeamSelections();
  renderTeamConfig();
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

  elements.authLogout.addEventListener("click", (e) => {
    e.preventDefault();
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
    renderAuthGate();
    renderAuth();
    void refreshChampionDataFromApi()
      .then(() => {
        renderExplorer();
      })
      .catch(() => {});
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
      if (settingName === "admin-champion-core") {
        setTab("champion-core", { syncRoute: true });
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
    elements.avatarModalSave.addEventListener("click", () => {
      void saveAvatarSelection();
    });
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
  if (elements.profileSaveDisplayTeam) {
    elements.profileSaveDisplayTeam.addEventListener("click", () => {
      void saveProfileDisplayTeamPreference();
    });
  }

  // Getting Started toggle — Profile page
  if (elements.profileSaveGettingStarted) {
    elements.profileSaveGettingStarted.addEventListener("click", () => {
      state.ui.showGettingStarted = elements.profileShowGettingStarted?.checked ?? true;
      state.ui.gettingStartedDismissed = false;
      saveUiState();
      renderAllGettingStartedBars();
      renderPlayerConfig();
      if (elements.profileGettingStartedFeedback) {
        elements.profileGettingStartedFeedback.textContent = "Saved.";
        setTimeout(() => {
          if (elements.profileGettingStartedFeedback) elements.profileGettingStartedFeedback.textContent = "";
        }, 2000);
      }
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
  if (elements.confirmationCancel) {
    elements.confirmationCancel.addEventListener("click", () => {
      settleConfirmation(false);
    });
  }
  if (elements.confirmationConfirm) {
    elements.confirmationConfirm.addEventListener("click", () => {
      settleConfirmation(true);
    });
  }
  if (elements.confirmationModal) {
    elements.confirmationModal.addEventListener("click", (event) => {
      if (event.target === elements.confirmationModal) {
        settleConfirmation(false);
      }
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
      if (state?.api?.confirmation?.isOpen === true) {
        settleConfirmation(false);
        return;
      }
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

  // explorerScaling events handled by multiSelectControls.explorerScaling

  elements.explorerSort.addEventListener("change", () => {
    state.explorer.sortBy = elements.explorerSort.value;
    renderExplorer();
  });

  elements.explorerMetadataScope?.addEventListener("change", () => {
    state.explorer.metadataScopeFilter = elements.explorerMetadataScope.value;
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
    multiSelectControls.explorerScaling?.setSelected([]);
    state.explorer.scaling = [];
    renderExplorer();
  });

  elements.explorerClearSort.addEventListener("click", () => {
    elements.explorerSort.value = "alpha-asc";
    state.explorer.sortBy = "alpha-asc";
    renderExplorer();
  });

  elements.explorerClearMetadataScope?.addEventListener("click", () => {
    state.explorer.metadataScopeFilter = "";
    refreshExplorerMetadataScopeFilterOptions();
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

  if (elements.tagsManageOpen) {
    elements.tagsManageOpen.addEventListener("click", openTagsManageModal);
  }

  if (elements.tagsManageModalClose) {
    elements.tagsManageModalClose.addEventListener("click", () => {
      void confirmAndCloseTagsManageModal();
    });
  }

  if (elements.tagsManageModal) {
    elements.tagsManageModal.addEventListener("click", (event) => {
      if (event.target === elements.tagsManageModal) {
        void confirmAndCloseTagsManageModal();
      }
    });
  }

  if (elements.tagsManageSave) {
    elements.tagsManageSave.addEventListener("click", () => {
      void saveManagedTag();
    });
  }

  if (elements.tagsManageCancel) {
    elements.tagsManageCancel.addEventListener("click", async () => {
      const isEditing = Boolean(getManagedTagById(state.api.selectedTagManagerId));
      if (isEditing) {
        const snapshot = state.api.tagManageSnapshot;
        const currentName = (elements.tagsManageName?.value ?? "").trim();
        const currentDef = (elements.tagsManageDefinition?.value ?? "").trim();
        const isDirty = currentName !== (snapshot?.name ?? "") || currentDef !== (snapshot?.definition ?? "");
        if (isDirty) {
          const confirmed = await showUSSConfirm({
            title: "Unsaved Tag Changes",
            body: "You have unsaved changes to this tag. Discard them?",
            affirmLabel: "Discard",
            cancelLabel: "Keep Editing",
            destructive: true
          });
          if (!confirmed) return;
        }
        closeTagsManageModal();
      } else {
        clearTagsManagerState();
        renderTagsManageModal();
      }
    });
  }

  if (elements.tagsScope) {
    elements.tagsScope.addEventListener("change", () => {
      state.api.tagsCatalogScope = normalizeChampionTagScope(elements.tagsScope.value);
      clearTagsManagerState();
      void loadScopedTagCatalogIntoState(
        {
          tags: "tagsWorkspaceCatalog",
          tagById: "tagsWorkspaceTagById"
        },
        {
          ...getTagCatalogScopeRequestContext(),
          includeFallback: true
        }
      ).then(() => {
        renderTagsWorkspace();
      });
    });
  }

  if (elements.tagsTeam) {
    elements.tagsTeam.addEventListener("change", () => {
      state.api.tagsCatalogTeamId = String(elements.tagsTeam.value ?? "");
      clearTagsManagerState();
      void loadScopedTagCatalogIntoState(
        {
          tags: "tagsWorkspaceCatalog",
          tagById: "tagsWorkspaceTagById"
        },
        {
          ...getTagCatalogScopeRequestContext(),
          includeFallback: true
        }
      ).then(() => {
        renderTagsWorkspace();
      });
    });
  }

  if (elements.championCoreSearch) {
    elements.championCoreSearch.addEventListener("input", () => {
      state.api.championCoreSearch = elements.championCoreSearch.value;
      renderChampionCoreWorkspace();
    });
  }

  if (elements.championCoreRefresh) {
    elements.championCoreRefresh.addEventListener("click", () => {
      void loadChampionCoreFromApi();
    });
  }

  if (elements.usersSearch) {
    elements.usersSearch.addEventListener("input", () => {
      state.api.usersSearch = elements.usersSearch.value;
      renderUsersWorkspace();
    });
  }

  if (elements.usersRoleFilter) {
    elements.usersRoleFilter.addEventListener("change", () => {
      state.api.usersRoleFilter = elements.usersRoleFilter.value;
      renderUsersWorkspace();
    });
  }

  if (elements.usersBulkRole) {
    elements.usersBulkRole.addEventListener("change", () => {
      state.api.bulkUserRole = normalizeApiUserRole(elements.usersBulkRole.value);
      renderUsersWorkspace();
    });
  }

  if (elements.usersBulkApply) {
    elements.usersBulkApply.addEventListener("click", () => {
      void applyBulkUserRoleFromWorkspace();
    });
  }

  if (elements.usersSelectionClear) {
    elements.usersSelectionClear.addEventListener("click", () => {
      clearSelectedAdminUsers();
      renderUsersWorkspace();
    });
  }

  if (elements.issueReportSubmit) {
    elements.issueReportSubmit.addEventListener("click", () => {
      void submitIssueReport();
    });
  }

  if (elements.issueReportCancel) {
    elements.issueReportCancel.addEventListener("click", () => {
      closeIssueReportingPanel();
    });
  }

  if (elements.issueReportFallbackLink) {
    elements.issueReportFallbackLink.addEventListener("click", () => {
      setIssueReportFeedback("");
    });
  }

  if (elements.issueReportModal) {
    elements.issueReportModal.addEventListener("click", (event) => {
      if (event.target === elements.issueReportModal && !state.api.issueReporting.isSubmitting) {
        closeIssueReportingPanel();
      }
    });
  }

  for (const scopeSelect of [elements.requirementsScope, elements.compositionsScope]) {
    if (!scopeSelect) {
      continue;
    }
    scopeSelect.addEventListener("change", () => {
      const selectedScope = normalizeChampionTagScope(scopeSelect.value);
      state.api.compositionCatalogScope = selectedScope;
      if (selectedScope !== "team") {
        state.api.compositionCatalogTeamId = "";
      } else {
        state.api.compositionCatalogTeamId = resolveCompositionCatalogTeamId();
      }
      state.api.isRequirementDefinitionEditorOpen = false;
      setRequirementDefinitionDraft(null);
      setCompositionBundleDraft(null);
      setRequirementsFeedback("Loading requirement definitions...");
      setCompositionsFeedback("Loading compositions...");
      renderCompositionsWorkspace();
      void hydrateCompositionsWorkspaceFromApi();
    });
  }

  for (const teamSelect of [elements.requirementsTeam, elements.compositionsTeam]) {
    if (!teamSelect) {
      continue;
    }
    teamSelect.addEventListener("change", () => {
      state.api.compositionCatalogTeamId = normalizeTeamEntityId(teamSelect.value) ?? "";
      state.api.isRequirementDefinitionEditorOpen = false;
      setRequirementDefinitionDraft(null);
      setCompositionBundleDraft(null);
      setRequirementsFeedback("Loading team-scoped requirement definitions...");
      setCompositionsFeedback("Loading team-scoped compositions...");
      renderCompositionsWorkspace();
      void hydrateCompositionsWorkspaceFromApi();
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

  if (elements.requirementsCreateBtn) {
    elements.requirementsCreateBtn.addEventListener("click", () => {
      openRequirementEditorModal(null);
    });
  }

  if (elements.requirementsTourBtn) {
    elements.requirementsTourBtn.addEventListener("click", () => {
      startRequirementsTour();
    });
  }

  if (elements.requirementsTourDismiss) {
    elements.requirementsTourDismiss.addEventListener("click", () => {
      state.ui.gettingStartedDismissed = true;
      renderAllGettingStartedBars();
      if (elements.requirementsTourCallout) elements.requirementsTourCallout.hidden = true;
    });
  }

  if (elements.requirementsTourHide) {
    elements.requirementsTourHide.addEventListener("click", () => {
      state.ui.showGettingStarted = false;
      saveUiState();
      renderAllGettingStartedBars();
    });
  }

  if (elements.requirementsNavCompositions) {
    elements.requirementsNavCompositions.addEventListener("click", () => {
      setTab("compositions", { syncRoute: true });
    });
  }

  if (elements.requirementsNavComposer) {
    elements.requirementsNavComposer.addEventListener("click", () => {
      setTab("workflow", { syncRoute: true });
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

  if (elements.compositionsCreateBtn) {
    elements.compositionsCreateBtn.addEventListener("click", () => {
      openCompositionEditorModal(null);
    });
  }

  if (elements.compositionsTourBtn) {
    elements.compositionsTourBtn.addEventListener("click", () => {
      startCompositionsTour();
    });
  }

  if (elements.compositionsTourDismiss) {
    elements.compositionsTourDismiss.addEventListener("click", () => {
      state.ui.gettingStartedDismissed = true;
      renderAllGettingStartedBars();
      if (elements.compositionsTourCallout) elements.compositionsTourCallout.hidden = true;
    });
  }

  if (elements.compositionsTourHide) {
    elements.compositionsTourHide.addEventListener("click", () => {
      state.ui.showGettingStarted = false;
      saveUiState();
      renderAllGettingStartedBars();
    });
  }

  if (elements.compositionsNavRequirements) {
    elements.compositionsNavRequirements.addEventListener("click", () => {
      setTab("requirements", { syncRoute: true });
    });
  }

  if (elements.compositionsNavComposer) {
    elements.compositionsNavComposer.addEventListener("click", () => {
      setTab("workflow", { syncRoute: true });
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
        setChampionTagEditorFeedback("Loading champion profile...");
        void loadChampionEditorScopeData(state.api.selectedChampionTagEditorId);
      }
    });
  }

  if (elements.championTagEditorTeam) {
    elements.championTagEditorTeam.addEventListener("change", () => {
      state.api.championTagTeamId = normalizeTeamEntityId(elements.championTagEditorTeam.value) ?? "";
      renderChampionTagEditor();
      if (state.api.selectedChampionTagEditorId) {
        setChampionTagEditorFeedback("Loading champion profile...");
        void loadChampionEditorScopeData(state.api.selectedChampionTagEditorId);
      }
    });
  }

  if (elements.championTagEditorReviewed) {
    elements.championTagEditorReviewed.addEventListener("change", () => {
      state.api.championReviewedDraft = elements.championTagEditorReviewed.checked;
      renderChampionTagEditor();
    });
  }

  if (elements.championCompositionSynergyDefinition) {
    elements.championCompositionSynergyDefinition.addEventListener("input", () => {
      state.api.championMetadataDraft.compositionSynergies.definition =
        elements.championCompositionSynergyDefinition.value;
    });
  }

  if (elements.championCompositionSynergyEdit) {
    elements.championCompositionSynergyEdit.addEventListener("click", () => {
      openChampionCompositionSynergyEditorModal();
    });
  }

  if (elements.championCompositionSynergyClear) {
    elements.championCompositionSynergyClear.addEventListener("click", () => {
      state.api.championMetadataDraft.compositionSynergies = createEmptyChampionCompositionSynergiesDraft();
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
    void refreshBuilderComposerContext({ includeDraftContext: true });
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

  if (elements.builderCompEdit) {
    elements.builderCompEdit.addEventListener("click", () => {
      const selected = getBuilderSelectedComposition();
      if (selected) {
        openCompositionEditorModal(selected);
      }
    });
  }

  if (elements.builderCompCreate) {
    elements.builderCompCreate.addEventListener("click", () => {
      openCompositionEditorModal(null);
    });
  }

  if (elements.builderCompManage) {
    elements.builderCompManage.addEventListener("click", () => {
      setTab("compositions", { syncRoute: true });
    });
  }

  if (elements.builderReqManage) {
    elements.builderReqManage.addEventListener("click", () => {
      setTab("requirements", { syncRoute: true });
    });
  }

  if (elements.builderTourBtn) {
    elements.builderTourBtn.addEventListener("click", () => {
      startComposerTour();
    });
  }

  if (elements.builderTourDismiss) {
    elements.builderTourDismiss.addEventListener("click", () => {
      state.ui.gettingStartedDismissed = true;
      renderAllGettingStartedBars();
      if (elements.builderTourCallout) elements.builderTourCallout.hidden = true;
    });
  }

  if (elements.builderTourHide) {
    elements.builderTourHide.addEventListener("click", () => {
      state.ui.showGettingStarted = false;
      saveUiState();
      renderAllGettingStartedBars();
    });
  }

  if (elements.builderCustomScopesEnabled) {
    elements.builderCustomScopesEnabled.addEventListener("change", () => {
      state.builder.useCustomScopes = elements.builderCustomScopesEnabled.checked;
      setBuilderStage("setup");
      resetBuilderTreeState();
      void refreshBuilderComposerContext({ includeDraftContext: false });
    });
  }

  if (elements.builderScopeModeSelect) {
    elements.builderScopeModeSelect.addEventListener("change", () => {
      state.builder.useCustomScopes = elements.builderScopeModeSelect.value === "custom";
      elements.builderCustomScopesEnabled.checked = state.builder.useCustomScopes;
      setBuilderStage("setup");
      resetBuilderTreeState();
      void refreshBuilderComposerContext({ includeDraftContext: false });
      if (state.builder.useCustomScopes) {
        openScopeConfigModal();
      }
    });
  }

  if (elements.builderScopeConfigureBtn) {
    elements.builderScopeConfigureBtn.addEventListener("click", () => {
      openScopeConfigModal();
    });
  }

  if (elements.builderScopeDefaultPrecedence) {
    elements.builderScopeDefaultPrecedence.addEventListener("change", () => {
      state.builder.defaultScopePrecedence = normalizeBuilderScopePrecedence(elements.builderScopeDefaultPrecedence.value);
      for (const resource of BUILDER_SCOPE_RESOURCES) {
        const resourceConfig = state.builder.scopeResourceSettings?.[resource] ?? {};
        state.builder.scopeResourceSettings[resource] = {
          enabled: resourceConfig.enabled !== false,
          precedence: normalizeBuilderScopePrecedence(resourceConfig.precedence, state.builder.defaultScopePrecedence)
        };
      }
      setBuilderStage("setup");
      resetBuilderTreeState();
      void refreshBuilderComposerContext({ includeDraftContext: false });
    });
  }

  if (elements.builderDraftSetupSave) {
    elements.builderDraftSetupSave.addEventListener("click", () => {
      openBuilderSaveDraftModal();
    });
  }

  if (elements.builderDraftSetupLoad) {
    elements.builderDraftSetupLoad.addEventListener("click", () => {
      openBuilderLoadDraftModal();
    });
  }

  if (elements.builderSaveDraftName) {
    elements.builderSaveDraftName.addEventListener("input", () => {
      state.builder.draftSetupName = elements.builderSaveDraftName.value;
    });
  }

  if (elements.builderSaveDraftDescription) {
    elements.builderSaveDraftDescription.addEventListener("input", () => {
      state.builder.draftSetupDescription = elements.builderSaveDraftDescription.value;
    });
  }

  if (elements.builderSaveDraftSettingsOnly) {
    elements.builderSaveDraftSettingsOnly.addEventListener("change", () => {
      state.builder.draftSetupSaveMode = elements.builderSaveDraftSettingsOnly.checked ? "settings_only" : "full";
    });
  }

  if (elements.builderSaveDraftCancel) {
    elements.builderSaveDraftCancel.addEventListener("click", closeBuilderSaveDraftModal);
  }

  if (elements.builderSaveDraftConfirm) {
    elements.builderSaveDraftConfirm.addEventListener("click", () => {
      void saveCurrentDraftSetup();
    });
  }

  if (elements.builderSaveDraftModal) {
    elements.builderSaveDraftModal.addEventListener("click", (event) => {
      if (event.target === elements.builderSaveDraftModal && !state.builder.isSavingDraftSetup) {
        closeBuilderSaveDraftModal();
      }
    });
  }

  if (elements.builderLoadDraftClose) {
    elements.builderLoadDraftClose.addEventListener("click", closeBuilderLoadDraftModal);
  }

  if (elements.builderLoadDraftModal) {
    elements.builderLoadDraftModal.addEventListener("click", (event) => {
      if (event.target === elements.builderLoadDraftModal) {
        closeBuilderLoadDraftModal();
      }
    });
  }

  if (elements.tagsPromotionRefresh) {
    elements.tagsPromotionRefresh.addEventListener("click", () => {
      void loadTagPromotionQueuesFromApi();
    });
  }

  if (elements.tagsPromotionOpen) {
    elements.tagsPromotionOpen.addEventListener("click", openTagPromotionModal);
  }

  if (elements.tagsPromotionModalComment) {
    elements.tagsPromotionModalComment.addEventListener("input", () => {
      state.api.tagPromotionDraftComment = elements.tagsPromotionModalComment.value;
    });
  }

  if (elements.tagsPromotionModalCancel) {
    elements.tagsPromotionModalCancel.addEventListener("click", () => {
      closeTagPromotionModal();
    });
  }

  if (elements.tagsPromotionModalSubmit) {
    elements.tagsPromotionModalSubmit.addEventListener("click", () => {
      void requestTagPromotion();
    });
  }

  if (elements.tagsPromotionModal) {
    elements.tagsPromotionModal.addEventListener("click", (event) => {
      if (event.target === elements.tagsPromotionModal && !state.api.isSubmittingTagPromotion) {
        closeTagPromotionModal();
      }
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

  elements.builderGenerate.addEventListener("click", () => {
    generateTreeFromCurrentState({ scrollToResults: true });
  });

  elements.builderClearSticky.addEventListener("click", () => {
    state.builder.teamState = createEmptyTeamState();
    state.builder.excludedChampions = [];
    state.builder.excludedSearch = "";
    state.builder.treeValidLeavesOnly = true;
    state.builder.treeMinCandidateScore = 1;
    state.builder.treeRankGoal = BUILDER_RANK_GOAL_VALID_END_STATES;
    state.builder.candidateScoringWeights = { ...BUILDER_DEFAULT_CANDIDATE_SCORING_WEIGHTS };
    state.builder.draftOrder = [...SLOTS];
    state.builder.slotPoolRole = Object.fromEntries(SLOTS.map((s) => [s, s]));
    state.builder.maxBranch = 8;
    resetBuilderTreeState();
    setBuilderStage("setup");
    validateTeamSelections();
    clearBuilderFeedback();
    setSetupFeedback("");
    renderTeamConfig();
    renderBuilder();
    // Re-generate tree so Draft Selector repopulates (matches page-load behavior)
    generateTreeFromCurrentState({ scrollToResults: false });
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
      void refreshBuilderComposerContext({ includeDraftContext: true });
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
      void refreshTeamWorkspaceDataForActiveTab();
    });
  }

  if (elements.reportIssueLink) {
    elements.reportIssueLink.addEventListener("click", (event) => {
      event.preventDefault();
      openIssueReportingPanel();
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

  if (elements.myChampionsAddBtn) {
    elements.myChampionsAddBtn.addEventListener("click", () => {
      openChampionSelectorModal();
    });
  }
  if (elements.championSelectorSearch) {
    elements.championSelectorSearch.addEventListener("input", () => {
      state.playerConfig.selectorFilter = elements.championSelectorSearch.value;
      renderChampionSelectorGrid();
    });
  }
  if (elements.championSelectorDone) {
    elements.championSelectorDone.addEventListener("click", () => {
      closeChampionSelectorModal(false);
    });
  }
  if (elements.championSelectorCancel) {
    elements.championSelectorCancel.addEventListener("click", () => {
      closeChampionSelectorModal(true);
    });
  }
  if (elements.championSelectorClear) {
    elements.championSelectorClear.addEventListener("click", () => {
      state.playerConfig.selectorPending = [];
      renderChampionSelectorGrid();
    });
  }
  if (elements.championSelectorModal) {
    elements.championSelectorModal.addEventListener("click", (e) => {
      if (e.target === elements.championSelectorModal) closeChampionSelectorModal(true);
    });
  }
  if (elements.myChampionsSearch) {
    elements.myChampionsSearch.addEventListener("input", () => {
      state.playerConfig.cardFilter = elements.myChampionsSearch.value;
      renderMyChampions();
    });
  }
  if (elements.myChampionsComfortFilter) {
    multiSelectControls.myChampionsComfort = createCheckboxMultiControl({
      root: elements.myChampionsComfortFilter,
      options: FAMILIARITY_GRADES.map((grade) => ({ value: grade, label: grade })),
      selectedValues: [],
      placeholder: "All Comfort Levels",
      onChange(selectedValues) {
        state.playerConfig.comfortFilter = selectedValues;
        renderMyChampions();
      }
    });
  }

  elements.profilePrimaryRole.addEventListener("change", () => {
    state.profile.primaryRole = normalizeProfileRole(elements.profilePrimaryRole.value);
    state.profile.secondaryRoles = normalizeSecondaryRoles(state.profile.secondaryRoles, state.profile.primaryRole);
    state.playerConfig.teamId = buildRolePoolTeamId(state.profile.primaryRole);
    renderPlayerConfig();
  });

  if (elements.profileCancelRoles) {
    elements.profileCancelRoles.addEventListener("click", () => {
      cancelOtherRolesModal();
    });
  }

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
    state.api.teamAdminAddMemberSearchQuery = "";
    state.api.teamAdminAddMemberSearchResults = [];
    state.api.isLoadingTeamAdminAddMemberSearch = false;
    _teamAdminAddMemberSearchRequestId += 1;
    if (elements.teamAdminAddRiotId) {
      elements.teamAdminAddRiotId.value = "";
    }
    void loadTeamMembersForSelectedTeam().then(async () => {
      await refreshTeamWorkspaceDataForActiveTab();
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
      void loadTeamsFromApi(state.api.selectedTeamId).then(async () => {
        await refreshTeamWorkspaceDataForActiveTab();
        renderTeamAdmin();
      });
    });
  }

  if (elements.teamJoinDiscoverRefresh) {
    elements.teamJoinDiscoverRefresh.addEventListener("click", () => {
      void loadDiscoverTeamsFromApi().then(() => {
        setTeamJoinFeedback("");
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

  if (elements.teamJoinReviewRefresh) {
    elements.teamJoinReviewRefresh.addEventListener("click", () => {
      void loadPendingJoinRequestsForSelectedTeam().then(() => {
        setTeamJoinFeedback("");
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

  if (elements.teamInviteRefresh) {
    elements.teamInviteRefresh.addEventListener("click", () => {
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

  if (elements.teamInviteUserRefresh) {
    elements.teamInviteUserRefresh.addEventListener("click", () => {
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
    void confirmAction({
      title: "Confirm Team Deletion",
      message: `Delete team '${selectedTeam.name}'? This permanently removes the roster and team settings.`,
      confirmLabel: "Delete Team"
    }).then((confirmed) => {
      if (!confirmed) {
        return;
      }
      return apiRequest(`/teams/${selectedTeam.id}`, {
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
  });

  if (elements.teamAdminAddRiotId) {
    elements.teamAdminAddRiotId.addEventListener("input", () => {
      void loadTeamAdminAddMemberSearchResults(elements.teamAdminAddRiotId.value);
    });
  }

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
        state.api.teamAdminAddMemberSearchQuery = "";
        state.api.teamAdminAddMemberSearchResults = [];
        state.api.isLoadingTeamAdminAddMemberSearch = false;
        _teamAdminAddMemberSearchRequestId += 1;
        renderTeamMemberRiotIdOptions();
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

    void confirmAction({
      title: "Confirm Member Removal",
      message: `Remove ${lookup.riotId} from ${selectedTeam.name}?`,
      confirmLabel: "Remove Member"
    }).then((confirmed) => {
      if (!confirmed) {
        return;
      }
      return apiRequest(`/teams/${selectedTeam.id}/members/${userId}`, {
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
    await loadIssueReportingStatusFromApi();
    let loadedTeamContextFromApi = false;
    if (isAuthenticated()) {
      await loadProfileFromApi();
      await loadPoolsFromApi();
      await loadTeamsFromApi();
      await Promise.all([
        loadDiscoverTeamsFromApi(),
        loadInvitationsForUser()
      ]);
      if (canReviewSelectedTeam()) {
        await Promise.all([
          loadPendingJoinRequestsForSelectedTeam(),
          loadMemberInvitationsForSelectedTeam()
        ]);
      }
      loadedTeamContextFromApi = await loadTeamContextFromApi();
      if (state.ui.teamWorkspaceTab === TEAM_WORKSPACE_TAB_MEMBER && canReviewSelectedTeam()) {
        const selectedTeam = getSelectedAdminTeam();
        const selectedTeamId = selectedTeam ? String(selectedTeam.id) : "";
        if (selectedTeamId && !state.api.teamInvitationsLoadedAtByTeamId[selectedTeamId]) {
          await loadMemberInvitationsForSelectedTeam();
        }
      }
      await hydrateCompositionsWorkspaceFromApi();
      if (isAdminUser()) {
        await loadUsersFromApi();
      }
      await loadDraftSetupsFromApi();
      await loadTagPromotionQueuesFromApi();
    } else {
      loadStoredPlayerConfig();
      setPoolApiFeedback("Sign in to manage API-backed pools.");
      setTeamAdminFeedback("Sign in to manage teams.");
      setTeamJoinFeedback("Sign in to request or review team join requests.");
      setProfileRolesFeedback("");
      setUsersFeedback("Sign in as admin to manage users.");
      setChampionCoreFeedback("Sign in as admin to inspect champion core rows.");
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
    clearBuilderFeedback();
    await fetchBuilderDraftContext(state.builder.teamId);
    await loadComposerContextFromApi();
    validateTeamSelections();
    renderTeamConfig();
    renderTeamAdmin();
    renderPlayerConfig();
    renderChampionTagCatalog();
    renderTagsWorkspace();
    renderUsersWorkspace();
    renderChampionCoreWorkspace();
    renderCompositionsWorkspace();
    renderChampionTagEditor();
    renderIssueReportingPanel();
    renderAuth();
    renderAllGettingStartedBars();
    // Auto-generate tree on load so Draft Selector is immediately populated.
    // generateTreeFromCurrentState calls renderBuilder() internally.
    generateTreeFromCurrentState({ scrollToResults: false });
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
