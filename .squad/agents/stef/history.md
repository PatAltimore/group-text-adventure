# Project Context

- **Owner:** Pat Altimore
- **Project:** Group text adventure game — browser-based, text-based multiplayer game for 1-20 players. Rooms connected by compass directions, puzzles solved by collecting items, player inventories, host/join via URL or QR code.
- **Stack:** Azure (Web PubSub for WebSocket, Azure Functions for game logic, Azure Table Storage for persistence), JavaScript/TypeScript, HTML/CSS
- **Created:** 2026-03-31

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- **2026-03-31 — Test suite created (111 tests, all passing)**
  - Files: `/tests/command-parser.test.js` (46 tests), `/tests/game-engine.test.js` (65 tests), `/tests/test-world.json`
  - Root `package.json` created with Jest, ESM support (`"type": "module"`, `--experimental-vm-modules`)
  - Run via `npm test` from project root
- **Engine API shape (actual vs proposed contract):**
  - ES modules throughout (`export`/`import`), not CommonJS
  - `parseCommand` returns `{ verb, noun?, target?, raw }` — optional fields are `undefined`, not `null`; always includes `raw`
  - Empty/unknown input returns `{ verb: 'unknown', raw: '...' }`, not `{ verb: null, ... }`
  - Session uses `roomStates` and `puzzleStates` separate from `world` object
  - `getPlayerView` returns flat `{ name, description, exits[], items[], players[], hazards[] }` — exits are direction strings, items are display names
  - `addPlayer` is idempotent (no-op on duplicate), does not throw
  - No max-player limit currently enforced in engine
  - Take/drop commands match by item **display name** (e.g., "take Old Key"), not item ID
  - Inventory response items are `[{ name, description }]` objects, not strings
  - Puzzle solving consumes the required item from player inventory
  - `removePlayer` drops held items back into the room

### 2026-03-31 — Backend + Frontend complete

**From Mouth (Backend):**
- Game engine located at \pi/src/game-engine.js\ — pure (no Azure imports)
- Command parser at \pi/src/command-parser.js\ — also pure
- Web PubSub message protocol: client sends \{ type: "join" | "command" }\, server replies with message types
- 10-room world in \world/default-world.json\

**From Data (Frontend):**
- Client files: \client/index.html\, \client/style.css\, \client/app.js\
- Vanilla JS, no build step
- QR code generation via CDN
- Azure Web PubSub subprotocol integration for real-time updates
