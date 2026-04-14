# Squad Decisions

## Active Decisions

### Hazard System Redesign — Probability → Item-Pickup Death

**By:** Mouth (Backend Dev)  
**Date:** 2026-04-10

#### What

Completely replaced the probability-based random death system with a deterministic item-pickup death mechanic. Players now die only when they deliberately pick up a hazard item — no more random deaths on room entry.

#### Key Decisions

1. **`hazardItem: true` on items** — New boolean field. When a player runs `take <item>` on a hazardItem, they die instantly via `killPlayer()`. The item is removed from the room (one-shot trap). Death response format is identical to the old system (`type: 'death'`, `deathText`, `deathTimeout`).

2. **`handleTakeAll()` skips hazard items** — `get items` / `g` will never auto-kill. Only deliberate `take <specific-item>` triggers the trap. This prevents frustrating mass-death scenarios.

3. **`hazardHintsEnabled` replaces `hazardMultiplier`** — Boolean session setting (default `true`). Controls whether `getPlayerView()` includes the `hazards` hint text array. The old multiplier concept (0.5x/1x/2x probability scaling) is removed since probability-based death no longer exists.

4. **Room hazards remain as hint text** — The `hazards` array in room definitions still exists with `description` fields, but `probability` is set to 0. These descriptions serve as environmental clues that something dangerous is nearby.

5. **90 hazard items across 15 worlds** — Each hazard maps to one alluring-looking item with tempting name/roomText and dramatic deathText. Items are designed to look interesting, not obviously lethal.

#### Impact

- **Modified:** `api/src/game-engine.js`, `api/src/functions/gameHub.js`, all 15 `world/*.json` files, 2 test fixtures
- **Removed:** `checkHazards()` export, `hazardMultiplier` session property, `setHazardMultiplier` handler
- **Added:** `hazardHintsEnabled` session property, `setHazardHints` handler, 90 hazard items in world files
- **Frontend impact:** Data (Frontend Dev) updates UI to replace hazard multiplier control with hazard hints toggle. The `hazardMultiplier` field is no longer sent in `gameStart` messages; `hazardHintsEnabled` is sent instead. The `setHazardMultiplier` message type is replaced with `setHazardHints` (payload: `{ value: true/false }`).
- All 567 tests pass

### Hazard System Frontend Redesign

**By:** Data (Frontend Dev)  
**Date:** 2026-04-09

#### What

Updated the frontend to support the hazard system redesign — probability-based random death replaced with item-pickup-based death.

#### Key Changes

1. **Host settings:** Replaced "Hazard Danger" (Low/Medium/High multiplier) with "Hazard Hints" (Show/Hide toggle). Defaults to Show. Hiding hints makes the game harder by removing hazard warning text from rooms.

2. **startGame protocol:** Message payload changed from `{ deathTimeout, hazardMultiplier, sayScope, hintsEnabled }` to `{ deathTimeout, sayScope, hintsEnabled, hazardHintsEnabled }`. Backend accepts `hazardHintsEnabled` (boolean, default true).

3. **Death notification:** `playerDeath` message text is now generic ("has died") since death can come from hazardous items, not just room hazards.

4. **World editor:** Probability input removed from hazard cards. Hazards still have description and deathText — probability is no longer relevant.

#### Impact

- Modified: `client/index.html`, `client/app.js`, `client/editor.js`, `client/editor.css`
- All 567 tests pass
- Backend reads `hazardHintsEnabled` from `startGame` message and omits hazard descriptions from room views when disabled.

### Azure Deployment Architecture

**By:** Mouth (Backend Dev)  
**Date:** 2026-03-31

#### What

Created a single-command Azure deployment solution (`deploy/deploy.ps1` and `deploy/deploy.sh`) that provisions all resources and deploys the game.

#### Key Decisions

1. **Single Storage Account for both data and hosting** — Table Storage for game state AND static website hosting for client files. Fewer resources, lower cost.

2. **Client discovers API via `config.json`** — Deploy script generates `config.json` with the Function App URL at upload time. Client falls back to relative paths for local dev. Config file is gitignored and never committed.

3. **World files bundled in Function App zip** — The `world/` directory is copied into the deployment package. `gameHub.js` tries deployed path first, then local dev path, so both environments work without config changes.

4. **All free/consumption tiers** — Web PubSub Free_F1 (20 connections), Functions Consumption plan (pay-per-execution), Storage Standard_LRS. Estimated cost: ~$0/month.

#### Impact

- New files: `deploy/deploy.ps1`, `deploy/deploy.sh`, `deploy/README.md`
- Modified: `client/app.js` (config loading), `api/src/functions/gameHub.js` (multi-path world loading), `.gitignore` (deploy artifacts)
- All 111 existing tests still pass

