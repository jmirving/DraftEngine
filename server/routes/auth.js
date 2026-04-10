import { createHash, randomBytes } from "crypto";
import { Router } from "express";

import { ApiError, badRequest, conflict, schemaMismatch, unauthorized } from "../errors.js";
import { requireEmail, requireGameName, requireNonEmptyString, requireObject, requirePassword, requireTagline } from "../http/validation.js";
import { redeemLaunchGrant as defaultRedeemLaunchGrant } from "../auth/exchange.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { signAccessToken, verifyHostedAccessToken } from "../auth/tokens.js";
import { USER_ROLE_ADMIN, USER_ROLE_MEMBER, isOwnerAdminEmail, resolveAuthorizationRole } from "../user-roles.js";
import { createRequireAuth } from "../auth/middleware.js";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const HOSTED_AUTH_STORAGE_KEY = "draftflow.authSession.v1";
const HOSTED_AUTH_DEFAULT_RETURN_TO = "/#workflow";

function hashResetToken(rawToken) {
  return createHash("sha256").update(rawToken).digest("hex");
}

function serializeNullablePositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function serializeAuthUser(user) {
  return {
    id: Number(user.id),
    email: user.email,
    role: resolveAuthorizationRole(user),
    gameName: user.game_name ?? "",
    tagline: user.tagline ?? "",
    firstName: user.first_name ?? "",
    lastName: user.last_name ?? "",
    displayTeamId: serializeNullablePositiveInteger(user.default_team_id),
    avatarChampionId: serializeNullablePositiveInteger(user.avatar_champion_id),
    primaryRole: user.primary_role ?? "Mid",
    secondaryRoles: Array.isArray(user.secondary_roles) ? user.secondary_roles : []
  };
}

function mapUniqueConstraintError(error) {
  if (error && error.code === "23505") {
    return conflict("Email already exists.", { field: "email" });
  }
  if (error && (error.code === "42703" || error.code === "42P01")) {
    return schemaMismatch();
  }
  return error;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function serializeJsonForHtml(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function logHostedAuthEvent(details) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      service: "draftengine",
      route: "auth-callback",
      ...details
    })
  );
}

function sanitizeReturnTo(value) {
  if (typeof value !== "string") {
    return HOSTED_AUTH_DEFAULT_RETURN_TO;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return HOSTED_AUTH_DEFAULT_RETURN_TO;
  }

  if (trimmed.startsWith("#")) {
    return `/${trimmed}`;
  }

  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return HOSTED_AUTH_DEFAULT_RETURN_TO;
  }

  return trimmed;
}

function normalizeHostedString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

function deriveHostedIdentity(payload) {
  const displayName = normalizeHostedString(payload.displayName);
  if (displayName.includes("#")) {
    const [gameName, tagline] = displayName.split("#", 2).map((value) => value.trim());
    if (gameName && tagline) {
      return {
        gameName,
        tagline
      };
    }
  }

  const email = normalizeHostedString(payload.email);
  const emailLocalPart = email.includes("@") ? email.split("@", 1)[0].trim() : "";
  const baseGameName = displayName || emailLocalPart || `NexusUser${String(payload.sub ?? "").slice(-8)}`;

  return {
    gameName: baseGameName || "NexusUser",
    tagline: "Nexus"
  };
}

function deriveHostedAccountInfo(payload) {
  const displayName = normalizeHostedString(payload.displayName);
  if (!displayName || displayName.includes("#")) {
    return {
      firstName: null,
      lastName: null
    };
  }

  const [firstName, ...rest] = displayName.split(/\s+/).filter(Boolean);
  return {
    firstName: firstName || null,
    lastName: rest.length > 0 ? rest.join(" ") : null
  };
}

