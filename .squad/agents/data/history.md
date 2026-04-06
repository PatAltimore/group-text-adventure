# Project Context

- **Owner:** Pat Altimore
- **Project:** Group text adventure game — browser-based, text-based multiplayer game for 1-20 players. Rooms connected by compass directions, puzzles solved by collecting items, player inventories, host/join via URL or QR code.
- **Stack:** Azure (Web PubSub for WebSocket, Azure Functions for game logic, Azure Table Storage for persistence), JavaScript/TypeScript, HTML/CSS
- **Created:** 2026-03-31

## Core Context

### 2026-04-04 — Current State

**Data's (Frontend Dev) contributions:**

1. **Client architecture** — Vanilla JS (no build), three screens: landing (host/join), lobby (QR + player list), game (output + command). Screen routing via URL params (`?game=<code>`).

2. **UI/UX features:**
   - **Screens:** Landing → Lobby → Game, with auto-focus per screen (mobile-optimized)
   - **Join flow:** Dedicated join screen when URL has `?game=` param
   - **WebSocket protocol:** `json.webpubsub.azure.v1` subprotocol, messages from `data` field
   - **Message styling:** 6 types (`look`, `message`, `error`, `inventory`, `playerEvent`, `gameInfo`) with distinct CSS
   - **Game IDs:** 6-char alphanumeric (no 0/O/1/I/L), passed via URL param
   - **Dark theme:** CSS custom properties for easy global tweaking
   - **Command history:** Up/Down arrows cycle previous commands

3. **Recent fixes & features:**
   - **Deploy bugfix (2026-04-01):** Client protocol changed from `sendToGroup` to `event` type; QR CDN downgraded v1.5.4 → v1.4.4
   - **Negotiate 404 audit (2026-04-01):** Client-side code verified correct; issue was server-side (backend @azure/functions version bug)
   - **Static website fix (2026-04-01):** Deploy script was missing blob upload verification; now uses `--connection-string` auth and verifies `index.html` exists
   - **Double-serialization bug fix (2026-04-04):** Removed `JSON.stringify()` before SDK calls (SDK does it automatically); added defensive client-side parsing for string data
   - **Share button + QR overlay (2026-04-04):** New feature in game header — click to copy game URL to clipboard with toast feedback, QR overlay dismissible via X/backdrop/Escape

4. **Testing & conventions** — All 150 tests passing (111 pre-existing + 39 new communication tests). Client integrates cleanly with backend say/yell (no changes needed for multi-room verbs; backend sends regular `message` type).

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-04-04 — Share Button + QR Overlay UI

- **Share button placement:** Game header (top right), next to player count
- **Copy-to-clipboard:** Click copies `https://patcastlestore.z5.web.core.windows.net/?game=<gameId>` to clipboard
- **Toast feedback:** 3-second auto-dismiss toast shows "Copied!" with checkmark
- **QR overlay:** Dismissible via X button (top-right), backdrop click, or Escape key
- **Responsive QR:** Sized to fit mobile and desktop viewports, semi-transparent dark backdrop
- **Fallback handling:** If QR generation fails, overlay shows text URL with copy button
- **Accessibility:** ARIA labels on buttons, semantic HTML (`<button>`, `<dialog>`), proper focus management
- **No backend changes:** Share feature entirely client-side; URL generated from `state.currentGameId`

### 2026-04-04 — Cross-Team: Mouth's Say & Yell Implementation

**From Mouth (Backend Dev):**
- **Say verb:** Room-local only. Already working; no changes needed.
- **Yell verb:** Implemented with 3-tier reach:
  1. Same room: clear text + "players look annoyed" feedback
  2. Adjacent (1 exit): full text + directional hint (e.g., "from the south")
  3. Far (2+ exits): muffled text, no content, general direction
