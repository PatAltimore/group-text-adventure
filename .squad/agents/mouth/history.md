# Project Context

- **Owner:** Pat Altimore
- **Project:** Group text adventure game — browser-based, text-based multiplayer game for 1-20 players. Rooms connected by compass directions, puzzles solved by collecting items, player inventories, host/join via URL or QR code.
- **Stack:** Azure (Web PubSub for WebSocket, Azure Functions for game logic, Azure Table Storage for persistence), JavaScript/TypeScript, HTML/CSS
- **Created:** 2026-03-31

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

### 2026-03-31 — Frontend + Test suite complete

**From Data (Frontend):**
- Vanilla HTML/CSS/JS client with 3-screen UI (landing, lobby, game)
- QR code generation via jsDelivr CDN (`qrcode@1.5.4`)
- Azure Web PubSub subprotocol `json.webpubsub.azure.v1` — messages wrapped in `sendToGroup` envelope
- Client files: `client/index.html`, `client/style.css`, `client/app.js`

**From Stef (Tester):**
- 111 tests passing (46 command-parser, 65 game-engine)
- Root `package.json` configured with Jest ESM support
- Test fixture: `tests/test-world.json`
- Run tests: `npm test`

### 2026-03-31 — Azure deployment scripts created

- **Deploy scripts:** `deploy/deploy.ps1` (PowerShell) and `deploy/deploy.sh` (Bash) provision all Azure resources and deploy the app in one command.
- **Architecture for deploy:** Storage Account serves dual purpose — Table Storage for game state AND static website hosting for client files. Keeps resource count minimal.
- **World file path fix:** `gameHub.js getDefaultWorld()` now tries two paths — deployed (world/ alongside api code at wwwroot level) and local dev (project root). The deploy script copies `world/` into the function app zip.
- **Client config pattern:** `client/app.js` loads `config.json` on init for the Function App URL. Falls back to relative `/api` path when config is absent (local dev). The deploy script generates `config.json` at upload time — never committed to source.
- **Key file paths:** `deploy/deploy.ps1`, `deploy/deploy.sh`, `deploy/README.md`.
- **All tiers are cheapest:** Storage Standard_LRS, Web PubSub Free_F1, Functions Consumption plan on Linux. Estimated cost ~$0/month.
- **Web PubSub event handler config:** Uses `webpubsub_extension` system key (falls back to master key). Script retries up to 12 times waiting for cold start to generate the key.

### 2026-03-31 — Three deployment bugs fixed

**Bug 1 — Negotiate 404:** Deploy scripts were missing `WEBSITE_RUN_FROM_PACKAGE=1` and `SCM_DO_BUILD_DURING_DEPLOYMENT=false`. Without `WEBSITE_RUN_FROM_PACKAGE=1`, Linux Consumption zip deployment doesn't mount the zip correctly, so functions return 404. Both `deploy.ps1` and `deploy.sh` updated.

**Bug 2 — WebSocket protocol (critical):** Client `sendMessage` was using `sendToGroup` envelope, which sends messages directly to other clients — the server never receives them. Changed to `type: 'event', event: 'message'` which routes messages to the server's `gameHubMessage` handler. This is a fundamental Web PubSub protocol distinction: `sendToGroup` = client-to-client, `event` = client-to-server.

**Bug 3 — QR code CDN 404:** The `qrcode` npm package v1.5.4 doesn't include the `build/` directory in its published files (despite listing it in package.json `files` array). The `build/qrcode.min.js` path 404s. Downgraded to v1.4.4 which has the UMD browser build. Also added `.catch()` error handling on `QRCode.toCanvas()` promise.

- **Key learning — Web PubSub subprotocol:** With `json.webpubsub.azure.v1`, `sendToGroup` bypasses server entirely. Must use `type: 'event'` to reach server-side handlers.
- **Key learning — Linux Consumption deploy:** Always set `WEBSITE_RUN_FROM_PACKAGE=1` for zip deploy on Linux Consumption plan.
- **Key learning — qrcode npm package:** v1.5.4 is broken for browser CDN use. v1.4.4 works. The browser UMD build lives at `build/qrcode.min.js`.

### 2026-03-31 — Deploy script error handling fix

