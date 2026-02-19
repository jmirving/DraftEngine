import {
  BOOLEAN_TAGS,
  DAMAGE_TYPES,
  DEFAULT_REQUIREMENT_TOGGLES,
  SCALING_VALUES,
  SLOTS,
  buildDraftflowData,
  createEmptyTeamState,
  evaluateCompositionChecks,
  generatePossibilityTree,
  scoreNodeFromChecks,
  normalizeTeamState
} from "../../src/index.js";

const NO_FILTER = "__NO_FILTER__";
const NONE_TEAM_ID = "__NONE_TEAM__";
const TEAM_CONFIG_STORAGE_KEY = "draftflow.teamConfig.v1";
const PLAYER_CONFIG_STORAGE_KEY = "draftflow.playerConfig.v1";

const CHAMPION_IMAGE_OVERRIDES = Object.freeze({
  VelKoz: "Velkoz"
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
      "player-config": "Player Pools",
      explorer: "Champion Tags"
    }
  },
  panels: {
    explorerTitle: "Champion Tags",
    explorerMeta: "Filter champions by role, damage profile, scaling, and tags.",
    teamConfigTitle: "Team Draft Context",
    teamConfigMeta: "Set the team profile that drives role pools across composition work.",
    playerConfigTitle: "Player Pools",
    playerConfigMeta: "Tune each player's champion pool before running composition generation."
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

const state = {
  data: null,
  activeTab: "workflow",
  ui: {
    isNavOpen: false
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
    previewTeam: null,
    selectedNodeId: null,
    selectedNodeReasons: [],
    selectedNodeTitle: "Root Composition",
    compareNodeA: null,
    compareNodeB: null
  }
};

const elements = {
  navToggle: document.querySelector("#nav-toggle"),
  navDrawer: document.querySelector("#nav-drawer"),
  navOverlay: document.querySelector("#nav-overlay"),
  tabTriggers: Array.from(document.querySelectorAll("button[data-tab]")),
  sideMenuLinks: Array.from(document.querySelectorAll(".side-menu-link")),
  heroKicker: document.querySelector("#hero-kicker"),
  heroTitle: document.querySelector("#hero-title"),
  heroSubtitle: document.querySelector("#hero-subtitle"),
  navTitle: document.querySelector("#nav-title"),
  navMeta: document.querySelector("#nav-meta"),
  explorerTitle: document.querySelector("#explorer-title"),
  explorerMeta: document.querySelector("#explorer-meta"),
  teamConfigTitle: document.querySelector("#team-config-title"),
  teamConfigMeta: document.querySelector("#team-config-meta"),
  playerConfigTitle: document.querySelector("#player-config-title"),
  playerConfigMeta: document.querySelector("#player-config-meta"),
  tabExplorer: document.querySelector("#tab-explorer"),
  tabWorkflow: document.querySelector("#tab-workflow"),
  tabTeamConfig: document.querySelector("#tab-team-config"),
  tabPlayerConfig: document.querySelector("#tab-player-config"),
  explorerSearch: document.querySelector("#explorer-search"),
  explorerRole: document.querySelector("#explorer-role"),
  explorerDamage: document.querySelector("#explorer-damage"),
  explorerScaling: document.querySelector("#explorer-scaling"),
  explorerSort: document.querySelector("#explorer-sort"),
  explorerIncludeTags: document.querySelector("#explorer-include-tags"),
  explorerExcludeTags: document.querySelector("#explorer-exclude-tags"),
  explorerClearAll: document.querySelector("#explorer-clear-all"),
  explorerClearInclude: document.querySelector("#explorer-clear-include"),
  explorerClearExclude: document.querySelector("#explorer-clear-exclude"),
  explorerCount: document.querySelector("#explorer-count"),
  explorerResults: document.querySelector("#explorer-results"),
  builderWorkflowTitle: document.querySelector("#builder-workflow-title"),
  builderStageGuide: document.querySelector("#builder-stage-guide"),
  builderStageGuideMeta: document.querySelector("#builder-stage-guide-meta"),
  builderSetupFeedback: document.querySelector("#builder-setup-feedback"),
  builderInspectFeedback: document.querySelector("#builder-inspect-feedback"),
  builderActiveTeam: document.querySelector("#builder-active-team"),
  builderTeamHelp: document.querySelector("#builder-team-help"),
  builderStageSetupTitle: document.querySelector("#builder-stage-setup-title"),
  builderStageSetupMeta: document.querySelector("#builder-stage-setup-meta"),
  builderStageInspectTitle: document.querySelector("#builder-stage-inspect-title"),
  builderStageInspectMeta: document.querySelector("#builder-stage-inspect-meta"),
  builderChecksReadiness: document.querySelector("#builder-checks-readiness"),
  builderStageSetup: document.querySelector("#builder-stage-setup"),
  builderStageInspect: document.querySelector("#builder-stage-inspect"),
  builderAdvancedControls: document.querySelector("#builder-advanced-controls"),
  builderToggles: document.querySelector("#builder-toggles"),
  builderToggleOptionalChecks: document.querySelector("#builder-toggle-optional-checks"),
  builderExcludedSearch: document.querySelector("#builder-excluded-search"),
  builderExcludedOptions: document.querySelector("#builder-excluded-options"),
  builderExcludedPills: document.querySelector("#builder-excluded-pills"),
  builderMaxDepth: document.querySelector("#builder-max-depth"),
  builderMaxBranch: document.querySelector("#builder-max-branch"),
  builderContinueValidate: document.querySelector("#builder-continue-validate"),
  builderGenerate: document.querySelector("#builder-generate"),
  builderClear: document.querySelector("#builder-clear"),
  builderDraftOrder: document.querySelector("#builder-draft-order"),
  builderNextRoleReadout: document.querySelector("#builder-next-role-readout"),
  builderTeamContext: document.querySelector("#builder-team-context"),
  builderRequiredChecks: document.querySelector("#builder-required-checks"),
  builderOptionalChecks: document.querySelector("#builder-optional-checks"),
  builderMissingNeeds: document.querySelector("#builder-missing-needs"),
  builderTreeSummary: document.querySelector("#builder-tree-summary"),
  builderTree: document.querySelector("#builder-tree"),
  builderTreeMap: document.querySelector("#builder-tree-map"),
  treeDensity: document.querySelector("#tree-density"),
  treeSearch: document.querySelector("#tree-search"),
  treeMinScore: document.querySelector("#tree-min-score"),
  builderPreview: document.querySelector("#builder-preview"),
  treeExpandAll: document.querySelector("#tree-expand-all"),
  treeCollapseAll: document.querySelector("#tree-collapse-all"),
  teamConfigDefaultTeam: document.querySelector("#team-config-default-team"),
  teamConfigActiveTeam: document.querySelector("#team-config-active-team"),
  teamConfigDefaultHelp: document.querySelector("#team-config-default-help"),
  teamConfigActiveHelp: document.querySelector("#team-config-active-help"),
  teamConfigPoolSummary: document.querySelector("#team-config-pool-summary"),
  teamConfigPoolGrid: document.querySelector("#team-config-pool-grid"),
  playerConfigTeam: document.querySelector("#player-config-team"),
  playerConfigSummary: document.querySelector("#player-config-summary"),
  playerConfigFeedback: document.querySelector("#player-config-feedback"),
  playerConfigGrid: document.querySelector("#player-config-grid"),
  slotSelects: Object.fromEntries(
    SLOTS.map((slot) => [slot, document.querySelector(`#slot-${slot}`)])
  ),
  slotLabels: Object.fromEntries(
    SLOTS.map((slot) => [slot, document.querySelector(`#slot-label-${slot}`)])
  ),
  slotRows: Object.fromEntries(
    SLOTS.map((slot) => [slot, document.querySelector(`#slot-row-${slot}`)])
  ),
  slotOrderBadges: Object.fromEntries(
    SLOTS.map((slot) => [slot, document.querySelector(`#slot-order-${slot}`)])
  ),
  slotStatusBadges: Object.fromEntries(
    SLOTS.map((slot) => [slot, document.querySelector(`#slot-status-${slot}`)])
  )
};

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
  return window.matchMedia(COMPACT_NAV_MEDIA_QUERY).matches;
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
  document.body.classList.toggle("nav-open", showDrawer);
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
  state.builder.previewTeam = null;
  state.builder.selectedNodeId = null;
  state.builder.selectedNodeReasons = [];
  state.builder.selectedNodeTitle = "Root Composition";
  state.builder.compareNodeA = null;
  state.builder.compareNodeB = null;
}