- **Parser split:** `yell`/`shout` now map to distinct verb `'yell'` (not grouped with `'say'`)
- **BFS pathfinding:** `findDirectionToRoom()` helper respects dynamically opened exits from puzzles
- **Hub routing unchanged:** Existing `routeResponses` function handles per-player message tuples
- **All 150 tests pass** (111 pre-existing + 39 new communication tests from Stef)

**Data's takeaway:** No client-side changes needed for say/yell. Backend sends regular `message` type responses; client displays with same styling as other player messages.

### 2026-04-04 — Cross-Team: Mouth's Duplicate Player Name Resolution

**From Mouth (Backend Dev):**
- **New feature:** `resolvePlayerName(session, playerName)` in game-engine.js automatically renames duplicate players
- **Process:** When a player joins with an existing name, engine prepends a random silly adjective (20-adjective pool, case-insensitive comparison)
- **Player notification:** Hub sends `type: 'message'` to renamed player explaining the new name
- **Hub integration:** Hub calls `resolvePlayerName` before `addPlayer`, no changes to game logic routing
- **Fallback:** If all 20 adjectives exhausted (21+ duplicates), appends numeric suffix
- **All 150 tests pass** unchanged
- **Convention:** Player-facing name logic in game-engine as pure functions; hub handles messaging

**Data's takeaway:** No client-side changes needed. Renamed players receive a standard message notification. Name-change message appears in player output like any other message.

### 2026-04-04 — Bugfix: Share Button + Duplicate Look

- **Share button fix:** `navigator.clipboard` is undefined in non-secure contexts (HTTP). Direct access to `.writeText()` threw synchronous TypeError, crashing the handler before the overlay could open. Extracted a `copyToClipboard()` helper that guards with `if (navigator.clipboard)` and try/catch. Moved overlay-show code before clipboard attempt so overlay always opens.
- **Duplicate look fix:** Added 2-second debounce on consecutive `look` messages for the same room. If same room name arrives within 2s, skip rendering. Allows intentional re-looks (>2s apart) while preventing server retries/echos from duplicating.
- **WebSocket cleanup:** Added defensive `state.ws.close()` before creating a new WebSocket in `connectWebSocket()` to prevent orphaned listeners from processing messages.
- **Clipboard helper reuse:** `copyToClipboard()` is now used by share button, overlay copy button, and lobby copy URL button — all three had the same vulnerability.
- **All 150 tests pass** unchanged.

### 2026-04-04 — Cross-Team: Mouth's Azure Developer CLI (azd) Template

**From Mouth (Backend Dev):**

- **New azd template** created alongside existing `deploy/deploy.ps1`. Two deployment paths coexist:
  - PowerShell script: battle-tested, extensive error handling, idempotent
  - azd template: cleaner interface, standard Azure tooling, same infrastructure
- **Files added:**
  - `azure.yaml` — azd project definition with postdeploy hooks for data-plane operations
  - `infra/main.bicep` — Subscription-scoped orchestrator (creates resource group)
  - `infra/resources.bicep` — All IaC (Storage Account, Web PubSub Free_F1, Function App Y1)
  - `infra/main.parameters.json` — azd environment placeholders
  - `infra/abbreviations.json` — Standard resource naming abbreviations
- **Key design:** Two-file Bicep pattern (main + resources module) is standard azd for subscription-scoped deployments. Data-plane operations (static website, event handler, client config) handled in postdeploy hook.
- **Resource naming:** Uses `uniqueString(subscription, env, location)` for global uniqueness — azd deployments create NEW resources, not reuse existing ones (intentional isolation)
- **All 150 tests pass** unchanged. No existing files modified.

**Data's takeaway:** No client-side changes needed. azd template provisions identical infrastructure to PowerShell script, so all existing frontend code works unchanged.

### 2026-04-04 — World/Adventure Selector UI

