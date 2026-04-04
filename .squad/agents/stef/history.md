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

- **2026-04-02 — TDD tests for SAY and YELL verbs (39 new tests, 13 expected failures)**
  - File: `/tests/communication.test.js` — 39 tests covering say (room-local) and yell (multi-room) communication
  - Updated `/tests/test-world.json` — added 5 rooms: `room-hub` (3 exits), `room-hub-n`, `room-hub-e`, `room-hub-w`, `room-isolated` (no exits)
  - Updated `/tests/game-engine.test.js` line 50 — room count 4→9 to account for new test rooms
  - 26 tests pass now (say works, basic yell same-room works via existing handleSay)
  - 13 tests fail awaiting implementation: 4 parser (yell→distinct verb), 9 engine (multi-room propagation, direction, muffled yelling, annoyed feedback)
  - Implementation needs: (1) parser must return `verb: 'yell'` not `verb: 'say'` for yell/shout, (2) engine needs `handleYell` with BFS room traversal for distance, exit-direction resolution for "from the south", muffled text for 2+ rooms away, annoyed feedback for same-room

- **2026-04-02 — World selection tests (32 tests: 11 pass, 21 skip awaiting world files)**
  - File: `/tests/world-selection.test.js`
  - Reusable `validateWorldJson()` function checks 10 invariants: schema, startRoom, exit connectivity, item refs, puzzle refs, orphan items, room reachability (BFS with puzzle-unlocked exits), room count (10)
  - Tests use `test.skip` when world files don't exist yet — will auto-activate when Mouth creates `space-adventure.json` and `escape-room.json`
  - Gameplay integration tests: loadWorld, createGameSession, navigation, item pickup, full puzzle solve (pick up item → navigate → use item)
  - Edge cases: invalid/null/empty loadWorld input, missing startRoom, default-world fallback
  - Test framework: Jest with `@jest/globals`, ESM, `--experimental-vm-modules` (matches existing suite)
  - BFS pathfinding helper for navigating player to specific rooms during tests
  - All 172 existing tests still pass (204 total with skips)
