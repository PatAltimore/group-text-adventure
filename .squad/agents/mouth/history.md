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
   - **WEBSITE_RUN_FROM_PACKAGE handling:** On Linux Consumption, config-zip sets this to blob SAS URL. Do NOT override to `1`.

4. **Testing & conventions** — All 111 tests passing. Key conventions documented in `.squad/decisions.md`.

5. **Current status (2026-04-04)** — Successfully deployed all 5 functions to patcastle-func. Health endpoint returns 200, negotiate returns 400 (expected), static website serving. Deploy script issues identified: provisioning loop stderr crash, WEBSITE_RUN_FROM_PACKAGE override breaking Linux Consumption. Fixes needed.

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

### 2026-04-04 — Successful First Deployment to Azure

- **Problem:** Function App existed in Azure (HTTP 503) but had zero deployed code. Previous sessions identified subscription mismatch; this session completed the actual deployment.
- **Steps taken:**
  1. Switched Azure CLI to "Visual Studio Enterprise" subscription — resource group and function app found immediately.
  2. Confirmed: resource group `rg-text-adventure` (westus2), function app `patcastle-func` (Running, Linux), all app settings pre-configured, but zero functions deployed.
  3. Deploy script (`deploy.ps1 -Location westus2`) failed at `az functionapp show` provisioning check — Python cryptography warning on stderr triggers PowerShell's `$ErrorActionPreference = 'Stop'` even with `2>$null` redirection.
  4. Performed manual deployment: staged API + world files, ran `npm install --omit=dev`, verified 7 required files, created zip (4.06 MB), deployed via `az functionapp deployment source config-zip`.
  5. **Critical finding:** Zip deploy wiped `AzureWebJobsFeatureFlags` (EnableWorkerIndexing) and set `WEBSITE_RUN_FROM_PACKAGE` to blob SAS URL. Initially overwrote URL with `1` which caused persistent 503 (Linux Consumption needs the blob URL, not `1`).
  6. Re-applied settings via ARM REST API: restored connection strings (WebPubSub, Table Storage), EnableWorkerIndexing, hub name. Let `WEBSITE_RUN_FROM_PACKAGE` keep the blob URL from config-zip.
  7. Full stop+start, then verified: `/api/health` returns 200 (3 functions loaded, both connections configured), `/api/negotiate` returns 400 (expected — missing gameId), static website returns 200.
- **Final state:** All 5 functions deployed and operational: negotiate, gameHubConnect, gameHubDisconnect, gameHubMessage, health.
- **Key learning — WEBSITE_RUN_FROM_PACKAGE on Linux Consumption:** `config-zip` deploys to blob storage and sets WEBSITE_RUN_FROM_PACKAGE to a SAS URL. Do NOT override to `1` — that tells the runtime to look in `/home/data/SitePackages` which doesn't exist on Linux Consumption with blob-based deployment. Let the deploy command manage this value.
- **Key learning — zip deploy wipes custom settings:** `az functionapp deployment source config-zip` can wipe custom app settings (connection strings, feature flags). ALWAYS re-read and re-apply all critical settings AFTER zip deploy. The deploy script's existing post-deploy settings verification is essential.
- **Key learning — PowerShell stderr + $ErrorActionPreference:** Native command stderr output (like Python warnings in Azure CLI) can trigger exceptions when `$ErrorActionPreference = 'Stop'`, even with `2>$null`. The deploy script's `az functionapp show` provisioning loop needs a `try/catch` wrapper. This is a known PS5.1/PS7 behavior difference.
- **Deploy script bug:** `deploy.ps1` step 5 provisioning check (lines 230-242) fails on systems where Azure CLI emits Python warnings to stderr. Needs fix: wrap the loop body in `try/catch` or temporarily set `$ErrorActionPreference = 'Continue'`.
- **URLs:** Function App: `https://patcastle-func.azurewebsites.net`, Static Website: `https://patcastlestore.z5.web.core.windows.net`

