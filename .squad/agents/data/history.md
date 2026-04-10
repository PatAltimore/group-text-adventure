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

### 2026-04-06 — Hazard Multiplier Feature (Frontend)

- **Added Hazard Danger dropdown to lobby host screen:** Low/Medium/High options
- **UI placement:** Lobby host setup panel alongside other pre-game settings
- **Integration:** Communicates with backend `setHazardMultiplier` handler
- **Files:** `client/index.html`, `client/app.js`
- **Status:** All frontend components complete, synced with backend multiplier support

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

### 2025-07-17 — Displaced Items Rendering

- **Change:** Modified enderRoomMessage in client/app.js to handle displaced: true/false flag on items, showing dropped/foreign items separately from native room items
- **Item splitting:** Items now filtered into 
ativeItems (displaced absent/false) and displacedItems (displaced: true)
- **Native items:** roomText woven into room description paragraph as before; listed in "Items:" section with green names
- **Displaced items:** 
  - NOT woven into room description (won't have roomText anyway)
  - Displayed in separate italic line after room description: "Some dropped items are here: Flashlight, Old book."
  - Item names still use .room-item-name class (green) so players know they're gettable
  - NOT included in the "Items:" section
- **CSS addition:** Added .room-dropped-items style in client/style.css — italic, dimmed color (#b0b0b0), subtle top margin (4px) to distinguish from main room description
- **Approach:** Same DOM-building pattern as existing code (createElement, createTextNode, appendChild)
- **Backend integration:** Backend (Mouth) adds displaced flag; frontend distinguishes presentation

### 2026-04-07 — Team Coordination: Displaced Items Feature Complete

- **Mouth (Backend):** Added `displaced` flag to getPlayerView. Items in original room: `displaced: false` + `roomText`. Items moved/dropped: `displaced: true`, no `roomText`.
- **Frontend (this task):** Split renderRoomMessage to handle displaced items separately. Native items woven into description; displaced items shown as italic "Some dropped items are here: X, Y."
- **Stef (QA):** Wrote 6 new displaced item tests covering native/displaced/mixed states, death scenario, item return, graceful unknown items. All 424 tests pass.
- **Scribe:** Orchestration logs created (3), session log created (1), decision merged (1), team histories updated (3 agents).

### 2026-04-07 — Say Scope Setting + Help Text for All Lobby Settings

- **Say Scope dropdown added:** New lobby host control (`#say-scope-select`) with "Room Only" and "Global" options. Placed after Hazard Danger, before Start Adventure button.
- **Help text for ALL settings:** Added `.setting-help` paragraphs under each label explaining what the setting does:
  - Respawn Timer: "How long a player stays dead before respawning in the same room."
  - Hazard Danger: "Adjusts hazard lethality. Low = safer, High = deadlier. Medium uses the world default."
  - Say Scope: "Room Only: only players in the same room hear you. Global: all players hear what you say."
- **CSS styling:** `.setting-help` uses color `#999`, 0.8em size, italic, subtle margins (2px top, 6px bottom) for clear visual hierarchy.
- **Integration:** `startHost()` wires up `setSayScope` change event. `startGame` message includes `sayScope` parameter alongside `deathTimeout` and `hazardMultiplier`.
- **DOM references:** Added `sayScopeGroup` and `sayScopeSelect` to `els` object following existing pattern.
- **Files modified:** `client/index.html`, `client/app.js`, `client/style.css`
- **Status:** Frontend complete. Backend (Mouth) will consume `sayScope` parameter in `startGame` handler.


- **2026-04-06 — Say Scope UI Controls (7 tests verified, all passing)**
  - Added Say Scope dropdown to lobby settings with options: Room (default), Global
  - Integrated scope selection into startGame message payload
  - Frontend receives sayScope from backend via gameStart message
  - Added help text for Say Scope and existing lobby settings
  - Coordinated with Mouth (backend) for message routing and Stef (tester) for verification
  - Total: 431 tests (all passing across 5 suites)

### 2026-04-06 — Lobby Cleanup + Hints + Share Hint

- **Lobby cleanup:** Removed QR code canvas and share link text box from host lobby screen. Replaced with a single prominent Share button (`btn-primary btn-large`) that triggers the Web Share API / QR overlay fallback. QR library kept for share overlay only.
- **Hints toggle:** Added `🔍 Puzzle Hints` setting to lobby (Enabled/Disabled dropdown), following existing settings pattern. Sends `setHintsEnabled` message on change, includes `hintsEnabled` in `startGame` message.
- **Share hint on game start:** `handleGameStart()` now checks for `shareHint` in the gameStart message and renders it as a styled info-bar message (`.msg-share-hint` — blue accent left-border, subtle background).
- **Puzzle hint display:** `renderRoomMessage()` now checks for `hintText` in room data and renders it as `💡 Hint: ...` with amber/gold italic styling (`.room-hint`).
- **CSS additions:** `.room-hint` (amber italic), `.msg-share-hint` (accent info bar), `.lobby-share-btn` (full-width prominent share button).
- **No test regressions** from frontend changes — 4 pre-existing failures are in backend engine tests (hints engine not yet implemented).

### 2026-04-06 — Join Screen UX Redesign

- **Problem:** Players confused game code with player name field. Game code section was too prominent; name field lacked a visible label.
- **Name field improvements:** Added visible `👤 Your Name` label above input (not just SR-only). Increased input size (18px font, 2px border, more padding). Changed placeholder to "What should other players call you?" for clarity.
- **Game code de-emphasized:** Replaced the large bordered game-code box (28px bold display) with a compact inline `Game: ABC123` line (13px, dimmed text, accent-colored code). Game code already auto-fills from URL param in `initJoin()`.
- **Visual hierarchy:** Name section is now first and most prominent. Game code is secondary/subtle between name and Join button. Flow reads naturally: name → code confirmation → join.
- **Subtitle updated:** Changed from "Ready to explore?" to "Enter your name to join the adventure" — guides player action.
- **Responsive:** Mobile breakpoint maintains 16px minimum input font to prevent iOS zoom.
- **Files modified:** `client/index.html`, `client/style.css`
- **No JS changes needed** — all element IDs preserved, `initJoin()` logic unchanged.
- **All tests pass** (pre-existing intermittent failure in world-selection unrelated).

### 2026-04-07 — Goal and Victory Message Rendering

- **New message handlers:** Added `goalComplete` and `victoryComplete` message type handlers in `handleServerMessage` switch statement (client/app.js)
- **Goal Complete Rendering:** When a player solves a goal puzzle, ALL players receive:
  - Gold-bordered container (`.goal-complete`) with dark background
  - ASCII art in monospace `<pre>` block with gold color (#FFD700)
  - Achievement text: "🏆 {playerName} achieved: {goalName}!"
  - Progress indicator: "Goals: {goalNumber}/{totalGoals}" in dimmed italic text
  - Celebratory styling with 2px amber border (#d4a017)
- **Victory Complete Rendering:** When ALL goals are solved, ALL players receive:
  - More dramatic container (`.victory-complete`) with 3px double gold border
  - Larger ASCII art in gold with heavier font weight
  - Victory text: "🎉 Adventure Complete! All goals have been achieved! 🎉"
  - Gold glow effect via box-shadow and text-shadow for extra celebration
- **Goal Progress Display:** Room view now shows inline progress indicator:
  - Located right after room name, before room description
  - Format: "🏆 Goals: {completed}/{total}" in small gold text
  - Only displayed when `room.goalProgress` exists and `total > 0`
  - CSS class `.goal-progress` — 12px, gold (#FFD700), subtle opacity
- **Rendering functions:** Added `renderGoalComplete(msg)` and `renderVictoryComplete(msg)` following existing DOM-building patterns (createElement, appendChild, no innerHTML)
- **ASCII art handling:** Used `<pre>` tags with `white-space: pre` to preserve newlines and spacing
- **Visual hierarchy:** Goals are celebratory but not overwhelming; victory is THE big moment with extra visual flourish
- **Files modified:** `client/app.js`, `client/style.css`
- **Pattern consistency:** Followed existing message rendering patterns, color palette (gold/amber for achievements), and DOM manipulation approach



### 2026-04-06 — UI: Share/QR Buttons, Host New Game, Message Rendering

- **Share button split:** Renamed game header "Share" → "🔗 Share" and added separate "📱 QR" button that directly opens the QR overlay (bypasses native share API). Both compact for mobile.
- **QR Code button:** Opens QR overlay immediately without clipboard copy or native share attempt. Ideal for phones where you want to show a QR code.
- **Host New Game button:** Added "+ New" button in game header (subtle outline style). Navigates to landing screen via `window.location.href = window.location.pathname`.
- **Lobby QR code always visible:** Host lobby screen now renders QR code permanently visible below the Share Game Link button. "Scan to join" label underneath. Host can show their phone/screen for others to scan.
- **Message pre-wrap:** Added `white-space: pre-wrap; word-break: break-word;` to `.msg-narrative` CSS class. This preserves `\n` formatting in message text (help command output, map ASCII art). Since body uses `font-family: var(--font-mono)`, ASCII art renders correctly in monospace.
- **Responsive tweaks:** Reduced header button gap on mobile (6px). Added mobile-specific sizing for the new buttons.
- **Files modified:** `client/index.html`, `client/app.js`, `client/style.css`
- **Pre-existing test failures:** 6 map command tests in game-engine.test.js fail (backend feature not yet implemented). Not related to frontend changes.

### 2026-04-06 — Lobby Layout Improvements + Host New Game Bugfix

- **Start Adventure button moved:** Repositioned from after settings to after the player list and before settings. Flow is now: share → players → start button → settings. Makes more sense UX-wise — see who's here, start when ready, settings below for tweaking.
- **Settings reformatted to two-column layout:** Each `.death-timeout-group` setting now uses a `.setting-row` flex container with label on the left and dropdown on the right, same line. Help text sits below spanning full width. More compact — reduces vertical space per setting significantly.
- **CSS changes:** `.death-timeout-group` changed from horizontal flex to column flex. Added `.setting-row` with `justify-content: space-between`. Reduced `.setting-help` font size and margins.
- **Host New Game bugfix:** The "+ New" button navigated to `window.location.pathname` which stripped query params, but localStorage auto-rejoin (`gta_gameId`, `gta_playerName`) immediately reconnected to the old game. Fix: added `clearSession()` call before navigation to wipe localStorage state.
- **Files modified:** `client/index.html`, `client/app.js`, `client/style.css`
- **All 473 tests pass** (466 passing, 7 skipped) unchanged.

### 2026-04-07 — Host Screen UI Overhaul: World Cards + Settings + Mobile

- **World selector cards:** Replaced `<select>` dropdown with card-based radio selector. Each world shows name + truncated description (one-line with CSS text-overflow). Selected card has accent border + highlight background. Keyboard accessible (Enter/Space to select, role=radio, aria-checked).
- **Settings moved to landing screen:** All 4 settings (Respawn Timer, Hazard Danger, Say Scope, Puzzle Hints) moved from lobby (#screen-lobby) to landing (#screen-landing), placed after world selector and before buttons. Settings are always visible — no more `.hidden` class toggling in `startHost()`. Host configures everything BEFORE clicking Host New Game.
- **Settings section wrapper:** Added `.settings-section` with "⚙️ Game Settings" header. Settings use `.setting-group` class (replaces `.death-timeout-group`). Labels now use `.setting-label` (replaces `.death-timeout-label`). Selects use `.setting-select` (replaces `#death-timeout-select`).
- **Mobile improvements:** `.setting-row` stacks vertically on mobile (flex-direction: column), selects go full-width with 44px min-height, font sizes increased. World card descriptions allow 2-line wrap on mobile. Landing container padding reduced for small screens.
- **JS refactor:** `populateWorldSelector()` now creates div cards instead of option elements. Added `selectWorldCard()` and `getSelectedWorldName()` helpers. `state.worldId` is set by card click rather than reading `els.worldSelector.value`. `startHost()` simplified — no more settings show/hide logic.
- **Join flow unaffected:** Joiners never see settings or world selector (those are on the landing screen, joiners use the join screen via URL param).
- **Files modified:** `client/index.html`, `client/app.js`, `client/style.css`
- **All 539 tests pass** (2 skipped) unchanged.

### 2026-04-08 — Landing Screen Scroll Fix, Respawn Options, World Synopses

- **Landing scroll fix:** Changed #screen-landing from justify-content: center to lex-start with overflow-y: auto and padding: 32px 0. Content taller than viewport now scrolls naturally instead of clipping at top.
- **Respawn timer options:** Added 5s and 10s options to death-timeout-select in index.html (before existing 15s option). Default remains 30s.
- **World synopses:** Added synopsis field (≤8 words) to all 8 world JSON files. Updated populateWorldSelector() in app.js to prefer world.synopsis over world.description for card text. Updated FALLBACK_WORLDS array with synopsis fields. Updated worlds.js API to return synopsis field.
- **Files modified:** client/style.css, client/index.html, client/app.js, pi/src/functions/worlds.js, all 8 world/*.json files
- **All 539 tests pass** (2 skipped) unchanged.

### 2026-04-06 — Home Screen + Game Banner

- **New home screen (screen-home):** Root entry point with two big buttons: "Host a Game" and "Join a Game". Replaces the old landing screen as the default visible screen.
- **Manual join screen (screen-join-manual):** New screen for entering a game code manually. Has name input, code input, and "Join Game →" button (disabled until both filled). Back link returns to home.
- **Landing screen refactored:** Now exclusively a host setup screen. Title changed to "🏰 Host a Game". Removed Join Game button and inline join code group. Added back link to home.
- **Screen flow:** Root URL → home → host setup or manual join. URL with ?game= param → existing URL-based join screen (unchanged). Auto-rejoin and reconnect flows skip home as before.
- **Game banner dynamic title:** handleGameStart and handleGameInfo now update #game-title with adventure name + game code (e.g., "🏰 The Forgotten Castle · ABC123"). Falls back to "Group Text Adventure" if adventureName absent.
- **CSS additions:** Home screen styles (.home-container, .home-title, .home-subtitle, .home-buttons, .btn-home). Manual join screen reuses existing .join-container/.join-form. Game title gets min-width: 0 and flex: 1 for proper ellipsis in flex header.
- **Listener cleanup:** initJoinManual clones inputs/button before attaching listeners to prevent duplicates on re-entry.
- **Files modified:** client/index.html, client/app.js, client/style.css
- **All 539 tests pass** (2 skipped) unchanged.

### 2026-04-09 — Font Change: VT323 → Merriweather

- **Font choice:** Replaced VT323 (retro pixel) with Merriweather (serif, screen-optimized book font).
- **Why Merriweather:** Specifically designed for on-screen readability. Renders cleanly at small sizes on dark backgrounds, making it ideal for this dark-themed game UI. Libre Baskerville was considered but Merriweather's screen-first design wins for a web game context.
- **Fallback stack:** Updated from monospace fallbacks to serif: Georgia, 'Times New Roman', serif.
- **Variable name --font-mono kept as-is** to avoid renaming across ~20+ references in style.css and editor.css.