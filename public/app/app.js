import {
  BOOLEAN_TAGS,
  DAMAGE_TYPES,
  DEFAULT_RECOMMENDATION_WEIGHTS,
  DEFAULT_REQUIREMENT_TOGGLES,
  SCALING_VALUES,
  SLOTS,
  DataValidationError,
  createEmptyTeamState,
  isDamageType,
  isScaling,
  isSlot,
  parseChampionsCsv,
  evaluateCompositionChecks,
  generatePossibilityTree,
  scoreNodeFromChecks,
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
const TEAM_WORKSPACE_TAB_MANAGE = "manage";
const TEAM_WORKSPACE_TAB_CREATE = "create";
const TEAM_WORKSPACE_TAB_SET = new Set([TEAM_WORKSPACE_TAB_MANAGE, TEAM_WORKSPACE_TAB_CREATE]);
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
const CHAMPION_TAG_SCOPES = Object.freeze(["all"]);
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
const ALLOWED_TEAM_LOGO_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_TEAM_LOGO_BYTES = 512 * 1024;
const PREFILLED_RECOMMENDATION_LIMIT = 3;
const HIGH_SIGNAL_MASTERY_LEVEL = 6;
const HIGH_SIGNAL_CHAMPION_POINTS = 100000;

const FAMILIARITY_LEVEL_LABELS = Object.freeze({
  1: "I know all the intricacies and how to use them",
  2: "I've got all the normal and a lot of the harder skills down.",
  3: "I am familiar enough to play at an average level.",
  4: "I will potentially panic or misinput a spell",
  5: "There are intricacies I straight up don't know.",
  6: "I don't know how that champion works."
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
    maxDepth: 4,
    maxBranch: 8
  }
});

const BUILDER_DEFAULTS = Object.freeze({
  defaultTreeDensity: "summary",
  showOptionalChecksByDefault: false
});

const UI_COPY = Object.freeze({
  hero: {
    kicker: "DraftEngine",
    tabs: {
      workflow: {
        title: "Composer",
        subtitle: "Configure team context, scout candidates, and run deterministic next-pick simulations."
      },
      "team-config": {
        title: "Teams",
        subtitle: "Create teams, manage rosters, and maintain team settings."
      },
      "player-config": {
        title: "Profile",
        subtitle: "Manage your roles, champion pools, and Riot champion stats."
      },
      explorer: {
        title: "Champions",
        subtitle: "Browse champion cards, filter by tags, and edit global champion metadata."
      },
      tags: {
        title: "Tags",
        subtitle: "Review tag categories and current champion coverage."
      },
      "coming-soon": {
        title: "Updates & Roadmap",
        subtitle: "Review latest shipped changes and track known gaps grouped by workspace page."
      }
    }
  },
  nav: {
    title: "Workspace",
    meta: "Jump between Composer, Teams, Profile, Champions, Tags, and Updates.",
    toggleClosed: "Menu",
    toggleOpen: "Close Menu",
    desktopCollapseIcon: "◀",
    desktopExpandIcon: "▶",
    desktopCollapseLabel: "Collapse sidebar",
    desktopExpandLabel: "Expand sidebar",
    items: {
      workflow: "Composer",
      "team-config": "Teams",
      "player-config": "Profile",
      explorer: "Champions",
      tags: "Tags",
      "coming-soon": "Updates"
    }
  },
  panels: {
    explorerTitle: "Champions",
    explorerMeta: "Filter champions by role, damage profile, scaling, and tags.",
    tagsTitle: "Tags",
    tagsMeta: "Review tag categories and current champion coverage.",
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
        panelMeta: "Set team context, lock known picks, and adjust generation constraints."
      },
      {
        key: "inspect",
        panelTitle: "Review",
        panelMeta: "Review checks, generate options, and inspect slot-level node impact."
      }
    ],
    continueLabel: "Review Composition",
    generateLabel: "Generate Tree",
    setupGateMessage: "Go to Review before generating the tree."
  }
});

const COMPACT_NAV_MEDIA_QUERY = "(max-width: 1099px)";
const DEFAULT_TAB_ROUTE = "workflow";
const TAB_ROUTES = Object.freeze(["workflow", "team-config", "player-config", "explorer", "tags", "coming-soon"]);
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

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

function createEmptyChampionMetadataDraft() {
  return {
    roles: [],
    damageType: "",
    scaling: ""
  };
}

