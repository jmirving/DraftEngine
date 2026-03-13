import { Router } from "express";

import { ApiError, badRequest } from "../errors.js";
import { requireObject, requireNonEmptyString } from "../http/validation.js";

const ISSUE_TYPES = new Set(["bug", "feature", "task"]);

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

function parseIssueType(value) {
  const normalized = normalizeOptionalString(value).toLowerCase();
  if (!ISSUE_TYPES.has(normalized)) {
    throw badRequest("Expected 'type' to be one of: bug, feature, task.");
  }
  return normalized;
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

    const issue = await reporter.submitIssue({
      title,
      description,
      type,
      reporterEmail,
      reporterGameName,
      authenticatedEmail
    });

    response.status(201).json({ issue });
  });

  return router;
}