async function findOrProvisionHostedUser(usersRepository, payload) {
  const email = normalizeHostedString(payload.email).toLowerCase();
  if (!email) {
    throw badRequest("Hosted auth response did not include an email.");
  }

  const existingUser = await usersRepository.findByEmail(email);
  if (existingUser) {
    return {
      user: existingUser,
      created: false
    };
  }

  const hostedIdentity = deriveHostedIdentity(payload);
  const hostedAccountInfo = deriveHostedAccountInfo(payload);
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));

  try {
    const createdUser = await usersRepository.createUser({
      email,
      passwordHash,
      gameName: hostedIdentity.gameName,
      tagline: hostedIdentity.tagline,
      firstName: hostedAccountInfo.firstName,
      lastName: hostedAccountInfo.lastName,
      role: isOwnerAdminEmail(email) ? USER_ROLE_ADMIN : USER_ROLE_MEMBER
    });

    return {
      user: createdUser,
      created: true
    };
  } catch (error) {
    if (error && error.code === "23505") {
      const concurrentUser = await usersRepository.findByEmail(email);
      if (concurrentUser) {
        return {
          user: concurrentUser,
          created: false
        };
      }
    }
    throw mapUniqueConstraintError(error);
  }
}

function renderHostedAuthPage({ title, heading, body, tone = "normal", portalBaseUrl, content = "" }) {
  const headingClass = tone === "error" ? "tone-error" : "tone-ok";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f0e8;
        --panel: #fffaf4;
        --ink: #161514;
        --muted: #61574b;
        --accent: #145f8a;
        --error: #a33b1d;
        --border: #d7cbbb;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Avenir Next", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top right, rgba(20, 95, 138, 0.12), transparent 30%),
          linear-gradient(180deg, #fbf7f1 0%, var(--bg) 100%);
        color: var(--ink);
      }
      main {
        max-width: 760px;
        margin: 0 auto;
        min-height: 100vh;
        padding: 48px 20px 64px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 28px;
        box-shadow: 0 24px 64px rgba(22, 21, 20, 0.08);
      }
      .eyebrow {
        margin: 0 0 8px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 12px;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 36px;
        line-height: 1.05;
      }
      p {
        margin: 0 0 14px;
        line-height: 1.55;
      }
      .tone-ok { color: var(--accent); }
      .tone-error { color: var(--error); }
      .actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 18px;
      }
      a {
        color: var(--accent);
      }
      .button {
        display: inline-block;
        padding: 10px 16px;
        border-radius: 999px;
        text-decoration: none;
        background: var(--ink);
        color: #fff;
      }
      .button.secondary {
        background: transparent;
        color: var(--ink);
        border: 1px solid var(--border);
      }
      .meta {
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <main>
      <section class="panel">
        <p class="eyebrow">DraftEngine Hosted Auth</p>
        <h1 class="${headingClass}">${escapeHtml(heading)}</h1>
        <p>${escapeHtml(body)}</p>
        ${content}
        <div class="actions">
          <a class="button" href="/">Open DraftEngine</a>
          <a class="button secondary" href="${escapeHtml(portalBaseUrl)}">Return to Nexus</a>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function renderHostedAuthErrorPage({ title, heading, body, portalBaseUrl }) {
  return renderHostedAuthPage({
    title,
    heading,
    body,
    tone: "error",
    portalBaseUrl
  });
}

function renderHostedAuthSuccessPage({ session, returnTo, portalBaseUrl }) {
  const payload = {
    storageKey: HOSTED_AUTH_STORAGE_KEY,
    returnTo,
    session
  };
  const serializedPayload = serializeJsonForHtml(payload);
  const safeReturnLink = escapeHtml(returnTo);

  return renderHostedAuthPage({
    title: "DraftEngine Auth Complete",
    heading: "Redirecting into DraftEngine",
    body: "Your Nexus session was accepted and DraftEngine is opening with a local app session.",
    tone: "normal",
    portalBaseUrl,
    content: `
        <p class="meta" id="hosted-auth-status">If the redirect does not start automatically, continue below.</p>
        <div class="actions">
          <a class="button" href="${safeReturnLink}">Continue</a>
        </div>
        <script id="draftengine-hosted-auth-payload" type="application/json">${serializedPayload}</script>
        <script>
          (function () {
            var statusNode = document.getElementById("hosted-auth-status");
            var payloadNode = document.getElementById("draftengine-hosted-auth-payload");
            if (!payloadNode) {
              if (statusNode) {
                statusNode.textContent = "DraftEngine could not finalize the hosted sign-in payload.";
              }
              return;
            }

            try {
              var payload = JSON.parse(payloadNode.textContent || "{}");
              localStorage.setItem(payload.storageKey, JSON.stringify(payload.session));
              window.location.replace(payload.returnTo);
            } catch (error) {
              if (statusNode) {
                statusNode.textContent = "DraftEngine could not persist the hosted session in this browser.";
              }
            }
          })();
        </script>
      `
  });
}

export function createAuthRouter({ config, usersRepository, redeemLaunchGrant = defaultRedeemLaunchGrant }) {
  const router = Router();
  const requireAuth = createRequireAuth(config);

  router.post("/register", async (request, response) => {
    const body = requireObject(request.body);
    const email = requireEmail(body.email);
    const password = requirePassword(body.password);
    const gameName = requireGameName(body.gameName);
    const tagline = requireTagline(body.tagline);
    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : null;
    const lastName = typeof body.lastName === "string" ? body.lastName.trim() : null;

    const existing = await usersRepository.findByEmail(email);
    if (existing) {
      throw conflict("Email already exists.", { field: "email" });
    }

    const passwordHash = await hashPassword(password);
    let createdUser;
    try {
      createdUser = await usersRepository.createUser({
        email,
        passwordHash,
        gameName,
        tagline,
        firstName,
        lastName,
        role: isOwnerAdminEmail(email) ? USER_ROLE_ADMIN : USER_ROLE_MEMBER
      });
    } catch (error) {
      throw mapUniqueConstraintError(error);
    }

    if (!createdUser) {
      throw new ApiError(500, "USER_CREATE_FAILED", "Failed to create user.");
    }

    const token = signAccessToken(createdUser.id, config);
    response.status(201).json({
      token,
      user: serializeAuthUser(createdUser)
    });
  });

  router.post("/login", async (request, response) => {
    const body = requireObject(request.body);
    const email = requireEmail(body.email);
    const password = requirePassword(body.password);

    const user = await usersRepository.findByEmail(email);
    if (!user) {
      throw unauthorized("Invalid email or password.");
    }

    const validPassword = await verifyPassword(password, user.password_hash);
    if (!validPassword) {
      throw unauthorized("Invalid email or password.");
    }

    const token = signAccessToken(user.id, config);
    response.json({
      token,
      user: serializeAuthUser(user)
    });
  });

  router.post("/request-password-reset", async (request, response) => {
    const body = requireObject(request.body);
    const email = requireEmail(body.email);

    // Always respond the same way regardless of whether email exists (prevents enumeration)
    const user = await usersRepository.findByEmail(email);
    if (!user) {
      response.json({ message: "If that email is registered, a reset token has been issued." });
      return;
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await usersRepository.createPasswordResetToken(user.id, tokenHash, expiresAt);

    // NOTE: In production this token would be emailed. Returned directly here
    // because no email service is configured.
    response.json({
      message: "If that email is registered, a reset token has been issued.",
      resetToken: rawToken
    });
  });

  router.post("/reset-password", async (request, response) => {
    const body = requireObject(request.body);
    const rawToken = requireNonEmptyString(body.token, "token");
    const newPassword = requirePassword(body.newPassword);

    const tokenHash = hashResetToken(rawToken);
    const record = await usersRepository.findValidPasswordResetToken(tokenHash);
    if (!record) {
      throw badRequest("Invalid or expired reset token.");
    }

    const passwordHash = await hashPassword(newPassword);
    await usersRepository.updatePassword(Number(record.user_id), passwordHash);
    await usersRepository.markResetTokenUsed(Number(record.id));

    response.json({ message: "Password updated successfully." });
  });

  router.post("/change-password", requireAuth, async (request, response) => {
    const body = requireObject(request.body);
    const newPassword = requirePassword(body.newPassword);

    const passwordHash = await hashPassword(newPassword);
    await usersRepository.updatePassword(request.user.userId, passwordHash);

    response.json({ message: "Password changed successfully." });
  });

  router.get("/nexus/callback", async (request, response) => {
    const grantId = typeof request.query.grant === "string" ? request.query.grant.trim() : "";

    if (!grantId) {
      response.status(400).send(
        renderHostedAuthErrorPage({
          title: "DraftEngine Auth Failed",
          heading: "Hosted auth failed",
          body: "The callback is missing a launch grant.",
          portalBaseUrl: config.nexusPortalBaseUrl
        })
      );
      logHostedAuthEvent({
        outcome: "missing-grant"
      });
      return;
    }

    if (!config.nexusExchangeUrl || !config.nexusExchangeSecret || !config.nexusAppSigningSecret) {
      response.status(503).send(
        renderHostedAuthErrorPage({
          title: "DraftEngine Auth Failed",
          heading: "Hosted auth is unavailable",
          body: "DraftEngine hosted auth is not fully configured.",
          portalBaseUrl: config.nexusPortalBaseUrl
        })
      );
      logHostedAuthEvent({
        outcome: "misconfigured",
        grantId
      });
      return;
    }

    logHostedAuthEvent({
      outcome: "callback-received",
      grantId
    });

    try {
      const exchange = await redeemLaunchGrant({
        config,
        grantId
      });

      if (!exchange.ok) {
        const message =
          typeof exchange.payload?.message === "string"
            ? exchange.payload.message
            : "The Nexus exchange failed.";

        response.status(exchange.status).send(
          renderHostedAuthErrorPage({
            title: "DraftEngine Auth Failed",
            heading: "Hosted auth failed",
            body: message,
            portalBaseUrl: config.nexusPortalBaseUrl
          })
        );
        logHostedAuthEvent({
          outcome: "exchange-failed",
          grantId,
          statusCode: exchange.status
        });
        return;
      }

      const accessToken = exchange.payload?.accessToken;
      if (typeof accessToken !== "string" || !accessToken.trim()) {
        throw new Error("Exchange response did not include an access token.");
      }

      const payload = verifyHostedAccessToken(accessToken, config);
      if (typeof exchange.payload?.user?.userId === "string" && exchange.payload.user.userId !== payload.sub) {
        throw new Error("Exchange user payload did not match token subject.");
      }

      const hostedUser = await findOrProvisionHostedUser(usersRepository, payload);
      const localToken = signAccessToken(hostedUser.user.id, config);
      const returnTo = sanitizeReturnTo(
        typeof exchange.payload?.returnTo === "string"
          ? exchange.payload.returnTo
          : typeof request.query.returnTo === "string"
            ? request.query.returnTo
            : HOSTED_AUTH_DEFAULT_RETURN_TO
      );

      response.status(200).send(
        renderHostedAuthSuccessPage({
          session: {
            token: localToken,
            user: serializeAuthUser(hostedUser.user)
          },
          returnTo,
          portalBaseUrl: config.nexusPortalBaseUrl
        })
      );

      logHostedAuthEvent({
        outcome: "authenticated",
        grantId,
        nexusUserId: payload.sub,
        localUserId: hostedUser.user.id,
        createdLocalUser: hostedUser.created
      });
    } catch (error) {
      const statusCode = error instanceof ApiError ? error.status : 500;
      const message =
        error instanceof ApiError
          ? error.message
          : "DraftEngine could not complete the hosted sign-in.";

      response.status(statusCode).send(
        renderHostedAuthErrorPage({
          title: "DraftEngine Auth Failed",
          heading: "Hosted auth failed",
          body: message,
          portalBaseUrl: config.nexusPortalBaseUrl
        })
      );
      logHostedAuthEvent({
        outcome: "callback-error",
        grantId,
        statusCode,
        errorCode: error instanceof ApiError ? error.code : "INTERNAL_ERROR",
        error: error.message
      });
    }
  });

  return router;
}
