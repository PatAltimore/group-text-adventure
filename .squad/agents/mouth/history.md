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

### 2026-04-06 — Hazard Multiplier Feature (Backend)

- **Added `hazardMultiplier` to session state:** Initialized in `startGame`, defaults to 1.0
- **`checkHazards()` integration:** Multiplier applied to hazard trigger probability on every command
- **New handler:** `setHazardMultiplier` message handler for client to update setting (validates 0.5–2.0 range)
- **Files:** `api/src/game-engine.js`, `api/src/functions/gameHub.js`
- **Integration:** Works with frontend dropdown (Low/Medium/High) and Stef's test suite
- **Status:** All backend components complete, tested

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

### 2026-04-06 — Inventory Item Descriptions + Hazard Death System

Two features implemented:

**Feature 1: Item Descriptions Separated from Room Descriptions**
- Room descriptions in all 3 world JSONs (`default-world.json`, `escape-room.json`, `space-adventure.json`) no longer mention portable items (e.g., removed "clutching a golden key" from dungeon description).
- `getPlayerView()` now returns items as `{id, name, description}` objects instead of name strings.
- `handleInventory()` also returns items with `{id, name, description}`.
- Items are discovered via the room's item list, not embedded in description prose.

**Feature 2: Hazard Death System**
- Hazards are now structured objects: `{ description, probability, deathText }`.
- Old string hazards normalized by `loadWorld()` to `{ description: str, probability: 0, deathText: '' }` (backward compatible).
- `validate-world.js` updated to validate both old-style strings and structured hazard objects.
- `killPlayer(session, playerId)` creates a death ghost (`isDeath: true`, `diedAt` timestamp); player can be looted.
- `respawnPlayer(session, ghostName, newPlayerId)` drops remaining ghost items into the room, recreates player with empty inventory.
- `handleGo` checks hazards on room entry; `Math.random() < probability` triggers death.
- Death response: `{ type: 'death', deathText, timeout }`.
- `gameHub.js`: added `setDeathTimeout` (host-only, lobby-only, 15-60s range) and `respawn` message handlers.
- `gameStart` message now includes `deathTimeout`.
- Dead player message routing in `handleCommand`: if player is killed, their responses are sent directly via `connectionId`.
- `applyPuzzleAction` `removeHazard` updated to match on `h.description` for structured hazards.
- `createGameSession` sets `deathTimeout: 30` as default.
- All 397 tests pass (346 original + 51 new pre-written tests for these features).
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

### 2026-04-05 — World JSON Validation Module Completed

- **Status:** `world/validate-world.js` finished with 13 validation rules + 4 warning types. Universal ES module (browser + Node.js).
- **Integration:** Imported in `api/src/game-engine.js` `loadWorld()`. Errors throw; warnings logged via `console.warn` (visible in Azure Application Insights).
- **Coverage:** All 3 world files pass validation. escape-room has 2 expected empty-room warnings (puzzle-gated rooms with no initial items).
- **Test status:** All 279 tests passing. 55 new validation tests from Stef, 53 pass immediately, 2 gaps found and fixed.
- **Deployment:** Code merged and deployed to Azure. `/api/health` endpoint returning 200. Game fully operational end-to-end.

### 2026-04-07 — Fix: Start Adventure Button Grays Out But Game Doesn't Start

- **Bug:** Host clicks "Start Adventure" → button disables → game never starts. All players stuck in lobby.
- **Root cause:** `handleStartGame` sent `gameStart` exclusively via `sendToGame` (Web PubSub group broadcast using `serviceClient.group(gameId).sendToAll()`). The `sendToGame` helper wraps the call in try/catch and silently logs failures. If the group broadcast failed (stale group membership, service hiccup, connection not in group), the message was dropped and nobody received `gameStart`. Zero error handling in `handleStartGame` meant all exceptions were invisible to the client — the Azure Functions runtime swallowed them.
- **Fix (3 changes):**
  1. **Per-player `sendToConnection` instead of group broadcast.** `handleStartGame` now iterates `session.players` and sends `gameStart` to each player's `connectionId` directly — the same reliable delivery path used for `gameInfo`, errors, and all other direct messages. Each player also gets a personalized room view via `getPlayerView` (correct "other players" list + ghosts).
  2. **try/catch with client notification.** The entire handler is wrapped in try/catch. On error: logs via `context.error` (visible in Application Insights) AND sends `{ type: 'error', text }` to the host's connection so the failure is visible in the UI.
  3. **Diagnostic logging.** `[START]` prefixed logs trace connectionId, gameId, hostPlayerId match result, player count, and success/failure.
