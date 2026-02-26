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
const DEFAULT_MEMBER_ROLE = "member";
const MEMBER_ROLE_OPTIONS = Object.freeze(["lead", "member"]);
const DEFAULT_TEAM_MEMBER_TYPE = "substitute";
const TEAM_MEMBER_TYPE_OPTIONS = Object.freeze(["primary", "substitute"]);
const DEFAULT_PRIMARY_ROLE = "Mid";

const CHAMPION_IMAGE_OVERRIDES = Object.freeze({
  VelKoz: "Velkoz"
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
    title: "Build a Composition",
    subtitle: "Configure team context, scout candidates, and run deterministic next-pick simulations."
  },
  nav: {
    title: "Navigation",
    meta: "Switch between workflow and configuration pages.",
    toggleClosed: "Menu",
    toggleOpen: "Close Menu",
    items: {
      workflow: "Workflow",
      "team-config": "Team Context",
      "player-config": "Profile",
      explorer: "Champion Tags"
    }
  },
  panels: {
    explorerTitle: "Champion Tags",
    explorerMeta: "Filter champions by role, damage profile, scaling, and tags.",
    teamConfigTitle: "Team Draft Context",
    teamConfigMeta: "Set the team profile that drives role pools across composition work.",
    playerConfigTitle: "My Profile",
    playerConfigMeta: "Manage your roles, champion pools, and teams."
  },
  builder: {
    workflowTitle: "Build a Composition",
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

function createInitialState() {
  return {
    data: null,
    activeTab: "workflow",
    ui: {
      isNavOpen: false
    },
    auth: {
      token: null,
      user: null,
      feedback: ""
    },
    profile: {
      primaryRole: DEFAULT_PRIMARY_ROLE,
      secondaryRoles: []
    },
    api: {
      pools: [],
      poolByTeamId: {},
      teams: [],
      membersByTeamId: {},
      selectedTeamId: ""
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
      byTeam: {}
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
    tabExplorer: runtimeDocument.querySelector("#tab-explorer"),
    tabWorkflow: runtimeDocument.querySelector("#tab-workflow"),
    tabTeamConfig: runtimeDocument.querySelector("#tab-team-config"),
    tabPlayerConfig: runtimeDocument.querySelector("#tab-player-config"),
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
    teamConfigDefaultTeam: runtimeDocument.querySelector("#team-config-default-team"),
    teamConfigActiveTeam: runtimeDocument.querySelector("#team-config-active-team"),
    teamConfigDefaultHelp: runtimeDocument.querySelector("#team-config-default-help"),
    teamConfigActiveHelp: runtimeDocument.querySelector("#team-config-active-help"),
    teamConfigPoolSummary: runtimeDocument.querySelector("#team-config-pool-summary"),
    teamConfigPoolGrid: runtimeDocument.querySelector("#team-config-pool-grid"),
    teamAdminCreateName: runtimeDocument.querySelector("#team-admin-create-name"),
    teamAdminCreate: runtimeDocument.querySelector("#team-admin-create"),
    teamAdminTeamSelect: runtimeDocument.querySelector("#team-admin-team-select"),
    teamAdminRenameName: runtimeDocument.querySelector("#team-admin-rename-name"),
    teamAdminRename: runtimeDocument.querySelector("#team-admin-rename"),
    teamAdminDelete: runtimeDocument.querySelector("#team-admin-delete"),
    teamAdminMembers: runtimeDocument.querySelector("#team-admin-members"),
    teamAdminAddUserId: runtimeDocument.querySelector("#team-admin-add-user-id"),
    teamAdminAddRole: runtimeDocument.querySelector("#team-admin-add-role"),
    teamAdminAddTeamRole: runtimeDocument.querySelector("#team-admin-add-team-role"),
    teamAdminAddMember: runtimeDocument.querySelector("#team-admin-add-member"),
    teamAdminRoleUserId: runtimeDocument.querySelector("#team-admin-role-user-id"),
    teamAdminRole: runtimeDocument.querySelector("#team-admin-role"),
    teamAdminUpdateRole: runtimeDocument.querySelector("#team-admin-update-role"),
    teamAdminTeamRoleUserId: runtimeDocument.querySelector("#team-admin-team-role-user-id"),
    teamAdminTeamRole: runtimeDocument.querySelector("#team-admin-team-role"),
    teamAdminUpdateTeamRole: runtimeDocument.querySelector("#team-admin-update-team-role"),
    teamAdminRemoveUserId: runtimeDocument.querySelector("#team-admin-remove-user-id"),
    teamAdminRemoveMember: runtimeDocument.querySelector("#team-admin-remove-member"),
    teamAdminFeedback: runtimeDocument.querySelector("#team-admin-feedback"),
    poolApiFeedback: runtimeDocument.querySelector("#pool-api-feedback"),
    playerConfigTeam: runtimeDocument.querySelector("#player-config-team"),
    profilePrimaryRole: runtimeDocument.querySelector("#profile-primary-role"),
    profileSecondaryRoles: runtimeDocument.querySelector("#profile-secondary-roles"),
    profileSaveRoles: runtimeDocument.querySelector("#profile-save-roles"),
    profileRolesFeedback: runtimeDocument.querySelector("#profile-roles-feedback"),
    playerConfigSummary: runtimeDocument.querySelector("#player-config-summary"),
    playerConfigFeedback: runtimeDocument.querySelector("#player-config-feedback"),
    playerConfigGrid: runtimeDocument.querySelector("#player-config-grid"),
    settingsTeamsMemberSummary: runtimeDocument.querySelector("#settings-teams-member-summary"),
    settingsTeamsMemberList: runtimeDocument.querySelector("#settings-teams-member-list"),
    settingsTeamsLeadSummary: runtimeDocument.querySelector("#settings-teams-lead-summary"),
    settingsTeamsLeadList: runtimeDocument.querySelector("#settings-teams-lead-list"),
    settingsTeamCreateName: runtimeDocument.querySelector("#settings-team-create-name"),
    settingsTeamCreate: runtimeDocument.querySelector("#settings-team-create"),
    settingsTeamFeedback: runtimeDocument.querySelector("#settings-team-feedback"),
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

function setSettingsTeamFeedback(message) {
  if (elements.settingsTeamFeedback) {
    elements.settingsTeamFeedback.textContent = message;
  }
}

function setProfileRolesFeedback(message, isError = false) {
  if (!elements.profileRolesFeedback) {
    return;
  }
  elements.profileRolesFeedback.textContent = message;
  elements.profileRolesFeedback.style.color = isError ? "var(--warn)" : "var(--muted)";
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
  state.profile.primaryRole = DEFAULT_PRIMARY_ROLE;
  state.profile.secondaryRoles = [];
  saveAuthSession();
  setAuthFeedback(feedback);
}

function setAuthControlsVisibility(showLoginControls) {
  const controls = [
    elements.authEmailGroup,
    elements.authGameNameGroup,
    elements.authTaglineGroup,
    elements.authPasswordGroup,
    elements.authRegister,
    elements.authLogin,
    elements.authRegistrationHelp
  ];
  for (const control of controls) {
    if (control) {
      control.hidden = !showLoginControls;
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
  if (elements.navToggle) {
    elements.navToggle.hidden = !signedIn;
  }
  if (!signedIn) {
    setNavOpen(false);
  }
}

function renderAuth() {
  const signedIn = hasAuthSession();
  if (!signedIn) {
    setAuthControlsVisibility(true);
    elements.authStatus.textContent = "Signed out.";
    elements.authLogout.disabled = true;
    renderAuthGate();
    return;
  }

  setAuthControlsVisibility(false);
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
  elements.heroTitle.textContent = UI_COPY.hero.title;
  elements.heroSubtitle.textContent = UI_COPY.hero.subtitle;
  elements.navTitle.textContent = UI_COPY.nav.title;
  elements.navMeta.textContent = UI_COPY.nav.meta;
  elements.explorerTitle.textContent = UI_COPY.panels.explorerTitle;
  elements.explorerMeta.textContent = UI_COPY.panels.explorerMeta;
  elements.teamConfigTitle.textContent = UI_COPY.panels.teamConfigTitle;
  elements.teamConfigMeta.textContent = UI_COPY.panels.teamConfigMeta;
  elements.playerConfigTitle.textContent = UI_COPY.panels.playerConfigTitle;
  elements.playerConfigMeta.textContent = UI_COPY.panels.playerConfigMeta;

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
  const showDrawer = state.ui.isNavOpen && isCompactNavViewport();
  elements.navDrawer.classList.toggle("is-open", showDrawer);
  elements.navOverlay.classList.toggle("is-open", showDrawer);
  runtimeDocument.body.classList.toggle("nav-open", showDrawer);
  elements.navToggle.textContent = showDrawer ? UI_COPY.nav.toggleOpen : UI_COPY.nav.toggleClosed;
  elements.navToggle.setAttribute("aria-expanded", String(showDrawer));
}

function syncNavLayout() {
  if (!isCompactNavViewport() && state.ui.isNavOpen) {
    state.ui.isNavOpen = false;
  }
  setNavOpen(state.ui.isNavOpen);
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

function setTab(tabName) {
  if (!hasAuthSession()) {
    state.activeTab = "workflow";
    return;
  }

  const validTabs = new Set(["workflow", "team-config", "player-config", "explorer"]);
  const resolvedTab = validTabs.has(tabName) ? tabName : "workflow";
  state.activeTab = resolvedTab;

  for (const button of elements.sideMenuLinks) {
    const isActive = button.dataset.tab === resolvedTab;
    button.classList.toggle("is-active", isActive);
  }

  elements.tabExplorer.classList.toggle("is-active", resolvedTab === "explorer");
  elements.tabWorkflow.classList.toggle("is-active", resolvedTab === "workflow");
  elements.tabTeamConfig.classList.toggle("is-active", resolvedTab === "team-config");
  elements.tabPlayerConfig.classList.toggle("is-active", resolvedTab === "player-config");

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

  if (isCompactNavViewport()) {
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

async function apiRequest(path, { method = "GET", body = undefined, auth = false } = {}) {
  if (!runtimeApiBaseUrl) {
    throw new Error("API base URL is not configured.");
  }

  const headers = {
    Accept: "application/json"
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (auth && state.auth.token) {
    headers.Authorization = `Bearer ${state.auth.token}`;
  }

  const response = await runtimeFetch(resolveApiUrl(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
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

function normalizeApiTags(rawTags) {
  const source = rawTags && typeof rawTags === "object" && !Array.isArray(rawTags) ? rawTags : {};
  const tags = {};
  for (const tag of BOOLEAN_TAGS) {
    const raw = source[tag];
    tags[tag] = raw === true || raw === 1 || raw === "1";
  }
  return tags;
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

  return {
    id: Number.isInteger(rawChampion.id) ? rawChampion.id : null,
    name,
    roles: normalizedRoles,
    damageType,
    scaling,
    tags: normalizeApiTags(metadata.tags)
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
    return "None (global role pools)";
  }
  return state.data.teamLabels?.[teamId] ?? teamId;
}

function buildRolePlayerFromChampionNames(role, championNames) {
  const roleEligible = new Set(state.data.noneTeamPools[role] ?? []);
  const uniqueNames = Array.from(new Set(championNames))
    .filter((name) => roleEligible.has(name))
    .sort((left, right) => left.localeCompare(right));
  return [
    {
      id: `${role}::${role} Player`,
      player: `${role} Player`,
      role,
      champions: uniqueNames
    }
  ];
}

function clearApiPoolState() {
  state.api.pools = [];
  state.api.poolByTeamId = {};
  state.playerConfig.byTeam = {};
  state.playerConfig.teamId = "";
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
    const championNames = (pool?.champion_ids ?? [])
      .map((championId) => state.data.championNamesById[championId])
      .filter((name) => Boolean(name));
    byTeam[teamId] = buildRolePlayerFromChampionNames(role, championNames);
    teamLabels[teamId] = role;
    poolByTeamId[teamId] = pool;
  }

  state.api.pools = pools;
  state.api.poolByTeamId = poolByTeamId;
  state.playerConfig.byTeam = byTeam;
  state.data.teamLabels = teamLabels;
  state.playerConfig.teamId = normalizePlayerConfigTeamId(preferredTeamId ?? state.playerConfig.teamId);
  syncDerivedTeamDataFromPlayerConfig();

  state.teamConfig.defaultTeamId = normalizeConfiguredTeamId(state.teamConfig.defaultTeamId);
  state.teamConfig.activeTeamId = normalizeConfiguredTeamId(state.teamConfig.activeTeamId);
  state.builder.teamId = normalizeConfiguredTeamId(state.builder.teamId);
}

function normalizeApiErrorMessage(error, fallbackMessage) {
  if (error instanceof Error && typeof error.message === "string" && error.message.trim() !== "") {
    return error.message;
  }
  return fallbackMessage;
}

async function ensureProfileRolePools(pools) {
  const configuredRoles = getConfiguredProfileRoles();
  const existingRoles = new Set(
    pools
      .map((pool) => (SLOTS.includes(pool?.name) ? pool.name : null))
      .filter((role) => Boolean(role))
  );
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
    return pools;
  }

  const refreshed = await apiRequest("/me/pools", { auth: true });
  return Array.isArray(refreshed?.pools) ? refreshed.pools : pools;
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
    return false;
  }

  try {
    const payload = await apiRequest("/me/profile", { auth: true });
    const profile = payload?.profile ?? {};
    const primaryRole = normalizeProfileRole(profile.primaryRole);
    state.profile.primaryRole = primaryRole;
    state.profile.secondaryRoles = normalizeSecondaryRoles(profile.secondaryRoles, primaryRole);
    if (state.auth.user && typeof state.auth.user === "object") {
      state.auth.user.primaryRole = state.profile.primaryRole;
      state.auth.user.secondaryRoles = [...state.profile.secondaryRoles];
      saveAuthSession();
    }
    return true;
  } catch (error) {
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
  const playerName = state.data.teamPlayersByRole[state.builder.teamId]?.[slot];
  return playerName ? `${slot} (${playerName})` : slot;
}

function updateTeamHelpAndSlotLabels() {
  if (state.builder.teamId === NONE_TEAM_ID) {
    elements.builderTeamHelp.textContent =
      "Role candidates use global champion eligibility.";
  } else {
    elements.builderTeamHelp.textContent =
      "Role candidates are limited to this team's configured pools.";
  }

  for (const slot of SLOTS) {
    elements.slotLabels[slot].textContent = getSlotLabel(slot);
  }
}

function getTeamSelectOptions() {
  const teamOptions = Object.keys(state.data.teamPools)
    .sort((left, right) => getTeamDisplayLabel(left).localeCompare(getTeamDisplayLabel(right)))
    .map((teamId) => ({ value: teamId, label: getTeamDisplayLabel(teamId) }));
  return [
    { value: NONE_TEAM_ID, label: "None (global role pools)" },
    ...teamOptions
  ];
}

function normalizeConfiguredTeamId(teamId) {
  if (teamId === NONE_TEAM_ID) {
    return NONE_TEAM_ID;
  }
  if (typeof teamId === "string" && state.data.teamPools[teamId]) {
    return teamId;
  }
  return NONE_TEAM_ID;
}

function getPoolsForTeam(teamId) {
  if (teamId === NONE_TEAM_ID) {
    return state.data.noneTeamPools;
  }
  return state.data.teamPools[teamId] ?? state.data.noneTeamPools;
}

function initializeBuilderControls() {
  const candidateDefaultTeamId = state.teamConfig.defaultTeamId ?? state.data.config.teamDefault ?? NONE_TEAM_ID;
  state.teamConfig.defaultTeamId = normalizeConfiguredTeamId(
    candidateDefaultTeamId
  );
  state.teamConfig.activeTeamId = state.teamConfig.defaultTeamId;
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

function renderTeamConfig() {
  elements.teamConfigDefaultTeam.value = state.teamConfig.defaultTeamId;
  elements.teamConfigActiveTeam.value = state.teamConfig.activeTeamId;

  elements.teamConfigDefaultHelp.textContent = state.teamConfig.defaultTeamId === NONE_TEAM_ID
    ? "Default team: None (global role pools)."
    : `Default team: ${getTeamDisplayLabel(state.teamConfig.defaultTeamId)}.`;

  elements.teamConfigActiveHelp.textContent = state.teamConfig.activeTeamId === NONE_TEAM_ID
    ? "Active team: None (global role pools)."
    : `Active team: ${getTeamDisplayLabel(state.teamConfig.activeTeamId)}.`;

  const pools = getPoolsForTeam(state.teamConfig.activeTeamId);
  const roleCounts = SLOTS.map((slot) => `${slot}: ${(pools[slot] ?? []).length}`);
  elements.teamConfigPoolSummary.textContent = `${state.teamConfig.activeTeamId === NONE_TEAM_ID ? "None" : getTeamDisplayLabel(state.teamConfig.activeTeamId)} pool sizes -> ${roleCounts.join(" | ")}`;

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

function renderTeamAdmin() {
  const teamOptions = state.api.teams
    .map((team) => ({ value: String(team.id), label: team.name }))
    .sort((left, right) => left.label.localeCompare(right.label));

  replaceOptions(elements.teamAdminTeamSelect, teamOptions);

  const selectedTeam = getSelectedAdminTeam();
  state.api.selectedTeamId = selectedTeam ? String(selectedTeam.id) : "";
  elements.teamAdminTeamSelect.value = state.api.selectedTeamId;
  if (selectedTeam) {
    elements.teamAdminRenameName.value = selectedTeam.name;
  } else {
    elements.teamAdminRenameName.value = "";
  }

  const members = selectedTeam ? state.api.membersByTeamId[String(selectedTeam.id)] ?? [] : [];
  const isLead = selectedTeam?.membership_role === "lead";
  const adminEnabled = Boolean(selectedTeam) && isLead;

  elements.teamAdminRename.disabled = !adminEnabled;
  elements.teamAdminDelete.disabled = !adminEnabled;
  elements.teamAdminAddMember.disabled = !adminEnabled;
  elements.teamAdminUpdateRole.disabled = !adminEnabled;
  elements.teamAdminRemoveMember.disabled = !adminEnabled;
  elements.teamAdminRenameName.disabled = !adminEnabled;
  elements.teamAdminAddUserId.disabled = !adminEnabled;
  elements.teamAdminAddRole.disabled = !adminEnabled;
  elements.teamAdminAddTeamRole.disabled = !adminEnabled;
  elements.teamAdminRoleUserId.disabled = !adminEnabled;
  elements.teamAdminRole.disabled = !adminEnabled;
  elements.teamAdminTeamRoleUserId.disabled = !adminEnabled;
  elements.teamAdminTeamRole.disabled = !adminEnabled;
  elements.teamAdminUpdateTeamRole.disabled = !adminEnabled;
  elements.teamAdminRemoveUserId.disabled = !adminEnabled;

  elements.teamAdminMembers.innerHTML = "";
  if (!selectedTeam) {
    const empty = runtimeDocument.createElement("p");
    empty.className = "meta";
    empty.textContent = isAuthenticated()
      ? "No teams yet. Create a team to start."
      : "Sign in to manage teams.";
    elements.teamAdminMembers.append(empty);
    return;
  }

  for (const member of members) {
    const card = runtimeDocument.createElement("article");
    card.className = "summary-card";
    const title = runtimeDocument.createElement("strong");
    title.textContent = member.email ?? `User ${member.user_id}`;
    const details = runtimeDocument.createElement("p");
    details.className = "meta";
    details.textContent = `user_id=${member.user_id} | role=${member.role} | team_role=${member.team_role ?? "primary"}`;
    card.append(title, details);
    elements.teamAdminMembers.append(card);
  }
}

function initializeTeamConfigControls() {
  const options = getTeamSelectOptions();
  replaceOptions(elements.teamConfigDefaultTeam, options);
  replaceOptions(elements.teamConfigActiveTeam, options);
  renderTeamConfig();
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

  replaceOptions(
    elements.profilePrimaryRole,
    SLOTS.map((role) => ({ value: role, label: role }))
  );
  elements.profilePrimaryRole.value = state.profile.primaryRole;
  elements.profilePrimaryRole.disabled = !authenticated;
  if (elements.profileSaveRoles) {
    elements.profileSaveRoles.disabled = !authenticated;
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
    checkbox.disabled = !authenticated;
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
    card.className = "summary-card";

    const title = runtimeDocument.createElement("strong");
    title.textContent = team.name;

    const details = runtimeDocument.createElement("p");
    details.className = "meta";
    details.textContent = `membership=${team.membership_role ?? "member"} | team_role=${team.membership_team_role ?? "primary"}`;

    card.append(title, details);
    target.append(card);
  }
}

function renderSettingsTeamMembership() {
  const allTeams = [...state.api.teams].sort((left, right) => left.name.localeCompare(right.name));
  const leadTeams = allTeams.filter((team) => team.membership_role === "lead");
  const authenticated = isAuthenticated();

  if (elements.settingsTeamsMemberSummary) {
    elements.settingsTeamsMemberSummary.textContent = authenticated
      ? `${allTeams.length} team${allTeams.length === 1 ? "" : "s"} total.`
      : "Sign in to view teams.";
  }
  if (elements.settingsTeamsLeadSummary) {
    elements.settingsTeamsLeadSummary.textContent = authenticated
      ? `${leadTeams.length} lead assignment${leadTeams.length === 1 ? "" : "s"}.`
      : "Sign in to view teams.";
  }

  renderSettingsTeamList(
    elements.settingsTeamsMemberList,
    allTeams,
    authenticated ? "No teams yet. Create a team to start." : "Sign in to view teams."
  );
  renderSettingsTeamList(
    elements.settingsTeamsLeadList,
    leadTeams,
    authenticated ? "You are not currently a lead on any team." : "Sign in to view teams."
  );

  if (elements.settingsTeamCreate) {
    elements.settingsTeamCreate.disabled = !authenticated;
  }
  if (elements.settingsTeamCreateName) {
    elements.settingsTeamCreateName.disabled = !authenticated;
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
  renderPlayerConfig();
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
  const activeRole = parseRolePoolTeamId(state.playerConfig.teamId) ?? state.profile.primaryRole;

  const players = state.playerConfig.byTeam[state.playerConfig.teamId] ?? [];
  const activePlayer = players.find((player) => player.role === activeRole) ?? null;
  if (activePlayer) {
    elements.playerConfigSummary.textContent = `Editing ${activeRole} pool. ${activePlayer.champions.length} champion${activePlayer.champions.length === 1 ? "" : "s"} selected.`;
  } else {
    elements.playerConfigSummary.textContent = isAuthenticated()
      ? `No champions selected for ${activeRole}.`
      : "Sign in to load API-backed pools.";
  }

  renderSettingsTeamMembership();
  elements.playerConfigGrid.innerHTML = "";
  if (!activePlayer) {
    return;
  }

  const card = runtimeDocument.createElement("article");
  card.className = "player-config-card";

  const title = runtimeDocument.createElement("h3");
  title.textContent = `${activeRole} Champion Pool`;

  const roleMeta = runtimeDocument.createElement("p");
  roleMeta.className = "meta";
  roleMeta.textContent = `Role: ${activeRole}`;

  const countMeta = runtimeDocument.createElement("p");
  countMeta.className = "meta";
  countMeta.textContent = `${activePlayer.champions.length} champion${activePlayer.champions.length === 1 ? "" : "s"} in pool.`;

  const label = runtimeDocument.createElement("label");
  label.textContent = "Champion Pool";

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
      syncDerivedTeamDataFromPlayerConfig();
      state.teamConfig.defaultTeamId = normalizeConfiguredTeamId(state.teamConfig.defaultTeamId);
      state.teamConfig.activeTeamId = normalizeConfiguredTeamId(state.teamConfig.activeTeamId);
      state.builder.teamId = normalizeConfiguredTeamId(state.builder.teamId);
      setBuilderStage("setup");
      resetBuilderTreeState();
      syncSlotSelectOptions();
      renderTeamConfig();
      renderBuilder();
      if (isAuthenticated()) {
        void syncPoolSelectionToApi(state.playerConfig.teamId)
          .then(() => {
            renderPlayerConfigFeedback(`Saved pool updates for ${activePlayer.role}.`);
          })
          .catch((error) => {
            renderPlayerConfigFeedback(normalizeApiErrorMessage(error, "Failed to save pool updates."), true);
          });
        return;
      }

      const saved = savePlayerConfig();
      renderPlayerConfig();
      renderPlayerConfigFeedback(
        saved ? `Saved pool updates for ${activePlayer.role}.` : "Pool updates applied in memory, but local storage is unavailable.",
        !saved
      );
    }
  });

  label.append(poolControlHost);
  card.append(title, roleMeta, countMeta, label);
  elements.playerConfigGrid.append(card);
}

function initializePlayerConfigControls() {
  renderPlayerConfig();
  renderPlayerConfigFeedback("");
  setProfileRolesFeedback("");
  setSettingsTeamFeedback("");
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
  state.teamConfig.defaultTeamId = typeof stored.defaultTeamId === "string" ? stored.defaultTeamId : null;
  state.teamConfig.activeTeamId = typeof stored.activeTeamId === "string" ? stored.activeTeamId : null;
}

function saveTeamConfig() {
  tryWriteJsonStorage(TEAM_CONFIG_STORAGE_KEY, state.teamConfig);
}

function savePlayerConfig() {
  return tryWriteJsonStorage(PLAYER_CONFIG_STORAGE_KEY, state.playerConfig);
}

function loadStoredAuthSession() {
  const stored = readStoredAuthSession();
  state.auth.token = stored.token;
  state.auth.user = stored.user;
  const primaryRole = normalizeProfileRole(stored.user?.primaryRole);
  state.profile.primaryRole = primaryRole;
  state.profile.secondaryRoles = normalizeSecondaryRoles(stored.user?.secondaryRoles, primaryRole);
}

function loadStoredPlayerConfig() {
  state.playerConfig.byTeam = clonePlayerPoolsByTeam(state.data.defaultPlayerPoolsByTeam);
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
  const defaultTeamId = normalizeConfiguredTeamId(state.teamConfig.defaultTeamId);

  state.builder.teamId = defaultTeamId;
  state.teamConfig.activeTeamId = defaultTeamId;
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
  return state.data.teamPools[state.builder.teamId];
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

  return {
    teamId: state.builder.teamId,
    teamPools: state.data.teamPools
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

    heading.append(name, summary);
    header.append(image, heading);

    const chips = runtimeDocument.createElement("div");
    chips.className = "chip-row";
    const activeTags = BOOLEAN_TAGS.filter((tag) => champion.tags[tag]);
    for (const tag of activeTags) {
      const chip = runtimeDocument.createElement("span");
      chip.className = "chip";
      chip.textContent = tag;
      chips.append(chip);
    }

    card.append(header, chips);
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
  initializeTeamConfigControls();
  renderTeamAdmin();
  renderPlayerConfig();
  renderBuilder();
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
    void handleAuthSubmit("/auth/register", "register").catch((error) => {
      setAuthFeedback(normalizeApiErrorMessage(error, "Registration failed."));
      renderAuth();
    });
  });

  elements.authLogin.addEventListener("click", () => {
    void handleAuthSubmit("/auth/login", "login").catch((error) => {
      setAuthFeedback(normalizeApiErrorMessage(error, "Login failed."));
      renderAuth();
    });
  });

  elements.authLogout.addEventListener("click", () => {
    clearAuthSession("");
    clearApiPoolState();
    state.api.teams = [];
    state.api.membersByTeamId = {};
    state.api.selectedTeamId = "";
    initializeTeamConfigControls();
    renderTeamAdmin();
    renderPlayerConfig();
    setProfileRolesFeedback("Sign in to manage profile roles.");
    renderBuilder();
    renderAuth();
  });

  elements.navToggle.addEventListener("click", () => {
    setNavOpen(!state.ui.isNavOpen);
  });
  elements.navOverlay.addEventListener("click", () => {
    setNavOpen(false);
  });
  runtimeWindow.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setNavOpen(false);
    }
  });
  runtimeWindow.addEventListener("resize", () => {
    syncNavLayout();
  });

  for (const button of elements.tabTriggers) {
    button.addEventListener("click", () => {
      if (!hasAuthSession()) {
        setAuthFeedback("Login required to access app screens.");
        return;
      }
      setTab(button.dataset.tab);
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

  elements.teamConfigDefaultTeam.addEventListener("change", () => {
    state.teamConfig.defaultTeamId = normalizeConfiguredTeamId(elements.teamConfigDefaultTeam.value);
    state.teamConfig.activeTeamId = state.teamConfig.defaultTeamId;
    state.builder.teamId = state.teamConfig.activeTeamId;
    setBuilderStage("setup");
    resetBuilderTreeState();
    syncSlotSelectOptions();
    saveTeamConfig();
    renderTeamConfig();
    renderBuilder();
  });

  elements.teamConfigActiveTeam.addEventListener("change", () => {
    state.teamConfig.activeTeamId = normalizeConfiguredTeamId(elements.teamConfigActiveTeam.value);
    state.builder.teamId = state.teamConfig.activeTeamId;
    setBuilderStage("setup");
    resetBuilderTreeState();
    syncSlotSelectOptions();
    saveTeamConfig();
    renderTeamConfig();
    renderBuilder();
    clearBuilderFeedback();
  });

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

  elements.profilePrimaryRole.addEventListener("change", () => {
    state.profile.primaryRole = normalizeProfileRole(elements.profilePrimaryRole.value);
    state.profile.secondaryRoles = normalizeSecondaryRoles(state.profile.secondaryRoles, state.profile.primaryRole);
    state.playerConfig.teamId = buildRolePoolTeamId(state.profile.primaryRole);
    renderPlayerConfig();
  });

  elements.profileSaveRoles.addEventListener("click", () => {
    if (!isAuthenticated()) {
      setProfileRolesFeedback("Sign in to save profile roles.", true);
      return;
    }
    if (!SLOTS.includes(state.profile.primaryRole)) {
      setProfileRolesFeedback("Primary role is required.", true);
      return;
    }

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
        setProfileRolesFeedback("Saved profile roles.");
        await hydrateAuthenticatedViews(state.playerConfig.teamId, state.api.selectedTeamId);
      })
      .catch((error) => {
        setProfileRolesFeedback(normalizeApiErrorMessage(error, "Failed to save profile roles."), true);
      });
  });

  elements.teamAdminTeamSelect.addEventListener("change", () => {
    state.api.selectedTeamId = elements.teamAdminTeamSelect.value;
    void loadTeamMembersForSelectedTeam().then(() => {
      renderTeamAdmin();
    });
  });

  elements.teamAdminCreate.addEventListener("click", () => {
    if (!isAuthenticated()) {
      setTeamAdminFeedback("Sign in to create teams.");
      return;
    }
    const name = elements.teamAdminCreateName.value.trim();
    if (!name) {
      setTeamAdminFeedback("Enter a team name.");
      return;
    }

    void apiRequest("/teams", {
      method: "POST",
      auth: true,
      body: { name }
    })
      .then(async (payload) => {
        elements.teamAdminCreateName.value = "";
        const teamId = payload?.team?.id;
        setTeamAdminFeedback(`Created team '${payload?.team?.name ?? name}'.`);
        await hydrateAuthenticatedViews(state.playerConfig.teamId, teamId);
      })
      .catch((error) => {
        setTeamAdminFeedback(normalizeApiErrorMessage(error, "Failed to create team."));
      });
  });

  if (elements.settingsTeamCreate && elements.settingsTeamCreateName) {
    elements.settingsTeamCreate.addEventListener("click", () => {
      if (!isAuthenticated()) {
        setSettingsTeamFeedback("Sign in to create teams.");
        return;
      }
      const name = elements.settingsTeamCreateName.value.trim();
      if (!name) {
        setSettingsTeamFeedback("Enter a team name.");
        return;
      }

      void apiRequest("/teams", {
        method: "POST",
        auth: true,
        body: { name }
      })
        .then(async (payload) => {
          elements.settingsTeamCreateName.value = "";
          const teamId = payload?.team?.id;
          const message = `Created team '${payload?.team?.name ?? name}'.`;
          setSettingsTeamFeedback(message);
          setTeamAdminFeedback(message);
          await hydrateAuthenticatedViews(state.playerConfig.teamId, teamId);
        })
        .catch((error) => {
          setSettingsTeamFeedback(normalizeApiErrorMessage(error, "Failed to create team."));
        });
    });
  }

  elements.teamAdminRename.addEventListener("click", () => {
    const selectedTeam = getSelectedAdminTeam();
    if (!selectedTeam) {
      setTeamAdminFeedback("Select a team first.");
      return;
    }
    const name = elements.teamAdminRenameName.value.trim();
    if (!name) {
      setTeamAdminFeedback("Enter a team name.");
      return;
    }

    void apiRequest(`/teams/${selectedTeam.id}`, {
      method: "PATCH",
      auth: true,
      body: { name }
    })
      .then(async () => {
        setTeamAdminFeedback(`Renamed team to '${name}'.`);
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
    const userId = Number.parseInt(elements.teamAdminAddUserId.value, 10);
    if (!Number.isInteger(userId) || userId <= 0) {
      setTeamAdminFeedback("Enter a valid user id to add.");
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
      body: { user_id: userId, role, team_role: teamRole }
    })
      .then(async () => {
        elements.teamAdminAddUserId.value = "";
        setTeamAdminFeedback(`Added user ${userId} as ${role}/${teamRole}.`);
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
    const userId = Number.parseInt(elements.teamAdminRoleUserId.value, 10);
    if (!Number.isInteger(userId) || userId <= 0) {
      setTeamAdminFeedback("Enter a valid user id to update.");
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
        setTeamAdminFeedback(`Updated user ${userId} role to ${role}.`);
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
    const userId = Number.parseInt(elements.teamAdminTeamRoleUserId.value, 10);
    if (!Number.isInteger(userId) || userId <= 0) {
      setTeamAdminFeedback("Enter a valid user id to update.");
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
        setTeamAdminFeedback(`Updated user ${userId} team role to ${teamRole}.`);
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
    const userId = Number.parseInt(elements.teamAdminRemoveUserId.value, 10);
    if (!Number.isInteger(userId) || userId <= 0) {
      setTeamAdminFeedback("Enter a valid user id to remove.");
      return;
    }

    void apiRequest(`/teams/${selectedTeam.id}/members/${userId}`, {
      method: "DELETE",
      auth: true
    })
      .then(async () => {
        elements.teamAdminRemoveUserId.value = "";
        setTeamAdminFeedback(`Removed user ${userId} from team.`);
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
    syncNavLayout();
    setTab("workflow");
    loadStoredAuthSession();
    await loadMvpData();
    if (isAuthenticated()) {
      await loadProfileFromApi();
      await loadPoolsFromApi();
    } else {
      loadStoredPlayerConfig();
      setPoolApiFeedback("Sign in to manage API-backed pools.");
      setTeamAdminFeedback("Sign in to manage teams.");
      setProfileRolesFeedback("Sign in to manage profile roles.");
    }
    loadStoredTeamConfig();
    initializeExplorerControls();
    initializeBuilderControls();
    initializeTeamConfigControls();
    initializePlayerConfigControls();
    if (isAuthenticated()) {
      await loadTeamsFromApi();
    }
    resetBuilderToDefaults();

    attachEvents();
    syncSlotSelectOptions();
    renderTeamConfig();
    renderTeamAdmin();
    renderPlayerConfig();
    renderBuilder();
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
