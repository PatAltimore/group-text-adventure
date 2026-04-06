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

- **2026-04-02 — Ghost Persistence tests (17 new tests, all passing)**
  - Added `describe('Ghost Persistence')` block to `/tests/game-engine.test.js`
  - Covers 3 new behavior areas introduced by Mouth's engine changes:
    1. **Looting keeps ghost** (7 tests): ghost persists after loot, inventory emptied, items transferred to looter, empty ghost visible in look, graceful double-loot, take-last-item keeps ghost
    2. **Rejoin places in ghost room** (4 tests): reconnect uses ghost's room, ghost removed on reconnect, works after full loot (empty inv), works after partial loot
    3. **Ghosts never expire** (6 tests): `getExpiredGhosts` and `finalizeGhost` no longer exported, old-timestamped ghosts persist, can still reconnect/loot old ghosts, multiple old ghosts coexist
  - Also fixed broken imports (`getExpiredGhosts`, `finalizeGhost` removed from import) and updated stale test referencing removed functions
  - Concurrent editing note: Mouth was simultaneously modifying `game-engine.test.js` to update existing ghost tests. Coordinated by only appending a new describe block.
  - Total: 279 tests pass across 4 suites

- **2026-04-02 — World JSON validation tests (55 tests: 53 pass, 2 known gaps)**
  - File: `/tests/validate-world.test.js` — 55 tests across 8 describe blocks
  - Tests `validateWorld()` from `world/validate-world.js` (created concurrently by Mouth)
  - API: `validateWorld(worldData)` → `{ valid: boolean, errors: string[], warnings: string[] }`
  - Categories: valid worlds (6), required fields (8), exit validation (3), item validation (4), puzzle validation (4), warnings (5), edge cases (10), real world file smoke tests (15)
  - Validates all 3 world JSON files: `default-world.json`, `escape-room.json`, `space-adventure.json`
  - 2 expected failures: `addItem`/`removeHazard` puzzle action types use `action.room` instead of `action.targetRoom`; Mouth's validator only checks `action.targetRoom` currently
  - Key discovery: world files use `north/south/east/west` for directions, NOT abbreviated `n/s/e/w`
  - Total: 333 tests pass across 5 suites (2 known-gap failures)

- **2026-04-07 — World Validation Test Gaps Fixed**
  - **Gaps:** `addItem` and `removeHazard` puzzle action types use `action.room` (not `action.targetRoom`) to reference rooms; Mouth's validator initially only checked `action.targetRoom`.
  - **Fix (Mouth):** Added validation for `action.room` when action type is `addItem` or `removeHazard`. Both referenced rooms are checked for existence.
  - **Result:** All 55 validation tests now pass (previously 53 pass + 2 gaps).
  - **Test status:** 335 tests passing across all suites (game-engine, command-parser, communication, world-selection, validate-world).

