# Project Context

- **Owner:** Pat Altimore
- **Project:** Group text adventure game — browser-based, text-based multiplayer game for 1-20 players. Rooms connected by compass directions, puzzles solved by collecting items, player inventories, host/join via URL or QR code.
- **Stack:** Azure (Web PubSub for WebSocket, Azure Functions for game logic, Azure Table Storage for persistence), JavaScript/TypeScript, HTML/CSS
- **Created:** 2026-03-31

## Core Context

**Mouth's (Backend Dev) contributions:**

1. **Azure deployment architecture** — Single-command deploy scripts (PS & Bash) provisioning all resources (Web PubSub, Functions, Storage) with consumption tiers (~$0/month).

2. **Game engine & WebSocket protocol** — Stateless Azure Functions (v4 Node.js ESM). Functions register via `app.http()` / `app.generic()` in `src/index.js`. Web PubSub subprotocol `json.webpubsub.azure.v1` uses `type: 'event'` for client-to-server routing.

3. **Critical deploy fixes** — Multiple issues resolved:
   - Function discovery: Explicit `src/index.js` entry point instead of glob pattern; `@azure/functions` upgraded to 4.12.0
   - App settings: ARM REST API with file-based input to bypass Windows cmd.exe semicolon mangling
   - Static website: Explicit `--account-name`/`--account-key` auth; defensive re-enable before upload
   - Packaging validation: npm error checking, staging directory verification before zip
   - Health endpoint: `/api/health` for diagnostics, post-deploy verification with 2.5min cold-start tolerance

4. **Testing & conventions** — All 111 tests passing. Key conventions documented in `.squad/decisions.md`.

5. **Current issue (2026-04-04)** — Function App exists but shows no code deployed. Azure CLI authenticated to wrong subscription ("dSCM PPE") which doesn't contain `rg-text-adventure`. Deploy script correct; subscription context needs switch.

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-03-31 — Backend v1 built (greenfield)

- **Architecture:** Azure Functions v4 (Node.js, ESM) + Web PubSub + Table Storage. Stateless functions, all state persisted in Table Storage.
- **Game engine is pure:** `api/src/game-engine.js` has zero Azure dependencies. All state is passed in and returned — fully testable in isolation.
- **Command parser is separate:** `api/src/command-parser.js` is its own module, also pure.
- **Puzzle system:** Puzzles use `requiredItem` + `action` (openExit, removeHazard, addItem). Items are consumed on use.
- **WebSocket protocol:** Client sends `{ type: "join" | "command" }`, server replies with `{ type: "look" | "message" | "error" | "inventory" | "playerEvent" | "gameInfo" }`.
- **Connection ID as player ID:** The Web PubSub connectionId doubles as the playerId for simplicity.
- **World format:** `/world/default-world.json` — 10-room "Forgotten Castle" with 4 puzzles, 9 items, compass exits.
- **Table schema:** GameSessions (PK: "game"), Players (PK: gameId), GameState (PK: gameId, RK: "state" — serialized JSON).
- **Key paths:** `api/src/functions/negotiate.js`, `api/src/functions/gameHub.js`, `api/src/game-engine.js`, `api/src/command-parser.js`, `api/src/table-storage.js`, `world/default-world.json`.

### 2026-03-31 to 2026-04-02 — Deploy Script & Infrastructure Fixes

**Summary of major work (see decisions.md for full details):**

1. **Function discovery chain** — Glob pattern removed (→ explicit `src/index.js`), `@azure/functions` upgraded 4.5.0→4.12.0
2. **Azure CLI issues** — PowerShell $ErrorActionPreference doesn't catch native commands; always check $LASTEXITCODE
3. **App settings delivery** — Windows cmd.exe mangling semicolons in --settings args; switched to ARM REST API with file-based input
4. **Static website auth** — Switched from env-var-only to explicit `--account-name`/`--account-key` params
5. **Packaging validation** — npm install error checking, staging directory verification before zip
6. **Deploy idempotency** — Resource group creation first; storage account existence check before name availability
7. **Health endpoint** — `/api/health` for diagnostics; post-deploy verification with 10×15s retry (2.5min cold-start tolerance)
8. **Deployment sequence** — Full stop+start (not restart); re-apply critical settings post-zip-deploy

**Tests:** All 111 passing throughout.

### 2026-04-04 — Subscription Mismatch Diagnosis

- **Problem:** Function App exists in Azure Portal but appears empty (no code deployed).
- **Findings:**
  - Code: VERIFIED CORRECT — `package.json` main field correct, @azure/functions 4.12.0, all imports correct
  - Deploy script: VERIFIED CORRECT — all steps working, npm error checking in place, staging verification
  - Staging directory: VERIFIED CORRECT — simulated build succeeds, all files present
  - Azure CLI auth: PROBLEM FOUND — CLI authenticated to "dSCM PPE" subscription which does NOT contain `rg-text-adventure`
