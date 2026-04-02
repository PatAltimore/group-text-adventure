# Project Context

- **Owner:** Pat Altimore
- **Project:** Group text adventure game — browser-based, text-based multiplayer game for 1-20 players. Rooms connected by compass directions, puzzles solved by collecting items, player inventories, host/join via URL or QR code.
- **Stack:** Azure (Web PubSub for WebSocket, Azure Functions for game logic, Azure Table Storage for persistence), JavaScript/TypeScript, HTML/CSS
- **Created:** 2026-03-31

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- **Client structure:** `client/index.html`, `client/style.css`, `client/app.js` — vanilla JS, no build step.
- **QR code:** Using `qrcode` npm package via CDN (`https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js`). Falls back to plain text if CDN fails.
- **WebSocket subprotocol:** `json.webpubsub.azure.v1` — messages wrapped in `sendToGroup` envelope with `dataType: json`. Server messages unwrapped from `data` field.
- **Screens:** Three screens — landing (name + host/join), lobby (QR + player list, host only), game (output + command input).
- **Message types:** `look`, `message`, `error`, `inventory`, `playerEvent`, `gameInfo` — each rendered with distinct styling.
- **Game IDs:** 6-char alphanumeric codes (no ambiguous chars like 0/O/1/I/L). Passed via `?game=` URL param.
- **Dark theme:** CSS custom properties in `:root` — easy to tweak colors globally.
- **Command history:** Up/Down arrow keys cycle through previous commands, stored in `state.commandHistory`.

### 2026-03-31 — Backend + Test suite complete

**From Mouth (Backend):**
- Azure Functions v4 game engine with pure game-engine.js (zero Azure imports)
- WebSocket message types: `look`, `message`, `error`, `inventory`, `playerEvent`, `gameInfo`
- `/api/negotiate?gameId=...` endpoint returns `{ url: "wss://...", gameId }`
- Connection ID doubles as player ID
- Backend API paths: `api/src/functions/negotiate.js`, `api/src/functions/gameHub.js`

**From Stef (Tester):**
- 111 tests (all passing) cover game engine and command parser
- Run tests with `npm test` from project root
- ESM modules required (`import`/`export`)

### 2026-03-31 — Azure Deployment Pipeline

**From Mouth (Backend):**
- `client/app.js` updated to load API endpoint from `config.json` (auto-generated at deploy time)
- Client falls back to relative paths for local dev
- Config file is gitignored and never committed
- Deployment architecture uses single Storage Account (Table Storage + static website hosting)

### 2026-04-01 — Deploy Bugfix: Client Protocol + QR Code

**From Mouth (Backend):**
- **Client message protocol:** Changed from `sendToGroup` to `event` type messages. Server was expecting `event` type, not `sendToGroup` envelope.
- **QR code CDN:** Downgraded from v1.5.4 to v1.4.4 with error handling (v1.5.4 had JS errors in some browsers)
- **Deploy scripts:** Added `WEBSITE_RUN_FROM_PACKAGE=1` env var to Linux zip deployment
- All 111 tests pass post-fix

### 2026-04-01 — Critical Backend Fix: Missing gameId + Deploy Idempotency

**From Mouth (Backend):**
- **CRITICAL bug — gameId missing in join message:** Players were all joining 'default' game regardless of URL. Fixed by adding `gameId` to join message so server loads correct session.
- **Deploy not idempotent:** Re-running deploy always failed. Fixed by checking storage account existence before name availability.
- **Better error messages:** Negotiate errors now show full URL for easier debugging.
- **Modified files:** `client/app.js`, `deploy/deploy.ps1`, `deploy/deploy.sh`
- **Impact:** All 111 tests pass. Requires Azure redeployment.

### 2026-04-01 — Join UX Redesign: Dedicated Join Screen