- **World selector dropdown:** Added `<select id="world-selector">` to landing screen between player name input and Host/Join buttons
- **`loadWorlds()` function:** Fetches `GET /api/worlds`, populates dropdown with `{id, name, description}`. On failure, falls back to single "The Forgotten Castle" option with value `default-world`
- **State management:** Added `worldId` to client state. Set from dropdown when host clicks "Host New Game"
- **Join message:** Host's WebSocket join message includes `worldId`; joiners do NOT send `worldId` (world already set by host)
- **Lobby subtitle:** `<p id="lobby-adventure-name">` shows "Adventure: {name}" in lobby screen
- **CSS:** Custom-styled `<select>` matching dark theme — uses same dimensions/colors as player name input, custom SVG chevron, proper option styling
- **Mobile:** Select uses `font-size: 16px` to prevent iOS zoom, full-width layout
- **Files modified:** `client/index.html`, `client/app.js`, `client/style.css`
- **All 150 tests pass** unchanged

### 2026-04-04 — Bugfix: World Selector Stuck on "Loading..."

- **Root cause:** `loadWorlds()` used a bare `fetch()` with no timeout. If the Azure Function was cold-starting or unreachable, `fetch()` hung indefinitely. Neither the success nor error path executed, leaving the dropdown stuck on the "Loading..." placeholder.
- **Fix 1 — Fetch timeout:** Added `AbortController` with 5-second timeout to the `/api/worlds` fetch. If the API doesn't respond in 5s, the request aborts and the fallback fires.
- **Fix 2 — Bulletproof fallback:** Extracted `setDefaultWorld()` helper with its own `try/catch`. Even if `els.worldSelector` is somehow unavailable, the error is caught and logged rather than crashing the entire init chain.
- **Fix 3 — HTML default:** Changed the initial `<option>` from `Loading...` to `The Forgotten Castle` (value `default-world`). The dropdown is now usable immediately, even before JavaScript executes or if the script fails entirely.
- **Key insight:** The catch block in the original code was correct, but unreachable if `fetch()` never resolved. The AbortController timeout ensures the promise always settles.
- **Files modified:** `client/app.js`, `client/index.html`
- **All 204 tests pass** unchanged

### 2026-04-04 — Bugfix: Share Button Non-Functional

- **Root cause:** `copyToClipboard()` returned inverted success/failure values — `Promise<false>` on failure, `Promise<undefined>` on success. All three callers (share button, overlay copy, lobby copy) checked `if (failed === false) return;`, which silently exited on failure with zero visual feedback. In non-secure contexts (HTTP), clipboard API is unavailable, so every click silently did nothing.
- **Fix 1 — `navigator.share()` support:** Share button now tries the Web Share API first (`navigator.share()`), giving mobile users a native share dialog (SMS, email, etc.). User cancel (`AbortError`) is handled gracefully.
- **Fix 2 — `copyToClipboard()` rewrite:** Converted to async, returns `true` on success, `false` on failure. Clean boolean semantics.
- **Fix 3 — Always show feedback:** All three copy/share buttons now always display feedback text: "Copied!" on clipboard success, "Shared!" on native share success, "Link ready" or "Failed" when clipboard is unavailable. Extracted `showButtonFeedback(btn, text, originalText, duration)` helper.
- **Fallback chain:** `navigator.share()` → QR overlay + `navigator.clipboard.writeText()` → QR overlay with "Link ready" text
- **Files modified:** `client/app.js`
- **All 204 tests pass** unchanged

### 2026-04-04 — Lobby Share Button Consolidation

- **Problem:** Lobby "Copy" button (`btnCopyUrl`) only did clipboard copy. On mobile, this missed the native share sheet. On desktop with no clipboard API (HTTP), it silently failed with "Failed" feedback.
- **Fix:** Extracted share logic into reusable `handleShare(btn, originalText)` function. Both lobby button and game header Share button now call the same function.
- **Share flow:** `navigator.share()` → QR overlay + `navigator.clipboard.writeText()` → QR overlay with "Link ready" text
- **HTML change:** Button text changed from "Copy" to "Share", aria-label updated to "Share join URL"
- **UX improvement:** Lobby button now gives mobile users the native share sheet (SMS, email, AirDrop, etc.) instead of just clipboard copy
- **No duplication:** Share logic lives in one place (`handleShare`), used by 2 callers (lobby + game header)
- **Files modified:** `client/app.js`, `client/index.html`
- **All 204 tests pass** unchanged

