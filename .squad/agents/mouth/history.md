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

5. **Current status (2026-04-04)** — All 5 functions deployed and operational to patcastle-func. `/api/health` returns 200, game fully functional end-to-end. Deploy script has known issues fixed post-deploy: (1) Provisioning loop fails on systems with Azure CLI Python warnings to stderr. (2) WEBSITE_RUN_FROM_PACKAGE initially set to `1` which broke Linux Consumption (should be blob SAS URL). Both fixed manually; deploy script needs future hardening.

## Core Context

**Deployment learnings summarized (2026-03-31 to 2026-04-04):**

1. **Azure Functions v4 production:** Requires explicit `src/index.js` entry point (glob pattern fails). Upgrade @azure/functions to 4.12.0+ (4.5.0 has production bugs). After zip deploy, system keys rotate — always re-read and re-apply critical settings (`webpubsub_extension` key, `AzureWebJobsFeatureFlags`, connection strings).

2. **Windows Azure CLI edge cases:** `$ErrorActionPreference = 'Stop'` doesn't catch native command exit codes — must check `$LASTEXITCODE`. Semicolons in args bypass cmd.exe security — use ARM REST API with file-based JSON input for connection strings and sensitive values.

3. **Web PubSub hub webhook security:** `/runtime/webhooks/webpubsub` endpoint validates ONLY the `webpubsub_extension` system key. Master key fails silently (401). Always use `az functionapp keys list --resource-group <rg> --name <app> | grep webpubsub_extension`.

4. **Linux Consumption deployment:** `config-zip` with blob-based deployment sets `WEBSITE_RUN_FROM_PACKAGE` to a SAS URL (correct). Do NOT override to `1` — causes 503 (runtime looks in nonexistent local path). Full stop+start required post-deploy (not restart).

5. **Code deployment bug:** Commit `ed0f9f5` fixed double-serialization (`JSON.stringify` + SDK serialization) in `gameHub.js` but wasn't deployed initially. Redeployment fixed it; game now receives properly parsed messages.

6. **Validation before deployment:** npm install must be loud (no output piping without error checking). Staging directory must contain all 7 required files before zip creation. Post-deploy health check with retry tolerance for cold-start.

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-04-04 — Cross-Team: Data's Share Button + QR Overlay

**From Data (Frontend Dev):**
- **Share button UI:** Placed in game header (top right), accessible with keyboard navigation. Click copies game URL to clipboard.
- **Toast feedback:** 3-second auto-dismiss feedback on successful copy with visual indicator.
- **QR overlay:** Dismissible via X button, backdrop click, or Escape key. Responsive sizing for mobile and desktop.
- **Fallback:** If QR generation fails, overlay shows text URL with copy option.
- **Accessibility:** ARIA labels, semantic HTML, proper focus management.
- **No test regressions:** All 150 tests pass with new feature.

**Mouth's takeaway:** Share URL is game-specific (`?game=<6-char-code>`). Client generates it from `state.currentGameId`. QR is generated client-side only; no backend changes needed.

### 2026-04-04 — Say & Yell Verbs Implementation

- **Say verb:** Room-local only. `handleSay` sends `"PlayerName says: <text>"` to all other players in the same room, plus confirmation to the speaker. Already existed; no changes needed.
- **Yell verb:** Three-tier reach using BFS pathfinding. Same room: clear text + "players look annoyed" feedback. Adjacent room (1 exit away): text with directional hint from listener's perspective. Far room (2+ away): muffled yelling with general direction.
- **Command parser split:** `yell`/`shout` now map to verb `'yell'` (separate from `say`/`whisper` → `'say'`).
- **`findDirectionToRoom` BFS helper:** Uses `session.roomStates[].exits` (not `world.rooms[].exits`) so dynamically opened exits (from puzzles) are respected.
- **No gameHub.js changes needed:** The existing `routeResponses` function already handles per-player message routing — yell just generates more `{ playerId, message }` response entries.
- **All 150 tests pass** (including 38 new communication tests from Stef).

### 2026-04-04 — Duplicate Player Name Resolution