function renderBuilderStageGuide() {
  const completion = getTeamCompletionInfo();
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
  const option = document.createElement("option");
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

function normalizeNoFilterMultiSelection(values) {
  let normalized = [...new Set(values)];
  if (normalized.includes(NO_FILTER) && normalized.length > 1) {
    normalized = normalized.filter((value) => value !== NO_FILTER);
  }
  return normalized.includes(NO_FILTER) ? [] : normalized;
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

  const shell = document.createElement("div");
  shell.className = "checkbox-multi";

  const details = document.createElement("details");
  details.className = "checkbox-multi-details";
  checkboxMultiDetailsRegistry.add(details);
  details.addEventListener("toggle", () => {
    shell.classList.toggle("is-open", details.open);
    syncDropdownPanelLayering(details, details.open);
    if (details.open) {
      closeCheckboxMultiDetails(details);
    }
  });

  const summary = document.createElement("summary");
  summary.className = "checkbox-multi-summary";
  const summaryText = document.createElement("span");
  summary.append(summaryText);
  details.append(summary);

  const panel = document.createElement("div");
  panel.className = "checkbox-multi-panel";

  let searchInput = null;
  if (searchable) {
    searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = searchPlaceholder;
    searchInput.className = "checkbox-multi-search";
    panel.append(searchInput);
  }

  const list = document.createElement("div");
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
      const empty = document.createElement("p");
      empty.className = "checkbox-multi-empty";
      empty.textContent = "No options match the current search.";
      list.append(empty);
      return;
    }

    for (const option of visibleOptions) {
      const label = document.createElement("label");
      label.className = "selection-option checkbox-multi-option";

      const checkbox = document.createElement("input");
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

      const text = document.createElement("span");
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
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (${response.status})`);
  }
  return response.text();
}

function createEmptyRolePools() {
  const pools = createEmptyTeamState();
  for (const slot of SLOTS) {
    pools[slot] = [];
  }
  return pools;
}

function buildNoneTeamPools(champions) {
  const pools = createEmptyRolePools();
  for (const champion of champions) {
    for (const role of champion.roles) {
      if (pools[role]) {
        pools[role].push(champion.name);
      }
    }
  }

  for (const slot of SLOTS) {
    pools[slot] = Array.from(new Set(pools[slot])).sort((left, right) => left.localeCompare(right));
  }
  return pools;
}

function compareSlots(left, right) {
  return SLOTS.indexOf(left) - SLOTS.indexOf(right);
}

function normalizePoolPlayerName(playerName, role) {
  const normalizedName = typeof playerName === "string" ? playerName.trim() : "";
  return normalizedName || `${role} Player`;
}

function buildPlayerPoolsByTeam(teamPoolEntries) {
  const byTeam = {};
  for (const entry of teamPoolEntries) {
    if (!byTeam[entry.team]) {
      byTeam[entry.team] = {};
    }

    const playerName = normalizePoolPlayerName(entry.player, entry.role);
    const playerKey = `${entry.role}::${playerName}`;
    if (!byTeam[entry.team][playerKey]) {
      byTeam[entry.team][playerKey] = {
        id: playerKey,
        player: playerName,
        role: entry.role,
        champions: []
      };
    }

    if (!byTeam[entry.team][playerKey].champions.includes(entry.champion)) {
      byTeam[entry.team][playerKey].champions.push(entry.champion);
    }
  }

  const normalized = {};
  for (const [teamId, playersByKey] of Object.entries(byTeam)) {
    const players = Object.values(playersByKey);
    for (const player of players) {
      player.champions.sort((left, right) => left.localeCompare(right));
    }
    players.sort((left, right) => {
      const roleCmp = compareSlots(left.role, right.role);
      if (roleCmp !== 0) {
        return roleCmp;
      }
      return left.player.localeCompare(right.player);
    });
    normalized[teamId] = players;
  }
  return normalized;
}

function clonePlayerPoolsByTeam(playerPoolsByTeam) {
  const clone = {};
  for (const [teamId, players] of Object.entries(playerPoolsByTeam)) {
    clone[teamId] = players.map((player) => ({
      id: player.id,
      player: player.player,
      role: player.role,
      champions: [...player.champions]
    }));
  }
  return clone;
}

function buildTeamPoolsFromPlayerPools(playerPoolsByTeam) {
  const poolsByTeam = {};
  for (const [teamId, players] of Object.entries(playerPoolsByTeam)) {
    const pools = createEmptyRolePools();
    for (const player of players) {
      const slot = player.role;
      for (const champion of player.champions) {
        if (!pools[slot].includes(champion)) {
          pools[slot].push(champion);
        }
      }
    }
    for (const slot of SLOTS) {
      pools[slot].sort((left, right) => left.localeCompare(right));
    }
    poolsByTeam[teamId] = pools;
  }
  return poolsByTeam;
}

function buildTeamPlayersByRoleFromPlayerPools(playerPoolsByTeam) {
  const mapping = {};
  for (const [teamId, players] of Object.entries(playerPoolsByTeam)) {
    mapping[teamId] = {};
    for (const player of players) {
      if (!mapping[teamId][player.role]) {
        mapping[teamId][player.role] = player.player;
      }
    }
  }
  return mapping;
}

async function loadMvpData() {
  const [championsCsvText, teamPoolsCsvText, configJsonText] = await Promise.all([
    fetchText("/public/data/champions.csv"),
    fetchText("/public/data/team_pools.csv"),
    fetchText("/public/data/config.json")
  ]);

  const loaded = buildDraftflowData({
    championsCsvText,
    teamPoolsCsvText,
    configJsonText
  });

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
    .sort((left, right) => left.localeCompare(right))
    .map((teamId) => ({ value: teamId, label: teamId }));
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
    const wrapper = document.createElement("label");
    wrapper.className = "toggle-item selection-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(state.builder.toggles[key]);
    checkbox.dataset.toggle = key;
    const title = document.createElement("span");
    title.textContent = key;
    wrapper.append(checkbox, title);
    elements.builderToggles.append(wrapper);
  }

  state.builder.maxDepth = state.data.config.treeDefaults.maxDepth;
  state.builder.maxBranch = state.data.config.treeDefaults.maxBranch;
  elements.builderMaxDepth.value = String(state.builder.maxDepth);
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
    : `Default team: ${state.teamConfig.defaultTeamId}.`;

  elements.teamConfigActiveHelp.textContent = state.teamConfig.activeTeamId === NONE_TEAM_ID
    ? "Active team: None (global role pools)."
    : `Active team: ${state.teamConfig.activeTeamId}.`;

  const pools = getPoolsForTeam(state.teamConfig.activeTeamId);
  const roleCounts = SLOTS.map((slot) => `${slot}: ${(pools[slot] ?? []).length}`);
  elements.teamConfigPoolSummary.textContent = `${state.teamConfig.activeTeamId === NONE_TEAM_ID ? "None" : state.teamConfig.activeTeamId} pool sizes -> ${roleCounts.join(" | ")}`;

  elements.teamConfigPoolGrid.innerHTML = "";
  for (const slot of SLOTS) {
    const card = document.createElement("article");
    card.className = "summary-card";

    const title = document.createElement("strong");
    title.textContent = slot;

    const count = document.createElement("p");
    count.className = "meta";
    const champions = [...(pools[slot] ?? [])].sort((left, right) => left.localeCompare(right));
    count.textContent = `${champions.length} champion${champions.length === 1 ? "" : "s"} in pool.`;

    const list = document.createElement("p");
    list.className = "meta";
    list.textContent = champions.length > 0 ? champions.join(", ") : "No champions configured.";

    card.append(title, count, list);
    elements.teamConfigPoolGrid.append(card);
  }
}

function initializeTeamConfigControls() {
  const options = getTeamSelectOptions();
  replaceOptions(elements.teamConfigDefaultTeam, options);
  replaceOptions(elements.teamConfigActiveTeam, options);
  renderTeamConfig();
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
  const teamIds = Object.keys(state.playerConfig.byTeam).sort((left, right) => left.localeCompare(right));
  return teamIds[0] ?? "";
}

function renderPlayerConfigFeedback(message, isError = false) {
  elements.playerConfigFeedback.textContent = message;
  elements.playerConfigFeedback.style.color = isError ? "var(--warn)" : "var(--muted)";
}

function renderPlayerConfig() {
  state.playerConfig.teamId = normalizePlayerConfigTeamId(state.playerConfig.teamId);
  const teamOptions = Object.keys(state.playerConfig.byTeam)
    .sort((left, right) => left.localeCompare(right))
    .map((teamId) => ({ value: teamId, label: teamId }));

  replaceOptions(elements.playerConfigTeam, teamOptions);
  elements.playerConfigTeam.value = state.playerConfig.teamId;

  const players = state.playerConfig.byTeam[state.playerConfig.teamId] ?? [];
  const summary = players.map((player) => `${player.role}: ${player.champions.length}`).join(" | ");
  elements.playerConfigSummary.textContent = summary
    ? `Pool sizes -> ${summary}`
    : "No players are configured for this team.";

  elements.playerConfigGrid.innerHTML = "";

  for (const player of players) {
    const card = document.createElement("article");
    card.className = "player-config-card";

    const title = document.createElement("h3");
    title.textContent = player.player;

    const roleMeta = document.createElement("p");
    roleMeta.className = "meta";
    roleMeta.textContent = `Role: ${player.role}`;

    const countMeta = document.createElement("p");
    countMeta.className = "meta";
    countMeta.textContent = `${player.champions.length} champion${player.champions.length === 1 ? "" : "s"} in pool.`;

    const label = document.createElement("label");
    label.textContent = "Champion Pool";

    const poolControlHost = document.createElement("div");
    poolControlHost.className = "player-pool-control";

    const roleEligible = state.data.noneTeamPools[player.role] ?? [];
    createCheckboxMultiControl({
      root: poolControlHost,
      options: roleEligible.map((championName) => ({
        value: championName,
        label: championName
      })),
      selectedValues: player.champions,
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
        player.champions = Array.from(new Set(selectedValues)).sort((left, right) => left.localeCompare(right));
        syncDerivedTeamDataFromPlayerConfig();
        const saved = savePlayerConfig();
        state.teamConfig.defaultTeamId = normalizeConfiguredTeamId(state.teamConfig.defaultTeamId);
        state.teamConfig.activeTeamId = normalizeConfiguredTeamId(state.teamConfig.activeTeamId);
        state.builder.teamId = normalizeConfiguredTeamId(state.builder.teamId);
        setBuilderStage("setup");
        resetBuilderTreeState();
        syncSlotSelectOptions();
        renderTeamConfig();
        renderBuilder();
        renderPlayerConfig();
        renderPlayerConfigFeedback(
          saved ? `Saved pool updates for ${player.player}.` : "Pool updates applied in memory, but local storage is unavailable.",
          !saved
        );
      }
    });

    label.append(poolControlHost);
    card.append(title, roleMeta, countMeta, label);
    elements.playerConfigGrid.append(card);
  }
}

function initializePlayerConfigControls() {
  renderPlayerConfig();
  renderPlayerConfigFeedback("");
}

function tryReadJsonStorage(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
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
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
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

  const rawDepth = Number.parseInt(String(state.data.config.treeDefaults.maxDepth), 10);
  const rawBranch = Number.parseInt(String(state.data.config.treeDefaults.maxBranch), 10);
  state.builder.maxDepth = Number.isFinite(rawDepth) ? Math.max(1, rawDepth) : 4;
  state.builder.maxBranch = Number.isFinite(rawBranch) ? Math.max(1, rawBranch) : 8;

  resetBuilderTreeState();
  state.builder.treeDensity = BUILDER_DEFAULTS.defaultTreeDensity;
  setBuilderStage("setup");

  elements.builderMaxDepth.value = String(state.builder.maxDepth);
  elements.builderMaxBranch.value = String(state.builder.maxBranch);
  elements.builderExcludedSearch.value = "";
  elements.treeSearch.value = "";
  elements.treeMinScore.value = "0";
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
    const empty = document.createElement("p");
    empty.className = "meta";
    empty.textContent = "No champions match these filters.";
    elements.explorerResults.append(empty);
    return;
  }

  for (const champion of sorted) {
    const card = document.createElement("article");
    card.className = "champ-card";

    const header = document.createElement("div");
    header.className = "champ-header";
    const image = document.createElement("img");
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

    const heading = document.createElement("div");
    const name = document.createElement("p");
    name.className = "champ-name";
    name.textContent = champion.name;

    const summary = document.createElement("p");
    summary.className = "meta";
    summary.textContent = `${champion.roles.join(" / ")} | ${champion.damageType} | ${champion.scaling}`;

    heading.append(name, summary);
    header.append(image, heading);

    const chips = document.createElement("div");
    chips.className = "chip-row";
    const activeTags = BOOLEAN_TAGS.filter((tag) => champion.tags[tag]);
    for (const tag of activeTags) {
      const chip = document.createElement("span");
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
    const chip = document.createElement("span");
    chip.className = "context-chip";
    chip.textContent = `${getSlotLabel(slot)}: ${state.builder.teamState[slot] ?? "Empty"}`;
    elements.builderTeamContext.append(chip);
  }
}

function getTeamCompletionInfo() {
  const filledSlots = SLOTS.filter((slot) => Boolean(state.builder.teamState[slot])).length;
  if (filledSlots === 0) {
    return { filledSlots, totalSlots: SLOTS.length, completionState: "empty" };
  }
  if (filledSlots === SLOTS.length) {
    return { filledSlots, totalSlots: SLOTS.length, completionState: "full" };
  }
  return { filledSlots, totalSlots: SLOTS.length, completionState: "partial" };
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

  const item = document.createElement("li");
  item.className = `check ${required ? "is-required" : "is-optional"} ${passed ? "is-passed" : "is-failed"}`;

  const titleRow = document.createElement("div");
  titleRow.className = "check-title-row";

  const title = document.createElement("strong");
  title.textContent = humanizeCheckName(checkName);

  const badgeRow = document.createElement("div");
  badgeRow.className = "check-badges";

  const requirementBadge = document.createElement("span");
  requirementBadge.className = `check-badge ${required ? "is-required" : "is-optional"}`;
  requirementBadge.textContent = requirementLabel;

  const stateBadge = document.createElement("span");
  stateBadge.className = `check-badge ${passed ? "is-passed" : "is-failed"}`;
  stateBadge.textContent = stateLabel;

  badgeRow.append(requirementBadge, stateBadge);
  titleRow.append(title, badgeRow);

  const detail = document.createElement("div");
  detail.className = "meta";
  detail.textContent = result.reason;

  item.append(titleRow, detail);

  if (required && !passed) {
    const hint = document.createElement("p");
    hint.className = "check-hint";
    hint.textContent = `How to satisfy: ${getCheckRemediationHint(checkName, result, checkEvaluation)}`;
    item.append(hint);
  }

  return item;
}

function renderChecks() {
  const completion = getTeamCompletionInfo();
  if (completion.completionState === "empty") {
    elements.builderChecksReadiness.textContent = "No champions selected yet. Add at least one pick to start requirement evaluation.";
    elements.builderRequiredChecks.innerHTML = "";
    elements.builderOptionalChecks.innerHTML = "";
    elements.builderOptionalChecks.hidden = true;
    elements.builderToggleOptionalChecks.textContent = "Optional checks available after picks";
    elements.builderToggleOptionalChecks.disabled = true;

    const requiredRow = document.createElement("li");
    requiredRow.className = "check is-optional";
    requiredRow.textContent = "Readiness checks are waiting for your first champion selection.";
    elements.builderRequiredChecks.append(requiredRow);

    elements.builderMissingNeeds.innerHTML = "";
    const missingRow = document.createElement("li");
    missingRow.textContent = "No missing-need warnings yet (composition is empty).";
    elements.builderMissingNeeds.append(missingRow);
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

  const missing = [];
  for (const tag of checkEvaluation.missingNeeds.tags) {
    missing.push(tag);
  }
  if (checkEvaluation.missingNeeds.needsAD) {
    missing.push("Need AD damage source");
  }
  if (checkEvaluation.missingNeeds.needsAP) {
    missing.push("Need AP damage source");
  }
  if (checkEvaluation.missingNeeds.needsTopThreat) {
    missing.push("Top must provide SideLaneThreat or DiveThreat");
  }

  elements.builderMissingNeeds.innerHTML = "";
  if (missing.length === 0) {
    const row = document.createElement("li");
    row.textContent = "No required needs missing.";
    elements.builderMissingNeeds.append(row);
  } else {
    for (const need of missing) {
      const row = document.createElement("li");
      row.textContent = need;
      elements.builderMissingNeeds.append(row);
    }
  }
}

function teamStateKey(teamSlots) {
  return SLOTS.map((slot) => teamSlots[slot] ?? "-").join("|");
}

function renderExcludedPills() {
  elements.builderExcludedPills.innerHTML = "";
  if (state.builder.excludedChampions.length === 0) {
    const empty = document.createElement("span");
    empty.className = "meta";
    empty.textContent = "No excluded champions selected.";
    elements.builderExcludedPills.append(empty);
    return;
  }

  const sorted = [...state.builder.excludedChampions].sort((left, right) => left.localeCompare(right));
  for (const championName of sorted) {
    const pill = document.createElement("span");
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
    const empty = document.createElement("p");
    empty.className = "meta";
    empty.textContent = "No champions match the current search.";
    elements.builderExcludedOptions.append(empty);
    return;
  }

  for (const championName of filtered) {
    const label = document.createElement("label");
    label.className = "excluded-option selection-option";

    const checkbox = document.createElement("input");
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

    const text = document.createElement("span");
    text.textContent = championName;

    label.append(checkbox, text);
    elements.builderExcludedOptions.append(label);
  }
}

function getActiveNextRole() {
  return state.builder.draftOrder.find((slot) => !state.builder.teamState[slot]) ?? null;
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

  const activeNextRole = getActiveNextRole();
  if (activeNextRole) {
    elements.builderNextRoleReadout.textContent = `Next expansion role: ${getSlotLabel(activeNextRole)}`;
  } else {
    elements.builderNextRoleReadout.textContent = "All roles are already filled.";
  }

  for (const role of state.builder.draftOrder) {
    const item = document.createElement("li");
    item.className = "draft-order-item";
    if (state.builder.teamState[role]) {
      item.classList.add("is-filled");
    }
    item.draggable = true;
    item.dataset.role = role;

    const title = document.createElement("span");
    title.textContent = state.builder.teamState[role]
      ? `${getSlotLabel(role)} - filled (${state.builder.teamState[role]})`
      : `${getSlotLabel(role)} - pending`;

    const handle = document.createElement("span");
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

function getParentNodeId(nodeId = "0") {
  if (nodeId === "0") {
    return null;
  }
  const parts = nodeId.split(".");
  parts.pop();
  return parts.join(".") || "0";
}

function renderComparePanel(target) {
  const compareSection = document.createElement("div");
  compareSection.className = "compare-panel";

  const heading = document.createElement("h4");
  heading.textContent = "Compare Nodes";
  compareSection.append(heading);

  const summary = document.createElement("p");
  summary.className = "meta";
  const titleA = state.builder.compareNodeA?.title ?? "Not set";
  const titleB = state.builder.compareNodeB?.title ?? "Not set";
  summary.textContent = `A: ${titleA} | B: ${titleB}`;
  compareSection.append(summary);

  if (state.builder.compareNodeA && state.builder.compareNodeB) {
    const scoreLine = document.createElement("p");
    scoreLine.className = "meta";
    const delta = state.builder.compareNodeB.score - state.builder.compareNodeA.score;
    const sign = delta >= 0 ? "+" : "";
    scoreLine.textContent = `Score delta (B - A): ${sign}${delta}`;
    compareSection.append(scoreLine);

    const list = document.createElement("ul");
    list.className = "missing-list";
    for (const slot of SLOTS) {
      const a = state.builder.compareNodeA.teamSlots[slot] ?? "Empty";
      const b = state.builder.compareNodeB.teamSlots[slot] ?? "Empty";
      const row = document.createElement("li");
      row.textContent = `${getSlotLabel(slot)}: A=${a} | B=${b}${a === b ? "" : " (different)"}`;
      list.append(row);
    }
    compareSection.append(list);
  }

  target.append(compareSection);
}

function renderPreview() {
  elements.builderPreview.innerHTML = "";

  if (!state.builder.previewTeam || !state.builder.selectedNodeId) {
    elements.builderPreview.textContent = "No node selected. Inspect a node in the summary, outline, or tree map.";
    return;
  }

  const wrapper = document.createElement("div");
  const selectedNode = getNodeById(state.builder.selectedNodeId);
  const parentNodeId = getParentNodeId(state.builder.selectedNodeId);
  const parentNode = parentNodeId ? getNodeById(parentNodeId) : null;
  const selectedScore = selectedNode?.score ?? 0;
  const scoreDelta = parentNode ? selectedScore - parentNode.score : 0;
  const deltaSign = scoreDelta >= 0 ? "+" : "";

  const summary = document.createElement("p");
  summary.className = "meta";
  summary.textContent = `Inspecting ${state.builder.selectedNodeTitle}. Score ${selectedScore} (${deltaSign}${scoreDelta} vs parent).`;
  wrapper.append(summary);

  const impactHeading = document.createElement("p");
  impactHeading.className = "meta";
  impactHeading.textContent = "Slot-level impact:";
  wrapper.append(impactHeading);

  const impactList = document.createElement("ul");
  impactList.className = "missing-list";
  let changedCount = 0;
  for (const slot of SLOTS) {
    const before = state.builder.teamState[slot] ?? "Empty";
    const after = state.builder.previewTeam[slot] ?? "Empty";
    if (before !== after) {
      changedCount += 1;
    }
    const row = document.createElement("li");
    row.textContent = `${getSlotLabel(slot)}: ${before} -> ${after}${before === after ? " (no change)" : ""}`;
    impactList.append(row);
  }
  wrapper.append(impactList);

  const impactSummary = document.createElement("p");
  impactSummary.className = "meta";
  impactSummary.textContent =
    changedCount > 0
      ? `Applying this node changes ${changedCount} slot${changedCount === 1 ? "" : "s"}.`
      : "This node matches the current composition state.";
  wrapper.append(impactSummary);

  if (state.builder.selectedNodeReasons.length > 0) {
    const reasonsHeading = document.createElement("p");
    reasonsHeading.className = "meta";
    reasonsHeading.textContent = "Cumulative score reasons:";
    wrapper.append(reasonsHeading);

    const reasonList = document.createElement("ul");
    reasonList.className = "reason-list";
    for (const reason of state.builder.selectedNodeReasons) {
      const item = document.createElement("li");
      item.textContent = reason;
      reasonList.append(item);
    }
    wrapper.append(reasonList);
  }

  const compareButtons = document.createElement("div");
  compareButtons.className = "button-row";

  const setCompareA = document.createElement("button");
  setCompareA.type = "button";
  setCompareA.className = "ghost";
  setCompareA.textContent = "Set Compare A";
  setCompareA.addEventListener("click", () => {
    state.builder.compareNodeA = {
      nodeId: state.builder.selectedNodeId,
      title: state.builder.selectedNodeTitle,
      teamSlots: normalizeTeamState(state.builder.previewTeam),
      score: selectedScore
    };
    renderPreview();
  });

  const setCompareB = document.createElement("button");
  setCompareB.type = "button";
  setCompareB.className = "ghost";
  setCompareB.textContent = "Set Compare B";
  setCompareB.addEventListener("click", () => {
    state.builder.compareNodeB = {
      nodeId: state.builder.selectedNodeId,
      title: state.builder.selectedNodeTitle,
      teamSlots: normalizeTeamState(state.builder.previewTeam),
      score: selectedScore
    };
    renderPreview();
  });

  const clearCompare = document.createElement("button");
  clearCompare.type = "button";
  clearCompare.className = "ghost";
  clearCompare.textContent = "Clear Compare";
  clearCompare.addEventListener("click", () => {
    state.builder.compareNodeA = null;
    state.builder.compareNodeB = null;
    renderPreview();
  });

  compareButtons.append(setCompareA, setCompareB, clearCompare);
  wrapper.append(compareButtons);

  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.textContent = "Apply Node";
  applyButton.addEventListener("click", () => {
    state.builder.teamState = normalizeTeamState(state.builder.previewTeam);
    resetBuilderTreeState();
    setBuilderStage("setup");
    syncSlotSelectOptions();
    clearBuilderFeedback();
    renderBuilder();
  });
  wrapper.append(applyButton);

  renderComparePanel(wrapper);
  elements.builderPreview.append(wrapper);
}

function inspectNode(node, nodeId, nodeTitle) {
  setBuilderStage("inspect");
  state.builder.previewTeam = normalizeTeamState(node.teamSlots);
  state.builder.selectedNodeId = nodeId;
  state.builder.selectedNodeReasons = [...(node.pathRationale ?? [])];
  state.builder.selectedNodeTitle = nodeTitle;
  renderTree();
  renderPreview();
  renderTreeMap();
}

function nodeMatchesTreeSearch(node) {
  const query = state.builder.treeSearch.trim().toLowerCase();
  if (!query) {
    return true;
  }

  const parts = [
    node.addedRole ?? "",
    node.addedChampion ?? "",
    ...SLOTS.map((slot) => node.teamSlots[slot] ?? "")
  ];
  return parts.join(" ").toLowerCase().includes(query);
}

function nodePassesTreeFilters(node) {
  return node.score >= state.builder.treeMinScore && nodeMatchesTreeSearch(node);
}

function collectVisibleNodeIds(node, nodeId = "0", acc = new Set()) {
  let hasVisibleChild = false;
  for (let index = 0; index < node.children.length; index += 1) {
    const childVisible = collectVisibleNodeIds(node.children[index], `${nodeId}.${index}`, acc);
    hasVisibleChild = hasVisibleChild || childVisible;
  }

  const selfVisible = nodePassesTreeFilters(node);
  const visible = nodeId === "0" || selfVisible || hasVisibleChild;
  if (visible) {
    acc.add(nodeId);
  }
  return visible;
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

function renderTreeNode(node, depth = 0, nodeId = "0", visibleIds = null) {
  if (visibleIds && !visibleIds.has(nodeId)) {
    return null;
  }

  const details = document.createElement("details");
  details.open = depth <= 1;

  const summary = document.createElement("summary");
  const nodeBox = document.createElement("div");
  nodeBox.className = "node";
  if (!nodePassesTreeFilters(node)) {
    nodeBox.classList.add("is-context");
  }

  if (state.builder.selectedNodeId === nodeId) {
    nodeBox.classList.add("is-selected");
  }

  const titleRow = document.createElement("div");
  titleRow.className = "node-title";
  const title = document.createElement("strong");
  const titleText = node.addedChampion
    ? `${node.addedRole}: ${node.addedChampion}`
    : "Root Composition";
  title.textContent = titleText;
  const score = document.createElement("small");
  score.textContent = `Composition score: ${node.score}`;
  titleRow.append(title, score);

  const action = document.createElement("button");
  action.type = "button";
  action.textContent = "Inspect";
  action.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    inspectNode(node, nodeId, titleText);
  });

  const compareAAction = document.createElement("button");
  compareAAction.type = "button";
  compareAAction.className = "ghost";
  compareAAction.textContent = "A";
  compareAAction.title = "Set Compare A";
  compareAAction.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    state.builder.compareNodeA = {
      nodeId,
      title: titleText,
      teamSlots: normalizeTeamState(node.teamSlots),
      score: node.score
    };
    renderPreview();
  });

  const compareBAction = document.createElement("button");
  compareBAction.type = "button";
  compareBAction.className = "ghost";
  compareBAction.textContent = "B";
  compareBAction.title = "Set Compare B";
  compareBAction.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    state.builder.compareNodeB = {
      nodeId,
      title: titleText,
      teamSlots: normalizeTeamState(node.teamSlots),
      score: node.score
    };
    renderPreview();
  });

  const actionRow = document.createElement("div");
  actionRow.className = "button-row";
  actionRow.append(action, compareAAction, compareBAction);

  nodeBox.append(titleRow, actionRow);

  if (Array.isArray(node.pathRationale) && node.pathRationale.length > 0) {
    const rationale = document.createElement("div");
    rationale.className = "chip-row";
    const reasonsToShow = node.pathRationale.slice(-4);
    for (const reason of reasonsToShow) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = reason;
      rationale.append(chip);
    }
    if (node.pathRationale.length > reasonsToShow.length) {
      const more = document.createElement("span");
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

function renderTreeSummary(visibleIds) {
  elements.builderTreeSummary.innerHTML = "";
  if (!state.builder.tree) {
    return;
  }

  const root = state.builder.tree;
  const flat = flattenTreeForMap(root).filter((entry) => visibleIds.has(entry.id));
  const maxDepth = Math.max(...flat.map((entry) => entry.depth));
  const summaryMeta = document.createElement("p");
  summaryMeta.className = "meta";
  summaryMeta.textContent = `${flat.length} visible node(s), depth ${maxDepth}.`;
  elements.builderTreeSummary.append(summaryMeta);

  const topHeading = document.createElement("p");
  topHeading.className = "meta";
  topHeading.textContent = "Top branches from root:";
  elements.builderTreeSummary.append(topHeading);

  const list = document.createElement("div");
  list.className = "summary-card-list";
  const topBranches = root.children
    .map((node, index) => ({
      node,
      id: `0.${index}`,
      title: `${node.addedRole}: ${node.addedChampion}`
    }))
    .filter((entry) => visibleIds.has(entry.id))
    .slice(0, 8);

  if (topBranches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "meta";
    empty.textContent = "No root branches match current filters.";
    elements.builderTreeSummary.append(empty);
    return;
  }

  for (const entry of topBranches) {
    const card = document.createElement("article");
    card.className = "summary-card";

    const title = document.createElement("strong");
    title.textContent = entry.title;

    const score = document.createElement("p");
    score.className = "meta";
    score.textContent = `Composition score ${entry.node.score}, candidate score ${entry.node.candidateScore ?? 0}.`;

    const actions = document.createElement("div");
    actions.className = "button-row";
    const inspect = document.createElement("button");
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
    const empty = document.createElement("p");
    empty.className = "meta";
    empty.textContent = "Generate a tree to see ranked next composition additions.";
    elements.builderTree.append(empty);
    return;
  }

  const visibleIds = new Set();
  collectVisibleNodeIds(state.builder.tree, "0", visibleIds);

  if (state.builder.treeDensity === "summary") {
    renderTreeSummary(visibleIds);
    const summaryNotice = document.createElement("p");
    summaryNotice.className = "meta";
    summaryNotice.textContent = "Summary mode is active. Switch to Detailed for the full outline.";
    elements.builderTree.append(summaryNotice);
    return;
  }

  const rendered = renderTreeNode(state.builder.tree, 0, "0", visibleIds);
  if (!rendered) {
    const empty = document.createElement("p");
    empty.className = "meta";
    empty.textContent = "No nodes match current filters.";
    elements.builderTree.append(empty);
    return;
  }
  elements.builderTree.append(rendered);
}

function flattenTreeForMap(node, nodeId = "0", depth = 0, parentId = null, acc = []) {
  acc.push({
    id: nodeId,
    parentId,
    depth,
    node
  });

  for (let index = 0; index < node.children.length; index += 1) {
    flattenTreeForMap(node.children[index], `${nodeId}.${index}`, depth + 1, nodeId, acc);
  }
  return acc;
}

function renderTreeMap() {
  elements.builderTreeMap.innerHTML = "";
  if (!state.builder.tree) {
    return;
  }

  const visibleIds = new Set();
  collectVisibleNodeIds(state.builder.tree, "0", visibleIds);
  const flat = flattenTreeForMap(state.builder.tree).filter((entry) => visibleIds.has(entry.id));
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
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
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
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    let circleClass = "tree-map-node";
    if (nodePassesTreeFilters(entry.node)) {
      circleClass += " is-match";
    }
    circle.setAttribute("cx", String(point.x));
    circle.setAttribute("cy", String(point.y));
    circle.setAttribute("r", entry.id === state.builder.selectedNodeId ? "7" : "5");
    if (entry.id === state.builder.selectedNodeId) {
      circleClass += " is-selected";
    }
    circle.setAttribute("class", circleClass);
    circle.setAttribute(
      "aria-label",
      entry.node.addedChampion ? `${entry.node.addedRole} ${entry.node.addedChampion}` : "Root Composition"
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
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    const x = depthMax > 0 ? xPadding + depth * colWidth : width / 2;
    label.setAttribute("x", String(x - 18));
    label.setAttribute("y", "16");
    label.setAttribute("class", "tree-map-label");
    label.textContent = `D${depth}`;
    elements.builderTreeMap.append(label);
  }
}

function renderBuilder() {
  renderBuilderStageGuide();
  elements.builderActiveTeam.value = state.builder.teamId;
  elements.treeDensity.value = state.builder.treeDensity;
  elements.treeSearch.value = state.builder.treeSearch;
  elements.treeMinScore.value = String(state.builder.treeMinScore);
  elements.treeDensity.disabled = !state.builder.tree;
  elements.treeSearch.disabled = !state.builder.tree;
  elements.treeMinScore.disabled = !state.builder.tree;
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
  renderPreview();
}

function validateAndApplySlotSelection(slot, championName) {
  if (!championName) {
    state.builder.teamState[slot] = null;
    return true;
  }

  const pools = getEffectiveRolePools();
  if (!pools[slot]?.includes(championName)) {
    setSetupFeedback(`${championName} is not in ${slot}'s allowed pool.`);
    return false;
  }
  if (state.builder.excludedChampions.includes(championName)) {
    setSetupFeedback(`${championName} is excluded and cannot be selected.`);
    return false;
  }
  if (isChampionInOtherSlot(slot, championName)) {
    setSetupFeedback(`${championName} is already selected in another slot.`);
    return false;
  }

  setSetupFeedback("");
  state.builder.teamState[slot] = championName;
  return true;
}

