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

### 2026-04-05 — Multi-World Support: World Selection + Two New Adventures

- **New worlds created:**
  - `world/space-adventure.json` — "The Derelict Station": 10 rooms, 10 items, 6 puzzles. Derelict space station theme. Players explore airlock→corridors→medical/cargo/crew→lab→reactor→command deck. Puzzles use `openExit` (4), `removeHazard` (1), `addItem` (1). Items scattered across maintenance bay, cargo hold, crew quarters, quarantine requiring multi-player coordination.
  - `world/escape-room.json` — "The Clockmaker's Mansion": 10 rooms, 10 items, 7 puzzles. Escape room theme. Players explore ground floor → upper floor → secret workshop → observatory. Heavy puzzle density. Multi-step chains (fix music box with gear piece, then use it as a key). Puzzles use `openExit` (5), `removeHazard` (1), `addItem` (1).

- **New endpoint: `GET /api/worlds`** (`api/src/functions/worlds.js`)
  - Scans `world/` directory for JSON files, returns `[{ id, name, description }]`
  - Uses same candidate-directory pattern as `gameHub.js` (deployed + local dev paths)
  - Registered in `api/src/index.js`

- **`gameHub.js` changes:**
  - `getDefaultWorld()` refactored into `getWorld(worldId)` — loads `world/{worldId}.json`
  - `getDefaultWorld()` preserved as backward-compatible wrapper
  - `handleJoin` reads `data.worldId` when creating new session (first player = host). Defaults to `'default-world'` if not provided.
  - `worldId` saved in `saveGameSession()` metadata alongside `worldName`, `createdAt`, `hostConnectionId`
  - Players joining an existing game are unaffected — `worldId` only matters at session creation

- **Key design decisions:**
  - World ID = filename without `.json` (e.g., `space-adventure`, `escape-room`, `default-world`)
  - `worldId` is optional in join message — full backward compatibility
  - World files validated: all room/item/puzzle cross-references verified, all hazard strings match exactly
  - All 150 existing tests pass. No regressions.

### 2026-04-05 — Fix: Remove `web` Service from azure.yaml