- **Root cause:** Subscription mismatch. Resources exist in correct Azure subscription but CLI doesn't have access.
- **Function App status:** Returns 503 (app exists but no working code deployed). With correct subscription, just needs redeployment.
- **Fix required:** Switch Azure CLI to correct subscription, then run `cd deploy && .\deploy.ps1 -AppName patcastle`
- **Key learning — diagnose 503 vs 404 vs DNS failure:** 503 = app exists but no working code; 404 = code deployed but functions not discovered; DNS failure = app doesn't exist.
  4. **End-to-end health check** — After deployment, HTTP-request the static website URL (3 retries, 10s apart). If 404 persists, display full diagnostics: static website config, blob names, actionable next steps.
- **Key learning — explicit auth beats env vars on Windows:** `--account-name` + `--account-key` is more reliable across Azure CLI versions than env vars alone.
- **Key learning — verify critical state at point of use:** Don't trust that state set in step 3 survives to step 10. Re-enable immediately before the operation that depends on it.
- **Key learning — verify the specific blob, not just count:** Check that `index.html` exists, not just "blob count >= 1".
- **Key file path:** `deploy/deploy.ps1` (steps 3, 10, 12a)
- **All 111 tests still pass. Committed and pushed.**

### 2026-04-01T23:59:00Z — Final Session: Static Site 404 Debug

**Team Update from Scribe:**
- **Mouth:** Debugged and fixed 3 compounding issues in deploy.ps1:
  1. Environment variable auth not guaranteed to propagate — switched to explicit `--account-name` + `--account-key` params
  2. Static website hosting could be disabled during the 4-9 minute operations window — added defensive re-enable at step 10
  3. Upload verification only checked blob count >= 1 — now verifies `index.html` specifically exists
- **Data:** Verified all client files are valid; relative paths correct; structure ready for deployment
- **Outcome:** 111 tests pass. Code committed and pushed.
- **Coordination:** Team consensus that defensive redundancy (re-enable, explicit auth, specific verification) is the right pattern for mission-critical cloud deployments where silent failures are common.

### 2026-04-02 — Fix: Negotiate 404 root cause — silent npm install failures

- **Problem:** Recurring negotiate 404 across multiple sessions. All previous fixes (explicit entry point, EnableWorkerIndexing, ARM REST API for settings, @azure/functions upgrade) were correct for their specific issues but the 404 kept recurring.
- **Root cause:** Both deploy scripts (`deploy.ps1` and `deploy.sh`) piped `npm install --omit=dev` output to `/dev/null` (or `Out-Null`) with NO exit code check. If npm install failed (network issue, registry timeout, disk space), the deployment zip was created WITHOUT `node_modules`. The Azure Functions worker couldn't load `@azure/functions`, crashed on startup, and returned 404 on ALL routes. This failure was completely invisible.
- **Fix 1 — npm install error check:** Both scripts now capture npm output, check exit code, and abort with a clear error message on failure.
- **Fix 2 — Staging verification:** Before creating the zip, both scripts verify 6 required files exist: `package.json`, `host.json`, `src/index.js`, `negotiate.js`, `gameHub.js`, and `node_modules/@azure/functions/package.json`. If any is missing, deployment aborts.
- **Fix 3 — Post-deploy settings verification:** `deploy.ps1` now verifies ALL critical settings (not just EnableWorkerIndexing) via ARM REST API after zip deploy. Checks for setting drift on `WEBSITE_RUN_FROM_PACKAGE`, `FUNCTIONS_WORKER_RUNTIME`, `FUNCTIONS_EXTENSION_VERSION`. Re-applies via file-based PUT if drifted. `deploy.sh` re-applies critical settings post-deploy.
- **Fix 4 — Full stop+start:** Replaced `az functionapp restart` with `stop` + 5s pause + `start`. Full stop/start is more thorough than restart for clearing cached state on Linux Consumption.
- **Fix 5 — Explicit host.json routePrefix:** Added `"extensions": { "http": { "routePrefix": "api" } }` to `host.json`. Removes dependency on implicit default.
- **Key learning — silent npm failures:** NEVER pipe npm output to null without checking the exit code. `npm install` can fail for many reasons (network, registry, version resolution, disk space). Without an exit code check, the failure is completely invisible and leads to broken deployments.
- **Key learning — defense in depth for packaging:** Verify the CONTENT of the staging directory before zipping, not just that npm ran. The zip is the artifact that gets deployed — its contents must be validated.
- **Key file paths:** `api/host.json`, `deploy/deploy.ps1` (steps 8, post-deploy), `deploy/deploy.sh` (steps 8, post-deploy)
- **All 111 tests still pass. Committed and pushed.**
- **Requires redeployment** to take effect: `cd deploy && .\deploy.ps1 -AppName patcastle`

