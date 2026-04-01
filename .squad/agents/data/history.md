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
