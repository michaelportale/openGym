# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

openGym is a self-hosted gym & body-weight tracker PWA. Two containers (`api` + `web`) plus a
`./data` folder the user owns — no third-party account, no telemetry. Passkey (WebAuthn) login,
installable as a home-screen app (PWA).
This is a personal fork; the upstream Capacitor native shells (frontend/android, frontend/ios)
have been removed, though the `@capacitor/*` deps and `lib/mobile.js` gating remain.
License: AGPL-3.0-or-later.

## Project layout

```
frontend/  React 19 + Vite app (src/views, src/components, src/store, src/lib). Builds to static files.
api/       backend — server.js (Node, no framework), deps: @simplewebauthn/server, web-push.
           coach/ is the optional AI coach; openapi.yaml documents every route.
web/       multi-stage Dockerfile (builds frontend → nginx) + nginx.conf.template (serves app, proxies /api).
mcp/       optional MCP server — read-only stdio bridge exposing a user's workouts/1RM/muscle
           balance to LLM clients (Claude Desktop, Cursor…). Not part of the Docker build; only
           runs when an LLM client spawns it.
catalogue/ exercise dataset; catalogue/media/ holds the exercise animations (licensed separately,
           see catalogue/media/NOTICE.md), copied into the web image at build time.
docs/      guides indexed in docs/README.md (FAQ, SELF_HOSTING*, AI_COACH, DATA_IMPORTS, API);
           docs/dev/ holds feature design notes (SET_TYPES: drop sets/rest-pause, LIST_VIEW, COMBINE_ROUTINES).
```

## Commands

```bash
# Local stack (api + web), built from source
cp .env.example .env
docker compose up -d --build

# Frontend dev server (hot reload), proxies /api to :3000
cd frontend && npm install && npm run dev

# Frontend tests (training logic: progression, 1RM, session read-back)
cd frontend && npm test            # vitest run
cd frontend && npm run test:watch
npx vitest run src/lib/progression.test.js   # single file
npx vitest run -t "some test name"           # single test by name

# API and MCP server tests
cd api && npm test
cd mcp && npm test

# Production build
cd frontend && npm run build
```

There is no linter/formatter configured (no ESLint/Prettier config in the repo) and no
TypeScript — match the existing style by hand.

Upstream is `github.com/DuarteSantos8/openGym`; this repo is a personal fork
(`michaelportale/openGym`). `.github/workflows/test.yml` describes the checks on Node 22 — the same
version as `web/Dockerfile` / `api/Dockerfile` (`node:22-alpine`): the frontend, api and MCP suites,
the locale checks, and building and booting both api image targets. Actions are disabled on the
fork, so run the suites locally before merging.

## Architecture

### Frontend (`frontend/src`)

- **`store/useStore.js`** — single Zustand store holding the entire client-side app state (`S`),
  persisted to `localStorage` (`gym_state_v1`) and debounce-pushed to the server when signed in
  (`pushState`, see `lib/api.js`). On the Capacitor mobile build it's also mirrored to a file via
  `lib/mobile.js` (`nativeSave`), since WebView storage can be evicted. `store/useUI.js` holds
  ephemeral UI state (modals, active sheet, etc.) separately from persisted data.
- **`lib/`** — pure, framework-free helpers, each paired with a same-directory `*.test.js`. This
  is where the domain logic lives, most importantly:
  - `progression.js` — the progression-rule engine (linear, Greyskull LP, double progression,
    time-based). Rules implement a shared policy interface; adding a new one plugs in here.
  - `onerm.js` — estimated 1RM from logged sets.
  - `finish-workout.js` — reduces a completed session back into state (weights advance, PRs, etc).
  - `recovery.js` / `recovery-view.js` — fatigue/muscle-recovery model.
  - `workout-model.js`, `supersetFlow.js` — in-session workout state machine, incl. supersets.
  - `exercises.js` / `exercises-data.js` — the exercise library (1,324 built-ins + user-defined).
  - `api.js` — the only place that talks to the backend (`fetch` wrapper, session cookie flows).
  - Upstream's rule: **anything that decides what you lift next, or reads a logged
    session back, is a pure helper here with a unit test beside it** — not verifiable by
    clicking, and the progression engine has already had two bugs that only a test caught.
