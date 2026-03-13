import { ApiError, badRequest } from "../errors.js";

const DEFAULT_GITHUB_OWNER = "jmirving";
const DEFAULT_GITHUB_REPO = "DraftEngine";

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

function normalizeIssueType(value) {
  const normalized = normalizeOptionalString(value).toLowerCase();
  if (normalized === "feature_request" || normalized === "feature-request" || normalized === "feature request") {
    return "feature";
  }
  if (normalized === "bug" || normalized === "feature" || normalized === "task") {
    return normalized;
  }
  return "task";
}

function normalizeFallbackUrl({ fallbackUrl, owner, repo }) {
  const normalizedFallback = normalizeOptionalString(fallbackUrl);
  if (normalizedFallback) {
    return normalizedFallback;
  }
  return `https://github.com/${owner}/${repo}/issues/new/choose`;
}

function buildIssueBody({
  type,
  description,
  reporterEmail,
  reporterGameName,
  authenticatedEmail,
  sourceContext
}) {
  const sourceLines = [];
  if (sourceContext && typeof sourceContext === "object") {
    if (sourceContext.pageLabel || sourceContext.page) {
      sourceLines.push(`Source page: ${sourceContext.pageLabel || sourceContext.page}`);
    }
    if (sourceContext.tabLabel || sourceContext.tab) {
      sourceLines.push(`Source tab: ${sourceContext.tabLabel || sourceContext.tab}`);
    }
    if (sourceContext.detailLabel) {
      sourceLines.push(`Source detail: ${sourceContext.detailLabel}`);
    }
    if (sourceContext.routeHash) {
      sourceLines.push(`Source route: ${sourceContext.routeHash}`);
    }
  }

  const lines = [
    "Submitted from the DraftEngine in-app issue form.",
    "",
    `Type: ${type}`,
    `Reporter email: ${reporterEmail || "(not provided)"}`,
    `Reporter game name: ${reporterGameName || "(not provided)"}`,
    `Authenticated account email: ${authenticatedEmail || "(not provided)"}`,
    ...sourceLines,
    "",
    "Description:",
    description
  ];
  return lines.join("\n");
}

export function createDisabledIssueReporter({
  owner = DEFAULT_GITHUB_OWNER,
  repo = DEFAULT_GITHUB_REPO,
  fallbackUrl = ""
} = {}) {
  const normalizedOwner = normalizeOptionalString(owner) || DEFAULT_GITHUB_OWNER;
  const normalizedRepo = normalizeOptionalString(repo) || DEFAULT_GITHUB_REPO;
  const normalizedFallbackUrl = normalizeFallbackUrl({
    fallbackUrl,
    owner: normalizedOwner,
    repo: normalizedRepo
  });

  return {
    isEnabled() {
      return false;
    },
    getRepositoryLabel() {
      return `${normalizedOwner}/${normalizedRepo}`;
    },
    getFallbackUrl() {
      return normalizedFallbackUrl;
    },
    async submitIssue() {
      throw new ApiError(503, "ISSUE_REPORTING_DISABLED", "In-app issue reporting is not configured.");
    }
  };
}

export function createGitHubIssueReporter({
  token = "",
  owner = DEFAULT_GITHUB_OWNER,
  repo = DEFAULT_GITHUB_REPO,
  fallbackUrl = "",
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedToken = normalizeOptionalString(token);
  const normalizedOwner = normalizeOptionalString(owner) || DEFAULT_GITHUB_OWNER;
  const normalizedRepo = normalizeOptionalString(repo) || DEFAULT_GITHUB_REPO;
  const normalizedFallbackUrl = normalizeFallbackUrl({
    fallbackUrl,
    owner: normalizedOwner,
    repo: normalizedRepo
  });

  if (!normalizedToken || typeof fetchImpl !== "function") {
    return createDisabledIssueReporter({
      owner: normalizedOwner,
      repo: normalizedRepo,
      fallbackUrl: normalizedFallbackUrl
    });
  }

  return {
    isEnabled() {
      return true;
    },
    getRepositoryLabel() {
      return `${normalizedOwner}/${normalizedRepo}`;
    },
    getFallbackUrl() {
      return normalizedFallbackUrl;
    },
    async submitIssue({
      title,
      description,
      type,
      reporterEmail = "",
      reporterGameName = "",
      authenticatedEmail = "",
      sourceContext = null
    } = {}) {
      const normalizedTitle = normalizeOptionalString(title);
      const normalizedDescription = normalizeOptionalString(description);
      const normalizedReporterEmail = normalizeOptionalString(reporterEmail);
      const normalizedReporterGameName = normalizeOptionalString(reporterGameName);
      const normalizedAuthenticatedEmail = normalizeOptionalString(authenticatedEmail);

      if (!normalizedTitle) {
        throw badRequest("Expected 'title' to be a non-empty string.");
      }
      if (!normalizedDescription) {
        throw badRequest("Expected 'description' to be a non-empty string.");
      }
      if (!normalizedReporterEmail && !normalizedReporterGameName && !normalizedAuthenticatedEmail) {
        throw badRequest("Reporter email or game name is required.");
      }

      const normalizedType = normalizeIssueType(type);
      const response = await fetchImpl(`https://api.github.com/repos/${normalizedOwner}/${normalizedRepo}/issues`, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${normalizedToken}`,
          "Content-Type": "application/json",
          "User-Agent": "DraftEngine"
        },
        body: JSON.stringify({
          title: normalizedTitle,
          body: buildIssueBody({
            type: normalizedType,
            description: normalizedDescription,
            reporterEmail: normalizedReporterEmail,
            reporterGameName: normalizedReporterGameName,
            authenticatedEmail: normalizedAuthenticatedEmail,
            sourceContext
          })
        })
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch (_error) {
        payload = null;
      }

      if (!response.ok) {
        const providerMessage =
          typeof payload?.message === "string" && payload.message.trim() !== ""
            ? payload.message.trim()
            : "GitHub issue submission failed.";
        throw new ApiError(502, "ISSUE_REPORTING_FAILED", providerMessage);
      }

      return {
        number: Number(payload?.number),
        url: normalizeOptionalString(payload?.html_url),
        title: normalizeOptionalString(payload?.title) || normalizedTitle
      };
    }
  };
}