### 2026-04-04 — Live Lobby Player List

- **Problem:** The lobby screen had HTML/CSS for a player list (`#lobby-player-list`, `.lobby-players`) and a working `updateLobbyPlayerList()` function, but `handlePlayerEvent()` never called it. Players joining/leaving only updated the count badge, not the visible list.
- **Fix:** Added `updateLobbyPlayerList()` call inside `handlePlayerEvent()` after `state.players` is updated. One-line change.
- **Key insight:** All the infrastructure was already in place — HTML structure, CSS styling (green dot prefix, dark surface cards), and the render function. The only missing link was the call from the event handler.
- **Files modified:** `client/app.js`
- **All 204 tests pass** unchanged

### 2026-04-04 — Synchronized Lobby for All Players

- **Problem:** Joining players skipped the lobby and went straight to the game screen. Only the host saw the lobby with QR code, share controls, and player list. "Start Game" only affected the host's local state — no server coordination.
- **Fix 1 — Joiner lobby:** `startJoin()` now shows the lobby screen instead of the game screen. Joiners see QR code, share button, and player list — same as host — but with a "Waiting for host to start…" message instead of the Start button.
- **Fix 2 — Server-driven start:** Host's "Start Adventure" button sends `{ type: 'startGame' }` to the server instead of locally transitioning. Button disables and shows "Starting…" while waiting.
- **Fix 3 — `gameStart` handler:** New `handleGameStart(msg)` function handles server's `{ type: 'gameStart', room }` broadcast. ALL clients (host + joiners) transition from lobby to game screen simultaneously.
- **Fix 4 — `gameInfo` branching:** When `gameInfo` includes `room` (post-start join), client skips lobby and goes straight to game. When `room` is absent (pre-start join), client stays in lobby. `joinUrl` now updates lobby for all players, not just host.
- **CSS:** Added `.lobby-waiting-msg` with pulsing opacity animation (`waitingPulse` keyframes).
- **HTML:** Added `#lobby-waiting-msg` paragraph with `hidden` class, renamed button text to "Start Adventure".
- **Message contract:** Client sends `{ type: 'startGame' }`, server broadcasts `{ type: 'gameStart', room }`.
- **Files modified:** `client/app.js`, `client/index.html`, `client/style.css`
- **All 204 tests pass** unchanged

### 2026-04-04 — Bugfix: Lobby Player List Missing Earlier Players

- **Problem:** When players joined the lobby, their player list only showed players who joined *after* them. Players already in the lobby were missing because `state.players` was initialized with only the local player's name. The `playerEvent` messages only handle incremental adds/removes, so earlier players were never added.
- **Fix:** Updated `handleGameInfo()` to check for `msg.players` (array of player name strings). When present, initializes `state.players` from this array and calls `updateLobbyPlayerList()` to render immediately. The server now includes a `players` array in the `gameInfo` message with all currently connected player names.
- **Key insight:** The incremental `playerEvent` approach was correct for ongoing updates, but the initial state was never seeded. The `gameInfo` message is the right place for initial synchronization since it's sent to every player on connect.
- **Message contract:** `gameInfo.players` = array of player name strings (e.g., `['Alice', 'Bob']`), in addition to existing `gameInfo.playerCount`.
- **Files modified:** `client/app.js`
- **All 204 tests pass** unchanged

### 2026-04-04 — Reconnection Support + Inventory Drop Visibility