function syncTagMutualExclusion(changed, includeValuesInput, excludeValuesInput) {
  let includeValues = [...includeValuesInput];
  let excludeValues = [...excludeValuesInput];

  const overlap = includeValues.filter((tag) => excludeValues.includes(tag));
  if (overlap.length > 0) {
    if (changed === "include") {
      excludeValues = excludeValues.filter((tag) => !overlap.includes(tag));
      multiSelectControls.explorerExcludeTags?.setSelected(excludeValues);
    } else {
      includeValues = includeValues.filter((tag) => !overlap.includes(tag));
      multiSelectControls.explorerIncludeTags?.setSelected(includeValues);
    }
  }

  state.explorer.includeTags = includeValues;
  state.explorer.excludeTags = excludeValues;
}

function attachEvents() {
  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) {
      closeCheckboxMultiDetails();
      return;
    }
    if (target.closest(".checkbox-multi")) {
      return;
    }
    closeCheckboxMultiDetails();
  });

  elements.navToggle.addEventListener("click", () => {
    setNavOpen(!state.ui.isNavOpen);
  });
  elements.navOverlay.addEventListener("click", () => {
    setNavOpen(false);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setNavOpen(false);
    }
  });
  window.addEventListener("resize", () => {
    syncNavLayout();
  });

  for (const button of elements.tabTriggers) {
    button.addEventListener("click", () => setTab(button.dataset.tab));
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

  elements.builderToggles.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
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

  elements.builderMaxDepth.addEventListener("change", () => {
    state.builder.maxDepth = Math.max(1, Number.parseInt(elements.builderMaxDepth.value, 10) || 1);
    elements.builderMaxDepth.value = String(state.builder.maxDepth);
    setBuilderStage("setup");
    resetBuilderTreeState();
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
    const completion = getTeamCompletionInfo();
    if (completion.completionState === "empty") {
      setSetupFeedback("Select at least one champion before opening Review.");
      return;
    }
    setBuilderStage("inspect");
    setSetupFeedback("");
    setInspectFeedback("");
    renderBuilder();
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

    try {
      setInspectFeedback("");
      const { teamId, teamPools } = getEnginePoolContext();
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
        maxBranch: state.builder.maxBranch
      });
      state.builder.previewTeam = null;
      state.builder.selectedNodeId = null;
      state.builder.selectedNodeReasons = [];
      state.builder.selectedNodeTitle = "Root Composition";
      state.builder.compareNodeA = null;
      state.builder.compareNodeB = null;
      setBuilderStage("inspect");
      renderBuilder();
    } catch (error) {
      setInspectFeedback(error instanceof Error ? error.message : "Failed to generate tree.");
    }
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
    const saved = savePlayerConfig();
    renderPlayerConfig();
    renderPlayerConfigFeedback(
      saved ? "" : "Player-config team selection changed in memory, but local storage is unavailable.",
      !saved
    );
  });
}

async function init() {
  try {
    applyUiCopy();
    syncNavLayout();
    setTab("workflow");
    await loadMvpData();
    loadStoredPlayerConfig();
    loadStoredTeamConfig();
    initializeExplorerControls();
    initializeBuilderControls();
    initializeTeamConfigControls();
    initializePlayerConfigControls();
    resetBuilderToDefaults();

    attachEvents();
    syncSlotSelectOptions();
    renderTeamConfig();
    renderPlayerConfig();
    renderBuilder();
    clearBuilderFeedback();
  } catch (error) {
    setSetupFeedback(error instanceof Error ? error.message : "Failed to initialize app.");
  }
}

init();