- **Tests:** 11 new tests in "Start Game — Initial Room View" block: getPlayerView correctness for startGame, JSON round-trip integrity, hostPlayerId persistence, ghost visibility, multi-player views.
- **All 346 tests pass** (335 existing + 11 new).
- **Key lesson:** Never rely solely on Web PubSub group broadcast for critical state transitions. `sendToConnection` (direct to known connectionId) is more reliable. Group broadcast is fire-and-forget with no delivery guarantee to the caller. Always pair critical broadcasts with error handling and client-visible error paths.

### 2026-04-06 — Deployment to Azure (Latest Code)

- **Deployed latest code** via `deploy/deploy.ps1 -appName patcastle -Location westus2`.
- **Deploy attempt 1 failed** (transient), retry succeeded automatically.
- **Stop/start cycle** performed by deploy script after zip deploy.
- **Verification results (all pass):**
  - `/api/health` → 200, status `ok`, runtime v20.20.1, 4 functions loaded (negotiate, gameHub, health, worlds), webPubSub + tableStorage configured.
  - `/api/worlds` → 200, returns 3 worlds (default-world, escape-room, space-adventure).
  - `/api/negotiate?gameId=test` → 200, returns valid `wss://` URL with JWT.
- **Client files uploaded** to `$web` container (7 files including config.json).
- **Static site verified** live at `https://patcastlestore.z5.web.core.windows.net`.
- **All 346 tests** remain passing (no code changes, deploy only).
### 2026-04-05 — Death Message Field Name Fix

**Bug:** In `api/src/game-engine.js` (line ~526), the hazard death response sent `text: h.deathText` but the client (`app.js`) reads `msg.deathText`. This meant the death description never reached the player — they always saw the fallback "You have died." message.

**Fix:** Changed `text: h.deathText` to `deathText: h.deathText` in the death message payload. One-line change, no other fields affected. The `playerEvent` messages sent to other players already used the correct field name.
### 2026-04-05 — Hazards Check on Every Gameplay Command

**Architectural change:** Extracted hazard death check from `handleGo` into a standalone `checkHazards(session, playerId)` function. Previously, hazards only threatened players when entering a room (`go` command). Now hazards are checked after every gameplay command (go, look, take, loot, drop, use, give, say, yell) via `processCommand`. Meta commands (help, inventory) and invalid commands skip the check. The function is exported for direct test access.
### 2026-04-07 — Hazard Death Probability Multiplier

**Feature:** Hosts can now set hazard danger level (Low/Medium/High) from lobby before game start. Medium (1.0x) is default.

**Backend changes:**
1. **pi/src/game-engine.js:**
   - createGameSession: Added hazardMultiplier: 1.0 to session initialization
   - checkHazards: Modified probability calculation to use Math.min(1, h.probability * (session.hazardMultiplier || 1)) — multiplies world file probability by session multiplier, capped at 1.0 to prevent probabilities >100%

2. **pi/src/functions/gameHub.js:**
   - Added handleSetHazardMultiplier handler (mirroring handleSetDeathTimeout pattern):
     * Validates connection, game session, host-only permission
     * Only allows changes before game start
     * Accepts data.multiplier (0.5, 1, or 2), rejects invalid values
     * Maps to user-facing text: 0.5→Low, 1→Medium, 2→High
   - Added routing for setHazardMultiplier message type
   - Modified handleStartGame to accept optional data.hazardMultiplier and apply it at start
   - Added hazardMultiplier to gameStart message payload sent to clients (alongside deathTimeout)

**Multiplier values:**
- Low = 0.5 (halves world file probability)
- Medium = 1.0 (uses world file probability as-is)
- High = 2.0 (doubles world file probability)

**All 346 tests** still passing (no breaking changes to existing behavior).

### 2026-04-07 — Displaced Item Detection in getPlayerView

**Feature:** When items drop in a different room (e.g., player dies and inventory drops in current room), the getPlayerView function now marks those items as **displaced** so the client knows not to use the narrative roomText.

**Implementation (api/src/game-engine.js, ~line 377-387):**
- Added worldRoomItems = room.items || [] to get the room's native item list from world definition
- Modified items mapping to check isNative = worldRoomItems.includes(itemId)
- Items native to the room: displaced: false, include roomText
- Items NOT native (dropped/moved): displaced: true, roomText is undefined
- The displacement check applies to all items, including those without world definitions

**Why this matters:** Items have roomText descriptions written for their original location ("The rusty key sits beneath a loose floorboard"). If that key ends up in a different room via death/drop/give, the narrative doesn't fit. The displaced flag lets the client decide how to render the item — use roomText for native items, fallback to generic text for displaced items.

