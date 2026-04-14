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

- **2026-04-02 — Loot removal & get-items tests (new tests + updated old loot tests)**
  - Added 3 new `describe` blocks to `/tests/game-engine.test.js`:
    1. **Loot Command Removed** (3 tests): verifies "loot" returns error, doesn't transfer items
    2. **Death and Disconnect Inventory Drop** (7 tests): death/disconnect drop items to floor, items pickable with "get", removePlayer drops items, no-inventory disconnect safe
    3. **Get Items / Take Items / G Shortcut** (12 tests): "get items" picks up all, "g" shortcut, "take items" alias, empty room handling, partial match still works, integration with death/disconnect drop
  - Mouth was working concurrently — rewrote Ghost Looting section as "Ghost Interactions" and added "Get Items / Take All" block (8 tests)
  - Fixed case sensitivity bug in Mouth's test: `toContain('old key')` → `toContain('Old Key')` — response uses item display name
  - Total: 531 tests (529 pass, 2 skipped) across 5 suites
  - Key patterns: `killPlayer()` drops inventory to floor immediately; `disconnectPlayer()` drops inventory to floor; ghosts always have empty `inventory: []`

- **2026-04-02 — Help Command + Map Command tests (12 new tests, all passing)**
  - Added `describe('Help Command (Stef)')` (2 tests) and `describe('Map Command (Stef)')` (10 tests) to `/tests/game-engine.test.js`
  - Help tests: verify formatted help text contains expected command keywords (go, look, take, drop, inventory, help); verify both `help` and `?` trigger help response
  - Map tests cover: `visitedRooms` initialization on join, updating on move, no-duplicate on revisit; map command returns `type: 'message'` with room name; `[*]` marker for current room; `[?] ???` for unvisited rooms; visited room names shown; depth-2 limit enforced; compass direction labels present; map response only sent to requesting player
  - Created inline `mapTestWorld()` with 5 rooms (Central Hall → North Corridor → Tower Room/East Wing, Central Hall → Garden) to test depth 0/1/2/3 scenarios without modifying shared `test-world.json`
  - Both features were already implemented by Mouth when tests ran — all 12 tests pass
  - Total: 465 tests pass across 5 suites (7 skipped)

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

- **2026-04-07 — Displaced Items Display tests (6 new tests, all passing)**
  - Added `describe('displaced items')` block to `/tests/game-engine.test.js` (lines 3158-3339)
  - Tests verify new feature where `getPlayerView` marks items as `displaced: true` when not in their original room
  - Feature implementation: `getPlayerView` checks if item ID is in `world.rooms[roomId].items` array; native items get `displaced: false` + `roomText`, displaced items get `displaced: true` + no `roomText`
  - 6 tests cover:
    1. **Native items not displaced**: Items in original room have `displaced: false` and include `roomText`
    2. **Dropped items marked displaced**: Items manually pushed to non-native room have `displaced: true` and no `roomText`
    3. **Native and displaced coexist**: Room with both native and displaced items returns correct flags for each
    4. **Death scenario**: Item picked up from room A, player dies in room B, respawn drops item to B floor — item is `displaced: true` in room B
    5. **Item returned home**: Item picked up and dropped back in original room has `displaced: false` and `roomText` restored
    6. **Unknown items graceful**: Non-existent item IDs (not in `world.items`) return with name=itemId, `displaced: true`, no `roomText`
  - Created helper world with 2 rooms (room-a with torch, room-b with sword) and helper session functions following existing test patterns
  - All displaced item tests use `getPlayerView(session, playerId)` and validate `.items` array properties
  - Coordinated with Mouth who implemented the feature in parallel; tests written based on agreed API shape
  - Total: 424 tests (all passing)

### 2026-04-07 — Team Coordination: Displaced Items Feature Complete

