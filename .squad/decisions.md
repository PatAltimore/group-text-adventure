# Squad Decisions

## Active Decisions

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

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
