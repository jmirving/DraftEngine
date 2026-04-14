# DraftEngine Hosted Nexus Auth Callback

## Purpose

Define the first DraftEngine-owned hosted-auth slice that consumes the
Nexus launch-grant exchange contract, resolves a DraftEngine-local user,
and establishes DraftEngine's existing local auth session shape without
requiring manual login.

This slice is aligned with:

- `Nexus/docs/specs/004-hosted-shared-auth-delivery-plan.md`
- `Nexus/docs/contracts/draftengine-auth-handoff.md`
- `docs/planning.md`
- `docs/getting-to-v1.0.md`

## Roadmap and User Alignment

This work supports the existing product direction by reducing
cross-application friction between Nexus and DraftEngine.

Relevant local goals:

- preserve a usable onboarding flow into the composer
- keep local app auth compatible with future Nexus adoption
- avoid parallel permanent identity ownership in DraftEngine

Primary users:

- authenticated Nexus users entering DraftEngine from the portal
- local operators validating hosted app launch

Relevant requirements:

- intentional portal-to-app transition
- stable authenticated access to protected DraftEngine API routes
- app-owned failure behavior when hosted auth cannot complete

Affected boundaries:

- DraftEngine auth routes
- frontend auth session bootstrap
- JWT verification and local session persistence

## Problem Statement

DraftEngine currently supports only app-local login and bearer-token
session persistence through `localStorage`, and its protected API still
expects local numeric user IDs.

It does not yet support the hosted Nexus browser handoff:

- no `GET /auth/nexus/callback`
- no grant redemption against the Nexus exchange endpoint
- no DraftEngine-owned success or failure flow for hosted launch

That means Nexus can launch DraftEngine only as a plain external link,
not as a recognized authenticated app session.

## Goals

- add `GET /auth/nexus/callback`
- redeem a Nexus launch grant using the DraftEngine app secret
- validate the exchanged access token for the `draftengine` audience
- resolve or provision a DraftEngine-local user by Nexus email
- populate DraftEngine's existing local auth session format
- redirect the browser into DraftEngine without a manual login step
- render an intentional app-owned failure page when the callback fails

## Non-Goals

- replacing DraftEngine's existing local login/register flows
- introducing a second permanent identity system
- changing the Nexus exchange contract
- redesigning the main DraftEngine auth UI

## Chosen Integration Model

DraftEngine already uses a stable local session shape:

```json
{
  "token": "<jwt>",
  "user": { "...": "..." }
}
```

stored under `draftflow.authSession.v1` in `localStorage`.

For the first hosted slice, DraftEngine should reuse that same session
shape rather than introducing a separate cookie-only session boundary.

Because the rest of the API still authorizes against DraftEngine-local
numeric user IDs, the callback must not hand the Nexus token directly to
the frontend as the long-lived DraftEngine app token.

Instead, the callback should:

1. validate the Nexus token at the callback boundary
2. resolve an existing DraftEngine user by email or provision one with a
   generated password hash and placeholder Riot ID fields
3. mint a normal DraftEngine-local JWT for that local user
4. write that local token and serialized local user into
   `draftflow.authSession.v1`
5. redirect to the validated in-app destination

This keeps the implementation simple and compatible with the current
frontend session model.

## Requirements

- DraftEngine shall expose `GET /auth/nexus/callback`.
- The callback shall require a `grant` query parameter.
- DraftEngine shall redeem the grant through `NEXUS_EXCHANGE_URL` using
  `NEXUS_DRAFTENGINE_EXCHANGE_SECRET` or `DRAFTENGINE_EXCHANGE_SECRET`.
- DraftEngine may derive `NEXUS_EXCHANGE_URL` from the configured Nexus
  base URL when the explicit exchange URL env is omitted.
- DraftEngine may accept generic exchange-secret fallback env names for
  hosted rollout compatibility as long as the value still resolves to
  the DraftEngine app secret.
- DraftEngine shall verify the exchanged token using the configured
  signing secret, issuer, and `draftengine` audience before trusting it.
- DraftEngine shall require an email claim before creating or resolving
  a DraftEngine-local user.
- DraftEngine shall resolve or provision a DraftEngine-local user before
  minting a normal DraftEngine-local app token.
- DraftEngine shall serialize the DraftEngine-local token and user into
  the existing frontend auth session format.
- DraftEngine shall redirect the browser to a validated local `returnTo`
  hash or route when provided, or to the default workflow route
  otherwise.
- DraftEngine shall render an app-owned HTML failure response for
  missing grant, invalid app credential, expired grant, replayed grant,
  wrong audience, and general exchange failure.
- Existing app-local login and register behavior shall continue to work.

## Validation

- automated tests for callback success
- automated tests for callback failures
- local end-to-end launch from a live local Nexus instance
- existing auth tests remain green

## Deferred Follow-Up

- decide later whether DraftEngine should also support an app-owned auth
  cookie in addition to the localStorage bootstrap
- move more of the local auth system behind shared Nexus auth if and
  when DraftEngine no longer needs standalone login