- **Problem:** `azd up` failed during deploy with `resource not found: unable to find a resource tagged with 'azd-service-name: web'`. The `web` service was declared as `host: staticwebapp`, but the Bicep infra provisions a Storage Account, not a Static Web App.
- **Fix:** Removed the `web:` service block (5 lines) from `azure.yaml`. Client deployment was already handled by the global `postdeploy` hook, which uploads files to the Storage Account's `$web` blob container, generates `config.json`, and configures CORS.
- **Lesson:** When the deployment mechanism for a service is a custom hook (not azd's built-in service deployment), do NOT declare it as an azd service. azd will try to find a matching tagged Azure resource and fail.

### 2026-04-05 — Investigation: /api/worlds Dropdown "Loading..." Issue

- **Symptom:** World selector dropdown on live site showed "Loading..." and never populated. Suspected backend `/api/worlds` endpoint failure.
- **Root cause (backend):** The worlds endpoint code was structurally correct — path resolution matched gameHub.js pattern, index.js imported it, and the live endpoint returned data. The real issue was **observability**: silent error handling meant failures wouldn't surface in Application Insights, and health.js's hardcoded `functionsLoaded` list didn't include `'worlds'`, making diagnostics misleading. Deploy scripts also didn't validate `worlds.js` was in the staging package.
- **Fixes applied:**
  1. `worlds.js` handler: Added try/catch with `context.log` and `context.error` for Application Insights visibility. Returns 500 with error body on failure instead of crashing.
  2. `health.js`: Updated `functionsLoaded` list to include `'worlds'`.
  3. `deploy.ps1` + `deploy.sh`: Added `worlds.js` to required staging file validation.
- **Client-side fix (by Pat):** Separate commit added 5-second AbortController timeout and resilient fallback to `loadWorlds()`.
- **Key lesson:** Every new Azure Function endpoint needs: (1) logging in handler, (2) health.js list update, (3) deploy script validation entry. Silent error paths in production are invisible.

### 2026-04-05 — World Selector: Timeout + Loading Indicator Fix

- **Problem 1:** `loadWorlds()` had a 5-second AbortController timeout that was too aggressive for Azure Functions Consumption plan cold starts (10-30s). The fetch would time out and the fallback kicked in, showing only "The Forgotten Castle" instead of all 3 adventures.
- **Fix:** Increased timeout from 5000ms to 15000ms. Added "Loading adventures..." disabled placeholder option while fetch is in progress, replaced with actual worlds on success. Dropdown is disabled during load and re-enabled in `finally` block.
- **Problem 2 (non-issue):** World selector CSS was already fully styled — `#world-selector`, `.world-selector-group`, `.world-selector-label` all had matching dark theme styles (same bg, text, border, font as input fields). Custom dropdown arrow SVG included. No CSS changes needed.
- **All 204 tests pass.** No server-side changes.

### 2026-04-05 — Fix: "Left the Game" Shown on Room Movement

- **Bug:** When a player moved rooms (e.g., "go north"), other players in the old room saw "PlayerName has left the game." instead of "PlayerName went north." The player was also incorrectly removed from the client-side player list.
- **Root cause (two-part):**
  1. **game-engine.js:** Movement departure events used `event: 'left'` — same event name as disconnects. The `text` field had the correct directional message but the client ignored it.
  2. **client/app.js:** `handlePlayerEvent()` hardcoded `'has left the game.'` for all non-join events, ignoring `msg.text`. Also removed player from `state.players` on any `event: 'left'`, including room movement.
- **Fix:**
  1. Changed movement departure event from `event: 'left'` to `event: 'moved'` in `game-engine.js` (line 263). This makes movement and disconnect semantically distinct.
  2. Updated `handlePlayerEvent()` in `client/app.js` to use `msg.text` when present (covers movement and arrival messages). Falls back to "has joined/left the game" for events without text (join/disconnect).
  3. Player list removal now only triggers on `event: 'left'` (actual disconnect), not `event: 'moved'`.
- **Key files:** `api/src/game-engine.js`, `client/app.js`, `tests/game-engine.test.js`.
- **All 204 tests pass.** One test assertion updated (`'left'` → `'moved'` in departure notification test).

### 2026-04-05 — Synchronized Game Start Flow

- **Feature:** Host sends `{ type: 'startGame' }`, server broadcasts `{ type: 'gameStart', room: {view} }` to all players in the group so everyone transitions from lobby to game simultaneously.
- **Implementation in `gameHub.js`:**
  1. **Host tracking:** `session.hostPlayerId` set to the creating player's ID on game creation. Persisted in game state via `saveGameState`.
  2. **`handleStartGame` handler:** Verifies sender is host, prevents double-start, sets `session.started = true`, builds start room view (name, description, exits, items, all player names, hazards), broadcasts `gameStart` to group.
  3. **`handleJoin` conditional room view:** Pre-start joins get `gameInfo` WITHOUT `room` (client stays in lobby). Post-start late joiners get `gameInfo` WITH `room` (existing behavior).
  4. **Message routing:** `startGame` added as third message type alongside `join` and `command`.
- **Key design:** Room view in `gameStart` broadcast includes ALL player names (not per-player filtered), since it's a group broadcast. Client handles self-filtering.
- **All 204 tests pass.** No game-engine.js changes needed — all logic is in gameHub.js.

### 2026-04-05 — Fix: Player List Missing Previously-Joined Players

### 2026-04-05 — Fix: Ghost Reclamation Bug (Reconnect vs Duplicate Name)

- **Bug:** When a new player joined with the same name as an existing ghost, the server treated it as a reconnection instead of a duplicate name. The ghost was reclaimed by a stranger instead of giving them an adjective-prefixed name.
- **Root cause:** `handleJoin` in `gameHub.js` matched ghost names unconditionally — no way to distinguish "returning player" from "new player who picked the same name."
- **Fix (3 files):**
  1. **`client/app.js`:** Added `rejoin: true` flag to the join message when `state.pendingRejoin` is set (auto-rejoin from localStorage). This is a protocol-level change, not a UI change.
  2. **`gameHub.js`:** Ghost reclamation and active-player takeover are now gated behind `data.rejoin === true`. Without the flag, the join falls through to normal duplicate-name resolution.
  3. **`game-engine.js`:** `resolvePlayerName` now includes ghost names in the "taken" set, so new players picking a ghost's name get an adjective prefix.
- **Tests:** 6 new tests in `Duplicate Name vs Reconnection` describe block. All 263 tests pass.

- **Bug:** When a player joined the lobby, their player list only showed players who joined *after* them. Players who joined before were missing because those `playerEvent` broadcasts were sent before the new player's WebSocket connected.
- **Fix:** Added a `players` array (all current player names) to the `gameInfo` message in `handleJoin`. Now every new joiner gets a complete snapshot of who's already in the game. Also added `players` to the disconnect `gameInfo` broadcast for consistency.
- **Message contract:** `gameInfo.players` = `string[]` of player names. `gameInfo.playerCount` kept for backward compat.
- **Key line:** `Object.values(session.players).map((p) => p.name)` — same pattern used in `handleStartGame` for room views.
- **All 204 tests pass.** Single file changed: `api/src/functions/gameHub.js`.

### 2026-04-06 — Player Reconnection & Inventory Drop

- **Feature 1: Reconnection with state persistence.** When a player disconnects (phone standby, network drop, browser refresh), their state is preserved in `session.disconnectedPlayers` rather than being removed. Rejoining with the same name reconnects them with their room, inventory, and progress intact.
- **Feature 2: Inventory drop on true disconnect.** After a 5-minute timeout, disconnected players are finalized — their inventory is dropped into their last room, nearby players are notified, and the player is fully removed.
- **Architecture — Design B (separate map):** Disconnected players are moved to `session.disconnectedPlayers` (a separate object), NOT flagged within `session.players`. This means all existing game logic (movement notifications, say, yell, give, room views) automatically excludes disconnected players with zero changes to those functions.
- **New game-engine.js exports:** `disconnectPlayer`, `findDisconnectedPlayerByName`, `reconnectPlayer`, `getExpiredDisconnectedPlayers`, `finalizeDisconnectedPlayer`. All pure functions, no Azure dependencies.
- **gameHub.js changes:**
  1. Disconnect handler calls `disconnectPlayer` (not `removePlayer`), sends `event: 'disconnected'` (not `'left'`).
  2. Join handler checks `findDisconnectedPlayerByName` before `resolvePlayerName`. If match found, calls `reconnectPlayer`, sends `event: 'reconnected'` and `gameInfo.reconnected: true`.
  3. Host player ID updated on reconnection (`session.hostPlayerId`).
  4. `cleanupExpiredPlayers` called at start of `handleJoin`, `handleCommand`, `handleStartGame` — since Azure Functions is stateless with no timers, cleanup is triggered by next player activity.
- **Message protocol additions:**
  - `playerEvent.event: 'disconnected'` — player dropped connection, may reconnect.
  - `playerEvent.event: 'reconnected'` — player returned.
  - `playerEvent.event: 'left'` — player truly gone (timeout expired).
  - `gameInfo.reconnected: true` — tells reconnecting client to restore state.
- **Timeout:** `DISCONNECT_TIMEOUT_MS = 5 * 60 * 1000` (5 minutes) in gameHub.js.
- **All 231 tests pass** (204 existing + 27 new reconnection/drop tests).
### 2026-04-05 — Ghost Player System

- **Replaced disconnectedPlayers map with session.ghosts.** When a player disconnects, a visible ghost entity is created in their room (keyed by player name, not player ID). Ghosts hold the player's inventory and room position.
- **Ghost structure:** { playerName, room, inventory: [...], disconnectedAt } stored in session.ghosts[playerName].
- **Room visibility:** getPlayerView now returns ghosts: ["Alice's ghost"] array. Added getGhostsInRoom() helper.
- **Loot command:** loot Bob's ghost transfers all items from ghost to player. Ghost fades away (deleted) when inventory is emptied. Room notified.
- **Take from ghost:** 	ake <item> from <name>'s ghost takes a single item. Ghost fades when last item taken.
- **Reconnection via ghost:** indGhostByName + econnectPlayer(session, ghostName, newPlayerId) — restores player to ghost's room with remaining inventory. Ghost removed.
- **Ghost timeout:** Changed from 5 minutes (disconnect model) to 30 minutes (GHOST_TIMEOUT_MS). inalizeGhost drops items to room floor when timeout expires.
- **Command parser:** Added loot verb set. Extended 	ake to parse 	ake <item> from <target> pattern.
- **gameHub.js:** Disconnect handler announces ghost to room players. Join handler checks for ghost match. Cleanup uses cleanupExpiredGhosts.
- **250 tests pass** (19 net new: ghost looting, take-from-ghost, multi-ghost rooms, reconnection-after-partial-loot).

### 2026-04-05 — Reconnection Bug Fix (Ghost Reclamation + Stale Disconnect)

**Root cause:** Three issues combined to break the reconnect flow:
1. **Missing `text` on reconnection playerEvent** — server sent `event: 'reconnected'` without a `text` field, so the client fell through to "has left the game" for other players.
2. **Missing `inventory` and `ghosts` on reconnection gameInfo** — client checked `msg.inventory` but server never sent it; reconnecting player didn't see their restored items.
3. **Stale disconnect race condition** — if the new join arrived before the old disconnect was processed, the old player entry was still active. No ghost existed, so the reconnecting player got a silly name instead of reclaiming their session.

**Fixes in gameHub.js:**
- **Disconnect handler:** Added guards to skip ghost creation when the player is already removed from session or has reconnected with a new connectionId.
- **Join handler (ghost reclamation):** Now sends `inventory` (item display names) and `ghosts` array in the gameInfo response. Adds `text` field to the reconnected playerEvent broadcast.
- **Join handler (active player takeover):** New code path — if no ghost exists but an active player has the same name with a different connectionId, takes over that player's state directly (handles the race where disconnect hasn't fired yet).
- **Normal join gameInfo:** Now includes `reconnected: false` and `ghosts` array for consistency.
- **256 tests pass** (6 net new: reconnection edge cases).

