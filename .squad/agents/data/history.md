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

