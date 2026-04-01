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
