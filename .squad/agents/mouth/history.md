# Project Context

- **Owner:** Pat Altimore
- **Project:** Group text adventure game — browser-based, text-based multiplayer game for 1-20 players. Rooms connected by compass directions, puzzles solved by collecting items, player inventories, host/join via URL or QR code.
- **Stack:** Azure (Web PubSub for WebSocket, Azure Functions for game logic, Azure Table Storage for persistence), JavaScript/TypeScript, HTML/CSS
- **Created:** 2026-03-31

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-03-31 — Backend v1 built (greenfield)

- **Architecture:** Azure Functions v4 (Node.js, ESM) + Web PubSub + Table Storage. Stateless functions, all state persisted in Table Storage.
- **Game engine is pure:** `api/src/game-engine.js` has zero Azure dependencies. All state is passed in and returned — fully testable in isolation.
- **Command parser is separate:** `api/src/command-parser.js` is its own module, also pure.
- **Puzzle system:** Puzzles use `requiredItem` + `action` (openExit, removeHazard, addItem). Items are consumed on use.
- **WebSocket protocol:** Client sends `{ type: "join" | "command" }`, server replies with `{ type: "look" | "message" | "error" | "inventory" | "playerEvent" | "gameInfo" }`.
- **Connection ID as player ID:** The Web PubSub connectionId doubles as the playerId for simplicity.
- **World format:** `/world/default-world.json` — 10-room "Forgotten Castle" with 4 puzzles, 9 items, compass exits.
- **Table schema:** GameSessions (PK: "game"), Players (PK: gameId), GameState (PK: gameId, RK: "state" — serialized JSON).
- **Key paths:** `api/src/functions/negotiate.js`, `api/src/functions/gameHub.js`, `api/src/game-engine.js`, `api/src/command-parser.js`, `api/src/table-storage.js`, `world/default-world.json`.

### 2026-03-31 — Frontend + Test suite complete

**From Data (Frontend):**
- Vanilla HTML/CSS/JS client with 3-screen UI (landing, lobby, game)
- QR code generation via jsDelivr CDN (`qrcode@1.5.4`)
- Azure Web PubSub subprotocol `json.webpubsub.azure.v1` — messages wrapped in `sendToGroup` envelope
- Client files: `client/index.html`, `client/style.css`, `client/app.js`

**From Stef (Tester):**
- 111 tests passing (46 command-parser, 65 game-engine)
- Root `package.json` configured with Jest ESM support
- Test fixture: `tests/test-world.json`
- Run tests: `npm test`