### 2026-04-02 — Negotiate 404 debug session logged- **Orchestration log:** `.squad/orchestration-log/2026-04-02T0020-mouth.md` — Agent work output, root cause analysis, fixes applied, test results
- **Session log:** `.squad/log/2026-04-02T0020-negotiate-404-fix.md` — Brief summary of debug session
- **Decision merged:** `.squad/decisions.md` — "Deploy Scripts Must Validate Packaging Before Deployment" decision from inbox merged with convention going forward
- **Status:** 111 tests passing, committed and pushed

### 2026-04-02 — Fix: Join-Path PowerShell 5.1 compatibility

- **Problem:** `deploy/deploy.ps1` uses `Join-Path` with 3-4 positional arguments (lines 445-448). Windows PowerShell 5.1 only accepts 2 positional parameters; PowerShell 7+ added support for multiple arguments. This breaks the deploy script on CI/CD systems using PS 5.1.
- **Solution:** Refactored all 4 calls to nest Join-Path invocations, each using 2 positional parameters. Example: `Join-Path (Join-Path $dir "api") "src"` instead of `Join-Path $dir "api" "src"`.
- **Files modified:** `deploy/deploy.ps1` (lines 445-448)
- **Tests:** All 111 tests pass
- **Learning:** Join-Path in Windows PowerShell 5.1 only accepts 2 positional parameters. Always nest calls for cross-version compatibility.
- **Committed and pushed.**

### 2026-04-02 — Health endpoint + post-deploy verification

- **Problem:** Deploy script had no way to verify the Azure Functions runtime loaded functions correctly. After zip deploy, the only check was calling `/api/negotiate` and hoping for a non-404, with no insight into WHY it failed.
- **Solution (3 changes):**
  1. **New health endpoint** (`api/src/functions/health.js`): Anonymous GET at `/api/health` returns JSON with runtime status, Node.js version, loaded function list, and settings configuration (WebPubSub, Table Storage, EnableWorkerIndexing). Registered in `api/src/index.js`.
  2. **Staging verification** (`deploy/deploy.ps1`): Added `health.js` to `$requiredFiles` array with nested `Join-Path` for PS 5.1 compatibility.
  3. **Post-deploy verification** (`deploy/deploy.ps1`): Replaced the old negotiate-only check with a two-step verification: (a) Poll `/api/health` up to 10 times with 15s waits (handles cold start), parse response to show settings status and warn about misconfigurations; (b) Check `/api/negotiate` as secondary verification (expects 400 Missing gameId). Clear diagnostic messages with Azure Portal steps if endpoints fail.
- **Key learning — health endpoints for serverless:** A dedicated health check that reports configuration state is invaluable for diagnosing deploy issues. It separates "runtime loaded" from "app configured correctly" — two distinct failure modes that both manifest as 404.
- **Key file paths:** `api/src/functions/health.js` (new), `api/src/index.js` (updated), `deploy/deploy.ps1` (steps 8, post-deploy)
- **All 111 tests still pass. Committed and pushed.**

### 2026-04-02 — Investigated "no code in function app" report

- **Problem:** Pat reported the Function App exists in Azure Portal but shows no functions (no code deployed).
- **Investigation results:**
  1. **Code structure: VERIFIED CORRECT.** `package.json` has `main: src/index.js`, `type: module`, `@azure/functions: ^4.12.0`. `src/index.js` imports all three functions (negotiate, gameHub, health). All use correct v4 registration patterns (`app.http`, `app.generic` with `trigger.generic`).
  2. **Deploy script: VERIFIED CORRECT.** `deploy/deploy.ps1` stages files correctly, runs `npm install --omit=dev` with error checking, verifies all required files in staging, sets `WEBSITE_RUN_FROM_PACKAGE=1`, `EnableWorkerIndexing`, uses ARM REST API for settings. Post-deploy health check included.
  3. **Simulated staging: PERFECT.** Built staging directory locally — all required files present, npm install succeeds, @azure/functions 4.12.0 installed correctly.
  4. **Azure CLI auth problem:** CLI is authenticated to subscription "dSCM PPE" (9d0e9790-...) which does NOT contain `rg-text-adventure`. Searched all 157 accessible subscriptions — resource group not found. The function app exists (`patcastle-func.azurewebsites.net` returns 503) but CLI has no access.
- **Root cause:** The Function App was provisioned (returns HTTP 503, not DNS failure) but no code was deployed. Either the deploy script was run from a different auth context and failed partway, or only the resource was created through the portal. The 503 "Site Unavailable" confirms no working code.
- **Fix required:** Switch CLI to the correct subscription containing `rg-text-adventure`, then run `cd deploy && .\deploy.ps1 -AppName patcastle`. The code and script are ready — it's purely an auth/subscription mismatch preventing deployment.
- **Key learning — 503 vs 404 vs DNS failure:** 503 = app exists but no working code. 404 = code deployed but functions not discovered. DNS failure = app doesn't exist. Different diagnostics for each.