function createInitialState() {
  return {
    data: null,
    activeTab: DEFAULT_TAB_ROUTE,
    ui: {
      isNavOpen: false,
      isNavCollapsed: false,
      teamWorkspaceTab: TEAM_WORKSPACE_TAB_MANAGE,
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
      championStats: createEmptyChampionStatsState()
    },
    api: {
      pools: [],
      poolByTeamId: {},
      teams: [],
      membersByTeamId: {},
      selectedTeamId: "",
      isCreatingTeam: false,
      tags: [],
      tagById: {},
      selectedChampionTagEditorId: null,
      selectedChampionTagIds: [],
      championTagScope: "all",
      championTagTeamId: "",
      championEditorTab: CHAMPION_EDITOR_TAB_COMPOSITION,
      championMetadataDraft: createEmptyChampionMetadataDraft(),
      isLoadingChampionTags: false,
      isSavingChampionTags: false,
      selectedTagManagerId: null,
      isSavingTagCatalog: false
    },
    explorer: {
      search: "",
      roles: [],
      damageTypes: [],
      scaling: "",
      includeTags: [],
      excludeTags: [],
      sortBy: "alpha-asc"
    },
    teamConfig: {
      defaultTeamId: null,
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
      teamState: createEmptyTeamState(),
      draftOrder: [...SLOTS],
      toggles: {
        ...DEFAULT_REQUIREMENT_TOGGLES
      },
      excludedChampions: [],
      excludedSearch: "",
      maxDepth: 4,
      maxBranch: 8,
      tree: null,
      treeDensity: "summary",
      treeSearch: "",
      treeMinScore: 0,
      treeMinCandidateScore: 1,
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
    authGate: runtimeDocument.querySelector("#auth-gate"),
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
    authPassword: runtimeDocument.querySelector("#auth-password"),
    authPasswordGroup: runtimeDocument.querySelector("#auth-password-group"),
    authRegister: runtimeDocument.querySelector("#auth-register"),
    authLogin: runtimeDocument.querySelector("#auth-login"),
    authLogout: runtimeDocument.querySelector("#auth-logout"),
    authStatus: runtimeDocument.querySelector("#auth-status"),
    authRegistrationHelp: runtimeDocument.querySelector("#auth-registration-help"),
    authFeedback: runtimeDocument.querySelector("#auth-feedback"),
    explorerTitle: runtimeDocument.querySelector("#explorer-title"),
    explorerMeta: runtimeDocument.querySelector("#explorer-meta"),
    teamConfigTitle: runtimeDocument.querySelector("#team-config-title"),
    teamConfigMeta: runtimeDocument.querySelector("#team-config-meta"),
    playerConfigTitle: runtimeDocument.querySelector("#player-config-title"),
    playerConfigMeta: runtimeDocument.querySelector("#player-config-meta"),
    tagsTitle: runtimeDocument.querySelector("#tags-title"),
    tagsMeta: runtimeDocument.querySelector("#tags-meta"),
    tagsManageAccess: runtimeDocument.querySelector("#tags-manage-access"),
    tagsManageName: runtimeDocument.querySelector("#tags-manage-name"),
    tagsManageCategory: runtimeDocument.querySelector("#tags-manage-category"),
    tagsManageSave: runtimeDocument.querySelector("#tags-manage-save"),
    tagsManageCancel: runtimeDocument.querySelector("#tags-manage-cancel"),
    tagsManageFeedback: runtimeDocument.querySelector("#tags-manage-feedback"),
    comingSoonTitle: runtimeDocument.querySelector("#coming-soon-title"),
    comingSoonMeta: runtimeDocument.querySelector("#coming-soon-meta"),
    tabExplorer: runtimeDocument.querySelector("#tab-explorer"),
    tabWorkflow: runtimeDocument.querySelector("#tab-workflow"),
    tabTags: runtimeDocument.querySelector("#tab-tags"),
    tabTeamConfig: runtimeDocument.querySelector("#tab-team-config"),
    tabPlayerConfig: runtimeDocument.querySelector("#tab-player-config"),
    tabComingSoon: runtimeDocument.querySelector("#tab-coming-soon"),
    explorerSearch: runtimeDocument.querySelector("#explorer-search"),
    explorerRole: runtimeDocument.querySelector("#explorer-role"),
    explorerDamage: runtimeDocument.querySelector("#explorer-damage"),
    explorerScaling: runtimeDocument.querySelector("#explorer-scaling"),
    explorerSort: runtimeDocument.querySelector("#explorer-sort"),
    explorerIncludeTags: runtimeDocument.querySelector("#explorer-include-tags"),
    explorerExcludeTags: runtimeDocument.querySelector("#explorer-exclude-tags"),
    explorerClearAll: runtimeDocument.querySelector("#explorer-clear-all"),
    explorerClearInclude: runtimeDocument.querySelector("#explorer-clear-include"),
    explorerClearExclude: runtimeDocument.querySelector("#explorer-clear-exclude"),
    explorerCount: runtimeDocument.querySelector("#explorer-count"),
    explorerResults: runtimeDocument.querySelector("#explorer-results"),
    championTagCatalogMeta: runtimeDocument.querySelector("#champion-tag-catalog-meta"),
    championTagCatalogList: runtimeDocument.querySelector("#champion-tag-catalog-list"),
    championTagEditor: runtimeDocument.querySelector("#champion-tag-editor"),
    championTagEditorTitle: runtimeDocument.querySelector("#champion-tag-editor-title"),
    championTagEditorMeta: runtimeDocument.querySelector("#champion-tag-editor-meta"),
    championTagEditorScope: runtimeDocument.querySelector("#champion-tag-editor-scope"),
    championTagEditorTeamGroup: runtimeDocument.querySelector("#champion-tag-editor-team-group"),
    championTagEditorTeam: runtimeDocument.querySelector("#champion-tag-editor-team"),
    championEditorTabButtons: Array.from(runtimeDocument.querySelectorAll("button[data-champion-editor-tab]")),
    championEditorPanelComposition: runtimeDocument.querySelector("#champion-editor-panel-composition"),
    championEditorPanelRoles: runtimeDocument.querySelector("#champion-editor-panel-roles"),
    championEditorPanelDamage: runtimeDocument.querySelector("#champion-editor-panel-damage"),
    championEditorPanelScaling: runtimeDocument.querySelector("#champion-editor-panel-scaling"),
    championTagEditorTags: runtimeDocument.querySelector("#champion-tag-editor-tags"),
    championMetadataEditorRoles: runtimeDocument.querySelector("#champion-metadata-editor-roles"),
    championMetadataEditorDamageType: runtimeDocument.querySelector("#champion-metadata-editor-damage-type"),
    championMetadataEditorScaling: runtimeDocument.querySelector("#champion-metadata-editor-scaling"),
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
    builderTeamHelp: runtimeDocument.querySelector("#builder-team-help"),
    builderStageSetupTitle: runtimeDocument.querySelector("#builder-stage-setup-title"),
    builderStageSetupMeta: runtimeDocument.querySelector("#builder-stage-setup-meta"),
    builderStageInspectTitle: runtimeDocument.querySelector("#builder-stage-inspect-title"),
    builderStageInspectMeta: runtimeDocument.querySelector("#builder-stage-inspect-meta"),
    builderChecksReadiness: runtimeDocument.querySelector("#builder-checks-readiness"),
    builderStageSetup: runtimeDocument.querySelector("#builder-stage-setup"),
    builderStageInspect: runtimeDocument.querySelector("#builder-stage-inspect"),
    builderAdvancedControls: runtimeDocument.querySelector("#builder-advanced-controls"),
    builderToggles: runtimeDocument.querySelector("#builder-toggles"),
    builderToggleOptionalChecks: runtimeDocument.querySelector("#builder-toggle-optional-checks"),
    builderExcludedSearch: runtimeDocument.querySelector("#builder-excluded-search"),
    builderExcludedOptions: runtimeDocument.querySelector("#builder-excluded-options"),
    builderExcludedPills: runtimeDocument.querySelector("#builder-excluded-pills"),
    builderMaxDepth: runtimeDocument.querySelector("#builder-max-depth"),
    builderMaxBranch: runtimeDocument.querySelector("#builder-max-branch"),
    builderContinueValidate: runtimeDocument.querySelector("#builder-continue-validate"),
    builderGenerate: runtimeDocument.querySelector("#builder-generate"),
    builderClear: runtimeDocument.querySelector("#builder-clear"),
    builderDraftOrder: runtimeDocument.querySelector("#builder-draft-order"),
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
    treeValidLeavesOnly: runtimeDocument.querySelector("#tree-valid-leaves-only"),
    treeMapLegend: runtimeDocument.querySelector("#tree-map-legend"),
    treeExpandAll: runtimeDocument.querySelector("#tree-expand-all"),
    treeCollapseAll: runtimeDocument.querySelector("#tree-collapse-all"),
    teamConfigActiveTeam: runtimeDocument.querySelector("#team-config-active-team"),
    teamConfigDefaultTeam: runtimeDocument.querySelector("#team-config-default-team"),
    teamConfigContextHelp: runtimeDocument.querySelector("#team-config-context-help"),
    teamConfigDefaultHelp: runtimeDocument.querySelector("#team-config-default-help"),
    teamConfigActiveHelp: runtimeDocument.querySelector("#team-config-active-help"),
    teamConfigPoolSummary: runtimeDocument.querySelector("#team-config-pool-summary"),
    teamConfigPoolGrid: runtimeDocument.querySelector("#team-config-pool-grid"),
    teamWorkspaceTabButtons: Array.from(runtimeDocument.querySelectorAll("button[data-team-workspace-tab]")),
    teamWorkspaceManagePanel: runtimeDocument.querySelector("#team-workspace-manage"),
    teamWorkspaceCreatePanel: runtimeDocument.querySelector("#team-workspace-create"),
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
    playerConfigSavePool: runtimeDocument.querySelector("#player-config-save-pool"),
    playerConfigFeedback: runtimeDocument.querySelector("#player-config-feedback"),
    playerConfigGrid: runtimeDocument.querySelector("#player-config-grid"),
    settingsTeamsMemberSummary: runtimeDocument.querySelector("#settings-teams-member-summary"),
    settingsTeamsMemberList: runtimeDocument.querySelector("#settings-teams-member-list"),
    logoLightbox: runtimeDocument.querySelector("#logo-lightbox"),
    logoLightboxClose: runtimeDocument.querySelector("#logo-lightbox-close"),
    logoLightboxImage: runtimeDocument.querySelector("#logo-lightbox-image"),
    logoLightboxCaption: runtimeDocument.querySelector("#logo-lightbox-caption"),
    slotSelects: Object.fromEntries(
      SLOTS.map((slot) => [slot, runtimeDocument.querySelector(`#slot-${slot}`)])
    ),
    slotLabels: Object.fromEntries(
      SLOTS.map((slot) => [slot, runtimeDocument.querySelector(`#slot-label-${slot}`)])
    ),
    slotRows: Object.fromEntries(
      SLOTS.map((slot) => [slot, runtimeDocument.querySelector(`#slot-row-${slot}`)])
    ),
    slotOrderBadges: Object.fromEntries(
      SLOTS.map((slot) => [slot, runtimeDocument.querySelector(`#slot-order-${slot}`)])
    ),
    slotStatusBadges: Object.fromEntries(
      SLOTS.map((slot) => [slot, runtimeDocument.querySelector(`#slot-status-${slot}`)])
    )
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

function isAdminUser() {
  return String(state.auth.user?.role ?? "").trim().toLowerCase() === "admin";
}

function normalizeChampionTagScope(scope) {
  return CHAMPION_TAG_SCOPES.includes(scope) ? scope : "all";
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

function initializeChampionMetadataDraft(champion) {
  if (!champion) {
    state.api.championMetadataDraft = createEmptyChampionMetadataDraft();
    return;
  }
  state.api.championMetadataDraft = {
    roles: normalizeChampionMetadataRoles(champion.roles),
    damageType: normalizeApiDamageType(champion.damageType) ?? "",
    scaling: normalizeApiScaling(champion.scaling) ?? ""
  };
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
  const nextDamageType = normalizeApiDamageType(metadata.damageType);
  const nextScaling = normalizeApiScaling(metadata.scaling);
  if (nextRoles.length > 0) {
    champion.roles = nextRoles;
  }
  if (nextDamageType) {
    champion.damageType = nextDamageType;
  }
  if (nextScaling) {
    champion.scaling = nextScaling;
  }
  champion.tagIds = normalizeChampionTagIdArray(championPayload.tagIds ?? championPayload.tag_ids);
  initializeChampionMetadataDraft(champion);
}

function clearChampionTagEditorState() {
  state.api.selectedChampionTagEditorId = null;
  state.api.selectedChampionTagIds = [];
  state.api.championTagScope = "all";
  state.api.championTagTeamId = "";
  state.api.championEditorTab = CHAMPION_EDITOR_TAB_COMPOSITION;
  state.api.championMetadataDraft = createEmptyChampionMetadataDraft();
  state.api.isLoadingChampionTags = false;
  state.api.isSavingChampionTags = false;
  setChampionTagEditorFeedback("");
}

function clearTagsManagerState({ clearInputs = true } = {}) {
  state.api.selectedTagManagerId = null;
  state.api.isSavingTagCatalog = false;
  setTagsManageFeedback("");
  if (clearInputs) {
    if (elements.tagsManageName) {
      elements.tagsManageName.value = "";
    }
    if (elements.tagsManageCategory) {
      elements.tagsManageCategory.value = "";
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

function formatSavedProfileRolesFeedback(primaryRole, secondaryRoles) {
  const secondaryText = secondaryRoles.length > 0 ? secondaryRoles.join(", ") : "none";
  return `Saved profile roles. Primary: ${primaryRole}. Secondary: ${secondaryText}.`;
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

function normalizeFamiliarityLevel(rawValue, fallback = DEFAULT_FAMILIARITY_LEVEL) {
  const parsed = Number.parseInt(String(rawValue), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 6) {
    return fallback;
  }
  return parsed;
}

function getFamiliarityLabel(level) {
  return FAMILIARITY_LEVEL_LABELS[normalizeFamiliarityLevel(level)] ?? FAMILIARITY_LEVEL_LABELS[DEFAULT_FAMILIARITY_LEVEL];
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
  if (level >= 5 || points >= 60000) {
    return 3;
  }
  if (level >= 4 || points >= 25000) {
    return 4;
  }
  if (level >= 3 || points >= 8000) {
    return 5;
  }
  return 6;
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
  return hasAuthSession() && Boolean(runtimeApiBaseUrl);
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
  state.playerConfig.dirtyPoolByTeamId = {};
  state.playerConfig.isSavingPool = false;
  clearChampionTagEditorState();
  clearTagsManagerState();
  saveAuthSession();
  setAuthFeedback(feedback);
}

function setAuthMode(mode = "login") {
  state.auth.mode = mode === "register" ? "register" : "login";
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
  return hasDefinedProfileRoles(user) ? DEFAULT_TAB_ROUTE : "player-config";
}

function setAuthControlsVisibility(showAuthControls, mode = "login") {
  const alwaysVisibleWhenSignedOut = [
    elements.authEmailGroup,
    elements.authPasswordGroup,
    elements.authRegister,
    elements.authLogin
  ];
  for (const control of alwaysVisibleWhenSignedOut) {
    if (control) {
      control.hidden = !showAuthControls;
    }
  }

  const registerOnlyControls = [
    elements.authGameNameGroup,
    elements.authTaglineGroup,
    elements.authRegistrationHelp
  ];
  const showRegisterOnlyControls = showAuthControls && mode === "register";
  for (const control of registerOnlyControls) {
    if (control) {
      control.hidden = !showRegisterOnlyControls;
    }
  }
}

function renderAuthGate() {
  const signedIn = hasAuthSession();
  if (elements.appShell) {
    elements.appShell.hidden = !signedIn;
  }
  if (elements.authGate) {
    elements.authGate.hidden = signedIn;
  }
  if (!signedIn) {
    setNavOpen(false);
    return;
  }
  applyNavLayout();
}

function renderAuth() {
  const signedIn = hasAuthSession();
  if (!signedIn) {
    setAuthControlsVisibility(true, state.auth.mode);
    elements.authStatus.textContent = "Signed out.";
    elements.authLogout.disabled = true;
    renderAuthGate();
    return;
  }

  setAuthControlsVisibility(false, state.auth.mode);
  const email = typeof state.auth.user.email === "string" ? state.auth.user.email : "unknown";
  const gameName = typeof state.auth.user.gameName === "string" ? state.auth.user.gameName : "";
  const tagline = typeof state.auth.user.tagline === "string" ? state.auth.user.tagline : "";
  const riotId = gameName && tagline ? `${gameName}#${tagline}` : gameName;
  elements.authStatus.textContent = riotId
    ? `Signed in as ${email} (${riotId}).`
    : `Signed in as ${email}.`;
  elements.authLogout.disabled = false;
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
  if (elements.teamConfigTitle) {
    elements.teamConfigTitle.textContent = UI_COPY.panels.teamConfigTitle;
  }
  if (elements.teamConfigMeta) {
    elements.teamConfigMeta.textContent = UI_COPY.panels.teamConfigMeta;
  }
  elements.playerConfigTitle.textContent = UI_COPY.panels.playerConfigTitle;
  if (elements.playerConfigMeta) {
    elements.playerConfigMeta.textContent = UI_COPY.panels.playerConfigMeta;
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
  const signedIn = hasAuthSession();

  if (elements.navToggle) {
    elements.navToggle.hidden = !signedIn || !compact;
  }
  if (elements.navDesktopToggle) {
    elements.navDesktopToggle.hidden = !signedIn || compact;
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
  if (completion.completionState === "empty") {
    elements.builderStageGuideMeta.textContent = "Select at least one champion to unlock Review. Partial picks help finish a draft; all five picks evaluate a completed composition.";
  } else if (completion.completionState === "partial") {
    elements.builderStageGuideMeta.textContent = "Review is ready. Partial picks can generate finish-out draft options; fill all five slots for full composition evaluation.";
  } else {
    elements.builderStageGuideMeta.textContent = "Review is ready. All five slots are filled, so checks evaluate your full composition.";
  }

  elements.builderStageSetup.classList.toggle("is-current-stage", state.builder.stage === "setup");
  elements.builderStageInspect.classList.toggle("is-current-stage", state.builder.stage === "inspect");
  elements.builderStageSetup.hidden = state.builder.stage !== "setup";
  elements.builderStageInspect.hidden = state.builder.stage !== "inspect";

  elements.builderGenerate.disabled = state.builder.stage === "setup";
  elements.builderContinueValidate.disabled = state.builder.stage !== "setup" || completion.completionState === "empty";
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
    return { tab: null, status: "missing" };
  }
  const normalized = rawHash.startsWith("#") ? rawHash.slice(1).trim() : rawHash.trim();
  if (!normalized) {
    return { tab: null, status: "missing" };
  }
  if (TAB_ROUTE_SET.has(normalized)) {
    return { tab: normalized, status: "valid" };
  }
  return { tab: null, status: "invalid" };
}

function formatTabRouteHash(tab) {
  const resolved = TAB_ROUTE_SET.has(tab) ? tab : DEFAULT_TAB_ROUTE;
  return `#${resolved}`;
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
  const normalizedRequestedTab = TAB_ROUTE_SET.has(requestedTab) ? requestedTab : DEFAULT_TAB_ROUTE;
  const resolvedTab = hasAuthSession() ? normalizedRequestedTab : DEFAULT_TAB_ROUTE;
  const shouldNormalizeRoute = requestedTab !== resolvedTab || !TAB_ROUTE_SET.has(requestedTab);
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
  elements.tabTeamConfig.classList.toggle("is-active", resolvedTab === "team-config");
  elements.tabPlayerConfig.classList.toggle("is-active", resolvedTab === "player-config");
  elements.tabComingSoon.classList.toggle("is-active", resolvedTab === "coming-soon");
  applyHeroCopy(resolvedTab);

  if (resolvedTab === "team-config" && state.data) {
    renderTeamConfig();
    renderTeamAdmin();
  }
  if (resolvedTab === "player-config" && state.data) {
    renderPlayerConfig();
  }
  if (resolvedTab === "explorer" && state.data) {
    renderExplorer();
  }
  if (resolvedTab === "tags") {
    renderTagsWorkspace();
  }

  if ((tabChanged || syncRoute) && isCompactNavViewport()) {
    setNavOpen(false);
  }
}

async function fetchText(path) {
  const response = await runtimeFetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (${response.status})`);
  }
  return response.text();
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
  if (!runtimeApiBaseUrl || !state.data || !Array.isArray(state.data.champions)) {
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

  const damageType = normalizeApiDamageType(metadata.damageType);
  if (!damageType) {
    throw new DataValidationError(`Champion '${name}' is missing a valid damage type in metadata.`);
  }

  const scaling = normalizeApiScaling(metadata.scaling);
  if (!scaling) {
    throw new DataValidationError(`Champion '${name}' is missing a valid scaling value in metadata.`);
  }

  const legacyTags = normalizeApiTags(metadata.tags);

  return {
    id: normalizeApiEntityId(rawChampion.id),
    name,
    roles: normalizedRoles,
    damageType,
    scaling,
    tags: legacyTags,
    legacyTags,
    tagIds: normalizeChampionTagIdArray(rawChampion.tagIds ?? rawChampion.tag_ids)
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
  if (!runtimeApiBaseUrl) {
    const championsCsvText = await fetchText("/public/data/champions.csv");
    const parsed = parseChampionsCsv(championsCsvText);
    return {
      ...parsed,
      championIdsByName: {},
      championNamesById: {}
    };
  }

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
  const category = typeof rawTag.category === "string" ? rawTag.category.trim() : "";
  if (!name || !category) {
    return null;
  }
  return { id, name, category };
}

async function loadTagCatalogFromApi() {
  if (!runtimeApiBaseUrl) {
    state.api.tags = [];
    state.api.tagById = {};
    return false;
  }

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
    elements.championTagCatalogMeta.textContent = runtimeApiBaseUrl
      ? "No API tag catalog entries returned."
      : "Tag catalog is available when API mode is enabled.";
    const empty = runtimeDocument.createElement("span");
    empty.className = "meta";
    empty.textContent = "No tags available.";
    elements.championTagCatalogList.append(empty);
    return;
  }

  elements.championTagCatalogMeta.textContent = `${tags.length} tags available across champion metadata categories.`;
  for (const tag of tags) {
    const chip = runtimeDocument.createElement("span");
    chip.className = "chip";
    chip.textContent = `${tag.name} (${tag.category})`;
    elements.championTagCatalogList.append(chip);
  }
}

function normalizeTagCategoryLabel(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "uncategorized";
  }
  return value.trim();
}

function normalizeManagedTagName(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }
  return value.trim();
}

function normalizeManagedTagCategory(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }
  return value.trim().toLowerCase();
}

function getManagedTagById(tagId) {
  if (!Number.isInteger(tagId) || tagId <= 0) {
    return null;
  }
  return state.api.tags.find((tag) => tag.id === tagId) ?? null;
}

function readManagedTagDraftFromInputs() {
  const name = normalizeManagedTagName(elements.tagsManageName?.value ?? "");
  const category = normalizeManagedTagCategory(elements.tagsManageCategory?.value ?? "");
  if (!name) {
    throw new Error("Tag name is required.");
  }
  if (!category) {
    throw new Error("Tag category is required.");
  }
  return { name, category };
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
  if (elements.tagsManageCategory) {
    elements.tagsManageCategory.value = normalizeTagCategoryLabel(tag.category).toLowerCase();
  }
  setTagsManageFeedback(`Editing '${tag.name}'.`);
  renderTagsWorkspace();
}

function renderTagsManagerControls() {
  const canManageTags = isAuthenticated() && runtimeApiBaseUrl;
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
    if (!runtimeApiBaseUrl) {
      elements.tagsManageAccess.textContent = "Tag management requires API mode.";
    } else if (!isAuthenticated()) {
      elements.tagsManageAccess.textContent = "Sign in to manage tags.";
    } else if (!isAdminUser()) {
      elements.tagsManageAccess.textContent =
        "Tag catalog writes are admin-only unless no admin users exist (bootstrap fallback).";
    } else {
      elements.tagsManageAccess.textContent = "Admin mode enabled: create, update, and delete tags.";
    }
  }

  if (elements.tagsManageName) {
    elements.tagsManageName.disabled = controlsDisabled;
  }
  if (elements.tagsManageCategory) {
    elements.tagsManageCategory.disabled = controlsDisabled;
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
  if (!isAuthenticated() || !runtimeApiBaseUrl || state.api.isSavingTagCatalog) {
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
        if (elements.tagsManageCategory) {
          elements.tagsManageCategory.value = normalizeTagCategoryLabel(savedTag.category).toLowerCase();
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
  if (!isAuthenticated() || !runtimeApiBaseUrl || state.api.isSavingTagCatalog) {
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
    elements.tagsWorkspaceSummary.textContent = runtimeApiBaseUrl
      ? "No tags were returned by the API."
      : "Tag workspace is available when API mode is enabled.";
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "No tags to display.";
    elements.tagsWorkspaceCategories.append(empty);
    return;
  }

  const groupedByCategory = new Map();
  for (const tag of tags) {
    const category = normalizeTagCategoryLabel(tag.category).toLowerCase();
    if (!groupedByCategory.has(category)) {
      groupedByCategory.set(category, []);
    }
    groupedByCategory.get(category).push(tag);
  }

  const sortedCategories = [...groupedByCategory.keys()].sort((left, right) => left.localeCompare(right));
  elements.tagsWorkspaceSummary.textContent = `${tags.length} tags across ${sortedCategories.length} categories.`;

  for (const category of sortedCategories) {
    const categoryTags = groupedByCategory.get(category).slice().sort((left, right) => left.name.localeCompare(right.name));

    const card = runtimeDocument.createElement("section");
    card.className = "tags-category-card";

    const heading = runtimeDocument.createElement("h3");
    heading.textContent = category;
    const meta = runtimeDocument.createElement("p");
    meta.className = "meta";
    meta.textContent = `${categoryTags.length} tags`;

    const list = runtimeDocument.createElement("ul");
    list.className = "tags-workspace-list";
    for (const tag of categoryTags) {
      const item = runtimeDocument.createElement("li");
      item.className = "tags-workspace-item";

      const chip = runtimeDocument.createElement("span");
      chip.className = "chip";
      chip.textContent = tag.name;

      const usageCount = (usageByTagId.get(tag.id) ?? []).length;
      const usage = runtimeDocument.createElement("span");
      usage.className = "meta";
      usage.textContent = usageCount === 1 ? "Used by 1 champion" : `Used by ${usageCount} champions`;
      item.append(chip, usage);

      if (isAuthenticated() && runtimeApiBaseUrl) {
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

    card.append(heading, meta, list);
    elements.tagsWorkspaceCategories.append(card);
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

function resolveLegacyChampionFallbackTagIds(champion) {
  const legacySource = champion?.legacyTags ?? champion?.tags;
  if (!legacySource || typeof legacySource !== "object" || Array.isArray(legacySource)) {
    return [];
  }

  const availableTags = Array.isArray(state.api.tags) ? state.api.tags : [];
  if (availableTags.length === 0) {
    return [];
  }

  const tagIdByName = new Map();
  for (const tag of availableTags) {
    const tagId = normalizeApiEntityId(tag?.id);
    const normalizedName = normalizeTagNameForMatching(tag?.name);
    if (tagId === null || normalizedName === "") {
      continue;
    }
    if (!tagIdByName.has(normalizedName)) {
      tagIdByName.set(normalizedName, tagId);
    }
  }

  const fallbackTagIds = [];
  for (const legacyTagName of BOOLEAN_TAGS) {
    if (legacySource[legacyTagName] !== true) {
      continue;
    }
    const match = tagIdByName.get(normalizeTagNameForMatching(legacyTagName));
    if (Number.isInteger(match) && match > 0) {
      fallbackTagIds.push(match);
    }
  }

  return normalizeChampionTagIdArray(fallbackTagIds);
}

function renderChampionTagEditorTagOptions() {
  if (!elements.championTagEditorTags) {
    return;
  }

  elements.championTagEditorTags.innerHTML = "";
  const selectedTagIds = normalizeApiTagIdArray(state.api.selectedChampionTagIds);
  const selectedTagIdSet = new Set(selectedTagIds);
  const allTags = Array.isArray(state.api.tags)
    ? state.api.tags
        .map((tag) => {
          const tagId = normalizeApiEntityId(tag?.id);
          if (tagId === null) {
            return null;
          }
          return {
            ...tag,
            id: tagId
          };
        })
        .filter(Boolean)
    : [];
  const allTagsById = new Map(allTags.map((tag) => [tag.id, tag]));
  const compositionTags = allTags.filter(
    (tag) => typeof tag.category === "string" && tag.category.trim().toLowerCase() === "composition"
  );
  const tags = compositionTags.length > 0 ? [...compositionTags] : [...allTags];
  const renderedTagIds = new Set(tags.map((tag) => tag.id));

  for (const selectedTagId of selectedTagIds) {
    if (renderedTagIds.has(selectedTagId)) {
      continue;
    }
    const assignedTag = allTagsById.get(selectedTagId);
    tags.push(
      assignedTag ?? {
        id: selectedTagId,
        name: `Tag ${selectedTagId}`,
        category: "assigned"
      }
    );
    renderedTagIds.add(selectedTagId);
  }

  tags.sort((left, right) => String(left.name ?? "").localeCompare(String(right.name ?? "")));

  if (tags.length === 0) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "No tags available to edit.";
    elements.championTagEditorTags.append(empty);
    return;
  }

  const selected = selectedTagIdSet;
  for (const tag of tags) {
    const label = runtimeDocument.createElement("label");
    label.className = "champion-tag-checkbox selection-option";

    const checkbox = runtimeDocument.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = String(tag.id);
    checkbox.checked = selected.has(tag.id);
    checkbox.disabled = state.api.isSavingChampionTags || state.api.isLoadingChampionTags;
    checkbox.addEventListener("change", () => {
      const next = new Set(state.api.selectedChampionTagIds);
      if (checkbox.checked) {
        next.add(tag.id);
      } else {
        next.delete(tag.id);
      }
      state.api.selectedChampionTagIds = [...next].sort((left, right) => left - right);
    });

    const text = runtimeDocument.createElement("span");
    const category = typeof tag.category === "string" ? tag.category.trim() : "";
    text.textContent = category.toLowerCase() === "composition" ? tag.name : `${tag.name} (${category})`;
    label.append(checkbox, text);
    elements.championTagEditorTags.append(label);
  }
}

function renderChampionEditorTabs() {
  const activeTab = normalizeChampionEditorTab(state.api.championEditorTab);
  state.api.championEditorTab = activeTab;

  for (const button of elements.championEditorTabButtons) {
    const tab = button.dataset.championEditorTab;
    const selected = tab === activeTab;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.setAttribute("tabindex", selected ? "0" : "-1");
  }

  if (elements.championEditorPanelComposition) {
    elements.championEditorPanelComposition.hidden = activeTab !== CHAMPION_EDITOR_TAB_COMPOSITION;
  }
  if (elements.championEditorPanelRoles) {
    elements.championEditorPanelRoles.hidden = activeTab !== CHAMPION_EDITOR_TAB_ROLES;
  }
  if (elements.championEditorPanelDamage) {
    elements.championEditorPanelDamage.hidden = activeTab !== CHAMPION_EDITOR_TAB_DAMAGE;
  }
  if (elements.championEditorPanelScaling) {
    elements.championEditorPanelScaling.hidden = activeTab !== CHAMPION_EDITOR_TAB_SCALING;
  }
}

function renderChampionMetadataRoleOptions() {
  if (!elements.championMetadataEditorRoles) {
    return;
  }
  elements.championMetadataEditorRoles.innerHTML = "";
  const selected = new Set(state.api.championMetadataDraft.roles);

  for (const role of SLOTS) {
    const label = runtimeDocument.createElement("label");
    label.className = "selection-option";

    const checkbox = runtimeDocument.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = role;
    checkbox.checked = selected.has(role);
    checkbox.disabled = state.api.isSavingChampionTags;
    checkbox.addEventListener("change", () => {
      const next = new Set(state.api.championMetadataDraft.roles);
      if (checkbox.checked) {
        next.add(role);
      } else {
        next.delete(role);
      }
      state.api.championMetadataDraft.roles = normalizeChampionMetadataRoles([...next]);
    });

    const text = runtimeDocument.createElement("span");
    text.textContent = role;
    label.append(checkbox, text);
    elements.championMetadataEditorRoles.append(label);
  }
}

function renderChampionMetadataEditors() {
  renderChampionMetadataRoleOptions();

  if (elements.championMetadataEditorDamageType) {
    replaceOptions(
      elements.championMetadataEditorDamageType,
      DAMAGE_TYPES.map((value) => ({ value, label: value }))
    );
    elements.championMetadataEditorDamageType.value = state.api.championMetadataDraft.damageType;
    elements.championMetadataEditorDamageType.disabled = state.api.isSavingChampionTags;
  }

  if (elements.championMetadataEditorScaling) {
    replaceOptions(
      elements.championMetadataEditorScaling,
      SCALING_VALUES.map((value) => ({ value, label: value }))
    );
    elements.championMetadataEditorScaling.value = state.api.championMetadataDraft.scaling;
    elements.championMetadataEditorScaling.disabled = state.api.isSavingChampionTags;
  }
}

function renderChampionTagEditor() {
  if (!elements.championTagEditor) {
    return;
  }

  const championId = state.api.selectedChampionTagEditorId;
  const champion = Number.isInteger(championId) ? getChampionById(championId) : null;
  const canRenderEditor = Boolean(champion && isAuthenticated() && runtimeApiBaseUrl);
  elements.championTagEditor.hidden = !canRenderEditor;
  if (!canRenderEditor) {
    return;
  }

  state.api.championTagScope = normalizeChampionTagScope(state.api.championTagScope);

  if (elements.championTagEditorTitle) {
    elements.championTagEditorTitle.textContent = `Edit ${champion.name} Tags`;
  }
  if (elements.championTagEditorMeta) {
    elements.championTagEditorMeta.textContent = "Edit global champion data by tab.";
  }
  if (elements.championTagEditorScope) {
    elements.championTagEditorScope.value = state.api.championTagScope;
    elements.championTagEditorScope.disabled = true;
  }
  if (elements.championTagEditorTeamGroup) {
    elements.championTagEditorTeamGroup.hidden = true;
  }
  if (elements.championTagEditorTeam) {
    replaceOptions(elements.championTagEditorTeam, []);
    elements.championTagEditorTeam.disabled = true;
  }

  renderChampionEditorTabs();
  renderChampionTagEditorTagOptions();
  renderChampionMetadataEditors();

  const activeTab = normalizeChampionEditorTab(state.api.championEditorTab);
  const metadataDraftComplete =
    state.api.championMetadataDraft.roles.length > 0 &&
    Boolean(state.api.championMetadataDraft.damageType) &&
    Boolean(state.api.championMetadataDraft.scaling);

  if (elements.championTagEditorSave) {
    elements.championTagEditorSave.textContent =
      activeTab === CHAMPION_EDITOR_TAB_COMPOSITION ? "Save Composition" : "Save Metadata";
    const compositionSaveBlocked = activeTab === CHAMPION_EDITOR_TAB_COMPOSITION && state.api.isLoadingChampionTags;
    elements.championTagEditorSave.disabled =
      state.api.isSavingChampionTags ||
      compositionSaveBlocked ||
      (activeTab !== CHAMPION_EDITOR_TAB_COMPOSITION && !metadataDraftComplete);
  }
  if (elements.championTagEditorClear) {
    elements.championTagEditorClear.disabled = state.api.isSavingChampionTags;
  }
}

async function loadChampionScopedTags(championId) {
  if (!isAuthenticated() || !Number.isInteger(championId) || championId <= 0) {
    return false;
  }

  const query = new URLSearchParams({ scope: "all" });
  state.api.isLoadingChampionTags = true;
  renderChampionTagEditor();

  try {
    const payload = await apiRequest(`/champions/${championId}/tags?${query.toString()}`, { auth: true });
    const payloadTagIds = payload?.tag_ids ?? payload?.tagIds;
    if (payloadTagIds !== undefined) {
      const scopedTagIds = normalizeApiTagIdArray(payloadTagIds);
      if (scopedTagIds.length > 0) {
        state.api.selectedChampionTagIds = scopedTagIds;
        setChampionTagEditorFeedback("");
      } else {
        const champion = getChampionById(championId);
        const fallbackTagIds = resolveLegacyChampionFallbackTagIds(champion);
        state.api.selectedChampionTagIds = fallbackTagIds;
        if (fallbackTagIds.length > 0) {
          setChampionTagEditorFeedback(
            "No global tag assignments found; prefilled from current champion indicators. Save to persist."
          );
        } else {
          setChampionTagEditorFeedback("");
        }
      }
    } else {
      setChampionTagEditorFeedback("");
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
  if (!isAuthenticated() || !Number.isInteger(championId) || championId <= 0) {
    return;
  }

  const champion = getChampionById(championId);
  state.api.selectedChampionTagEditorId = championId;
  const scopedTagIds = normalizeChampionTagIdArray(champion?.tagIds);
  const fallbackTagIds = resolveLegacyChampionFallbackTagIds(champion);
  state.api.selectedChampionTagIds = scopedTagIds.length > 0 ? scopedTagIds : fallbackTagIds;
  state.api.championTagScope = "all";
  state.api.championEditorTab = CHAMPION_EDITOR_TAB_COMPOSITION;
  initializeChampionMetadataDraft(champion);
  setChampionTagEditorFeedback("Loading champion tags...");
  renderChampionTagEditor();
  await loadChampionScopedTags(championId);
  renderChampionTagEditor();
}

function setChampionEditorTab(tab) {
  state.api.championEditorTab = normalizeChampionEditorTab(tab);
  renderChampionTagEditor();
}

async function saveChampionCompositionTab(championId) {
  const payload = {
    scope: "all",
    tag_ids: [...state.api.selectedChampionTagIds].sort((left, right) => left - right)
  };

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
  }
}

async function saveChampionMetadataTab(championId) {
  const payload = {
    roles: [...state.api.championMetadataDraft.roles],
    damage_type: state.api.championMetadataDraft.damageType,
    scaling: state.api.championMetadataDraft.scaling
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
  if (!isAuthenticated() || !Number.isInteger(championId) || championId <= 0 || state.api.isSavingChampionTags) {
    return;
  }
  const activeTab = normalizeChampionEditorTab(state.api.championEditorTab);
  if (activeTab === CHAMPION_EDITOR_TAB_COMPOSITION && state.api.isLoadingChampionTags) {
    setChampionTagEditorFeedback("Wait for champion tags to finish loading before saving.");
    renderChampionTagEditor();
    return;
  }

  state.api.isSavingChampionTags = true;
  setChampionTagEditorFeedback(
    activeTab === CHAMPION_EDITOR_TAB_COMPOSITION
      ? "Saving composition tags..."
      : "Saving champion metadata..."
  );
  renderChampionTagEditor();

  try {
    if (activeTab === CHAMPION_EDITOR_TAB_COMPOSITION) {
      await saveChampionCompositionTab(championId);
      setChampionTagEditorFeedback("Composition tags saved.");
    } else {
      await saveChampionMetadataTab(championId);
      setChampionTagEditorFeedback("Champion metadata saved.");
    }
    renderExplorer();
  } catch (error) {
    setChampionTagEditorFeedback(
      normalizeApiErrorMessage(
        error,
        activeTab === CHAMPION_EDITOR_TAB_COMPOSITION
          ? "Failed to save composition tags."
          : "Failed to save champion metadata."
      )
    );
  } finally {
    state.api.isSavingChampionTags = false;
    renderChampionTagEditor();
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

async function loadTeamsFromApi(preferredTeamId = null) {
  if (!isAuthenticated()) {
    state.api.teams = [];
    state.api.membersByTeamId = {};
    state.api.selectedTeamId = "";
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
    state.api.membersByTeamId = {};
    state.api.selectedTeamId = "";
    setTeamAdminFeedback(normalizeApiErrorMessage(error, "Failed to load teams."));
    return false;
  }
}

async function loadTeamContextFromApi() {
  if (!isAuthenticated()) {
    state.teamConfig.defaultTeamId = NONE_TEAM_ID;
    state.teamConfig.activeTeamId = NONE_TEAM_ID;
    return false;
  }

  try {
    const payload = await apiRequest("/me/team-context", { auth: true });
    const apiDefaultTeamId = normalizeTeamEntityId(payload?.teamContext?.defaultTeamId);
    const apiActiveTeamId = normalizeTeamEntityId(payload?.teamContext?.activeTeamId);
    state.teamConfig.defaultTeamId = apiDefaultTeamId ?? NONE_TEAM_ID;
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
    const defaultTeamId = toApiTeamContextId(state.teamConfig.defaultTeamId);
    const activeTeamId = toApiTeamContextId(state.teamConfig.activeTeamId);
    const payload = await apiRequest("/me/team-context", {
      method: "PUT",
      auth: true,
      body: {
        defaultTeamId,
        activeTeamId
      }
    });
    const persistedDefaultTeamId = normalizeTeamEntityId(payload?.teamContext?.defaultTeamId);
    const persistedActiveTeamId = normalizeTeamEntityId(payload?.teamContext?.activeTeamId);
    state.teamConfig.defaultTeamId = persistedDefaultTeamId ?? NONE_TEAM_ID;
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
    "Any Scaling"
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
}

function getSlotLabel(slot) {
  if (state.builder.teamId === NONE_TEAM_ID) {
    return slot;
  }
  const selectedTeam = findTeamById(state.builder.teamId);
  if (!selectedTeam) {
    return slot;
  }
  const userId = Number.parseInt(String(state.auth.user?.id ?? ""), 10);
  const isPrimaryByTeamSummary = selectedTeam.membership_team_role === "primary";
  const selectedTeamMembers = state.api.membersByTeamId[String(selectedTeam.id)] ?? [];
  const isPrimaryByRoster = Number.isInteger(userId) && selectedTeamMembers.some(
    (member) => Number(member?.user_id) === userId && member?.team_role === "primary"
  );
  if (!isPrimaryByTeamSummary && !isPrimaryByRoster) {
    return slot;
  }
  if (slot !== state.profile.primaryRole) {
    return slot;
  }
  const gameName = typeof state.auth.user?.gameName === "string" ? state.auth.user.gameName.trim() : "";
  const email = typeof state.auth.user?.email === "string" ? state.auth.user.email.trim() : "";
  const displayName = gameName || email || "You";
  return `${slot} (${displayName})`;
}

function updateTeamHelpAndSlotLabels() {
  if (state.builder.teamId === NONE_TEAM_ID) {
    elements.builderTeamHelp.textContent =
      "Role candidates use global champion eligibility.";
  } else {
    elements.builderTeamHelp.textContent =
      "Team context is set. Candidate pools use your configured role pools.";
  }

  for (const slot of SLOTS) {
    elements.slotLabels[slot].textContent = getSlotLabel(slot);
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
  state.teamConfig.defaultTeamId = resolveConfiguredTeamSelection(state.teamConfig.defaultTeamId);
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

function initializeBuilderControls() {
  const candidateActiveTeamId =
    state.teamConfig.activeTeamId ?? state.teamConfig.defaultTeamId ?? state.data.config.teamDefault ?? null;
  state.teamConfig.activeTeamId = resolveConfiguredTeamSelection(candidateActiveTeamId);
  state.teamConfig.defaultTeamId = resolveConfiguredTeamSelection(state.teamConfig.defaultTeamId);
  state.builder.teamId = state.teamConfig.activeTeamId;
  state.builder.showOptionalChecks = BUILDER_DEFAULTS.showOptionalChecksByDefault;
  state.builder.treeDensity = BUILDER_DEFAULTS.defaultTreeDensity;
  replaceOptions(elements.builderActiveTeam, getTeamSelectOptions());
  elements.builderActiveTeam.value = state.builder.teamId;

  elements.builderToggles.innerHTML = "<legend>Required Toggles</legend>";
  for (const key of Object.keys(DEFAULT_REQUIREMENT_TOGGLES)) {
    const wrapper = runtimeDocument.createElement("label");
    wrapper.className = "toggle-item selection-option";
    const checkbox = runtimeDocument.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(state.builder.toggles[key]);
    checkbox.dataset.toggle = key;
    const title = runtimeDocument.createElement("span");
    title.textContent = key;
    wrapper.append(checkbox, title);
    elements.builderToggles.append(wrapper);
  }

  state.builder.maxDepth = getAutoMaxDepth();
  state.builder.maxBranch = state.data.config.treeDefaults.maxBranch;
  elements.builderMaxDepth.value = String(state.builder.maxDepth);
  elements.builderMaxDepth.disabled = true;
  elements.builderMaxDepth.title = "Tree depth is automatic and equals remaining draft slots.";
  elements.builderMaxBranch.value = String(state.builder.maxBranch);

  updateTeamHelpAndSlotLabels();
}

function syncBuilderToggleInputs() {
  const inputs = elements.builderToggles.querySelectorAll("input[data-toggle]");
  for (const input of inputs) {
    const key = input.dataset.toggle;
    if (!key) {
      continue;
    }
    input.checked = Boolean(state.builder.toggles[key]);
  }
}

function renderTeamWorkspaceTabs() {
  const activeTab = TEAM_WORKSPACE_TAB_SET.has(state.ui.teamWorkspaceTab)
    ? state.ui.teamWorkspaceTab
    : TEAM_WORKSPACE_TAB_MANAGE;
  state.ui.teamWorkspaceTab = activeTab;

  for (const button of elements.teamWorkspaceTabButtons) {
    const tab = button.dataset.teamWorkspaceTab;
    const selected = tab === activeTab;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.setAttribute("tabindex", selected ? "0" : "-1");
  }

  if (elements.teamWorkspaceManagePanel) {
    elements.teamWorkspaceManagePanel.hidden = activeTab !== TEAM_WORKSPACE_TAB_MANAGE;
  }
  if (elements.teamWorkspaceCreatePanel) {
    elements.teamWorkspaceCreatePanel.hidden = activeTab !== TEAM_WORKSPACE_TAB_CREATE;
  }
}

function setTeamWorkspaceTab(tab) {
  state.ui.teamWorkspaceTab = TEAM_WORKSPACE_TAB_SET.has(tab) ? tab : TEAM_WORKSPACE_TAB_MANAGE;
  renderTeamWorkspaceTabs();
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
  if (elements.teamConfigDefaultTeam) {
    elements.teamConfigDefaultTeam.value = state.teamConfig.defaultTeamId;
  }
  if (elements.teamConfigActiveTeam) {
    elements.teamConfigActiveTeam.value = state.teamConfig.activeTeamId;
  }

  if (elements.teamConfigDefaultHelp) {
    elements.teamConfigDefaultHelp.textContent = state.teamConfig.defaultTeamId === NONE_TEAM_ID
      ? "Default team: None (new sessions start in global context)."
      : `Default team: ${getTeamDisplayLabel(state.teamConfig.defaultTeamId)}.`;
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

  const pools = getPoolsForTeam(state.teamConfig.activeTeamId);
  const roleCounts = SLOTS.map((slot) => `${slot}: ${(pools[slot] ?? []).length}`);
  if (elements.teamConfigPoolSummary) {
    elements.teamConfigPoolSummary.textContent = state.teamConfig.activeTeamId === NONE_TEAM_ID
      ? `Global candidate pools -> ${roleCounts.join(" | ")}`
      : `Profile pool snapshot (${getTeamDisplayLabel(state.teamConfig.activeTeamId)} context) -> ${roleCounts.join(" | ")}`;
  }

  if (!elements.teamConfigPoolGrid) {
    return;
  }
  elements.teamConfigPoolGrid.innerHTML = "";
  for (const slot of SLOTS) {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card";

    const title = runtimeDocument.createElement("strong");
    title.textContent = slot;

    const count = runtimeDocument.createElement("p");
    count.className = "meta";
    const champions = [...(pools[slot] ?? [])].sort((left, right) => left.localeCompare(right));
    count.textContent = `${champions.length} champion${champions.length === 1 ? "" : "s"} in pool.`;

    const list = runtimeDocument.createElement("p");
    list.className = "meta";
    list.textContent = champions.length > 0 ? champions.join(", ") : "No champions configured.";

    card.append(title, count, list);
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
  const adminEnabled = Boolean(selectedTeam) && isLead;

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

  elements.teamAdminMembers.innerHTML = "";
  renderChampionTagEditor();
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
  if (elements.teamConfigDefaultTeam) {
    replaceOptions(elements.teamConfigDefaultTeam, options);
  }
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
  const desiredChampionIds = (activePlayer?.champions ?? [])
    .map((name) => state.data.championIdsByName[name])
    .filter((id) => Number.isInteger(id));
  const desiredIdSet = new Set(desiredChampionIds);
  const currentIdSet = new Set((pool.champion_ids ?? []).map((value) => Number(value)));

  const toAdd = [...desiredIdSet].filter((id) => !currentIdSet.has(id));
  const toRemove = [...currentIdSet].filter((id) => !desiredIdSet.has(id));

  for (const championId of toAdd) {
    await apiRequest(`/me/pools/${pool.id}/champions`, {
      method: "POST",
      auth: true,
      body: { champion_id: championId }
    });
  }

  for (const championId of toRemove) {
    await apiRequest(`/me/pools/${pool.id}/champions/${championId}`, {
      method: "DELETE",
      auth: true
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
  renderPlayerConfig();

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
    renderPlayerConfig();
  }
}

function renderPlayerConfig() {
  state.playerConfig.teamId = normalizePlayerConfigTeamId(state.playerConfig.teamId);
  const teamOptions = getConfiguredProfileRoles().map((role) => ({
    value: buildRolePoolTeamId(role),
    label: role
  }));

  replaceOptions(elements.playerConfigTeam, teamOptions);
  elements.playerConfigTeam.value = state.playerConfig.teamId;

  renderProfileRolesSection();
  renderProfileChampionStatsSection();
  const activeRole = parseRolePoolTeamId(state.playerConfig.teamId) ?? state.profile.primaryRole;
  const poolDirty = isPlayerPoolDirty(state.playerConfig.teamId);

  const players = state.playerConfig.byTeam[state.playerConfig.teamId] ?? [];
  const activePlayer = players.find((player) => player.role === activeRole) ?? null;
  if (elements.playerConfigSavePool) {
    elements.playerConfigSavePool.disabled = !activePlayer || !poolDirty || state.playerConfig.isSavingPool;
    elements.playerConfigSavePool.textContent = state.playerConfig.isSavingPool ? "Saving..." : "Save Champions";
  }

  renderSettingsTeamMembership();
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
      setPlayerPoolDirty(state.playerConfig.teamId, true);
      syncDerivedTeamDataFromPlayerConfig();
      syncConfiguredTeamSelection();
      setBuilderStage("setup");
      resetBuilderTreeState();
      syncSlotSelectOptions();
      renderTeamConfig();
      renderBuilder();
      if (elements.playerConfigSavePool) {
        elements.playerConfigSavePool.disabled = state.playerConfig.isSavingPool;
      }
      renderPlayerConfigFeedback("Unsaved champion changes. Click Save Champions.");
    }
  });

  card.append(poolControlHost);
  elements.playerConfigGrid.append(card);
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
  if (stored.defaultTeamId === NONE_TEAM_ID) {
    state.teamConfig.defaultTeamId = NONE_TEAM_ID;
  } else {
    const defaultTeamId = normalizeTeamEntityId(stored.defaultTeamId);
    state.teamConfig.defaultTeamId = defaultTeamId ?? NONE_TEAM_ID;
  }

  if (stored.activeTeamId === NONE_TEAM_ID) {
    state.teamConfig.activeTeamId = NONE_TEAM_ID;
    return;
  }

  const activeTeamId = normalizeTeamEntityId(stored.activeTeamId);
  if (activeTeamId) {
    state.teamConfig.activeTeamId = activeTeamId;
    return;
  }
  state.teamConfig.activeTeamId = state.teamConfig.defaultTeamId ?? NONE_TEAM_ID;
}

function saveTeamConfig() {
  tryWriteJsonStorage(TEAM_CONFIG_STORAGE_KEY, {
    defaultTeamId: state.teamConfig.defaultTeamId,
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
            champions: []
          };
        }

        const champions = Array.isArray(candidate.champions) ? candidate.champions : [];
        for (const champion of champions) {
          if (typeof champion !== "string" || !allowedChampionNames.has(champion)) {
            continue;
          }
          if (!playersById[playerId].champions.includes(champion)) {
            playersById[playerId].champions.push(champion);
          }
        }
      }

      const normalizedPlayers = Object.values(playersById);
      for (const player of normalizedPlayers) {
        const roleEligible = new Set(state.data.noneTeamPools[player.role] ?? []);
        player.champions = player.champions.filter((champion) => roleEligible.has(champion));
        player.champions.sort((left, right) => left.localeCompare(right));
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
  state.builder.toggles = { ...DEFAULT_REQUIREMENT_TOGGLES };
  state.builder.showOptionalChecks = BUILDER_DEFAULTS.showOptionalChecksByDefault;
  state.builder.excludedChampions = [];
  state.builder.excludedSearch = "";
  state.builder.treeDensity = BUILDER_DEFAULTS.defaultTreeDensity;
  state.builder.treeSearch = "";
  state.builder.treeMinScore = 0;
  state.builder.treeMinCandidateScore = 1;
  state.builder.treeValidLeavesOnly = true;

  const rawBranch = Number.parseInt(String(state.data.config.treeDefaults.maxBranch), 10);
  state.builder.maxDepth = getAutoMaxDepth();
  state.builder.maxBranch = Number.isFinite(rawBranch) ? Math.max(1, rawBranch) : 8;

  resetBuilderTreeState();
  state.builder.treeDensity = BUILDER_DEFAULTS.defaultTreeDensity;
  setBuilderStage("setup");

  elements.builderMaxDepth.value = String(state.builder.maxDepth);
  elements.builderMaxDepth.disabled = true;
  elements.builderMaxBranch.value = String(state.builder.maxBranch);
  elements.builderExcludedSearch.value = "";
  elements.treeSearch.value = "";
  elements.treeMinScore.value = "0";
  elements.treeMinCandidateScore.value = "1";
  elements.treeValidLeavesOnly.checked = true;
  elements.treeDensity.value = state.builder.treeDensity;
  syncBuilderToggleInputs();

  saveTeamConfig();
  return true;
}

function getEffectiveRolePools() {
  if (state.builder.teamId === NONE_TEAM_ID) {
    return state.data.noneTeamPools;
  }
  return getProfileRolePools();
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

  const profileRolePools = getProfileRolePools();
  return {
    teamId: BUILDER_PROFILE_POOL_CONTEXT_ID,
    teamPools: {
      [BUILDER_PROFILE_POOL_CONTEXT_ID]: profileRolePools
    }
  };
}

function getAutoMaxDepth() {
  const completion = getTeamCompletionInfo(state.builder.teamState);
  return completion.totalSlots - completion.filledSlots;
}

function generateTreeFromCurrentState({ scrollToResults = true } = {}) {
  const completion = getTeamCompletionInfo(state.builder.teamState);
  if (completion.completionState === "empty") {
    setSetupFeedback("Select at least one champion before opening Review.");
    return false;
  }

  try {
    setInspectFeedback("");
    const { teamId, teamPools } = getEnginePoolContext();
    state.builder.maxDepth = getAutoMaxDepth();
    state.builder.tree = generatePossibilityTree({
      teamState: state.builder.teamState,
      teamId,
      roleOrder: state.builder.draftOrder,
      teamPools,
      championsByName: state.data.championsByName,
      toggles: state.builder.toggles,
      excludedChampions: state.builder.excludedChampions,
      weights: state.data.config.recommendation.weights,
      maxDepth: state.builder.maxDepth,
      maxBranch: state.builder.maxBranch,
      minCandidateScore: state.builder.treeMinCandidateScore,
      pruneUnreachableRequired: true,
      rankGoal: "valid_end_states"
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

function isChampionInOtherSlot(slot, championName) {
  return SLOTS.some((otherSlot) => {
    if (otherSlot === slot) {
      return false;
    }
    return state.builder.teamState[otherSlot] === championName;
  });
}

function syncSlotSelectOptions() {
  const rolePools = getEffectiveRolePools();
  for (const slot of SLOTS) {
    const select = elements.slotSelects[slot];
    const selected = state.builder.teamState[slot];
    const pool = rolePools[slot] ?? [];

    const allowed = pool.filter((championName) => {
      if (state.builder.excludedChampions.includes(championName)) {
        return false;
      }
      if (isChampionInOtherSlot(slot, championName)) {
        return false;
      }
      return true;
    });

    const options = allowed.map((name) => ({ value: name, label: name }));
    replaceOptions(select, options, true, "Empty");

    if (selected && allowed.includes(selected)) {
      select.value = selected;
    } else {
      state.builder.teamState[slot] = null;
      select.value = "";
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

function renderExplorer() {
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
  elements.explorerCount.textContent = `${sorted.length} champions match the current filters.`;
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

    const header = runtimeDocument.createElement("div");
    header.className = "champ-header";
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

    const heading = runtimeDocument.createElement("div");
    const name = runtimeDocument.createElement("p");
    name.className = "champ-name";
    name.textContent = champion.name;

    const summary = runtimeDocument.createElement("p");
    summary.className = "meta";
    summary.textContent = `${champion.roles.join(" / ")} | ${champion.damageType} | ${champion.scaling}`;
    summary.title = "Roles | Damage Type | Scaling";
    summary.setAttribute(
      "aria-label",
      `Roles: ${champion.roles.join(" / ")}. Damage Type: ${champion.damageType}. Scaling: ${champion.scaling}.`
    );

    heading.append(name, summary);
    header.append(image, heading);

    const scopedTags = runtimeDocument.createElement("div");
    scopedTags.className = "chip-row champ-card-scope-tags";
    const scopedTagNames = Array.isArray(champion.tagIds)
      ? champion.tagIds.map((tagId) => state.api.tagById[String(tagId)]?.name ?? `#${tagId}`)
      : [];
    if (scopedTagNames.length > 0) {
      for (const tagName of scopedTagNames) {
        const chip = runtimeDocument.createElement("span");
        chip.className = "chip";
        chip.textContent = tagName;
        scopedTags.append(chip);
      }
    } else {
      const empty = runtimeDocument.createElement("span");
      empty.className = "meta";
      empty.textContent = "No global tags assigned.";
      scopedTags.append(empty);
    }

    const actions = runtimeDocument.createElement("div");
    actions.className = "button-row champ-card-actions";
    const editButton = runtimeDocument.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Edit Tags";
    const canEdit = isAuthenticated() && Number.isInteger(champion.id) && champion.id > 0 && runtimeApiBaseUrl;
    editButton.disabled = !canEdit;
    editButton.addEventListener("click", () => {
      if (!canEdit) {
        return;
      }
      void openChampionTagEditor(champion.id);
    });
    actions.append(editButton);

    if (!runtimeApiBaseUrl) {
      const chips = runtimeDocument.createElement("div");
      chips.className = "chip-row";
      const activeTags = BOOLEAN_TAGS.filter((tag) => champion.tags[tag]);
      for (const tag of activeTags) {
        const chip = runtimeDocument.createElement("span");
        chip.className = "chip";
        chip.textContent = tag;
        chips.append(chip);
      }
      card.append(header, chips, scopedTags, actions);
    } else {
      card.append(header, scopedTags, actions);
    }
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

function humanizeCheckName(checkName) {
  return checkName.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function getCheckRemediationHint(checkName, result, checkEvaluation) {
  if (result.satisfied) {
    return "";
  }

  switch (checkName) {
    case "HasHardEngage":
      return "Add a champion with HardEngage in an open slot.";
    case "HasFrontline":
      return "Prioritize a frontline champion in the next available role.";
    case "HasWaveclear":
      return "Add at least one champion with reliable Waveclear.";
    case "HasDisengage":
      return "Pick a champion with Disengage to improve reset safety.";
    case "HasAntiTank":
      return "Add AntiTank tools for front-to-back consistency.";
    case "DamageMix": {
      const needsAD = checkEvaluation.missingNeeds.needsAD;
      const needsAP = checkEvaluation.missingNeeds.needsAP;
      if (needsAD && needsAP) {
        return "Add both AD and AP threats across remaining slots.";
      }
      if (needsAD) {
        return "Add at least one AD or Mixed damage champion.";
      }
      if (needsAP) {
        return "Add at least one AP or Mixed damage champion.";
      }
      return "Balance remaining picks across AD and AP damage profiles.";
    }
    case "TopMustBeThreat":
      return result.applicable
        ? "Top should provide SideLaneThreat or DiveThreat."
        : "Fill Top with a SideLaneThreat or DiveThreat champion.";
    default:
      return "Adjust remaining picks to satisfy this requirement.";
  }
}

function buildCheckRow(checkName, result, checkEvaluation) {
  const required = Boolean(result.required);
  const passed = Boolean(result.satisfied);
  const requirementLabel = required ? "Required" : "Optional";
  const stateLabel = passed ? "Passed" : "Failed";

  const item = runtimeDocument.createElement("li");
  item.className = `check ${required ? "is-required" : "is-optional"} ${passed ? "is-passed" : "is-failed"}`;

  const titleRow = runtimeDocument.createElement("div");
  titleRow.className = "check-title-row";

  const title = runtimeDocument.createElement("strong");
  title.textContent = humanizeCheckName(checkName);

  const badgeRow = runtimeDocument.createElement("div");
  badgeRow.className = "check-badges";

  const requirementBadge = runtimeDocument.createElement("span");
  requirementBadge.className = `check-badge ${required ? "is-required" : "is-optional"}`;
  requirementBadge.textContent = requirementLabel;

  const stateBadge = runtimeDocument.createElement("span");
  stateBadge.className = `check-badge ${passed ? "is-passed" : "is-failed"}`;
  stateBadge.textContent = stateLabel;

  badgeRow.append(requirementBadge, stateBadge);
  titleRow.append(title, badgeRow);

  const detail = runtimeDocument.createElement("div");
  detail.className = "meta";
  detail.textContent = result.reason;

  item.append(titleRow, detail);

  if (required && !passed) {
    const hint = runtimeDocument.createElement("p");
    hint.className = "check-hint";
    hint.textContent = `How to satisfy: ${getCheckRemediationHint(checkName, result, checkEvaluation)}`;
    item.append(hint);
  }

  return item;
}

function renderChecks() {
  const completion = getTeamCompletionInfo(state.builder.teamState);
  if (completion.completionState === "empty") {
    elements.builderChecksReadiness.textContent = "No champions selected yet. Add at least one pick to start requirement evaluation.";
    elements.builderRequiredChecks.innerHTML = "";
    elements.builderOptionalChecks.innerHTML = "";
    elements.builderOptionalChecks.hidden = true;
    elements.builderToggleOptionalChecks.textContent = "Optional checks available after picks";
    elements.builderToggleOptionalChecks.disabled = true;

    const requiredRow = runtimeDocument.createElement("li");
    requiredRow.className = "check is-optional";
    requiredRow.textContent = "Readiness checks are waiting for your first champion selection.";
    elements.builderRequiredChecks.append(requiredRow);
    return;
  }

  elements.builderToggleOptionalChecks.disabled = false;

  const checkEvaluation = evaluateCompositionChecks(
    state.builder.teamState,
    state.data.championsByName,
    state.builder.toggles
  );
  const compositionScore = scoreNodeFromChecks(checkEvaluation);
  const checkResults = Object.values(checkEvaluation.checks);
  const requiredResults = checkResults.filter((result) => Boolean(result.required));
  const requiredPassedCount = requiredResults.filter((result) => Boolean(result.satisfied)).length;
  const requiredFailedCount = requiredResults.length - requiredPassedCount;

  if (completion.completionState === "partial") {
    elements.builderChecksReadiness.textContent = `Composition score: ${compositionScore}. ${completion.filledSlots}/${completion.totalSlots} slots filled. Required checks passed: ${requiredPassedCount}/${requiredResults.length}.`;
  } else {
    elements.builderChecksReadiness.textContent = `Composition score: ${compositionScore}. Required checks passed: ${requiredPassedCount}/${requiredResults.length}. ${requiredFailedCount > 0 ? `${requiredFailedCount} required gap(s) remain.` : "No required gaps."}`;
  }

  elements.builderRequiredChecks.innerHTML = "";
  elements.builderOptionalChecks.innerHTML = "";

  for (const [checkName, result] of Object.entries(checkEvaluation.checks)) {
    const required = Boolean(result.required);
    const item = buildCheckRow(checkName, result, checkEvaluation);

    if (required) {
      elements.builderRequiredChecks.append(item);
    } else {
      elements.builderOptionalChecks.append(item);
    }
  }

  elements.builderOptionalChecks.hidden = !state.builder.showOptionalChecks;
  elements.builderToggleOptionalChecks.textContent = state.builder.showOptionalChecks
    ? "Hide Optional Checks"
    : "Show Optional Checks";
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
    pill.className = "pill";
    pill.textContent = championName;
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
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = "No champions match the current search.";
    elements.builderExcludedOptions.append(empty);
    return;
  }

  for (const championName of filtered) {
    const label = runtimeDocument.createElement("label");
    label.className = "excluded-option selection-option";

    const checkbox = runtimeDocument.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.builder.excludedChampions.includes(championName);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        if (!state.builder.excludedChampions.includes(championName)) {
          state.builder.excludedChampions.push(championName);
        }
      } else {
        state.builder.excludedChampions = state.builder.excludedChampions.filter((name) => name !== championName);
      }

      for (const slot of SLOTS) {
        if (state.builder.teamState[slot] === championName) {
          state.builder.teamState[slot] = null;
        }
      }

      resetBuilderTreeState();
      setBuilderStage("setup");
      syncSlotSelectOptions();
      renderBuilder();
    });

    const text = runtimeDocument.createElement("span");
    text.textContent = championName;

    label.append(checkbox, text);
    elements.builderExcludedOptions.append(label);
  }
}

function renderDraftOrder() {
  elements.builderDraftOrder.innerHTML = "";

  for (let index = 0; index < state.builder.draftOrder.length; index += 1) {
    const role = state.builder.draftOrder[index];
    const row = elements.slotRows[role];
    const orderBadge = elements.slotOrderBadges[role];
    const statusBadge = elements.slotStatusBadges[role];
    const filled = Boolean(state.builder.teamState[role]);
    if (row) {
      row.style.order = String(index);
      row.classList.toggle("is-filled", filled);
    }
    if (orderBadge) {
      orderBadge.textContent = `#${index + 1}`;
    }
    if (statusBadge) {
      statusBadge.textContent = filled ? "Filled" : "Pending";
      statusBadge.classList.toggle("is-filled", filled);
      statusBadge.classList.toggle("is-pending", !filled);
    }
  }

  const activeNextRole = getActiveNextRole(state.builder.draftOrder, state.builder.teamState);
  if (activeNextRole) {
    elements.builderNextRoleReadout.textContent = `Next expansion role: ${getSlotLabel(activeNextRole)}`;
  } else {
    elements.builderNextRoleReadout.textContent = "All roles are already filled.";
  }

  for (const role of state.builder.draftOrder) {
    const item = runtimeDocument.createElement("li");
    item.className = "draft-order-item";
    if (state.builder.teamState[role]) {
      item.classList.add("is-filled");
    }
    item.draggable = true;
    item.dataset.role = role;

    const title = runtimeDocument.createElement("span");
    title.textContent = state.builder.teamState[role]
      ? `${getSlotLabel(role)} - filled (${state.builder.teamState[role]})`
      : `${getSlotLabel(role)} - pending`;

    const handle = runtimeDocument.createElement("span");
    handle.className = "handle";
    handle.textContent = "drag";

    item.append(title, handle);

    item.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/role", role);
      event.dataTransfer.effectAllowed = "move";
    });

    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });

    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const sourceRole = event.dataTransfer?.getData("text/role");
      if (!sourceRole || sourceRole === role) {
        return;
      }

      const updated = [...state.builder.draftOrder];
      const sourceIndex = updated.indexOf(sourceRole);
      const targetIndex = updated.indexOf(role);
      if (sourceIndex < 0 || targetIndex < 0) {
        return;
      }

      updated.splice(sourceIndex, 1);
      updated.splice(targetIndex, 0, sourceRole);
      state.builder.draftOrder = updated;
      setBuilderStage("setup");
      resetBuilderTreeState();
      renderBuilder();
    });

    elements.builderDraftOrder.append(item);
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
  syncSlotSelectOptions();
  clearBuilderFeedback();
  setSetupFeedback("");
  state.builder.selectedNodeId = nodeId;
  state.builder.selectedNodeTitle = nodeTitle;
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
  score.textContent = `Composition score: ${node.score} | required gaps: ${node.requiredSummary?.requiredGaps ?? "?"}`;
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
    case "candidate_score_floor":
      return `most dead-end paths run out at ${role} because all candidates fell below Min Candidate Score (${state.builder.treeMinCandidateScore}).`;
    case "top_threat_filter":
      return `most dead-end paths run out at ${role} because top-threat enforcement leaves no legal option.`;
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
  summaryMeta.className = "meta";
  summaryMeta.textContent = `${flat.length} visible node(s), depth ${maxDepth}.`;
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
      syncSlotSelectOptions();
      clearBuilderFeedback();
      setSetupFeedback("");
      renderTree();
      renderTreeMap();
    });
    navActions.append(back);
    elements.builderTreeSummary.append(navActions);
  }

  if (generationStats) {
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
    elements.builderTreeSummary.append(statsMeta);

    if ((generationStats.fallbackNodes ?? 0) > 0) {
      const fallbackMeta = runtimeDocument.createElement("p");
      fallbackMeta.className = "meta";
      fallbackMeta.textContent =
        `Adaptive fallback kept ${generationStats.fallbackCandidatesUsed} below-floor candidate(s) ` +
        `across ${generationStats.fallbackNodes} node(s) to avoid artificial dead-ends.`;
      elements.builderTreeSummary.append(fallbackMeta);
    }

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
  topHeading.className = "meta";
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
      const lowerCandidateFloor = runtimeDocument.createElement("button");
      lowerCandidateFloor.type = "button";
      lowerCandidateFloor.className = "ghost";
      lowerCandidateFloor.textContent = "Lower Min Candidate Score to 0";
      lowerCandidateFloor.addEventListener("click", () => {
        state.builder.treeMinCandidateScore = 0;
        elements.treeMinCandidateScore.value = "0";
        setBuilderStage("setup");
        resetBuilderTreeState();
        renderBuilder();
      });
      quickActions.append(lowerCandidateFloor);
    }

    if (quickActions.childElementCount > 0) {
      elements.builderTreeSummary.append(quickActions);
    }

    if (root.children.length === 0) {
      const guidance = runtimeDocument.createElement("p");
      guidance.className = "meta";
      guidance.textContent =
        "No viable branches were generated. Depth is automatic to remaining slots. Lower Min Candidate Score, relax required toggles, or pre-fill key slots.";
      elements.builderTreeSummary.append(guidance);
    }
    return;
  }

  for (const entry of topBranches) {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card";

    const title = runtimeDocument.createElement("strong");
    title.textContent = entry.title;

    const score = runtimeDocument.createElement("p");
    score.className = "meta";
    const fallbackSuffix = entry.node.passesMinScore === false ? ", below min candidate score floor" : "";
    score.textContent =
      `Composition score ${entry.node.score}, candidate score ${entry.node.candidateScore ?? 0}, ` +
      `required gaps ${entry.node.requiredSummary?.requiredGaps ?? "?"}, ` +
      `valid leaves ${entry.node.branchPotential?.validLeafCount ?? 0}${fallbackSuffix}.`;

    const actions = runtimeDocument.createElement("div");
    actions.className = "button-row";
    const inspect = runtimeDocument.createElement("button");
    inspect.type = "button";
    inspect.textContent = "Inspect";
    inspect.addEventListener("click", () => {
      inspectNode(entry.node, entry.id, entry.title);
    });
    actions.append(inspect);

    card.append(title, score, actions);
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
  state.builder.maxDepth = getAutoMaxDepth();
  renderBuilderStageGuide();
  replaceOptions(elements.builderActiveTeam, getTeamSelectOptions());
  elements.builderActiveTeam.value = state.builder.teamId;
  elements.builderMaxDepth.value = String(state.builder.maxDepth);
  elements.builderMaxDepth.disabled = true;
  elements.treeDensity.value = state.builder.treeDensity;
  elements.treeSearch.value = state.builder.treeSearch;
  elements.treeMinScore.value = String(state.builder.treeMinScore);
  elements.treeMinCandidateScore.value = String(state.builder.treeMinCandidateScore);
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
  const selection = validateSlotSelection({
    slot,
    championName,
    teamState: state.builder.teamState,
    excludedChampions: state.builder.excludedChampions,
    pools: getEffectiveRolePools(),
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
  await loadProfileFromApi();
  await loadPoolsFromApi(preferredPoolTeamId);
  await loadTeamsFromApi(preferredAdminTeamId);
  await loadTeamContextFromApi();
  await loadTagCatalogFromApi();
  initializeTeamConfigControls();
  renderTeamAdmin();
  renderPlayerConfig();
  renderBuilder();
  renderChampionTagCatalog();
  renderTagsWorkspace();
  renderChampionTagEditor();
  syncSlotSelectOptions();
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

  return {
    email,
    password,
    gameName,
    tagline
  };
}

function clearAuthForm() {
  elements.authPassword.value = "";
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
  const InputCtor = runtimeWindow.HTMLInputElement ?? globalThis.HTMLInputElement;

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
    void handleAuthSubmit("/auth/register", "register").catch((error) => {
      setAuthFeedback(normalizeApiErrorMessage(error, "Registration failed."));
      renderAuth();
    });
  });

  elements.authLogin.addEventListener("click", () => {
    setAuthMode("login");
    void handleAuthSubmit("/auth/login", "login").catch((error) => {
      setAuthFeedback(normalizeApiErrorMessage(error, "Login failed."));
      renderAuth();
    });
  });

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
    renderAuth();
  });

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
      setTab(route.tab);
      return;
    }
    setTab(DEFAULT_TAB_ROUTE, { syncRoute: true, replaceRoute: true });
  });

  for (const button of elements.tabTriggers) {
    button.addEventListener("click", () => {
      if (!hasAuthSession()) {
        setAuthFeedback("Login required to access app screens.");
        return;
      }
      setTab(button.dataset.tab, { syncRoute: true });
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

  if (elements.championTagEditorScope) {
    elements.championTagEditorScope.addEventListener("change", () => {
      state.api.championTagScope = normalizeChampionTagScope(elements.championTagEditorScope.value);
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

  for (const button of elements.championEditorTabButtons) {
    button.addEventListener("click", () => {
      setChampionEditorTab(button.dataset.championEditorTab);
    });
  }

  if (elements.championMetadataEditorDamageType) {
    elements.championMetadataEditorDamageType.addEventListener("change", () => {
      const normalized = normalizeApiDamageType(elements.championMetadataEditorDamageType.value);
      if (normalized) {
        state.api.championMetadataDraft.damageType = normalized;
      }
      renderChampionTagEditor();
    });
  }

  if (elements.championMetadataEditorScaling) {
    elements.championMetadataEditorScaling.addEventListener("change", () => {
      const normalized = normalizeApiScaling(elements.championMetadataEditorScaling.value);
      if (normalized) {
        state.api.championMetadataDraft.scaling = normalized;
      }
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
      clearChampionTagEditorState();
      renderChampionTagEditor();
    });
  }

  elements.builderActiveTeam.addEventListener("change", () => {
    state.builder.teamId = normalizeConfiguredTeamId(elements.builderActiveTeam.value);
    state.teamConfig.activeTeamId = state.builder.teamId;
    saveTeamConfig();
    setBuilderStage("setup");
    resetBuilderTreeState();
    syncSlotSelectOptions();
    clearBuilderFeedback();
    renderTeamConfig();
    renderBuilder();
    if (isAuthenticated()) {
      void saveTeamContextToApi().then(() => {
        saveTeamConfig();
        renderTeamConfig();
        renderBuilder();
      });
    }
  });

  elements.builderToggleOptionalChecks.addEventListener("click", () => {
    state.builder.showOptionalChecks = !state.builder.showOptionalChecks;
    renderChecks();
  });

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

  elements.treeMinCandidateScore.addEventListener("change", () => {
    const parsed = Number.parseInt(elements.treeMinCandidateScore.value, 10);
    state.builder.treeMinCandidateScore = Number.isFinite(parsed) ? Math.max(0, parsed) : 1;
    elements.treeMinCandidateScore.value = String(state.builder.treeMinCandidateScore);
    setBuilderStage("setup");
    resetBuilderTreeState();
    renderBuilder();
  });

  elements.builderToggles.addEventListener("change", (event) => {
    const target = event.target;
    if (!InputCtor || !(target instanceof InputCtor)) {
      return;
    }
    if (!target.dataset.toggle) {
      return;
    }
    state.builder.toggles[target.dataset.toggle] = target.checked;
    setBuilderStage("setup");
    resetBuilderTreeState();
    renderBuilder();
  });

  elements.builderExcludedSearch.addEventListener("input", () => {
    state.builder.excludedSearch = elements.builderExcludedSearch.value;
    renderExcludedOptions();
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

  for (const slot of SLOTS) {
    elements.slotSelects[slot].addEventListener("change", () => {
      const selected = elements.slotSelects[slot].value || null;
      if (!validateAndApplySlotSelection(slot, selected)) {
        syncSlotSelectOptions();
        return;
      }
      setBuilderStage("setup");
      resetBuilderTreeState();
      syncSlotSelectOptions();
      renderBuilder();
      setSetupFeedback("");
    });
  }

  elements.builderGenerate.addEventListener("click", () => {
    if (state.builder.stage === "setup") {
      setSetupFeedback(UI_COPY.builder.setupGateMessage);
      return;
    }
    generateTreeFromCurrentState({ scrollToResults: true });
  });

  elements.builderClear.addEventListener("click", () => {
    state.builder.teamState = createEmptyTeamState();
    resetBuilderTreeState();
    setBuilderStage("setup");
    syncSlotSelectOptions();
    clearBuilderFeedback();
    renderBuilder();
  });

  elements.treeExpandAll.addEventListener("click", () => {
    setAllTreeDetails(true);
  });

  elements.treeCollapseAll.addEventListener("click", () => {
    setAllTreeDetails(false);
  });

  if (elements.teamConfigDefaultTeam) {
    elements.teamConfigDefaultTeam.addEventListener("change", () => {
      state.teamConfig.defaultTeamId = resolveConfiguredTeamSelection(elements.teamConfigDefaultTeam.value);
      saveTeamConfig();
      renderTeamConfig();
      if (isAuthenticated()) {
        void saveTeamContextToApi().then(() => {
          saveTeamConfig();
          renderTeamConfig();
        });
      }
    });
  }

  if (elements.teamConfigActiveTeam) {
    elements.teamConfigActiveTeam.addEventListener("change", () => {
      state.teamConfig.activeTeamId = resolveConfiguredTeamSelection(elements.teamConfigActiveTeam.value);
      state.builder.teamId = state.teamConfig.activeTeamId;
      setBuilderStage("setup");
      resetBuilderTreeState();
      syncSlotSelectOptions();
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
      renderPlayerConfig();
      return;
    }
    const saved = savePlayerConfig();
    renderPlayerConfig();
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
      setProfileRolesFeedback("Primary role is required.", true);
      return;
    }

    state.profile.isSavingRoles = true;
    setProfileRolesFeedback("Saving profile roles...");
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
        setProfileRolesFeedback(formatSavedProfileRolesFeedback(state.profile.primaryRole, state.profile.secondaryRoles));
        await hydrateAuthenticatedViews(state.playerConfig.teamId, state.api.selectedTeamId);
      })
      .catch((error) => {
        setProfileRolesFeedback(normalizeApiErrorMessage(error, "Failed to save profile roles."), true);
      })
      .finally(() => {
        state.profile.isSavingRoles = false;
        renderProfileRolesSection();
      });
  });

  elements.teamAdminTeamSelect.addEventListener("change", () => {
    state.api.selectedTeamId = elements.teamAdminTeamSelect.value;
    void loadTeamMembersForSelectedTeam().then(() => {
      renderTeamAdmin();
    });
  });

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
    const initialRoute = parseTabRouteHash(runtimeWindow.location.hash);
    await loadMvpData();
    await loadTagCatalogFromApi();
    let loadedTeamContextFromApi = false;
    if (isAuthenticated()) {
      await loadProfileFromApi();
      await loadPoolsFromApi();
      await loadTeamsFromApi();
      loadedTeamContextFromApi = await loadTeamContextFromApi();
    } else {
      loadStoredPlayerConfig();
      setPoolApiFeedback("Sign in to manage API-backed pools.");
      setTeamAdminFeedback("Sign in to manage teams.");
      setProfileRolesFeedback("");
    }
    if (!loadedTeamContextFromApi) {
      loadStoredTeamConfig();
    }
    initializeExplorerControls();
    initializeBuilderControls();
    initializeTeamConfigControls();
    initializePlayerConfigControls();
    resetBuilderToDefaults();

    attachEvents();
    const initialTab =
      initialRoute.status === "valid"
        ? initialRoute.tab
        : initialRoute.status === "invalid"
          ? DEFAULT_TAB_ROUTE
          : state.activeTab;
    setTab(initialTab, {
      syncRoute: true,
      replaceRoute: initialRoute.status !== "valid"
    });
    syncSlotSelectOptions();
    renderTeamConfig();
    renderTeamAdmin();
    renderPlayerConfig();
    renderBuilder();
    renderChampionTagCatalog();
    renderTagsWorkspace();
    renderChampionTagEditor();
    renderAuth();
    clearBuilderFeedback();
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