### Fix: Three Deployment Bugs

**By:** Mouth (Backend Dev)  
**Date:** 2026-03-31

#### What

Fixed three bugs preventing the deployed Azure app from working:

1. **Negotiate 404** — Added `WEBSITE_RUN_FROM_PACKAGE=1` and `SCM_DO_BUILD_DURING_DEPLOYMENT=false` to deploy script app settings. Required for zip deployment on Linux Consumption plan.

2. **WebSocket protocol** — Changed client `sendMessage` from `sendToGroup` to `event` type. `sendToGroup` bypasses the server entirely (client-to-client only); `event` routes to the server's game engine handler.

3. **QR code CDN** — Downgraded from `qrcode@1.5.4` (missing `build/` directory) to `@1.4.4` (has working UMD browser build). Added `.catch()` on `QRCode.toCanvas()`.

#### Impact

- Modified: `client/app.js`, `client/index.html`, `deploy/deploy.ps1`, `deploy/deploy.sh`
- All 111 tests still pass
- Requires redeployment to take effect

### Deploy Scripts: Error Propagation

**By:** Mouth (Backend Dev)  
**Date:** 2026-04-01

#### What

Both `deploy.ps1` and `deploy.sh` now check every `az` command for failure and stop immediately with a clear error message instead of cascading into confusing secondary failures.

#### Key Points

1. **PowerShell `$ErrorActionPreference = 'Stop'` does NOT catch native command failures.** Every `az` call in `deploy.ps1` now has an explicit `$LASTEXITCODE` check via the `Assert-AzSuccess` helper.

2. **Storage account names are globally unique.** Both scripts now validate name availability before attempting creation, giving an immediate actionable error.

3. **Captured output is validated.** Connection strings and URLs are checked for null/empty after retrieval — no more null-reference crashes downstream.

4. **Intentional failures are still suppressed.** CORS remove and hub delete may legitimately fail on first deploy — those keep their error suppression.

#### Impact

- Modified: `deploy/deploy.ps1`, `deploy/deploy.sh`
- No application code changes; all 111 tests still pass

### Fix: Negotiate 404 — Explicit Entry Point

**By:** Mouth (Backend Dev)  
**Date:** 2026-04-01

#### What

Replaced glob pattern `"main": "src/functions/*.js"` in `api/package.json` with explicit entry point `"main": "src/index.js"`. Created `api/src/index.js` that imports `negotiate.js` and `gameHub.js`.

#### Why

The `glob` package is only a transitive devDependency (via Jest). Production deployment strips it with `npm install --omit=dev`. Without glob resolution, the Azure Functions v4 runtime cannot discover any function files, causing 404 on all endpoints.

#### Impact

- New file: `api/src/index.js`
- Modified: `api/package.json` (line 5)
- All 111 tests still pass
- **Requires redeployment** to take effect

#### Convention Going Forward

When adding new Azure Function files, they MUST be imported in `api/src/index.js` or they won't be discovered by the runtime.

### Decision: Upgrade @azure/functions to Latest Stable Version

**By:** Mouth (Backend Dev)  
**Date:** 2026-04-01

#### What

Upgraded `@azure/functions` from `^4.5.0` to `^4.12.0` to fix persistent 404 errors on deployed function endpoints.

#### Context

After applying all documented fixes for function discovery (explicit entry point, `EnableWorkerIndexing` app setting, correct package structure, proper app settings), the deployed function app at `https://patcastle-func.azurewebsites.net/api/negotiate` continued returning 404. The issue was not configuration-related but a bug in the older `@azure/functions` package version.

#### Decision

Always use the latest stable version of `@azure/functions` (currently 4.12.0). The v4 programming model underwent significant stability improvements across minor versions throughout 2024. Early releases (4.0-4.6) had production bugs that were fixed in later versions.

#### Key Points

1. **Version 4.5.0 had function discovery bugs** — Even with correct configuration, functions wouldn't be discovered in production environments with `WEBSITE_RUN_FROM_PACKAGE=1`.

2. **The v4 model matured across minor versions** — Unlike typical semantic versioning where minor versions are just features, the v4 programming model's stability significantly improved from 4.5.0 to 4.12.0.

3. **Local dev masks the issue** — Azure Functions Core Tools (`func start`) uses different code paths than production, so functions work locally but fail in production with older package versions.

4. **Check package version first when troubleshooting 404s** — Before diving into configuration, verify `@azure/functions` is at latest stable. If it's more than a few months old, upgrade and redeploy before investigating further.