**All 418 tests pass** with no breaking changes.

## Learnings

### 2025-02-03 — Say Command Scope Configurable
**Feature:** Hosts can now configure the "say" command scope from the lobby before game start. Default is "Room" (current behavior: say only reaches players in the same room), or "Global" (say reaches all players).

**Backend changes:**

1. **api/src/game-engine.js:**
   - createGameSession: Added sayScope: 'room' to session initialization (line ~135)
   - handleSay: Modified to check session.sayScope:
     * When scope is 'room' (default): Sends message only to players in same room (original behavior)
     * When scope is 'global': Sends message to ALL players
     * Global messages to players in OTHER rooms include prefix: [from Room Name] Player says: "..."
     * Players in SAME room see message without prefix (even in global mode)
     * Fallback to room ID if room name not found

2. **api/src/functions/gameHub.js:**
   - Added handleSetSayScope handler (follows handleSetHazardMultiplier pattern):
     * Validates connection, game session, host-only permission
     * Only allows changes before game start
     * Accepts data.scope ('room' or 'global'), rejects invalid values
     * Confirmation message: "Say scope set to Global (all players)" or "Say scope set to Room only"
   - Added routing for setSayScope message type (line ~212)
   - Modified handleStartGame to accept optional data.sayScope and apply it at start (line ~580)
   - Added sayScope to gameStart message payload sent to clients (line ~600)

**All 430 tests passing** (7 new say scope tests added, 1 pre-existing world-selection test still failing unrelated to this change).

- **2026-04-06 — Say Scope Configuration (7 new tests, all passing)**
  - Added sayScope: 'room' to session initialization in createGameSession
  - Modified handleSay to check session.sayScope and route messages accordingly
  - Global messages to players in different rooms include room prefix: [from Room Name] Player says: "..."
  - Players in the same room never see the prefix, even in global mode
  - Added handleSetSayScope handler (host-only, pre-game only) in gameHub.js
  - Added routing for setSayScope message type
  - Modified handleStartGame to accept and apply sayScope from start message
  - Added sayScope to gameStart message payload
  - Coordinated with Data (frontend) for UI dropdown and Stef (tester) for test coverage
  - Total: 431 tests (all passing across 5 suites)

### 2026-04-06 — Immediate Inventory Drop on Ghost Creation

**Change:** Modified ghost creation behavior so inventory items drop to room floor immediately when a player becomes a ghost (death OR disconnect).

**Implementation:**
- Updated `killPlayer()` in game-engine.js (~line 271): Drops all player inventory to room floor before creating ghost with empty inventory
- Updated `disconnectPlayer()` in game-engine.js (~line 190): Same pattern — drops inventory to room, creates empty ghost
- Updated `respawnPlayer()` in game-engine.js (~line 298): Removed item-dropping logic (items already dropped on ghost creation)
- Updated `revivePlayer()` in game-engine.js (~line 331): Changed to restore player with empty inventory (not ghost.inventory)
- Updated JSDoc comments to reflect new behavior

**Behavior Changes:**
- Ghost inventory is ALWAYS empty after creation (both death and disconnect)
- Items appear on room floor immediately when ghost is created
- Players use `get <item>` to pick up items from the floor (not `loot`)
- `loot` command still works but will always report "ghost has nothing to loot" (existing handler already handles empty inventory gracefully at line ~810)

**Test Impact:**
- 29 tests now fail because they expect OLD behavior (ghosts holding inventory)
- Tests need updating to reflect new behavior:
  - Ghost creation tests should expect empty ghost.inventory
  - Loot tests should expect items in roomState.items instead of ghost.inventory
  - Reconnection tests should check room floor for items, not ghost.inventory
- Existing code correctly handles edge cases (loot command gracefully handles empty ghosts)

**Why:** Per user request — items should drop immediately when ghost created, not held until respawn/loot. Aligns with natural death mechanics (corpse drops loot immediately) and prevents inventory loss bugs on disconnect.

### 2026-04-07 — Sprint: Item Bug Fix, Puzzle Hints, Emoji Prefix, Welcome Message

**Task 1 — Item special character bug fix:**
- Added `normalizeForMatch()` and `matchesItemName()` helpers in game-engine.js
- `matchesItemName` does 4-way matching: exact lowercase, normalized (strip punctuation), startsWith raw, startsWith normalized
- Applied to all 6 item-matching locations: handleLook, handleTake, handleTakeFromGhost, handleDrop, handleUse, handleGive
- Items like "Knight's Shield" now matchable by typing "knights shield" or "knight's"