### 2026-04-04 — Fix: Stale Inventory on Reconnection (gameInfo Format Bug)

**Bug:** When a player reconnected via ghost reclamation, the `gameInfo` response sent inventory as an array of plain strings (item names). The client's `renderInventoryMessage` expects an array of objects with `.name` and `.description` properties. This caused blank/undefined inventory display on reconnect.

**Root cause:** `gameHub.js` `handleJoin` built `inventoryNames` using `item.name` strings, but the client uses `item.name` as an object property access — so string items produced `undefined`.

**Fix:** Changed `gameHub.js` lines 430-433 to build inventory as `{ name, description }` objects (matching the format from `handleInventory` in `game-engine.js`). The reconnection `gameInfo.inventory` now matches the regular `inventory` message format the client already handles correctly.

**Test added:** `gameInfo inventory after ghost reclamation has name+description objects` — verifies the inventory format after ghost reclamation produces objects with `name` and `description` fields, not bare strings. **257 tests pass.**

### 2026-04-06 — Player ID System (Ghost Matching by playerId, Not Name)

- **Bug fixed:** Reconnection was broken after the `rejoin: true` gate was added — it matched by name, so returning players created new players instead of reclaiming their ghost. A different player picking the same name could also steal the ghost if they somehow sent `rejoin: true`.
- **Design change:** Introduced a unique `playerId` (UUID via `crypto.randomUUID()`) as the persistent identity. Name is now just a display label.
- **game-engine.js changes:**
  1. `disconnectPlayer` now copies `player.playerId` into the ghost entity.
  2. New `findGhostByPlayerId(session, playerId)` function — searches `session.ghosts` by the stored `playerId` field (exact match, not case-insensitive like name).
  3. `reconnectPlayer` now preserves `ghost.playerId` in the restored player state.