#### Impact

- Modified: `api/package.json` (upgraded `@azure/functions` dependency)
- Modified: `api/package-lock.json` (updated lockfile)
- **Requires redeployment** to take effect: `cd deploy && .\deploy.ps1 -AppName patcastle`

#### Convention Going Forward

When starting new Azure Functions projects or troubleshooting existing ones:
1. Check `npm view @azure/functions version` for the latest stable release
2. Update `package.json` to use latest (e.g., `"@azure/functions": "^4.12.0"`)
3. Run `npm install` to update lockfile
4. Don't assume "v4.x is v4.x" — minor version differences matter for stability

### Decision: ARM REST API for App Settings Deployment

**By:** Mouth (Backend Dev)  
**Date:** 2026-04-01

#### What

Replaced `az functionapp config appsettings set --settings ...` in `deploy.ps1` with ARM REST API calls (`az rest --body @file`) to apply app settings safely on Windows.

#### Why

On Windows, `az` is `az.cmd` — a batch file that runs through `cmd.exe`. When connection strings containing semicolons (`;`) are passed as command-line arguments, cmd.exe interprets the semicolons as command separators, silently truncating or breaking the entire argument list. This meant critical settings like `AzureWebJobsFeatureFlags=EnableWorkerIndexing` were never actually applied to the Function App, causing the v4 runtime to fall back to v3-style discovery (function.json files), find none, and return 404 for ALL endpoints.

This is the same class of bug previously fixed for storage operations (lines 124-131 use env vars to avoid passing keys on the command line).

#### Key Points

1. **File-based input bypasses cmd.exe entirely.** `az rest --body @filepath` reads the JSON body from disk, never exposing semicolons or special characters to command-line parsing.

2. **Merge before PUT.** The ARM `PUT .../config/appsettings` endpoint replaces ALL settings. The script now GETs existing settings first (`POST .../config/appsettings/list`) and merges our values in, preserving system settings like `AzureWebJobsStorage` and `FUNCTIONS_EXTENSION_VERSION`.

3. **Temp file cleanup.** The `_appsettings.json` file is cleaned up in both the success path and the catch block.

#### Impact

- Modified: `deploy/deploy.ps1` (step 6 — app settings configuration)
- All 111 tests pass
- Committed and pushed
- **Requires redeployment** to take effect

#### Convention Going Forward

- **NEVER pass values with semicolons as `az` command-line arguments on Windows.** Use file-based input (`@filepath`), environment variables, or the ARM REST API instead.
- This applies to: connection strings, SAS tokens, storage account keys, and any base64-encoded values.
- The `deploy.sh` (bash) version does NOT have this problem — bash doesn't route `.cmd` files through cmd.exe.

### Resolution: Static Website 404 — Investigation Complete

**By:** Data (Frontend Dev)  
**Date:** 2026-04-01

#### Finding

The static website 404 is **resolved**. All files (index.html, style.css, app.js, config.json) are serving correctly at `https://patcastlestore.z5.web.core.windows.net` with HTTP 200. Deployed app.js matches the local repo.

#### Root Cause

The `deploy.ps1` originally used `--account-name` for `az storage blob upload-batch`, which relies on Azure CLI auto-detecting storage account keys. This can silently succeed with 0 files uploaded (exit code 0). The bash `deploy.sh` was already correct — it used `--connection-string` and verified uploads.

The fix (commit `0334f01`) already applied to `deploy.ps1`:
1. Switched to `--connection-string $storageConnStr` for reliable auth
2. Added post-upload verification (blob count check)

#### Convention

All Azure Storage CLI commands in deploy scripts should use `--connection-string` (not `--account-name`), and batch uploads should verify file count afterward. Both `deploy.ps1` and `deploy.sh` now follow this pattern.

### Decision: Deploy Scripts Must Validate Packaging Before Deployment

**By:** Mouth (Backend Dev)  
**Date:** 2026-04-02  

#### What

Added mandatory npm install error checking and staging directory verification to both deploy scripts. Deploy now aborts if npm install fails or if required files are missing from the deployment package.

#### Why

The recurring negotiate 404 was caused by silent npm install failures. Both scripts piped npm output to null with no exit code check. When npm failed, the zip was deployed without `node_modules`, the Azure Functions worker crashed on startup, and ALL endpoints returned 404. This was completely invisible.

#### Convention Going Forward

1. **NEVER pipe npm/pip/go output to null without checking the exit code.** Build tool failures must be loud and fatal.
2. **Verify deployment artifacts before deploying.** Check that key files exist in the staging directory before creating the zip. At minimum: entry point, function files, and critical npm packages.
3. **After zip deploy, verify app settings haven't drifted.** Zip deployment on Azure can reset settings. Always re-check and re-apply critical settings.
4. **Use full stop+start, not restart,** after deploying to Linux Consumption function apps.