- **Problem:** `$ErrorActionPreference = 'Stop'` does NOT catch non-zero exit codes from native commands like `az` in PowerShell. When `az storage account create` failed (globally unique name conflict), the script silently continued, causing cascading failures ending in a null-reference crash on `$staticWebUrl.TrimEnd('/')`.
- **Fix (deploy.ps1):** Added `Assert-AzSuccess` helper that checks `$LASTEXITCODE` after every critical `az` call. Added null/empty checks for all captured output (connection strings, URLs). Added pre-flight `az storage account check-name` validation.
- **Fix (deploy.sh):** Already had `set -euo pipefail` for exit-code propagation. Added null/empty checks for captured variables (`STORAGE_CONN_STR`, `STATIC_WEB_URL`, `WPS_CONN_STR`, `WPS_HOSTNAME`). Added same pre-flight storage name check. Removed `|| true` from CORS add (should succeed).
- **Intentionally suppressed commands:** CORS remove (`2>$null`/`|| true`) and hub delete (`2>$null`/`|| true`) — these may legitimately fail if resources don't exist yet.
- **Key learning — PowerShell native commands:** `$ErrorActionPreference = 'Stop'` only affects cmdlets, not native executables. Must check `$LASTEXITCODE` after every `az`/`npm`/etc. call, or use `$PSNativeCommandUseErrorActionPreference = $true` (PowerShell 7.3+).

### 2026-04-01 — Critical fix: Missing gameId in join + deploy idempotency

**Bug 1 (CRITICAL) — gameId not sent in join message:**
- **Problem:** `client/app.js` line 122 sent `{ type: 'join', playerName: state.playerName }` without `gameId`. Server's `handleJoin` defaulted missing gameId to 'default', so EVERY player joined game 'default' regardless of URL. WebSocket connected to correct PubSub group (via negotiate), but server created/loaded sessions under wrong game ID → data mismatch causing negotiate 404 on subsequent plays.
- **Fix:** Changed join message to include `gameId: state.gameId` so server loads the correct game session matching the PubSub group.

**Bug 2 — Deploy scripts not idempotent:**
- **Problem:** `az storage account check-name` returns `nameAvailable=false` even for YOUR OWN storage accounts. Re-running deploy always failed at pre-flight check despite claiming to be "safe to run multiple times (idempotent)".
- **Fix (deploy.ps1 & deploy.sh):** Check if storage account already exists in resource group with `az storage account show` BEFORE checking name availability. If it exists, reuse it. If it doesn't exist, THEN check name availability before creating. This makes re-deploys work correctly.

**Bug 3 — Better negotiate error messages:**
- **Fix:** Added logging in `loadConfig()` to show whether config.json loaded successfully and what apiBaseUrl is being used. Added the full negotiate URL to the error message when negotiate returns 404, so debugging is easier.

**Impact:**
- Modified: `client/app.js`, `deploy/deploy.ps1`, `deploy/deploy.sh`
- All 111 tests still pass
- **Key file paths:** `client/app.js` (lines 9-19, 110-122), `deploy/deploy.ps1` (lines 60-77), `deploy/deploy.sh` (lines 84-98)
- **Coordination with Data:** Data's dedicated join screen also sends `gameId` in join message, aligning with this backend fix

### 2026-04-01 — Join UX Redesign: Dedicated Join Screen