**Task 2 — Puzzle room emoji prefix:**
- `getPlayerView` now checks `session.world.puzzles` for unsolved puzzles targeting the player's room
- If found, prepends "🧩 " to room name in the view

**Task 3 — Puzzle hint system:**
- Added `hintText` field to all 17 puzzles across 3 world files (default-world, escape-room, space-adventure)
- Added `hintsEnabled: true` to `createGameSession` defaults
- Added `handleSetHintsEnabled` handler in gameHub.js (host-only, pre-game-only, boolean toggle)
- Added routing entry for `setHintsEnabled` message type
- `getPlayerView` includes `hintText` field when hints enabled and room has unsolved puzzle
- `handleStartGame` broadcasts `hintsEnabled` in gameStart message

**Task 4 — Welcome message:**
- Added `shareHint: 'Invite others to join by selecting the Share button! 📤'` to gameStart broadcast

**Task 5 — createGameSession defaults:**
- `hintsEnabled: true` added alongside existing `hazardMultiplier`, `sayScope`, `deathTimeout`

**Tests:** All 446 tests pass (439 passed, 7 skipped). Updated 1 test to expect 🧩 emoji prefix on puzzle rooms.


### 2026-04-07 — Goal Puzzle System Implementation

**Feature:** Added a goal puzzle system to track and celebrate major puzzle completions across the multiplayer game.

**Backend Changes:**

1. **api/src/game-engine.js:**
   - Added getGoalAsciiArt() and getVictoryAsciiArt() helper functions:
     * Trophy ASCII art for individual goal completions
     * Large victory banner for completing all goals
     * Both exported for testing
   - Modified createGameSession():
     * Counts total goal puzzles (where isGoal: true)
     * Initializes session.goalsCompleted = 0 and session.totalGoals = {count}
   - Modified handleUseItem() (puzzle solving logic):
     * After solving a puzzle, checks if puzzle.isGoal === true
     * If yes: increments session.goalsCompleted
     * Broadcasts goalComplete message to ALL players (playerId: 'all') with:
       - playerName (solver), goalName, goalNumber, totalGoals, asciiArt
     * If all goals completed: broadcasts ictoryComplete message to ALL players with victory ASCII art
   - Modified getPlayerView():
     * Includes goalProgress: { completed: N, total: M } in view when 	otalGoals > 0

2. **World JSON updates:**
   - **world/default-world.json:** Marked 3 puzzles as goals:
     * unlock-armory: "Open the Armory"
     * unlock-throne: "Reach the Throne Room"
     * reveal-garden: "Discover the Secret Garden"
   - **world/escape-room.json:** Marked 3 puzzles as goals:
     * open-secret-workshop: "Find the Secret Workshop"
     * open-observatory: "Open the Observatory"
     * fix-music-box: "Repair the Music Box"
   - **world/space-adventure.json:** Marked 3 puzzles as goals:
     * unlock-quarantine: "Access Quarantine Chamber"
     * unlock-reactor: "Access the Reactor"
     * unlock-command-deck: "Reach Command Deck"

**Broadcasting:** Goal and victory messages use playerId: 'all' which is handled by sendToGame in gameHub.js (lines 691-702) to broadcast to all connected players.

**Tests:** All 453 tests pass (7 skipped). Test suite includes 12 new goal system tests covering:
- Goal counting in session initialization
- Goal completion broadcasts
- Victory condition broadcasts
- Goal progress in room views
- ASCII art generation

**Architecture Pattern:** Goals are defined in world JSON as flags on puzzles (isGoal: true, goalName: "..."). Game engine tracks progress in session state. Broadcast messages allow frontend to display celebrations to all players simultaneously.

### 2026-04-07 — Help Command Redesign + Map Command

- **Help redesign:** Replaced flat command list with grouped sections (Movement, Items, Communication, Ghosts, Game) using box-drawing separators and consistent formatting. Keeps lines under 30 chars wide for mobile readability.
- **Map command:** New `handleMap` function generates ASCII map of visited rooms via BFS (depth 2) from current room. Current room marked `[*]`, visited rooms numbered `[2]`, `[3]`…, unvisited rooms show as `[?] ???`. Tree-style layout with compass direction labels.
- **visitedRooms tracking:** Added `visitedRooms` array to player state. Initialized in `addPlayer` with start room, updated in `handleGo` on movement. Preserved through ghost transitions (disconnect/kill → reconnect/respawn/revive).
- **Command parser:** Added `MAP_VERBS` set (`map`, `m`) in `command-parser.js`.
- **Exports:** `handleMap` exported for testing.
- **Files:** `api/src/game-engine.js`, `api/src/command-parser.js`
- **All 465 tests pass** (7 skipped).