### Decision: Say & Yell Verb Implementation

**By:** Mouth (Backend Dev)  
**Date:** 2026-04-04

#### What

Added two communication verbs to the game engine:

- **`say <text>`** — Room-local. Only players in the same room receive the message.
- **`yell <text>`** — Three-tier reach:
  1. **Same room:** Clear text, yeller gets "annoyed" feedback
  2. **Adjacent room** (1 exit away): Text with directional hint (e.g., "from the south")
  3. **Far room** (2+ exits away): Muffled yelling with general direction

#### Key Decisions

1. **BFS pathfinding for direction** — `findDirectionToRoom()` does a breadth-first search from listener to yeller using `session.roomStates[].exits`. This respects puzzle-opened exits and gives the first-step direction for far rooms.

2. **Parser split: yell vs say** — `yell`/`shout` now produce verb `'yell'`; `say`/`whisper` produce verb `'say'`. Previously all four mapped to `'say'`.

3. **No gameHub.js changes** — The engine returns per-player `{ playerId, message }` tuples. The existing `routeResponses` function handles routing without modification.

4. **Engine stays pure** — No Azure dependencies added. All player lookups and pathfinding use the session object passed in.

#### Impact

- Modified: `api/src/command-parser.js`, `api/src/game-engine.js`, `tests/command-parser.test.js`
- All 150 tests pass (including 38 new communication tests)

#### Convention

When adding new multi-player interactions, follow this pattern: engine returns `{ playerId, message }` arrays and the hub routes them. No need to modify `gameHub.js` for new verbs.

### Decision: TDD Tests for SAY and YELL Communication Verbs

**By:** Stef (Tester)  
**Date:** 2026-04-04

#### What

Created 39 TDD tests in `tests/communication.test.js` covering the new `say` and `yell` verbs before implementation lands. Updated `tests/test-world.json` with 5 new rooms for directional and multi-room testing.

#### Key Decisions

1. **`yell` must be a distinct verb from `say`.** Currently the parser lumps `yell`, `shout`, `whisper` all into `say`. Tests expect `parseCommand('yell hello')` to return `{ verb: 'yell' }` so the engine can route to a separate handler with multi-room logic.

2. **Direction is relative to the listener.** If yeller is in Room A and Room B connects to Room A via its "south" exit, then Room B players hear yelling "from the south". Tests verify this for multiple directions.

3. **Distance tiers: same-room / adjacent / non-adjacent.** Same-room = full text + "annoyed" feedback. Adjacent (1 room away) = full text + direction. Non-adjacent (2+ rooms) = "muffled yelling" + general direction, text NOT included.

4. **Test world expanded.** Added `room-hub` (3 exits), `room-hub-n/e/w`, and `room-isolated` (no exits). Existing room count assertion updated 4→9.

#### Impact

- New file: `tests/communication.test.js` (39 tests)
- Modified: `tests/test-world.json` (5 new rooms)
- Modified: `tests/game-engine.test.js` (room count fix)
- All 111 pre-existing tests still pass
- 13 new tests fail awaiting implementation (expected for TDD)

#### For Implementation

The implementer needs to:
1. Split `yell` out of `SAY_VERBS` in `command-parser.js` into its own set, returning `verb: 'yell'`
2. Add `case 'yell'` to the `processCommand` switch in `game-engine.js`
3. Write `handleYell` that does BFS/adjacency check on `session.roomStates[...].exits` to find adjacent and non-adjacent rooms, then sends appropriate messages with direction info

### Decision: Fix Double Serialization + Missing sendToGroup API

**By:** Data (Frontend Dev)  
**Date:** 2026-04-04

#### What

Fixed two compounding bugs in `api/src/functions/gameHub.js` that caused ALL server-to-client messages to be silently dropped in the deployed game.

#### Bugs Found

##### Bug 1: Double JSON Serialization

`sendToConnection` and `sendToGame` called `JSON.stringify(message)` before passing to the `@azure/web-pubsub` SDK. But the SDK's internal `getPayloadForMessage()` also calls `JSON.stringify()` when `contentType: 'application/json'`. This double-serialized the payload — the client received `raw.data` as a string (e.g., `'{"type":"look","room":{...}}'`) instead of an object. The string had no `.type` property, so the client's switch/case fell to default and silently dropped every message.

**Fix:** Remove `JSON.stringify()` — pass the object directly to the SDK.