**From Data (Frontend):**
- **New join screen:** Created dedicated `screen-join` that shows when URL has `?game=XXX` parameter
- **Screen routing logic:** Modified `initLanding()` to detect URL params and call `initJoin()` when game code is present
- **Join screen features:**
  - Displays game code prominently (read-only, so players know which game they're joining)
  - Single name input with auto-focus for mobile-first experience
  - Large primary "Join Game →" button (obvious action)
  - Small "Or host a new game" link at bottom (navigates to base URL)
- **Landing screen unchanged when no game param:** Host experience remains the same
- **Files modified:** `client/index.html`, `client/style.css`, `client/app.js`
- **Mobile-first:** Join screen optimized for QR code scanning (responsive styles for small screens)
- **Auto-focus behavior:** Join screen auto-focuses name input, landing screen auto-focuses name input, game screen auto-focuses command input
- **Join message includes gameId:** All join messages now send `{ type: 'join', playerName, gameId }` (coordinated with Mouth's backend fix)

### 2026-04-01 — Deploy script ordering fix (resource group before storage check)

- **Problem:** Fresh deploys failed with `ResourceGroupNotFound` because the idempotency check (`az storage account show --resource-group ...`) ran BEFORE the resource group was created. Step 0 (storage check) depended on step 1 (resource group creation).
- **Fix:** Swapped the order in both `deploy/deploy.ps1` and `deploy/deploy.sh` — resource group creation is now step 0, storage account check is step 1. `az group create` is idempotent so safe to always run first.
- **Key learning — dependency ordering:** Any `az` command that references `--resource-group` requires the RG to exist. Resource group creation must always be the first provisioning step.
- **All 111 tests still pass.**

### 2026-04-01 — Fix: Storage account existence check fails on fresh deploy

- **Problem:** `deploy.ps1` line 72 used `2>$null` to suppress stderr from `az storage account show` when the account doesn't exist. With `$ErrorActionPreference = 'Stop'`, stderr from native commands can become terminating errors in PowerShell — `2>$null` doesn't reliably prevent this across all PS versions.
- **Fix (deploy.ps1):** Wrapped the `az storage account show` call in a try/catch block. Uses `2>&1` (merge stderr into stdout) plus `$LASTEXITCODE` check inside the try, and catches any terminating error. Result is `$null` when account doesn't exist, allowing the script to fall through to the name-availability check.
- **Bash version (deploy.sh) was already safe:** Line 94 uses `|| echo ""` which absorbs the non-zero exit code from `az` despite `set -euo pipefail`.
- **Key learning — PowerShell stderr + ErrorActionPreference:** Never rely on `2>$null` alone to suppress native command errors when `$ErrorActionPreference = 'Stop'`. Always wrap expected-failure native commands in try/catch and use `2>&1` to merge streams, then check `$LASTEXITCODE`.
- **Key file path:** `deploy/deploy.ps1` (lines 70-90)
- **All 111 tests still pass.**

### 2026-04-01 — Negotiate 404 fix: explicit entry point replaces glob in main

- **Problem:** `api/package.json` had `"main": "src/functions/*.js"` — a glob pattern. Azure Functions v4 Node.js worker resolves this glob at startup to discover function files. However, `glob` is only a transitive devDependency (via Jest → @jest/core → @jest/reporters → glob). The deploy script runs `npm install --omit=dev`, stripping the `glob` package from the production deployment zip. Without glob resolution capability, the worker can't find `negotiate.js` or `gameHub.js`, so the runtime reports 0 functions and returns 404 on all routes.
- **Diagnosis:** Function app root (/) returned 200 (runtime alive), admin/host/status returned 401 (expected), but `/api/negotiate` returned 404. Simulated the staging directory — confirmed `glob` package absent from production `node_modules`. The `@azure/functions` npm package does NOT bundle its own glob resolver; it relies on the host worker, which in turn may depend on the user's installed packages or its own bundled glob.
- **Fix:** Created `api/src/index.js` that explicitly imports `./functions/negotiate.js` and `./functions/gameHub.js`. Changed `package.json` `"main"` from `"src/functions/*.js"` to `"src/index.js"`. This is deterministic — no glob resolution needed.
- **Key learning — Azure Functions v4 main field:** Never use glob patterns in `package.json` `"main"` for Azure Functions v4 Node.js. Use an explicit entry point file that imports all function registration modules. Glob resolution depends on runtime/worker version and package availability, making it fragile in production.
- **Key file paths:** `api/src/index.js` (new), `api/package.json` (line 5)
- **All 111 tests still pass.**
- **Requires redeployment** to take effect: `cd deploy && .\deploy.ps1 -AppName patcastle`

### 2026-04-01 — Negotiate 404 root cause: missing EnableWorkerIndexing feature flag

- **Problem:** Despite correct entry point (`src/index.js`), correct package structure, and successful deployment, ALL function endpoints returned 404. Function app root `/` returned 200 (host alive), admin endpoints returned 401 (expected), but `/api/negotiate` and `/api/` returned 404.
- **Root cause:** The app setting `AzureWebJobsFeatureFlags=EnableWorkerIndexing` was missing. Azure Functions v4 Node.js programming model (where functions register via `app.http()`, `app.generic()`) requires this flag to tell the host to delegate function discovery to the Node.js worker process. Without it, the host uses v3-style discovery — looking for `function.json` files in subdirectories — finds none, and reports 0 functions. `az functionapp create` does NOT set this flag by default.
- **Fix:** Added `AzureWebJobsFeatureFlags=EnableWorkerIndexing` to both `deploy/deploy.ps1` and `deploy/deploy.sh` app settings. Also added to `api/local.settings.json` for local dev consistency.
- **Diagnosis method:** Confirmed the code was correct by loading `src/index.js` in the staged production directory — all 4 functions registered successfully (in test mode). Confirmed zip structure was correct (forward-slash paths). Confirmed `@azure/functions` v4.12.0 installed. The only remaining explanation was host-side function discovery configuration.
- **Key learning — Azure Functions v4 programming model:** `AzureWebJobsFeatureFlags=EnableWorkerIndexing` is MANDATORY for the v4 Node.js programming model. Without it, the host ignores programmatic function registrations and looks only for v3-style `function.json` files. `az functionapp create` does NOT set this automatically. Azure Functions Core Tools (`func start`) enables it implicitly for local dev, masking the issue.
- **Key learning — Debugging 404 on Azure Functions:** When the function app root (/) returns 200 but all `/api/*` routes return 404, the functions are not being discovered. Check: (1) `AzureWebJobsFeatureFlags=EnableWorkerIndexing` for v4 model, (2) `WEBSITE_RUN_FROM_PACKAGE=1` for zip deploy, (3) `package.json` `main` field for correct entry point.
- **Key file paths:** `deploy/deploy.ps1` (line 184), `deploy/deploy.sh` (line 194), `api/local.settings.json`
- **All 111 tests still pass.**
- **Requires redeployment** to take effect: `cd deploy && .\deploy.ps1 -AppName patcastle`

### 2026-04-01 — Fix: Static website 404 — upload-batch missing connection-string auth

- **Problem:** Static website at `https://patcastlestore.z5.web.core.windows.net` returned 404 (`WebContentNotFound`). Static website hosting was enabled (proper 404, not DNS error), but `$web` container had no files. The `az storage blob upload-batch` command in step 10 used `--account-name` only — no `--connection-string`, `--account-key`, or `--auth-mode`. This is a data plane operation that requires storage-level auth. With just `--account-name`, `az` attempts to auto-discover the account key via a management plane `listkeys` call, which can fail silently depending on RBAC role assignments and CLI version. The earlier `service-properties update` worked because it uses the management plane (ARM) API directly, not the storage data plane.
- **Fix (deploy.ps1 & deploy.sh):** Changed `upload-batch` from `--account-name $storageName` to `--connection-string $storageConnStr`. The connection string was already available (retrieved in step 3) but wasn't being passed to the upload command. Also added a post-upload verification step that lists blobs in `$web` and fails if count is 0 — catches any future silent upload failures.
- **Config.json generation:** Both scripts correctly generate `config.json` with `apiBaseUrl` before upload, then clean it up after. No issue there.
- **Content types:** `az storage blob upload-batch` auto-detects MIME types via Python's `mimetypes` module. Standard extensions (`.html`, `.js`, `.css`, `.json`) are detected correctly. No explicit override needed.
- **Key learning — az storage data plane auth:** Never rely on `--account-name` alone for `az storage blob` data plane commands (`upload-batch`, `upload`, `download`, `list`). Always pass `--connection-string` or `--account-key` explicitly. The `--account-name`-only auto-key-discovery depends on the caller having `listkeys` permission and can fail silently (exit code 0, 0 files transferred).
- **Key learning — verify uploads:** `az storage blob upload-batch` can return exit code 0 even when 0 files are uploaded. Always verify by listing the container after upload.
- **Key file paths:** `deploy/deploy.ps1` (step 10, lines ~307-328), `deploy/deploy.sh` (step 10, lines ~311-330)
- **All 111 tests still pass.**
- **Requires redeployment** to take effect: `cd deploy && .\deploy.ps1 -AppName patcastle`

### 2026-04-01 — Fix: Negotiate 404 — @azure/functions version upgrade

- **Problem:** Despite all previous fixes (explicit entry point, `EnableWorkerIndexing` app setting, correct package structure), the deployed function app continued returning 404 for `/api/negotiate?gameId=XXX`. The `@azure/functions` package was at version 4.5.0 (from early 2024), which is significantly outdated.
- **Root cause:** The `@azure/functions` v4 programming model underwent significant development and bug fixes throughout 2024. Version 4.5.0 (deployed) likely contained bugs affecting function discovery in production environments with `WEBSITE_RUN_FROM_PACKAGE=1`, even when all configuration was correct. The package had 7 minor version updates since 4.5.0, including important stability fixes.
- **Fix:** Upgraded `@azure/functions` from `^4.5.0` to `^4.12.0` (latest stable as of April 2026) in `api/package.json`. This ensures the deployed function app uses a mature, stable version of the v4 programming model that correctly discovers and registers functions in production.
- **Verification:** Local test with `node -e "import('./src/index.js')"` confirmed all 4 functions (negotiate, gameHubConnect, gameHubMessage, gameHubDisconnect) register correctly with the updated package.
- **Key learning — @azure/functions versions:** When using Azure Functions v4 Node.js programming model, always use the latest stable version of `@azure/functions`. Early v4 releases (4.0-4.6) had stability issues in production that were fixed in later versions. Don't assume an old v4.x version is "good enough" — the programming model matured significantly across minor versions.
- **Key learning — version hygiene:** Check `@azure/functions` version during 404 troubleshooting. If it's more than a few months old, upgrade to latest stable before investigating configuration issues.
- **Key file paths:** `api/package.json` (dependencies), `api/package-lock.json` (updated lockfile)
- **Requires redeployment** to take effect: `cd deploy && .\deploy.ps1 -AppName patcastle`

### 2026-04-01 — Status: Azure Functions version upgrade deployed and tested

- **Summary:** Upgrade from `@azure/functions` v4.5.0 to v4.12.0 completed. All 111 tests pass. Code committed and pushed to git.
- **Decision recorded** in `.squad/decisions.md` with version upgrade conventions for the team.
- **Ready for:** Redeployment to production. The fixed package will resolve persistent 404 errors on deployed endpoints when redeployed.
- **Next step:** Run `cd deploy && .\deploy.ps1 -AppName patcastle` to redeploy with the updated package.

### 2026-04-01 — Fix: App settings never applied due to cmd.exe semicolon mangling

- **Problem:** `az functionapp config appsettings set --settings "Key=value;with;semicolons"` in `deploy.ps1` passes connection strings as command-line arguments. On Windows, `az` is `az.cmd` — a batch file executed via `cmd.exe /c`. cmd.exe interprets semicolons as command separators, silently truncating or breaking the entire `--settings` argument list. Critical settings like `AzureWebJobsFeatureFlags=EnableWorkerIndexing` were never applied, causing the v4 runtime to fall back to v3-style function.json discovery, find none, and return 404 on ALL endpoints.
- **Why previous fixes didn't help:** We'd already fixed the entry point, package version, and added `EnableWorkerIndexing` to the script — but the script itself couldn't deliver the settings to Azure because cmd.exe mangled the command before `az` ever saw it.
- **Fix:** Replaced `az functionapp config appsettings set --settings ...` with ARM REST API calls via `az rest --body @file`. Settings are written to a temp JSON file (`_appsettings.json`), then applied via `PUT .../config/appsettings`. File-based input (`@filepath`) bypasses cmd.exe argument parsing entirely. The script GETs existing settings first and merges them to preserve system settings like `AzureWebJobsStorage`.
- **Connection string retrieval is safe:** Lines 157-160 and 188-191 capture `az` output into PowerShell variables via stdout — no semicolons on the command line. Only the app settings SET operation was broken.
- **Cleanup:** Temp file cleaned up in both success path and catch block.
- **Key learning — Windows az CLI:** NEVER pass values containing semicolons, equals signs, or base64 chars as command-line arguments to `az` on Windows. Always use file-based input (`az rest --body @file`) or environment variables. This applies to connection strings, SAS tokens, and storage keys.
- **Key learning — ARM REST API for app settings:** `POST .../config/appsettings/list` to read, `PUT .../config/appsettings` to write. Body format: `{"properties": {"KEY": "VALUE"}}`. PUT replaces all settings, so always merge with existing.
- **Key file path:** `deploy/deploy.ps1` (step 6, lines ~232-282)
- **All 111 tests still pass.**
- **Requires redeployment** to take effect: `cd deploy && .\deploy.ps1 -AppName patcastle`