- **Mouth (Backend):** Added `displaced` flag to getPlayerView. Items in original room: `displaced: false` + `roomText`. Items moved/dropped: `displaced: true`, no `roomText`.
- **Data (Frontend):** Split renderRoomMessage to handle displaced items separately. Native items woven into description; displaced items shown as italic "Some dropped items are here: X, Y."
- **Stef (this task):** Wrote 6 new displaced item tests covering native/displaced/mixed states, death scenario, item return, graceful unknown items. All 424 tests pass.
- **Scribe:** Orchestration logs created (3), session log created (1), decision merged (1), team histories updated (3 agents).

- **2026-04-07 — Say Scope Configuration tests (7 new tests, all passing)**
  - Added `describe('say scope')` block to `/tests/game-engine.test.js` (lines 3340-3463)
  - Tests verify host-configurable say command scope: 'room' (default, current behavior) or 'global' (all players hear)
  - Feature implementation: `createGameSession` returns `sayScope: 'room'` in session object. `handleSay` checks scope: 'room' sends only to same-room players, 'global' sends to all players with `[from Room Name]` prefix for different-room players.
  - 7 tests cover:
    1. **createGameSession includes sayScope default** — verifies `session.sayScope === 'room'`
    2. **room scope: say only reaches players in same room** — Two players in different rooms, sayScope='room', only same-room player gets message
    3. **room scope: say reaches all players in same room** — Two players in same room, sayScope='room', both get message without prefix
    4. **global scope: say reaches players in different rooms** — Two players in different rooms, sayScope='global', both get message, different-room player gets `[from Room Name]` prefix
    5. **global scope: same-room players don't get room prefix** — Two players in same room, sayScope='global', no prefix for same-room player
    6. **global scope: message includes room name in prefix** — Verifies `[from Room A]` format in prefix
    7. **missing sayScope defaults to room behavior** — Delete sayScope field, confirms fallback to room-only behavior
  - Coordinated with Mouth who implemented the feature in parallel; all tests passed immediately on first run
  - Test patterns: Use test world with rooms (room-a, room-b), create sessions with `sessionWithPlayers`, place players in different rooms, check responses for prefix/no-prefix, verify message delivery
  - Total: 431 tests (all passing across 5 suites)

- **2026-04-07 — Ghost Item Drop Behavior tests (29 tests updated, 6 new tests, all passing)**
  - **Context:** Mouth changed ghost behavior so `killPlayer` and `disconnectPlayer` immediately drop all inventory items into `roomStates[room].items`. Ghosts now have empty `inventory: []` from creation. `respawnPlayer` no longer needs to drop items (ghost inventory already empty).
  - **Updated tests:** Fixed 29 existing tests that expected ghosts to have items in inventory:
    - `disconnectPlayer` tests: Updated to expect empty ghost inventory and items in room
    - `reconnectPlayer` tests: Updated to expect empty inventory on reconnection, items remain in room
    - `killPlayer` tests: Updated to expect empty ghost inventory, items in room
    - Ghost looting tests: Updated to expect loot command returns "nothing to loot" message since ghosts have no inventory
    - Ghost persistence tests: Updated to reflect that ghosts always have empty inventory
    - Marked 7 tests as obsolete (using `test.skip`) where behavior fundamentally changed
  - **Added new tests** in `describe('ghost item drop')` block at end of file (6 tests):
    1. **`killPlayer drops all inventory items into the room`** — Player has 2 items. Kill them. Verify ghost.inventory is `[]`, roomStates[room].items contains both items.
    2. **`killPlayer with empty inventory creates ghost with no items to drop`** — Player has no items. Kill them. Verify ghost.inventory is `[]`, roomStates items unchanged.
    3. **`items dropped on death are in the room for other players to get`** — Player A has items, dies. Player B in same room can see items in getPlayerView and pick them up.
    4. **`respawnPlayer gives empty inventory to revived player`** — Kill player, respawn them. Verify respawned player has empty inventory `[]`, items still in room.