- **`views/`** — one file per screen (Home, Workout, Plan, Library, Stats, History, Settings,
  Admin, Login, RoutineEdit), routed by `react-router-dom` from `App.jsx`.
- **`components/`** — shared UI (charts, modals, timers); `instr/` holds per-language exercise
  instruction text; `locales/` is the i18n string catalogue (`lib/i18n.js` / `i18n-core.js`).
- Mobile: the app is used as an installed PWA. The upstream Capacitor shells are removed from this
  fork; `mobile.js` in `lib/` still gates native-only behavior (file persistence, local
  notifications, wake lock) behind a `MOBILE` flag that is off in the web build.

### API (`api/server.js`)

Single file, no framework, plain `node:http`. Requests are dispatched through a `routes` object
keyed by `'METHOD /path'` (e.g. `routes['GET /api/health']`) matched against `req.method + ' ' +
url.pathname` — add a new endpoint by adding a key here. State is two flat JSON files under
`DATA_DIR` (`db.json`: users/credentials/subscriptions/invites; `state-<uid>.json`: per-user
workout data), written with a write-temp-then-rename atomic pattern (`atomicWrite`). Auth is
WebAuthn passkeys (`@simplewebauthn/server`) plus a signed session cookie (HMAC'd with a
`DATA_DIR/secret` generated on first boot) — no JWT/session-store dependency. Optional pieces
gated by env vars: `ADMIN_UIDS` (admin dashboard), `INVITE_ONLY` (signup needs a code),
`ALLOW_GUEST` (client-only guest mode never hits the server at all), plus a rotating
`data/audit.log` (JSONL) for sign-in/admin events. Web Push (`web-push`, VAPID keys
auto-generated into `data/vapid.json`) drives rest-timer-over and day-reminder notifications.

### MCP server (`mcp/src`)

Read-only stdio MCP bridge (`@modelcontextprotocol/sdk`) that lets an LLM client read a single
user's routines/workouts/body-weight/1RM/muscle-balance directly from the same `DATA_DIR` the API
writes to — no network call, no extra container. `state.js` loads/derives the data, `tools.js`
defines the exposed MCP tools (zod-validated schemas), `labels.js` maps internal keys to
human-readable labels, `index.js` wires it together. See `mcp/README.md` for the client-config
side (Claude Desktop / Cursor).

### Passkeys and self-hosting constraints

WebAuthn passkeys are bound to an exact hostname (`RP_ID`) and require HTTPS (localhost excepted)
— this shapes a lot of the API and Settings code (`RP_ID`/`ORIGIN` env vars, guest-mode fallback
when neither is available). Read `docs/SELF_HOSTING.md` before touching auth, session, or
notification code; it documents the exact env-var contract (`RP_ID`, `ORIGIN`, `PORT`,
`WEB_PORT`, `NGINX_PORT`, `BACKEND`, `SESSION_DAYS`, `ADMIN_UIDS`, `INVITE_ONLY`, `ALLOW_GUEST`,
`AUDIT_*`, `VAPID_SUBJECT`) that real deployments depend on.

### Docker / deploy

`docker-compose.yml` has two services: `api` and `web` (multi-stage build of `frontend/` served by
nginx, which also proxies `/api` → `api` and serves the exercise animations from
`catalogue/media/`, baked into the image — single origin, required for passkeys).
`web/nginx.conf.template` is rendered from env vars at container start (`NGINX_PORT`, `BACKEND`,
`PORT`), so host/port remapping works against prebuilt images without a rebuild.

## Guidelines (from upstream) worth knowing before changing code

- **Dependency-light is a hard constraint, not a preference.** Frontend: React + Router + Zustand
  and nothing else. `api/`: two dependencies total. New dependencies are a hard sell either side.
- Don't commit `data/`, `.env` or `coach-auth/` (gitignored).
- Training-logic changes (progression, 1RM, session read-back) need a unit test in `src/lib`
  beside the code, not just manual clicking-through.
