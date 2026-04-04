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