- **Feature:** When a player joins with a name already in use, the engine auto-renames them by prepending a random silly adjective (e.g., "Sparkly Pat"). Player is notified of their new name.
- **Pattern:** Added `resolvePlayerName(session, playerName)` as a new pure function in `game-engine.js`. Returns `{ name, wasChanged, originalName }`. Called by `gameHub.js` before `addPlayer`. This avoids changing `addPlayer`'s return type (which would break all 150 tests).
- **Key files:** `api/src/game-engine.js` (resolvePlayerName + SILLY_ADJECTIVES list), `api/src/functions/gameHub.js` (handleJoin wiring + player notification).
- **Name comparison is case-insensitive.** "pat" and "Pat" are treated as the same name.
- **Fallback:** If all 20 adjectives are exhausted (extremely unlikely), appends a number suffix instead.
- **All 150 existing tests pass.** No changes to `addPlayer` signature.


### 2026-04-04 — Deployment to Azure (Latest Code)

- **Deployed latest code** including health endpoint, say/yell verbs, share button, duplicate name handling, double-serialization fix.
- **Deploy script fixes applied:**
  1. **WEBSITE_RUN_FROM_PACKAGE**: Removed `=1` from initial settings, fallback, and post-deploy verification. On Linux Consumption, `config-zip` correctly sets this to a blob SAS URL. Overriding to `1` causes 503.
  2. **config-zip deletes local zip**: Added backup copy before retry loop so retries have a file to work with.
  3. **PYTHONWARNINGS=ignore**: Set at script top to suppress Azure CLI's Python cryptography UserWarning.
  4. **Function App start on creation**: If provisioning loop finds app in 'Stopped' state, explicitly starts it.
  5. **Must use `pwsh` (PS 7)** for deploys. PS 5.1 treats stderr warnings as terminating errors.
- **Endpoint verification:** `/api/health` -> 200, 3 functions loaded, webPubSub + tableStorage configured. Static site -> 200.
- **Game URL:** https://patcastlestore.z5.web.core.windows.net
- **Region:** `westus2` -- must pass `-Location westus2`.

### 2026-04-04 — Azure Developer CLI (azd) Template

- **Created azd template** alongside existing `deploy/deploy.ps1`. Existing script untouched.
- **Files added:**
  - `azure.yaml` — azd project definition with two services (`api` = Function App, `web` = static site)
  - `infra/main.bicep` — Subscription-scoped orchestrator (creates resource group, calls resources module)
  - `infra/resources.bicep` — All resources: Storage Account, Web PubSub (Free_F1), Function App (Linux Consumption Y1)
  - `infra/main.parameters.json` — azd environment placeholders (`AZURE_ENV_NAME`, `AZURE_LOCATION`)
  - `infra/abbreviations.json` — Standard azd resource naming abbreviations
- **Architecture decisions:**
  1. **Two-file Bicep pattern:** `main.bicep` at subscription scope creates the RG, then `resources.bicep` module deploys into it. This is the standard azd pattern for subscription-scoped deployments.
  2. **Static website hosting** cannot be enabled via Bicep (data-plane operation). Handled in `azure.yaml` postdeploy hook.
  3. **Web PubSub event handler** requires the Function App's `webpubsub_extension` system key (chicken-and-egg). Also handled in postdeploy hook with retry polling.
  4. **Client config.json** generated at deploy time in postdeploy hook (apiBaseUrl pointing to Function App).
  5. **Prepackage hook** copies `world/` into `api/` and runs `npm install --omit=dev` before packaging.
  6. **Resource naming:** Uses `uniqueString(subscription, env, location)` token for global uniqueness. Pattern: `st{token}`, `func-{token}`, `wps-{token}`.
  7. **CORS** set in Bicep to storage static website URL, then reinforced in postdeploy with the actual URL after static website is enabled.
  8. All app settings match exactly what `deploy/deploy.ps1` configures, including `AzureWebJobsFeatureFlags=EnableWorkerIndexing`.
- **Validation:** Both Bicep files compile clean (`az bicep build`). All 150 existing tests pass.

### 2026-04-04 — Cross-Team Update: Data's Client Fixes

**From Data (Frontend Dev):**

- **Clipboard helper** — Centralized clipboard access behind guard. All three clipboard sites (share button, overlay copy, lobby copy) now use `copyToClipboard()` with try/catch. If clipboard unavailable, UI continues normally (graceful degradation).
- **Look message deduplication** — Added 2-second same-room window in `handleServerMessage`. Prevents duplicate `look` messages (likely Web PubSub service echo) from rendering room twice, while still allowing intentional player-initiated "look" commands.
- **WebSocket cleanup** — `connectWebSocket()` closes any existing `state.ws` before new connection to prevent orphaned event listeners.
- **Mouth's takeaway:** No server-side changes needed. Client-side fixes are defensive and don't affect backend game logic. All 150 tests pass.