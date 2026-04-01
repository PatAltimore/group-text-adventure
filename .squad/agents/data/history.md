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

