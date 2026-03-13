import { Router } from "express";

import { ApiError, badRequest } from "../errors.js";
import { requireObject, requireNonEmptyString } from "../http/validation.js";

const ISSUE_TYPES = new Set(["bug", "feature", "task"]);

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

function parseIssueType(value) {
  const normalized = normalizeOptionalString(value).toLowerCase();
  if (normalized === "feature_request" || normalized === "feature-request" || normalized === "feature request") {
    return "feature";
  }
  if (!ISSUE_TYPES.has(normalized)) {
    throw badRequest("Expected 'type' to be one of: bug, feature, task.");
  }
  return normalized;
}

function parseIssueSourceContext(value) {
  if (value == null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("Expected 'sourceContext' to be an object when provided.");
  }
  const page = normalizeOptionalString(value.page);
  const pageLabel = normalizeOptionalString(value.pageLabel);
  const tab = normalizeOptionalString(value.tab);
  const tabLabel = normalizeOptionalString(value.tabLabel);
  const detailLabel = normalizeOptionalString(value.detailLabel);
  const routeHash = normalizeOptionalString(value.routeHash);

  if (!page && !pageLabel && !tab && !tabLabel && !detailLabel && !routeHash) {
    return null;
  }

  const sourceContext = {};
  if (page) {
    sourceContext.page = page;
  }
  if (pageLabel) {
    sourceContext.pageLabel = pageLabel;
  }
  if (tab) {
    sourceContext.tab = tab;
  }
  if (tabLabel) {
    sourceContext.tabLabel = tabLabel;
  }
  if (detailLabel) {
    sourceContext.detailLabel = detailLabel;
  }
  if (routeHash) {
    sourceContext.routeHash = routeHash;
  }

  return sourceContext;
}

export function createIssueReportingRouter({ issueReporter, optionalAuth = (_request, _response, next) => next() }) {
  const router = Router();
  const reporter = issueReporter;

  router.get("/issue-reporting", (_request, response) => {
    response.json({
      issueReporting: {
        enabled: reporter?.isEnabled?.() === true,
        repository: reporter?.getRepositoryLabel?.() ?? "jmirving/DraftEngine",
        fallback_url: reporter?.getFallbackUrl?.() ?? "https://github.com/jmirving/DraftEngine/issues/new/choose"
      }
    });
  });

  router.post("/issue-reporting/issues", optionalAuth, async (request, response) => {
    if (!reporter?.isEnabled?.()) {
      throw new ApiError(503, "ISSUE_REPORTING_DISABLED", "In-app issue reporting is not configured.", {
        fallback_url: reporter?.getFallbackUrl?.() ?? "https://github.com/jmirving/DraftEngine/issues/new/choose"
      });
    }

    const body = requireObject(request.body);
    const title = requireNonEmptyString(body.title, "title");
    const description = requireNonEmptyString(body.description, "description");
    const type = parseIssueType(body.type);
    const reporterEmail = normalizeOptionalString(body.reporterEmail);
    const reporterGameName = normalizeOptionalString(body.reporterGameName);
    const authenticatedEmail = normalizeOptionalString(request.user?.email);
    const sourceContext = parseIssueSourceContext(body.sourceContext);

    const issue = await reporter.submitIssue({
      title,
      description,
      type,
      reporterEmail,
      reporterGameName,
      authenticatedEmail,
      sourceContext
    });

    response.status(201).json({ issue });
  });

  return router;
}