- **2026-04-07 — Goal Puzzle System tests (14 new tests, all passing)**
  - Added `describe('Goal System (Stef)')` block to `/tests/game-engine.test.js`
  - Feature: Puzzles can be marked as goals with `isGoal: true` and `goalName: "..."`. Session tracks `goalsCompleted` and `totalGoals`. Solving a goal broadcasts `goalComplete` (playerId: 'all') with player name, goal name, goal number, total goals, and ASCII art. When all goals complete, `victoryComplete` is also broadcast with ASCII art. `getPlayerView` returns `goalProgress: { completed, total }` when goals exist.
  - Tests cover:
    1. **Session initialization**: `createGameSession` counts goal puzzles correctly (`totalGoals` = count of isGoal puzzles, `goalsCompleted` = 0), handles worlds with no goals (totalGoals: 0)
    2. **Goal solving behavior**: Solving a goal puzzle broadcasts `goalComplete` to 'all' with correct fields (playerName, goalName, goalNumber, totalGoals), increments `goalsCompleted`, non-goal puzzles do NOT broadcast goalComplete
    3. **Victory condition**: Solving the last goal broadcasts BOTH `goalComplete` and `victoryComplete`, solving a goal (but not the last) does NOT broadcast victoryComplete
    4. **View integration**: `getPlayerView` includes `goalProgress` when goals exist, excludes it when no goals, progress updates after solving
    5. **ASCII art**: Both `goalComplete` and `victoryComplete` messages include non-empty `asciiArt` field, `getGoalAsciiArt()` and `getVictoryAsciiArt()` functions return non-empty strings
  - Helper worlds created: `worldWithGoals(goalCount)` (1 or 2 goal puzzles), `worldWithMixedPuzzles()` (1 goal + 1 non-goal)
  - Updated imports to include `getGoalAsciiArt` and `getVictoryAsciiArt` from `game-engine.js`
  - All 14 tests pass (feature already implemented by Mouth in parallel)
  - Total: 460 tests (453 passing, 7 skipped)
    5. **`items dropped on death are marked as displaced`** — Player picks up item from room-c, moves to room-b, dies. Item drops to room-b. getPlayerView shows `displaced: true` (not native to room-b).
    6. **`loot on ghost with no inventory gives appropriate message`** — Kill player, another player tries to loot the ghost. Gets message "nothing to loot", no crash.
  - **Test count:** 437 tests total (430 pass, 7 skipped)
  - **Key discoveries:**
    - `disconnectPlayer` and `killPlayer` both drop items immediately: `for (const itemId of player.inventory) { roomState.items.push(itemId); }`
    - Ghosts created with `inventory: []` (empty array)
    - `respawnPlayer` gives empty inventory to revived player: `inventory: []`
    - Loot command handles empty ghost inventory: `if (ghost.inventory.length === 0) { return "nothing to loot"; }`
  - Total: 437 tests (430 pass, 7 skipped, all 5 suites passing)