- **gameHub.js changes:**
  1. `import { randomUUID } from 'crypto'` and `findGhostByPlayerId`.
  2. Normal join: generates `uniquePlayerId = randomUUID()`, stores in `session.players[id].playerId`.
  3. Reconnection: uses `findGhostByPlayerId(session, data.playerId)` as primary match (not `findGhostByName`).
  4. Active player takeover: matches by `p.playerId === clientPlayerId` (not name).
  5. Both normal join and reconnect gameInfo include `playerId` field so client can persist it.
  6. Gate logic: `isRejoin && clientPlayerId` — both flags must be present for reconnection attempt.
- **Message protocol change:** `gameInfo` now includes `playerId: string` (UUID) on both first join and reconnect.
- **Key principle:** `playerId` is identity, `name` is display label. Ghost matching uses playerId; name collisions go to adjective resolution.
- **11 new tests** in `Player ID System` describe block + 2 updated existing tests. **All 274 tests pass.**

### 2026-04-06 — Fix: Auto-Reconnect Missing pendingRejoin Flag

**Bug:** When a player's WebSocket dropped (network blip, phone standby) and the client auto-reconnected via `attemptReconnect()` or the "tap to reconnect" banner (`manualReconnect()`), the server created a new player instead of reclaiming the ghost.