**Data (Frontend) Implementation:**
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
- **Join message includes gameId:** All join messages now send `{ type: 'join', playerName, gameId }` (coordinated with Mouth's backend gameId fix)
- **Coordination:** This work aligns with Mouth's fix to include gameId in backend, ensuring clients and server are synchronized

### 2026-04-01 — Negotiate 404 Investigation (Client-Side Audit)

**Issue:** Deployed game shows "Failed to connect: Negotiate failed: 404" when calling `https://patcastle-func.azurewebsites.net/api/negotiate?gameId=UPY6JE`.

**Client-side findings — ALL CORRECT, no changes needed:**
- **URL construction (app.js:130):** `${apiBaseUrl}/api/negotiate?gameId=${encodeURIComponent(gameId)}` — correct path, no double slashes, proper encoding
- **apiBaseUrl loading (app.js:9-22):** Loaded from `config.json`, trailing slashes stripped — correct
- **config.json generation (deploy.ps1:302):** Writes `https://${functionAppName}.azurewebsites.net` — no trailing slash, correct domain
- **HTTP method:** `fetch()` defaults to GET, negotiate function expects GET — correct
- **Route match:** Server `route: 'negotiate'` → `/api/negotiate` (Azure Functions v4 default prefix). Client calls `/api/negotiate` — matches
- **Error display (app.js:132):** Shows status code AND full URL in error message — good for debugging
- **CORS:** Deploy script configures CORS with static website origin. A CORS failure would show as a CORS error, not 404
- **Conclusion:** The 404 is a server-side issue (function app runtime not serving the negotiate function). Client is correct.

### 2026-04-01 — Static Website 404 Investigation

**Issue:** Static website at `https://patcastlestore.z5.web.core.windows.net` reported returning 404 (`WebContentNotFound`).

**Investigation findings:**
- **Website is NOW serving correctly** — HTTP 200 on all files (index.html, style.css, app.js, config.json)
- **Deployed app.js matches local repo** — content is up to date
- **config.json correctly points to** `https://patcastle-func.azurewebsites.net`
- **deploy.ps1 already fixed** (commit `0334f01`) — uses `--connection-string` instead of `--account-name` for blob uploads, plus upload verification
- **deploy.sh already had** `--connection-string` and verification — PowerShell was the lagging script

**Root cause:** The original `deploy.ps1` used `--account-name` for `az storage blob upload-batch`, which relies on Azure CLI auto-detecting storage keys. This can fail silently (exit 0 with 0 files uploaded). The bash script (`deploy.sh`) already used `--connection-string` and had upload verification. The PowerShell script was missing both.

**Key takeaway:** Always use `--connection-string` for Azure Storage CLI commands in deploy scripts, and verify uploads by counting blobs in the container after upload-batch.

### 2026-04-01 — Status: Negotiate 404 investigation re-confirmed (client correct)

- **Summary:** Re-audited client-side negotiate call per Mouth's findings on backend version issue. All client-side code confirmed correct:
  - URL construction: `${apiBaseUrl}/api/negotiate?gameId=${encodeURIComponent(gameId)}` ✅
  - HTTP method: GET (default, matches backend expectation) ✅
  - Config loading: Proper fallback logic for dev/prod ✅
  - Error handling: Shows status code and full URL for debugging ✅
  - CORS: Deploy script configures correctly, not the issue ✅
- **Conclusion:** 404 is a backend-only issue (Function App not serving the endpoint). No client-side changes needed.
- **Coordination with Mouth:** Backend issue diagnosed as version bug in `@azure/functions` v4.5.0. Mouth upgraded to v4.12.0. This resolves the 404 when redeployed.
- **Decision recorded** in `.squad/decisions.md` documenting the investigation and resolution findings.

### 2026-04-01T23:59:00Z — Final Session: Static Site 404 Debug

**Team Update from Scribe:**
- **Data:** Verified all client file structure is valid. Relative paths correct. QR code CDN fallback properly configured. WebSocket subprotocol implementation matches spec. Minor suggestion: consider `href="."` → `href="./"` for relative path consistency.
- **Mouth:** Debugged and fixed 3 compounding issues in deploy.ps1:
  1. Environment variable auth not guaranteed — switched to explicit `--account-name` + `--account-key` params
  2. Static website hosting could be disabled during operations — added defensive re-enable at step 10
  3. Upload verification only checked count >= 1 — now verifies `index.html` specifically exists
- **Outcome:** 111 tests pass. Code committed and pushed.
- **Coordination:** Client files validated and ready for deployment. All issues were deployment script concerns, not client code.