- **2026-04-07 — Item Description + Hazard Death System tests (30 new tests, all passing)**
  - Added 23 tests to `/tests/game-engine.test.js` across two new describe blocks:
    1. **Item Descriptions (Stef)** (5 tests): getPlayerView returns `{id, name, description}` objects, picked-up items disappear from room view, inventory shows descriptions, give transfers descriptions
    2. **Hazard Death System (Stef)** (18 tests): killPlayer creates ghost with inventory, killPlayer death message + notifications, looting dead player's ghost, respawnPlayer removes ghost and recreates with empty inventory, probability 0 never kills, probability 1 always kills, hazard check only on room entry (not look/inventory/help), deathTimeout defaults to 30, old string hazards backward compatible (normalized to probability 0), multiple hazards checked independently, integration: die→loot→respawn cycle, death notifications to other players
  - Added 7 tests to `/tests/validate-world.test.js` in `Hazard validation (Stef)` block: probability 0/1 valid, probability out of range invalid, old string hazards pass, mixed hazards pass, empty deathText with probability 0 valid
  - All 30 Stef tests pass against Mouth's current implementation
  - 12 of Mouth's own tests fail due to API mismatch: `revivePlayer` doesn't exist (actual: `respawnPlayer`), `diedAt` not set on ghost, `deathTimeout` not in death message, `roomText` not in getPlayerView output, old tests still expect string items instead of objects
  - Key API discoveries: `killPlayer(session, playerId)` takes 2 args (not 3), returns session (not `{session, responses}`). `respawnPlayer(session, ghostName, newPlayerId)` drops ghost items to room floor and gives empty inventory. Ghost has `isDeath: true` flag. `getPlayerView` items now `[{id, name, description}]`. `loadWorld` normalizes string hazards to `{description, probability: 0, deathText: ''}`. Hazard check in handleGo uses `Math.random() < hazard.probability`.
  - Total: 396 tests across 5 suites (384 pass, 12 fail from Mouth's stale tests)

- **2026-04-07 — Death message field name fix tests (deathText not text)**
  - Updated `/tests/game-engine.test.js` — 4 test assertions changed/added:
    1. `hazard triggers death on room entry` (line ~2075): Changed `deathMsg.message.text` → `deathMsg.message.deathText`, added `not.toHaveProperty('text')` guard
    2. `sends death message to the player (via handleGo hazard trigger)` (Stef block): Added assertions for `deathText === 'You choke on toxic gas and die!'` and `not.toHaveProperty('text')`
    3. `probability 1 always kills` (Stef block): Added `deathText === 'You choke on toxic gas and die!'` and `not.toHaveProperty('text')`
    4. `multiple hazards checked independently` (Stef block): Added `deathText === 'You fall into the spikes!'` and `not.toHaveProperty('text')`
  - All 4 changes verify: (a) death response uses `deathText` field name, (b) value matches hazard's configured deathText, (c) old `text` field is NOT present
  - Confirmed: Item description tests already cover `getPlayerView` returning items as objects with `name` property — no changes needed
  - Total: 397 tests passing across 5 suites, 0 failures

- **2026-04-07 — Hazard check on every gameplay command tests (14 new tests, all passing)**
  - Added `describe('Hazard check on every gameplay command (Stef)')` block to `/tests/game-engine.test.js`
  - Mouth's refactoring landed: `checkHazards(session, playerId)` extracted from `handleGo`, called in `processCommand` after every gameplay command. `handleGo` no longer contains hazard logic.
  - Mouth also updated the existing test "hazard check only happens on room entry" → renamed to "hazard check fires on gameplay commands (look, say), but NOT meta commands (inventory, help)"
  - 8 new integration tests via `processCommand`:
    1. Hazard triggers on `look` — player in deadly room dies
    2. Hazard triggers on `take` — player picks up item then dies, ghost has item in inventory
    3. Hazard triggers on `say` — player says something, hazard kills them
    4. Hazard does NOT trigger on `help` — meta command, player survives
    5. Hazard does NOT trigger on `inventory` — meta command, player survives
    6. Hazard does NOT trigger on invalid command — unrecognized verb, player survives
    7. Ghost player skips hazard check — already-dead player gets no death response
    8. Hazard check after `go` uses new room — moving from safe→deadly kills player in deadly room
  - 6 direct `checkHazards` unit tests:
    1. Safe room returns empty responses
    2. Probability-1 hazard kills player, creates ghost, returns death message with deathTimeout
    3. Non-existent player returns empty responses
    4. Ghost player returns empty responses (skip check)
    5. High random value (0.99) survives probability-0.5 hazard
    6. Other players in room get death notification + ghost event
  - Key design: `processCommand` uses `return` for `help`, `inventory`, and `default` (unknown commands), skipping the post-handler hazard check. Gameplay verbs use `break` and fall through to the hazard check.
  - Total: 411 tests (410 pass, 1 pre-existing ESM failure in world-selection.test.js)

- **2026-04-07 — Hazard Death Probability Multiplier tests (7 new tests, all passing)**
  - Added `describe('hazard multiplier')` block to `/tests/game-engine.test.js` (lines ~2963-3152)
  - Tests cover host-configurable hazard probability scaling: Low (0.5x), Medium (1.0x default), High (2.0x)
  - Test approach: Use `jest.spyOn(Math, 'random').mockReturnValue()` to control hazard outcomes deterministically
  - Created `multiplierWorld()` helper with hazard-room (probability 0.3) and high-prob-room (probability 0.8)
  - 7 tests:
    1. `createGameSession includes hazardMultiplier default` — verifies `session.hazardMultiplier === 1`
    2. `medium multiplier (1.0) uses world file probability as-is` — 0.3 base × 1.0 = 0.3 effective, random 0.2 → dies
    3. `low multiplier (0.5) halves the effective probability` — 0.3 × 0.5 = 0.15, random 0.2 → survives, random 0.1 → dies
    4. `high multiplier (2.0) doubles the effective probability` — 0.3 × 2.0 = 0.6, random 0.5 → dies
    5. `multiplier is clamped so adjusted probability never exceeds 1` — 0.8 × 2.0 = 1.6 clamped to 1.0, random 0.99 → dies
    6. `missing multiplier defaults to 1` — delete multiplier field, 0.3 base, random 0.2 → dies (same as medium)
    7. `multiplier of 0.5 can prevent death that would occur at 1.0` — 0.4 × 0.5 = 0.2, random 0.3 → survives (would die at 1.0x)
  - Key discoveries:
    - `createGameSession` returns `hazardMultiplier: 1` in session object
    - `checkHazards` applies multiplier: `adjustedProbability = Math.min(1, h.probability * (session.hazardMultiplier || 1))`
    - Clamping via `Math.min(1, ...)` prevents adjusted probability from exceeding 1.0
    - Missing/undefined multiplier falls back to 1 via `|| 1` operator
  - Coordinated with Mouth: tests written in parallel with implementation; all tests passed immediately on first run
  - Total: 418 tests (all passing)