##### Bug 2: `sendToGroup()` Doesn't Exist

The code called `serviceClient.sendToGroup(gameId, ...)` but `WebPubSubServiceClient` has no `sendToGroup()` method. The correct API is `serviceClient.group(gameId).sendToAll(message, options)`. The `TypeError` was caught by the try/catch wrapper and logged as a warning, making the failure invisible.

**Fix:** Use `serviceClient.group(gameId).sendToAll(message, { contentType: 'application/json' })`.

#### Client-Side Hardening

Added defensive string-parsing in the client's `handleServerMessage` — if `raw.data` is a string, try to `JSON.parse` it before processing. This makes the client resilient to any future serialization mishaps from the server.

#### Convention Going Forward

1. **NEVER call `JSON.stringify()` before passing to the Web PubSub SDK with `contentType: 'application/json'`.** The SDK handles serialization internally.
2. **Use `serviceClient.group(name).sendToAll()` for group messages.** There is no `sendToGroup()` on the service client.
3. **Log error names in catch blocks**, not just messages — `TypeError: X is not a function` would have immediately identified Bug 2.

#### Impact

- Modified: `api/src/functions/gameHub.js`, `client/app.js`
- All 111 tests pass
- Committed: `ed0f9f5`
- **Requires redeployment** to take effect

### Decision: Web PubSub Hub Must Use Extension System Key

**By:** Mouth (Backend Dev)  
**Date:** 2026-04-04

#### What

The Web PubSub hub event handler URL must use the `webpubsub_extension` system key, NOT the Function App master key. This was the primary reason the deployed game appeared broken — events from Web PubSub were silently rejected by the Function App.

#### Why

The Azure Functions `/runtime/webhooks/webpubsub` endpoint validates incoming requests against the `webpubsub_extension` system key specifically. The master key does NOT work as a fallback for extension webhook endpoints, unlike regular HTTP trigger endpoints where the master key authorizes everything.

#### Key Points

1. **Get the correct key:** `az functionapp keys list --name <app> --resource-group <rg>` → use `systemKeys.webpubsub_extension`, not `masterKey`.
2. **Deploy scripts must re-sync the key after zip deploy.** Zip deployment can rotate system keys. The deploy script should always re-read the extension key and update the hub event handler URL post-deploy.
3. **Hub update command:** `az webpubsub hub update --name <pubsub> --hub-name <hub> --resource-group <rg> --event-handler url-template="https://<func>.azurewebsites.net/runtime/webhooks/webpubsub?code=<webpubsub_extension_key>" user-event-pattern="*" system-event=connect system-event=disconnected`

#### Impact

- Fixed: Web PubSub hub configuration (runtime fix, no code change)
- Also deployed: commit `ed0f9f5` (double-serialization fix) which was committed but never pushed to Azure
- **Action needed:** Update `deploy.ps1` and `deploy.sh` to re-sync the hub event handler key after zip deploy

#### Convention Going Forward

- Always use the `webpubsub_extension` system key for hub event handler URLs
- After any deployment, verify the hub event handler key matches the current system key
- The deploy script should automate this verification

### Decision: Duplicate Player Name Resolution

**By:** Mouth (Backend Dev)  
**Date:** 2026-04-04

#### What

When a player joins a game with a name already in use, the engine automatically prepends a random silly adjective to make it unique (e.g., "Pat" → "Sparkly Pat"). The player receives a message explaining the rename.

#### Key Decisions

1. **New function, not a modified `addPlayer`.**  
   Added `resolvePlayerName(session, playerName)` as a separate exported function in `game-engine.js`. This avoids changing `addPlayer`'s return signature, which is used everywhere in tests. The hub calls `resolvePlayerName` first, then passes the resolved name to `addPlayer`.

2. **Case-insensitive comparison.** "pat" and "Pat" are treated as duplicates.

3. **20 silly adjectives, randomly shuffled.** The adjective is picked randomly (not sequentially) so different players with the same name get different adjectives. If all 20 are exhausted (theoretically possible with 21+ duplicate names), falls back to numeric suffix.

4. **Notification via `type: 'message'`** sent to the joining player after their room view, before the join broadcast. Uses the existing message type — no new protocol types needed.

#### Impact

- Modified: `api/src/game-engine.js` (new `resolvePlayerName` export + `SILLY_ADJECTIVES` constant)
- Modified: `api/src/functions/gameHub.js` (import + usage in `handleJoin`)
- Modified: `client/app.js` (removed duplicate look command)
- All 150 existing tests pass unchanged
- **Requires redeployment** to take effect

#### Convention