**Root cause:** `attemptReconnect()` and `manualReconnect()` called `connectWebSocket()` without setting `state.pendingRejoin = true`. The on-open handler only sends `rejoin: true` and `playerId` when `pendingRejoin` is set. Without the flag, the join message was a plain join — no rejoin, no playerId — so the server's ghost matching was never even attempted.

**Fix (client/app.js):**
- `attemptReconnect()`: Added `if (state.playerId) state.pendingRejoin = true;` before `connectWebSocket()` call.
- `manualReconnect()`: Same fix.
- Guard on `state.playerId` ensures we only attempt rejoin when we have an identity to reclaim.

**Also committed (gameHub.js diagnostics):**
- BinaryData-safe parsing of `request.data` (handles Buffer, ArrayBuffer, string, object).
- `[JOIN]` diagnostic logs: rejoin flag type, ghost list + playerIds, active player list, match outcomes, fallthrough to new-player path.
- These logs appear in Azure Application Insights for live debugging.

**All 274 tests pass.**

### 2026-04-06 — Ghost Persistence: No Expiration, Loot Keeps Ghost

**Three behavior changes to ghost system:**

1. **Looting/taking from ghost no longer removes it.** `handleLoot` and `handleTakeFromGhost` transfer items but leave the ghost in the room with empty inventory. No more "fades away" messages on loot. Ghost remains visible as a placeholder for the disconnected player.

2. **Reconnection uses ghost's room (verified).** `reconnectPlayer` already places the player in `ghost.room` — no code change needed. Even after looting empties inventory, reconnecting reclaims the ghost's position (empty inventory, ghost's room).

3. **Ghost expiration removed entirely.** Deleted `getExpiredGhosts` and `finalizeGhost` from `game-engine.js`. Deleted `cleanupExpiredGhosts` function and all 3 call sites from `gameHub.js`. Removed `GHOST_TIMEOUT_MS` constant. Ghosts persist indefinitely until player reconnects.

**Files changed:**
- `api/src/game-engine.js` — removed `getExpiredGhosts`, `finalizeGhost` exports; removed ghost deletion from `handleLoot` and `handleTakeFromGhost`
- `api/src/functions/gameHub.js` — removed `cleanupExpiredGhosts` function, 3 call sites, `GHOST_TIMEOUT_MS` constant, and imports
- `tests/game-engine.test.js` — removed 13 expiration/finalize tests, updated 4 loot/take tests to expect ghost persistence, added 1 new visibility test

**All 262 tests pass** (274 - 13 removed + 1 new).

### 2026-04-07 — World JSON Validation Utility

- **Created `world/validate-world.js`** — universal ES module that exports `validateWorld(worldData)`. Works in both browser and Node.js. Returns `{ valid: boolean, errors: string[], warnings: string[] }`.
- **Validation errors (block game start):** missing/empty name, invalid startRoom, no rooms, rooms missing name/description/exits, invalid exit directions, exits to non-existent rooms, items referenced in rooms not defined in items section, items missing name/description, puzzle room/requiredItem/targetRoom referencing non-existent entities.
- **Validation warnings (logged, don't block):** non-bidirectional exits (excluding puzzle-gated ones), orphan rooms with no inbound connections, items defined but never placed, empty rooms (no items or hazards).
- **Integrated into `loadWorld()` in `api/src/game-engine.js`:** validation runs on every world load. Errors throw (blocking). Warnings are logged via `console.warn`.
- **All 3 existing worlds pass validation.** escape-room has 2 expected warnings (empty rooms: upper-hallway, guest-bedroom — those rooms have puzzle interactions but no initial items/hazards).
- **All 279 tests pass.** No test changes needed.

### 2026-04-07 — Fix: Give Command Notification Bug

- **Bug:** `handleGive` in `game-engine.js` used JS shorthand `targetId,` in the response object, creating `{ targetId: "..." }` instead of `{ playerId: "..." }`. The `routeResponses` function in `gameHub.js` keys on `resp.playerId`, so the recipient's notification was silently dropped.
- **Fix:** Changed `targetId,` to `playerId: targetId,` so the message routes correctly.
- **Added bystander notifications:** Other players in the same room now see `"{Player} gave {item} to {Target}."` — consistent with how `say`, `yell`, and `loot` notify room occupants.
- **Tests:** Added 2 new test cases — one verifying the receiver gets `playerId`-keyed notification, one verifying bystanders see the exchange. All 142 game-engine tests pass.