- **sessionStorage persistence:** `saveSession()` stores `gta_gameId` and `gta_playerName` on WebSocket open. `loadSession()` retrieves them. `sessionStorage` is tab-scoped — auto-clears on tab close (no `beforeunload` clearance needed; that would break refresh-based rejoin).
- **Auto-rejoin on page load:** `init()` checks sessionStorage. If gameId + playerName exist and URL matches (or has no game param), skips landing screen, shows game screen with "Reconnecting…", and calls `connectWebSocket()`. Server sends `gameInfo` with `reconnected: true`.
- **Reconnection handling in `handleGameInfo()`:** When `msg.reconnected` is true: skip lobby, render room view, show "Reconnected! You're back in [room]." message, restore inventory display from `msg.inventory`.
- **WebSocket auto-reconnect:** On unexpected `close` event, `attemptReconnect()` retries up to 5 times with increasing delay (2s base, 1.5x backoff, 10s max). Shows orange banner "Connection lost. Reconnecting… (N/5)". After max retries, shows red tappable banner "Connection lost. Tap to reconnect."
- **`manualReconnect()`:** Resets attempt counter and tries once more when user taps the red banner.
- **`beforeunload` handler:** Sets `intentionalDisconnect = true` and clears reconnect timer — suppresses reconnect loop during page unload. Does NOT clear sessionStorage.
- **`playerDrop` message type:** Handles server broadcasts when a disconnected player's inventory is dropped in a room. Renders as player-event styled message.
- **Reconnect banner UI:** Fixed position top bar, `z-index: 900`. Orange for auto-reconnecting, red for tappable manual retry. Slide-in animation. Matches dark retro theme.
- **HTML:** Added `<div id="reconnect-banner">` between lobby and game screens.
- **CSS:** `.reconnect-banner`, `.reconnect-tappable` classes with `@keyframes bannerSlideIn`.
- **Files modified:** `client/app.js`, `client/index.html`, `client/style.css`
- **All 204 tests pass** unchanged
- **Message contract with backend (Mouth):** Server must send `gameInfo` with `{ reconnected: true, room, inventory }` when same-name player rejoins. Server may send `{ type: 'playerDrop', playerName, text }` when disconnected player's items are dropped.

### 2026-04-04 — Ghost Player UI

- **Ghost display in room views:** `renderRoomMessage()` now checks for `room.ghosts` array. Each ghost rendered as `👻 <name> lingers here.` using faded italic styling (`.room-ghosts` class). Ghost section appears after players, before hazards/exits.
- **Ghost interaction hint:** When ghosts are present in a room, a subtle hint `(You can 'loot <name>' to take their items)` is shown below the ghost list (`.room-ghost-hint` class).
- **Reconnection message updated:** When reconnecting, the message now reads `👻 You reclaim your ghostly form. You're back in <room>.` — uses ghost styling instead of plain system message.
- **`ghostEvent` message type:** New handler in the message switch. Server sends `{ type: 'ghostEvent', text }` for ghost-related broadcasts (e.g., `"Bob's ghost stirs... Bob has reconnected!"`). Rendered with ghost styling.
- **`playerDrop` repurposed:** Changed from player-event styling to ghost styling. Default text changed from "belongings appear on the ground" to "ghost fades away" — aligns with the ghost loot model.
- **`appendGhostMessage()` helper:** New function renders text with `msg-ghost` class and 👻 prefix. Used by reconnection, playerDrop, and ghostEvent handlers.
- **CSS additions:** `.msg-ghost` (faded italic, pale blue-grey `#7a8a9e`, 80% opacity), `.room-ghosts` (italic, 75% opacity in room view), `.room-ghost-hint` (subtle hint text, 70% opacity). All consistent with dark retro theme.
- **Room section reordering:** Items → Players → Ghosts → Hazards → Exits (exits moved to bottom for better scannability).
- **Files modified:** `client/app.js`, `client/style.css`
- **138 tests pass** (game-engine suite has pre-existing ESM parse error unrelated to client changes)
- **Message contract with backend (Mouth):** Room view must include `ghosts: string[]` array. Server may send `{ type: 'ghostEvent', text }` for ghost lifecycle events. `playerDrop` now expected to describe ghost loot, not floor drops.