When adding player-facing name logic, keep it in `game-engine.js` as a pure function. The hub (`gameHub.js`) handles messaging/notification but delegates all name resolution logic to the engine.

### Decision: World JSON Validation Module

**By:** Mouth (Backend Dev)  
**Date:** 2026-04-07

#### What

Created `world/validate-world.js` — a shared validation module for world JSON files. Universal ES module that works in both browser (for Data's world editor UI) and Node.js (server-side validation in game engine).

#### Key Decisions

1. **ES module syntax (no bundler needed).** Uses `export function validateWorld()` — importable directly in both browser `<script type="module">` and Node.js ESM.

2. **Puzzle-aware bidirectional exit checks.** Exits opened by puzzles (type `openExit`) are excluded from bidirectional mismatch warnings. These are intentionally one-way until the puzzle is solved.

3. **Validation integrated into `loadWorld()`.** Errors throw (same as existing behavior). Warnings are logged via `console.warn` — visible in Azure Application Insights but don't block game start.

4. **Item placement tracking includes puzzle actions.** Items referenced by `addItem` puzzle actions or as `requiredItem` are considered "placed" — not flagged as unplaced warnings.

#### Impact

- New file: `world/validate-world.js`
- Modified: `api/src/game-engine.js` (import + validation call in `loadWorld`)
- All 279 existing tests pass
- All 3 world files pass validation (escape-room has 2 expected empty-room warnings)

#### For Data (Frontend Dev)

Import the validator in the world editor UI:
```javascript
import { validateWorld } from '../world/validate-world.js';
const result = validateWorld(worldData);
// result.valid, result.errors, result.warnings
```

### Fix: Give Command Notification Bug

**By:** Mouth (Backend Dev)  
**Date:** 2026-04-07

#### What

Fixed a bug where the receiving player got no notification when given an item via the `give` command. Also added bystander notifications for other players in the room.

#### Root Cause

In `handleGive()` (`api/src/game-engine.js`), the recipient's response object used JavaScript shorthand `targetId,` which created `{ targetId: "..." }` instead of the required `{ playerId: "..." }`. Since `routeResponses()` in `gameHub.js` dispatches based on `resp.playerId`, the message was silently dropped.

#### Changes

- **`api/src/game-engine.js`** — Fixed `targetId,` → `playerId: targetId,`. Added bystander notification loop (same pattern as `say`/`yell`/`loot`).
- **`tests/game-engine.test.js`** — Added 2 tests: receiver notification and bystander notification.

#### Impact

- All 142 game-engine tests pass (2 new)
- No other test suites affected
- Requires redeployment to take effect in production

### Decision: World JSON Editor (Standalone Browser Tool)

**By:** Data (Frontend Dev)  
**Date:** 2026-04-04

#### What

Created a standalone browser-based visual editor for world JSON files at `client/editor.html`. This is a developer/designer tool, not a player-facing feature.

#### Key Decisions

1. **Standalone page, not integrated into the game client.** The editor is `editor.html` with its own CSS/JS — completely separate from `index.html`/`app.js`. No shared JavaScript modules. This avoids coupling editor complexity to the game client.

2. **SVG for the map, not Canvas.** SVG elements are individually addressable DOM nodes — click handlers, CSS styling, and DOM manipulation are trivial. Canvas would require manual hit-testing and a full redraw loop. The room count in world files is small (10-30), so SVG performance is not a concern.

3. **Auto-layout via BFS + compass directions.** Rooms are placed on a grid using their exit directions as hints (north = y-1, east = x+1, etc.). BFS from the start room ensures connected rooms cluster together. Disconnected rooms are placed below. Positions are editor-only — not saved to JSON.

4. **Live-save on input.** All edits (name, description, exits, items, hazards) are applied to the in-memory world object immediately on input/change events. No "Apply" button. This matches modern editor UX.

5. **File operations use browser APIs only.** Load via `<input type="file">`, save via Blob + download link, presets via `fetch()` from `../world/` relative path. No server-side endpoints needed.

6. **Same dark theme as game client.** Reuses the exact CSS custom property values from `client/style.css` (--bg, --bg-surface, --accent, etc.) but in a separate CSS file. No `@import` — self-contained.

#### Impact

- **New files:** `client/editor.html`, `client/editor.css`, `client/editor.js`
- **No existing files modified** — zero risk to game client or backend
- **No tests needed** — this is a standalone UI tool; no server interaction

### Fix: Alcatraz World Startup Failure — Azure Table Storage 32K Limit

**By:** Coordinator (Backend)  
**Date:** 2026-04-09

#### What

Fixed a silent startup failure in the Alcatraz ghost world caused by game session state exceeding Azure Table Storage's 32K character limit per string property.

#### Root Cause

- Azure Table Storage enforces a **32K character limit per string property** (UTF-16 encoding)
- Alcatraz session JSON serializes to **33,661 characters**
- When `saveGameState()` tried to save the state as a single `stateJson` property, Azure threw `PropertyValueTooLarge`
- The error was silently caught by gameHub's existing try-catch wrapper, making it invisible to players

#### Solution

Implemented **chunked storage strategy**:
- Split large state JSON into multiple properties: `stateJson_0`, `stateJson_1`, etc.
- Chunk boundary: **30K bytes** (safety margin below 32K limit)
- `saveGameState()` chunks the JSON before storing
- `loadGameState()` automatically concatenates chunks back together
- Solution is **backwards-compatible** — handles both old single-property and new chunked storage

#### Key Decisions

1. **Global error handler added to gameHub** — Wrapped message handler in try-catch to surface errors early (debugging aid for future issues)
2. **Chunking is transparent to callers** — Save/load API unchanged; chunking is internal to storage functions
3. **Automatic chunk reassembly** — No caller code needed modification; the loader handles multi-property concatenation
4. **30K chunk boundary** — Provides 2K safety margin before hitting 32K Azure limit

#### Testing & Validation

- All 12 worlds verified working end-to-end via WebSocket test
- No data loss or corruption during chunk serialization/deserialization
- Alcatraz session loads and saves successfully

#### Convention Going Forward

When building worlds with large session state:
1. Be aware Azure Table Storage has a **32K character limit per property**
2. If session JSON approaches 32K, the chunked storage pattern is already in place — just deploy
3. Monitor total session size; if chunking approaches 10+ chunks, consider offloading state to Blob Storage instead

#### Impact

- Modified: `api/src/functions/gameHub.js` (chunked storage, error handler)
- All existing tests pass
- Requires redeployment to take effect

### Decision: Alcatraz Ghost Hunting World — Equipment-Based Paranormal Investigation

**By:** Mouth (Backend Dev)  
**Date:** 2026-04-09

#### What

Created a new world themed around Ghost Adventures paranormal investigation at haunted Alcatraz prison, featuring the malevolent entity Zozo and authentic ghost hunting equipment.

#### Key Decisions

- **Equipment-as-puzzle-keys pattern** where paranormal sensors both detect threats and solve puzzles
- Equipment includes: EMF detector, SLS camera, thermal camera, spirit box, REM pod, Ovilus device, full-spectrum camera
- **15 rooms** spanning Alcatraz: dock, cellblocks, solitary, mess hall, hospital, lighthouse
- **11 puzzles** with clear progression: unlock armory → find tools → map entity → execute containment → document proof
- **6 goals** tracking major investigation milestones
- Paranormal hazards removed by corresponding sensors

#### Rationale

1. **Thematic coherence**: Equipment functions match real Ghost Adventures methodology
2. **Puzzle integration**: Sensors serve dual purpose (narrative + mechanical)
3. **Progressive revelation**: Players gather equipment → detect entity → contain entity → prove existence
4. **No dead items**: Every piece of equipment has a specific puzzle use

#### Pattern for Future Worlds

Equipment-based investigation worlds should:
- Give each tool a clear mechanical purpose (not just flavor)
- Make tool functions align with theme
- Use removeHazard actions to show sensors actively protecting players
- Build toward a final "proof" goal that validates the investigation

#### Impact

- New file: `world/alcatraz-ghosts.json`
- All 541 tests pass
- Requires deployment to make world available to players

### Decision: Cleanup Timer Function

**By:** Mouth (Backend Dev)  
**Date:** 2026-04-09

#### What

Added a daily Azure Functions Timer Trigger (`cleanup.js`) that deletes game sessions older than 30 days, along with their Players and GameState entries.

#### Why

Without cleanup, stale game data accumulates indefinitely in Table Storage. While storage costs are minimal, unbounded growth is bad hygiene and makes operational queries slower over time.

#### Implementation

- `cleanupOldGames(maxAgeDays)` added to `table-storage.js` — queries all GameSessions, filters by `createdAt` age, then deletes associated Players, GameState, and the session itself
- `api/src/functions/cleanup.js` — thin timer trigger registered with `app.timer()`, runs at 3 AM UTC daily
- Per-game error isolation: if one game fails to delete, the rest still proceed
- Registered in `src/index.js` alongside other function imports

#### Cost

Zero additional cost. Consumption plan includes 1M free executions/month; this adds ~30/month.

#### Impact

- New file: `api/src/functions/cleanup.js`
- Modified: `api/src/table-storage.js`, `api/src/index.js`
- All 541 tests pass
- Requires redeployment to take effect

### Decision: Goal Rendering UI Design

**By:** Data (Frontend Dev)  
**Date:** 2026-04-09

#### What

Implemented client-side rendering for the goal achievement system, handling two new message types (`goalComplete` and `victoryComplete`) and adding goal progress display to room views.

#### Key Decisions

1. **Gold/Amber Color Scheme** — Used #FFD700 (gold) and #d4a017 (amber) for all goal-related elements. Gold conveys achievement and celebration.

2. **Progressive Celebration Intensity** — Goal completion uses a 2px solid amber border; victory uses a 3px double gold border plus glow effects. Clear visual hierarchy: goals are special, but victory is THE moment.

3. **ASCII Art in `<pre>` Tags** — Goal and victory messages include multi-line ASCII art. Used `<pre>` elements with `white-space: pre` to preserve formatting.

4. **Inline Goal Progress Display** — Room views show "🏆 Goals: {N}/{M}" right after the room name. Small, subtle, non-intrusive but always visible.

5. **Centralized Text Alignment** — Goal and victory messages are center-aligned. Makes ASCII art and celebration text feel like a unified "moment".

6. **Separate Rendering Functions** — Created dedicated `renderGoalComplete()` and `renderVictoryComplete()` rather than cramming logic into the message handler.

#### Integration Points

- Backend will send `goalComplete` with `{ playerName, goalName, goalNumber, totalGoals, asciiArt }`
- Backend will send `victoryComplete` with `{ asciiArt }`
- Room data will include `goalProgress: { completed, total }` in look messages

#### Impact

- Modified: `client/app.js` (new rendering functions, message handlers)
- No breaking changes; new messages are additive
- Vanilla JS/CSS, no dependencies, follows existing patterns

### handleTakeAll Now Triggers Hazard Death

**By:** Mouth (Backend Dev)  
**Date:** 2026-04-14  
**Status:** Completed

#### What

Reversed the prior decision that `handleTakeAll()` skips hazard items. "get items" / "take all" / "g" now attempts to pick up ALL portable items including hazard items. When a hazard item is encountered during the loop, it triggers the full death sequence (same as `handleTake` for individual items) and returns immediately.

#### Rationale

Pat's direction: hazard items should be dangerous regardless of whether the player uses `take <item>` or `take all`. The prior skip behavior created an inconsistency where knowledgeable players could safely use "take all" to avoid traps.

#### Impact

- **Backend:** `handleTakeAll()` in `game-engine.js` modified. No new exports or API changes.
- **Frontend:** No changes needed — death responses use the same format.
- **Tests:** Stef added comprehensive tests for `handleTakeAll` encountering hazard items (569 total tests passing).

### Comprehensive World File Testing Standards

**By:** Stef (Tester)  
**Date:** 2026-04-07  
**Status:** Template Established

#### What

Created and established comprehensive test suite for world files, using "Shadows Over Blackwater" as a template. World files should have comprehensive test coverage including:

1. **Basic validation** — validateWorld() passes with no errors
2. **Multiple goals** — At least 3 puzzles marked as goals (isGoal: true), each with goalName
3. **Item portability** — All puzzle-required items have portable: true, commonly portable items (keys, documents, badges, etc.) are portable
4. **Puzzle solvability** — All requiredItem references exist, puzzle rooms exist, actions reference valid rooms/directions, all puzzles have hint/solved text
5. **Room quality** — Puzzle rooms should have solvedDescription (warning if missing), all rooms have required fields (name, description, exits), startRoom is valid
6. **Item placement** — Items in room.items arrays exist in items section, all items have name/description/roomText and boolean portable field
7. **Room connectivity** — Rooms are reachable via BFS from startRoom (accounting for puzzle-gating), exits are mostly bidirectional except puzzle-gated paths
8. **File constraints** — World file under 30KB, metadata present (name, description, synopsis, displayOrder)

#### Rationale

Pat reported two bugs with new worlds:
- "Only showing 1 goal but there are multiple puzzle rooms" — needed multiple isGoal: true
- "Couldn't pick up Ivory Letter Opener" — item was missing portable: true

These bugs could have been caught by comprehensive automated tests. The test suite created for Shadows Over Blackwater (21 tests, all passing) serves as a template for future world files.

#### Impact

- **Future world files** should follow this testing standard
- **Existing world files** should be audited for these patterns
- **Reference:** `/tests/shadows-over-blackwater.test.js` (21 tests)
- **Template:** Use `describe()` blocks for logical grouping, load world once for all tests

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