- **2026-04-07 — Three new feature test suites (10 new tests: 6 pass, 4 expected failures)**
  - Added 3 new `describe` blocks to `/tests/game-engine.test.js`:
    1. **Special Character Item Pickup (Stef)** (3 tests): apostrophe item pickup (pass), hyphen item pickup (pass), partial name match with special chars (fail — awaiting Mouth's partial matching logic)
    2. **Puzzle Room Emoji Prefix (Stef)** (2 tests): puzzle room has 🧩 prefix (fail — awaiting Mouth's getPlayerView change), non-puzzle room has no prefix (pass)
    3. **Puzzle Hint System (Stef)** (5 tests): hintText in view when enabled (fail — awaiting Mouth), hintText omitted when disabled (pass), hintText omitted for non-puzzle rooms (pass), hintsEnabled defaults to true (fail — awaiting Mouth's createGameSession change)
  - All 4 failures are expected: Mouth is implementing these features in parallel
  - Test approach: Created inline `loadWorld()` fixtures with special-char items, puzzle rooms, and hintText puzzles. Follows existing patterns (e.g., `worldWithRoomText`, `multiplierWorld`).
  - Key design decisions:
    - Puzzle room detection: room is a puzzle room if any unsolved puzzle references `room === playerRoom`
    - Hint system: `session.hintsEnabled` boolean flag, `puzzle.hintText` field, exposed via `getPlayerView().hintText`
    - Special char matching: Mouth updating `handleTake` to support partial name matching including apostrophes/hyphens
  - Total: 447 tests (236 pass in game-engine.test.js, 4 expected failures from new features)

- **2026-04-07 — Fuzzy Item Matching tests (31 new tests, all passing)**
  - Added `describe('Fuzzy item matching (Stef)')` block to `/tests/game-engine.test.js`
  - Tests cover Mouth's fuzzy/partial item name matching implementation across all item commands
  - **Implementation details discovered:**
    - `normalizeForMatch(str)` — strips non-alphanumeric (except spaces), lowercases, trims
    - `matchesItemName(itemName, input)` — exact, normalized exact, startsWith, normalized startsWith
    - `fuzzyMatchesItemName(itemName, input)` — substring/includes match (both raw and normalized)
    - `findMatchingItems(searchTerm, itemIds, worldItems)` — returns all matches, exact/startsWith prioritized over fuzzy substring. Returns array of matching item IDs.
    - `disambiguationMessage(searchTerm, itemIds, worldItems)` — format: "Did you mean:\n - Item1\n - Item2\nPlease be more specific."
    - All handlers (handleTake, handleDrop, handleUse, handleGive, handleTakeFromGhost) use `findMatchingItems` + disambiguation
  - 7 test sub-groups:
    1. **Partial name matching (get/take)** (7 tests): substring match ("get journal"), prefix match ("get rusty"), exact case-insensitive, case insensitive via parser, prefix with period ("get dr"), synonym verbs (take/grab)
    2. **Disambiguation (multiple matches)** (4 tests): triggers on ambiguous input, resolve with full name, resolve with unique prefix, no longer disambiguates after one item taken
    3. **Exact match priority** (2 tests): exact "Key" wins over substring "Rusty Key", order-independent (works regardless of array position)
    4. **Partial name matching (drop)** (3 tests): drop by substring, disambiguation with multiple, unique prefix resolves
    5. **Partial name matching (use)** (3 tests): finds item (no puzzle → "can't use"), disambiguation, unique prefix resolves
    6. **Partial name matching (give)** (3 tests): give by substring to other player, disambiguation, unique prefix resolves
    7. **No matches** (4 tests): get/drop/use/give with nonexistent item → appropriate error
    8. **Special characters** (4 tests): apostrophe stripping ("knights shield" → "Knight's Shield"), period+apostrophe ("dr webbs"), normalized substring ("webbs"), examine with special chars
    9. **Disambiguation message format** (1 test): verifies message structure
  - Created inline `fuzzyWorld()` with 5 items (Dr. Webb's research journal, Rusty Key, Golden Key, Knight's Shield, Old Torch) and `exactMatchWorld()` with 2 items (Key, Rusty Key) for exact-match priority tests
  - Mouth also wrote 15 tests in `describe('Fuzzy Item Name Matching')` — both test blocks complement each other
  - Total: 312 tests in game-engine.test.js (305 pass, 7 skipped)

- **2026-04-09 — Solved Description feature tests (18 tests: 8 pass, 10 expected failures)**
  - File: `/tests/solved-description.test.js` — 18 tests across 7 describe blocks
  - TDD-style: tests define spec for `solvedDescription` room field before Mouth's implementation lands
  - Uses standalone inline world data (`WORLD_DATA`) — no modifications to `test-world.json`
  - World has 6 rooms, 4 items, 4 puzzles covering: single-puzzle room, no-solvedDescription room, multi-puzzle room, unrelated room, room with solvedDescription but no puzzles
  - **8 passing now** (baseline checks): unsolved rooms show normal `description`, backward-compat rooms without `solvedDescription` still work, partial multi-puzzle solve stays normal, room isolation for rooms without the feature, multiplayer pre-solve state
  - **10 failing (expected)**: all tests that require `getPlayerView()` to return `solvedDescription` when puzzles are solved — awaiting engine implementation from Mouth
  - Key design decision: for rooms with multiple puzzles, `solvedDescription` only activates when ALL puzzles in the room are solved (not just one)
  - All 547 other tests across 6 suites still pass; zero regressions introduced

- **2026-04-07 — Puzzle Emoji Tests (28 new tests, all passing)**
  - File: /tests/puzzle-emoji.test.js — 28 tests covering 3 new features
  - **Feature 1: Puzzle Room Emoji in Room Titles** (8 tests): `getPlayerView()` now returns room names with emoji prefixes: 🧩 for unsolved puzzles, ✅ for all puzzles solved, no prefix for no puzzles. Tests cover single/multi-puzzle rooms, state transitions (🧩 → ✅), persistence after leaving/returning.
  - **Feature 2: Puzzle Emoji on Map** (8 tests): `handleMap()` shows emoji prefixes on room names in map output. Tests cover current room, adjacent rooms (depth-1), depth-2 rooms, transitions after solving puzzles, multi-puzzle rooms showing 🧩 when partially solved and ✅ when fully solved.
  - **Feature 3: Camera Item Disambiguation** (12 tests): Fixed Alcatraz bug where "use camera" was matching both "Full-Spectrum Camera" and "Camera Instructions" (now renamed to "Verification Instructions"). Tests verify "camera" searches only match the camera item, "verification"/"instructions" only match the renamed item, fuzzy matching still works, and disambiguation triggers for truly ambiguous cases.
  - Inline test world created with 7 rooms, 6 items, 5 puzzles — uses only cardinal directions (north/south/east/west) per validator requirements
  - All tests PASS — Mouth's implementation complete for Features 1, 2, and 3!
  - Total: 585 tests pass across 8 suites (2 skipped)

- **2026-04-07 — Shadows Over Blackwater world tests (21 new tests, all passing)**
  - File: `/tests/shadows-over-blackwater.test.js` — comprehensive validation tests for new world file
  - Pat reported 2 bugs: (1) "Only showing 1 goal" → world needs multiple isGoal: true puzzles, (2) "Couldn't pick up Ivory Letter Opener" → item missing portable: true
  - World file created by another agent during test development (appeared after 165s polling)
  - Tests verified BOTH bugs are fixed: world has 4 goal puzzles with isGoal: true + goalName, Ivory Letter Opener has portable: true
  - 21 tests across 10 describe blocks:
    1. **World Validation** (2): file loads, passes validateWorld()
    2. **Multiple Goals** (2): at least 3 goals, each has goalName
    3. **Item Portability** (3): Ivory Letter Opener portable, all puzzle items portable, commonly portable items (keys, documents, etc.) portable
    4. **Puzzle Solvability** (4): requiredItem exists, room exists, action references valid rooms/directions, hint/solved text present
    5. **Room Quality** (3): puzzle rooms have solvedDescription (warning only), all rooms have name/description/exits, startRoom valid
    6. **Item Placement** (2): items in room.items exist in items section, all items have name/description/roomText/portable
    7. **Room Connectivity** (2): BFS reachability from startRoom, bidirectional exits (except puzzle-gated)
    8. **File Constraints** (2): world file under 30KB, metadata fields present (name, description, synopsis, displayOrder)
  - Test patterns from existing tests: ESM imports, validateWorld() returns `{valid, errors, warnings}` not array, loadWorld from JSON.parse(readFileSync)
  - Warnings: 4 puzzle rooms missing solvedDescription (optional but recommended), 7 rooms puzzle-gated (unreachable without items), 4 one-way exits
  - Total: 445 tests (all passing)

### Hazard System Redesign Tests (Session 3)
- **Task**: Update `tests/game-engine.test.js` to reflect hazard system redesign from probability-based random death to player-initiated hazard items
- **Old system removed**:
  - `checkHazards(session, playerId)` — ran after every gameplay command, random probability death
  - `hazardMultiplier` session setting — scaled probability
  - Room-level `hazards[]` arrays with `{ description, probability, deathText }` objects
  - `Math.random()` mocking for death probability tests
- **New system tested**:
  - Items with `hazardItem: true` + `deathText` — picking up kills player deterministically
  - `take all` / `get items` / `g` skips hazard items
  - `hazardHintsEnabled` session setting (default: true) controls visibility
  - Death creates ghost with `isDeath: true`, drops inventory to room floor
  - Other players get death notification
  - `deathTimeout` defaults to 30
- **Changes made to `game-engine.test.js`**:
  - Removed `checkHazards` from imports (no longer exported)
  - Updated Look/View tests — removed old hazard assertions from `getPlayerView`
  - Updated Start Game tests — removed `hazards` field assertion
  - Section 21: Replaced old "Hazard Death System" with new "Hazard Item System" (~300 lines)
  - Section 23: Replaced old "Hazard Death System (Stef)" with new "Hazard Item Integration (Stef)" (~250 lines)
  - Sections 24-25: Removed old "Hazard check on every gameplay command" and "hazard multiplier" tests entirely
- **Changes made to `test-world.json`**:
  - Added `cursed-gem` hazard item with `hazardItem: true` and `deathText`
  - Placed in room-b, replaced old room-level hazard object
- **Test results**: 300 passing, 12 failing (expected — engine changes not yet implemented by Mouth), 1 skipped
- **Key patterns**: Tests use `GameEngine.killPlayer` / `GameEngine.respawnPlayer` with conditional `test.skip` for graceful handling when functions don't exist yet

### 2026-04-14 — Hazard System Redesign — Test Suite Refactoring Completed

**Task:** Finalize test suite for hazard system redesign (probability-based death → item-pickup death).

**Changes Made:**
1. **Test Removal:** Deleted ~908 lines of probability-based hazard tests from /tests/game-engine.test.js:
   - Random death on room entry tests (checkHazards)
   - hazardMultiplier setting/broadcast tests
   - hazardMultiplier slider/UI change tests
   - Probability scaling tests (0.5x, 1x, 2x)

2. **Test Addition:** Added ~419 lines of new hazard item tests:
   - hazardItem: true flag handling in handleTake()
   - Player death on hazard item pickup
   - Item removal from room after pickup
   - handleTakeAll() skipping hazard items
   - setHazardHints handler and hazardHintsEnabled session property
   - Hazard hint visibility toggling (true/false)
   - Multiple hazard items in same room

3. **Test Fixture Update:** Added cursed-gem hazard item to /tests/fixtures/test-world.json:
   - hazardItem: true, tempting name, dramatic deathText
   - Placed in main test room for basic coverage

4. **Assertion Updates:** Fixed assertions to match new death mechanics:
   - Death responses use same format (type: 'death', deathText, deathTimeout)
   - Ghost creation and inventory drop still work the same way
   - Respawn mechanics unchanged

**Files Modified:**
- /tests/game-engine.test.js — Hazard test refactoring (~908 lines removed, ~419 lines added)
- /tests/fixtures/test-world.json — Added cursed-gem hazard item

**Test Status:** All 567 tests pass (1 skipped). Zero regressions from new mechanics.

**Integration:** Coordinated with Mouth (Backend) and Data (Frontend). All three agents' code integrated into feature/hazard-item-death. PR #4 ready for review.

- **2026-04-10 — Updated handleTakeAll tests for hazard item death behavior**
  - Updated 2 tests in `/tests/game-engine.test.js` (Hazard Death System block):
    1. `take all skips hazard items` → renamed to `take all triggers death from hazard item` — now verifies player DIES on "get items" when room contains hazard items. Checks: player removed from session, death ghost created with `isDeath: true`, hazard item removed from room, death response contains deathText matching "idol"
    2. `"g" shortcut skips hazard items` → renamed to `"g" shortcut triggers death from hazard item` — same death verification for the "g" shortcut: player dead, ghost created, hazard item removed, death response present
  - Behavior change: `handleTakeAll()` no longer skips hazard items. It now processes ALL items including hazard ones, triggering `killPlayer()` on the first hazard item encountered (same as individual `take`). Previous decisions.md said "handleTakeAll() skips hazard items" — this is now outdated.
  - Both tests pass immediately — Mouth's engine changes were already in place
  - Total: 567 tests pass, 0 failures