### 2026-04-04 — Bugfix: Reconnection Reliability (Pat's Bug Report)

- **Problem:** Pat reported refresh didn't reliably reconnect. Other players saw repeated ghost leave/join cycles on each reconnect attempt. Session data was fragile.
- **Root cause — sessionStorage fragility:** `sessionStorage` is tab-scoped and cleared on tab close. If a mobile browser kills the tab (phone standby, memory pressure), session data is lost. Refresh worked in theory but was unreliable across mobile browsers.
- **Fix 1 — localStorage:** Switched `saveSession()`, `loadSession()`, `clearSession()` from `sessionStorage` to `localStorage`. Survives tab close, enabling true "rejoin later" capability. Keys: `gta_gameId`, `gta_playerName`.
- **Fix 2 — Save on gameInfo:** Added `saveSession()` call in `handleGameInfo()` immediately after gameId confirmation. Previously only saved on WebSocket open (before server acknowledged the join).
- **Fix 3 — URL mismatch handling:** In `init()`, if URL has `?game=X` but localStorage has a different gameId, clears stale session before proceeding. Prevents rejoining the wrong game.
- **Fix 4 — Auto-rejoin failure fallback:** Wrapped `connectWebSocket()` in try/catch during auto-rejoin. On failure: clears `pendingRejoin`, clears localStorage, wipes "Reconnecting…" message, loads worlds, and shows landing page. Previously user was stuck on blank game screen.
- **Fix 5 — Pre-start rejoin to lobby:** Added `state.pendingRejoin` flag. If server responds to auto-rejoin with `gameInfo` that has no `reconnected` and no `room` (game hasn't started), client switches from game screen to lobby with waiting message.
- **Fix 6 — Reconnect retry chain:** `attemptReconnect()` now calls itself on negotiate failure. Previously, if `fetch(/api/negotiate)` threw, no WebSocket was created, so the `close` handler never fired and the retry chain silently broke.
- **Fix 7 — Single beforeunload:** Moved `beforeunload` handler before the auto-rejoin branch so it registers in all code paths (previously duplicated in two branches).
- **Files modified:** `client/app.js`
- **All 250 tests pass** unchanged
- **Message contract:** No changes. Server still sends `gameInfo` with `{ reconnected: true/false, room?, inventory? }`.

### 2026-04-04 — PlayerId-Based Reconnection (Client Side)

- **Design change:** Switched from name-based to playerId-based reconnection. Server generates a unique `playerId` on first join and returns it in `gameInfo`. Client persists it and sends it back on rejoin.
- **State:** Added `playerId` to client `state` object (default `''`).
- **saveSession():** Now stores `gta_playerId` in localStorage alongside `gta_gameId` and `gta_playerName`. Only writes if `state.playerId` is truthy (avoids overwriting with empty string on legacy servers).
- **loadSession():** Returns `playerId` from localStorage (defaults to `''`).
- **clearSession():** Removes `gta_playerId` from localStorage. Called on stale session clear and new game starts.
- **handleGameInfo():** Reads `msg.playerId` from server response and sets `state.playerId`. Backward-compatible — only updates if field is present.
- **Join message:** On rejoin (`pendingRejoin`), includes `playerId` in the join message if available. Format: `{ type: 'join', gameId, playerName, rejoin: true, playerId }`.
- **Auto-rejoin init:** Loads `session.playerId` into `state.playerId` before calling `connectWebSocket()`.
- **Backward compat:** Missing `playerId` in localStorage (legacy) or missing `msg.playerId` from server both handled gracefully — falls back to name-based behavior.
- **Files modified:** `client/app.js`
- **All 263 tests pass** unchanged
- **Message contract update:** Server `gameInfo` may now include `playerId: string`. Client rejoin message may include `playerId: string`.

### 2026-04-04 — World JSON Editor

- **New standalone tool:** `client/editor.html` + `client/editor.css` + `client/editor.js` — a browser-based visual editor for world JSON files.
- **Layout:** Top toolbar (world name/desc, file operations), left panel (interactive SVG map ~60%), right panel (room editor ~40%), bottom tabs (items + puzzles).
- **SVG map features:** Auto-layout using BFS + compass direction hints, room dragging, pan (click-drag background), zoom (scroll wheel + buttons), start room highlighted green, selected room highlighted blue, puzzle indicator (🧩) on rooms with puzzles, exit lines with direction labels (N/S/E/W).
- **Room editor:** Name, description (textarea), start-room checkbox, exit dropdowns (N/S/E/W → other rooms), item checkboxes, hazard list with add/remove, delete room button.
- **Item editor:** Tab-based list + detail pane. Fields: id, name, description, pickupText, portable checkbox. Add/delete.
- **Puzzle editor:** Tab-based list + detail pane. Fields: id, room dropdown, description, requiredItem dropdown, solvedText, action (type/direction/targetRoom). Add/delete.
- **File operations:** Load from disk (file picker), Save (download JSON), Save As (prompt filename), New (blank world with 1 room), Preset dropdown for built-in worlds (`../world/*.json` fetch).
- **Design:** Dark theme using same CSS custom properties as `client/style.css` (--bg, --bg-surface, --accent, etc.). Professional editor feel, desktop-focused.
- **Technical:** Vanilla JS, no frameworks, IIFE pattern, ~600 lines JS, separate CSS/JS files. SVG for map (not Canvas). Live-save on input (no explicit Apply button).
- **Files created:** `client/editor.html`, `client/editor.css`, `client/editor.js`

### 2026-04-05 — World JSON Editor + Validation Integration

- **Status:** World JSON editor completed with all features (SVG map, editors, file I/O, dark theme). Integration with backend validation module in progress.
- **Editor features:** Auto-layout, drag/zoom, room/item/puzzle/hazard editors, file operations (load/save/presets), dark theme with accessibility.
- **Validation module (from Mouth):** Import `validateWorld()` from `world/validate-world.js` — returns `{ valid, errors[], warnings[] }`. Puzzle-aware (ignores one-way openExit on validation). Supports browser + Node.js.
- **Next integration:** Call `validateWorld(editorWorldData)` on each save; display errors as UI toasts/panels; warn on publish but don't block.
- **Test status:** All 150 client tests pass unchanged.


### 2026-04-05 — World Selector Bug Fix

- **Problem:** World selector dropdown only showed "The Forgotten Castle" (default-world) instead of all 3 available worlds. The `loadWorlds()` function fetches `/api/worlds` from the server, but any failure (cold start timeout, local dev without API, network error) triggered `setDefaultWorld()` which had only 1 hardcoded world.
- **Root cause:** The fallback in `setDefaultWorld()` only included the default world. Additionally, the fetch timeout (15s) was too short for Azure Functions Consumption plan cold starts.
- **Fix (client/app.js):**
  1. Replaced `setDefaultWorld()` with `FALLBACK_WORLDS` array containing all 3 worlds and a shared `populateWorldSelector()` function
  2. Increased fetch timeout from 15s to 30s to accommodate cold starts
  3. Fallback now shows all worlds (default-world, escape-room, space-adventure) with names and descriptions
- **Fix (client/index.html):** Updated the `<select>` to include all 3 worlds in the initial HTML (no flash of single option before JS runs)
- **Server endpoint verified:** `api/src/functions/worlds.js` correctly scans the `world/` directory and returns all 3 worlds. Registered in `src/index.js`, included in deploy zip.
- **Test status:** All 335 tests pass unchanged.

### 2026-04-04 — Item Descriptions, Hazard Death System, Editor Upgrades

**Three frontend features implemented:**

1. **Item descriptions in room view & inventory:**
   - Room items now render as individual rows with name + description (`🎒 Torch — A sturdy wooden torch...`)
   - Inventory display updated to match
   - Backward compatible: string items still render as plain names

2. **Hazard death system UI:**
   - **Death overlay:** Full-screen dark overlay with `💀 You Died` title, death text, countdown timer
   - **Countdown:** Ticks down from `timeout` seconds, sends `{ type: 'respawn' }` at zero
   - **Input disabled:** Command input locked while dead; `sendCommand()` short-circuits
   - **Auto-dismiss:** Overlay clears on `look`, `gameStart`, or `gameInfo` (server sends room after respawn)
   - **Lobby setting:** Host-only dropdown (15/20/30/45/60s) sends `{ type: 'setDeathTimeout', timeout }`
   - **Death notifications:** `playerDeath` → red alert; `playerRespawn` → green italic

3. **World editor hazard upgrade:**
   - Hazards changed from plain text tags to card-based editor with description, probability (0-1 step 0.05), and deathText fields
   - Legacy string hazards auto-normalized to objects on load
   - Item editor already had all required fields (name, description, pickupText, portable)

4. **Room hazard rendering:** Hazard objects show `description` text; backward compat for string format

- **State additions:** `isDead`, `deathTimer` in client state
- **New DOM elements:** `death-overlay`, `death-timeout-group` (lobby)
- **All 346 tests pass** unchanged.

### 2026-04-04 — Item Name Coloring in Room Descriptions
- **Change:** `renderRoomMessage` in `client/app.js` now highlights item names using the existing `.room-item-name` CSS class (green, bold)
- **With roomText:** Shows description text followed by `[itemName]` in green (e.g., "A rusty torch lies against the wall. [torch]")
- **Without roomText (fallback):** Shows "You see **{name}** here." with name wrapped in colored span
- **Approach:** Used DOM methods (createElement, createTextNode, appendChild) — no innerHTML — consistent with the codebase's existing DOM-building patterns
- **Death display:** No client change needed — `msg.deathText` already read correctly at line 447; backend fix is separate

### 2025-07-17 — Item Display Rework in Room Descriptions
- **Change:** Refactored `renderRoomMessage` in `client/app.js` to weave item `roomText` into the room description paragraph and simplify the Items section
- **Room description:** Now concatenates `room.description` + each item's `roomText` into one flowing narrative paragraph (e.g., "A cavernous hall... A rusty torch leans against the archway. A silver coin glints in a crack.")
- **Items section:** Simplified from per-item rows with descriptions/brackets to a comma-separated list of green item names only (e.g., "Items: torch, silver-coin")
- **Items container:** Changed from `<div>` to `<span>` for inline comma-separated layout
- **Backward compat:** String-only items (no `roomText`) still display correctly — just listed by name in the Items section
- **All 411 tests pass** unchanged

### 2025-07-17 — Hazard Danger Multiplier UI

- **Change:** Added "☠️ Hazard Danger" dropdown to host lobby screen, positioned right after the Respawn Timer setting
- **Values:** Low (0.5x), Medium (1.0x, default), High (2.0x) — multiplies world file hazard probabilities
- **HTML changes:** Added hazard-multiplier-group div in client/index.html (lines 125-132), reusing existing death-timeout-group and death-timeout-label CSS classes for consistent styling
- **app.js changes:**
  - DOM refs: Added hazardMultiplierGroup and hazardMultiplierSelect elements (lines 106-107)
  - Show/hide: Hazard multiplier shown alongside death timeout when host opens lobby (lines 913-920)
  - Change event: Sends { type: 'setHazardMultiplier', multiplier } when host changes selection (line 917)
  - Start game: Included hazardMultiplier parameter in startGame message (line 943)
- **Pattern:** Mirrored existing death timeout implementation for consistency — same visibility logic, same event pattern, same message structure
