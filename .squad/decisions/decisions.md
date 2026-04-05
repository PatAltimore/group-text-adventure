# Team Decisions

## 1. Backend Architecture — Stateless Functions + Pure Game Engine

**Author:** Mouth (Backend Dev)  
**Date:** 2026-03-31  
**Status:** Implemented

### Decision

- Pure game engine (`game-engine.js`) with zero Azure imports, fully testable
- Connection ID as player ID (Web PubSub's connectionId is user identity)
- Full session state in single Table Storage entity (64KB max, sufficient)
- ESM modules with native import/export
- Human-editable JSON world files

### Impact

- Frontend uses WebSocket protocol documented in `gameHub.js`
- `negotiate` endpoint returns `{ url, gameId }`
- Game state is mutable within request but always persisted back to Table Storage

---

## 2. Vanilla JS Client with CDN QR Library

**Author:** Data (Frontend Dev)  
**Date:** 2026-03-31  
**Status:** Implemented

### Decision

- Vanilla HTML/CSS/JS (no framework, zero build step)
- QR code via CDN (`qrcode@1.5.4` from jsDelivr)
- Azure Web PubSub subprotocol `json.webpubsub.azure.v1`
- URL-based routing with `?game=XXXX` parameter
- CSS custom properties for theming

### Impact

- Backend implements `/api/negotiate?gameId=...` returning `{ url: "wss://..." }`
- Server messages must match protocol types: `look`, `message`, `error`, `inventory`, `playerEvent`, `gameInfo`

---

## 3. Test Suite Structure & ESM Configuration

**Author:** Stef (Tester)  
**Date:** 2026-03-31  
**Status:** Implemented

### Decision

- Root `package.json` uses `"type": "module"` with Jest `--experimental-vm-modules`
- Tests use `@jest/globals` imports
- Test world fixture is separate JSON file
- Tests written against actual engine API

### Impact

- All team members run tests with `npm test` from project root
- New test files must use ESM `import` syntax
- `@jest/globals` is required devDependency

---

## 4. Fix: Negotiate 404, Deploy Idempotency, Missing gameId

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-01  
**Status:** Implemented

### Decision

- Add `gameId` to client join message to prevent players always joining 'default' game
- Make deploy scripts idempotent by checking storage account existence before name availability
- Improve error messages in negotiate endpoint to include full URL

### Problem Resolved

After deployment, users couldn't connect properly. Three issues found:

1. **gameId missing:** WebSocket join message didn't include gameId, causing all players to join 'default' game
2. **Deploy not idempotent:** `az storage account check-name` returns false for your own accounts, blocking re-runs
3. **Poor error messages:** 404 errors didn't show which URL was called, hindering diagnosis

### Impact

- **Modified files:** `client/app.js`, `deploy/deploy.ps1`, `deploy/deploy.sh`
- **Fixes deployed behavior** without breaking changes
- Requires Azure redeployment
- All 111 tests pass

---

## 5. Dedicated Join Screen for URL-Based Game Discovery

**Author:** Data (Frontend Dev)  
**Date:** 2026-04-01  
**Status:** Implemented

### Decision

- Create separate `screen-join` component for players arriving via `?game=XXX` URLs
- Show game code prominently (read-only)
- Focus on single action: "Join Game →"
- Optimize for mobile-first UX (QR code scanning)

### Problem Resolved

Join URLs showed same confusing screen as landing page with mixed host/join CTAs. Mobile users didn't know which button to press.

### Impact

- **Modified files:** `client/index.html`, `client/style.css`, `client/app.js`
- **New function:** `initJoin()` for dedicated join screen
- Improved UX for QR code and shared link flows
- All tests pass, cleaner code organization

---

## 6. Resource Group Must Be First Provisioning Step

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-01  
**Status:** Implemented

### Decision

Reordered deploy scripts (`deploy.ps1` and `deploy.sh`) so resource group creation runs before any command that references the resource group (specifically the storage account existence check).

### Problem Resolved

Fresh deploys failed with `ResourceGroupNotFound` because the idempotency check added for storage accounts used `az storage account show --resource-group $RG` before the resource group existed.

### Rule

Any `az` command with `--resource-group` requires the RG to exist. Resource group creation (`az group create`) is idempotent and must always be the first provisioning step in deploy scripts.

### Impact

- Modified: `deploy/deploy.ps1`, `deploy/deploy.sh`
- No application code changes; all 111 tests pass

---

## 7. Deploy Script: Safe Native Command Error Handling Pattern

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-01  
**Status:** Implemented

### Decision

For PowerShell deploy scripts with `$ErrorActionPreference = 'Stop'`, wrap expected-failure native commands (like `az`) in try/catch blocks.

**Safe pattern for expected failures:**

```powershell
$result = $null
try {
    $result = az some-command 2>&1
    if ($LASTEXITCODE -ne 0) { $result = $null }
} catch {
    $result = $null
}
```

`2>$null` alone is NOT safe. Use try/catch + `2>&1` + `$LASTEXITCODE` check.

### Problem Resolved

`$ErrorActionPreference = 'Stop'` only affects PowerShell cmdlets, not native executables. When `az storage account show` failed (ResourceNotFound), `2>$null` didn't reliably suppress the stderr stream across PowerShell versions, causing terminating errors.

### Impact

- Fixed: `deploy/deploy.ps1` (lines 70-90)
- Bash version (`deploy.sh`) was already safe via `|| echo ""`
- All 111 tests still pass
- This pattern applies to any `az`, `npm`, or other native command where failure is an expected/valid outcome

---

## 8. Fix: Static Website Upload — Use Connection String for Data Plane Auth

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-01  
**Status:** Implemented

### Decision

Changed `az storage blob upload-batch` in deploy scripts from `--account-name` to `--connection-string` authentication. Added post-upload verification that fails if 0 files are present.

### Problem Resolved

Static website returned 404. The `upload-batch` command used `--account-name` alone, which silently fails when storage-level auth isn't auto-discovered (exit code 0, 0 files uploaded). Data plane operations require explicit auth credentials.

### Rule

- Always pass `--connection-string` to `az storage blob` data plane commands (`upload-batch`, `upload`, `download`, `list`)
- Never rely on `--account-name` alone for data plane operations
- Always verify uploads complete by listing the container after `upload-batch`

### Impact

- Modified: `deploy/deploy.ps1`, `deploy/deploy.sh` (step 10)
- No application code changes; all 111 tests pass
- Requires Azure redeployment

### Convention

Data plane vs management plane are separate auth paths. Wrap data plane commands with verification logic — silent failures are common.

---

## 9. Fix: Belt-and-Suspenders for EnableWorkerIndexing

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-01  
**Status:** Implemented

### Decision

Modified `deploy/deploy.ps1` to set `AzureWebJobsFeatureFlags=EnableWorkerIndexing` at FOUR points in the deployment lifecycle, plus added loud diagnostic output when negotiate returns 404.

### Problem Resolved

The setting was applied via ARM REST API but the negotiate endpoint still returned 404 across multiple deployments. Zip deployment can reset or fail to propagate app settings, and the Azure Functions runtime needs this flag present at cold-start time to enable v4 worker indexing.

### Changes

1. **Set at function app creation** — via `--app-settings` on `az functionapp create`
2. **Restart after app settings** — before zip deploy
3. **Re-apply after zip deploy** — simple `az functionapp config appsettings set`
4. **Restart after zip deploy** — force re-index
5. **Fixed fallback path bug** — connection string PUTs were replacing ALL settings instead of merging
6. **Added loud diagnostics on 404** — dumps settings, lists functions, prints next steps

### Convention

For deployment-critical app settings, apply them redundantly at every opportunity. The cost of redundancy is zero; the cost of a missing flag is a broken deployment.

### Impact

- Modified: `deploy/deploy.ps1`
- All 111 tests pass
- **Requires redeployment** to take effect

---

## 10. Deploy Architecture Review — Negotiate 404

**Author:** Mikey (Lead)  
**Date:** 2026-04-01  
**Status:** Implemented

### Verdict

**The function code, dependencies, ESM configuration, and zip package structure are all correct.** The persistent 404 is a deployment configuration issue, not a code issue.

### Critical Issue Found

**Missing `FUNCTIONS_EXTENSION_VERSION=~4` in settings dict:**

- File: `deploy/deploy.ps1`, lines 241-250
- The `$newSettings` hashtable does NOT include `FUNCTIONS_EXTENSION_VERSION=~4`
- Script relies entirely on ARM API read-and-merge to preserve it from `az functionapp create`
- **Risk:** If merge happens before propagation completes, `PUT` replaces ALL settings, dropping `FUNCTIONS_EXTENSION_VERSION`
- Result: host version undefined → function discovery fails silently → 404 on all endpoints

**Same risk applies to `AzureWebJobsStorage`** — also not in `$newSettings`, also relies on merge.

### Verification Done

✅ 28 checks passed (programming model, ESM, deps, host.json, zip structure, runtime imports, etc.)

### Recommendations

1. Add `FUNCTIONS_EXTENSION_VERSION=~4` to `$newSettings` dict — makes deployment self-contained
2. Add `FUNCTIONS_EXTENSION_VERSION` and `AzureWebJobsStorage` to `criticalKeys` verification — catch dropped values
3. Add `Assert-AzSuccess` after post-deploy re-apply
4. Consider adding `AzureWebJobsStorage` to `$newSettings` with storage connection string

### Impact

Deployment configuration only. No application code changes needed.

---

## 11. Deploy Script: Static Website Hosting — Three Defensive Layers

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-01  
**Status:** Implemented

### Decision

Hardened the static website hosting setup in `deploy.ps1` with three layers of defense against the persistent 404 issue.

### Key Decisions

1. **Explicit auth params on ALL storage commands** — Pass `--account-name` + `--account-key` explicitly instead of relying on env vars alone. This matches the `deploy.sh` approach (which uses `--connection-string` and works reliably) while avoiding semicolons on the Windows command line.

2. **Re-enable static website at point of use** — Static website hosting is now enabled TWICE: once in step 3 (early), once in step 10 (right before upload). Steps 4-9 take many minutes and touch many Azure resources. The defensive re-enable costs nothing (idempotent) and guarantees the hosting is active when files are uploaded.

3. **Verify the specific blob, not just count** — The upload verification now checks that `index.html` specifically exists in the `$web` container (the static website's index document), not just that blob count >= 1.

4. **End-to-end health check** — The deploy script now actually requests the static website URL after deployment and reports the HTTP status. If 404, it dumps full diagnostics (service properties, blob names, next steps) so the root cause is immediately visible.

### Convention Going Forward

- All Azure Storage data plane commands in deploy scripts MUST use explicit `--account-name` + `--account-key` (or `--connection-string` in bash). Don't rely on env vars alone.
- When enabling a capability that a later step depends on (like static website hosting), re-enable defensively at point of use, not just early in the script.
- Upload verifications should check for the SPECIFIC files needed (e.g., `index.html`), not just "any file exists."

### Impact

- Modified: `deploy/deploy.ps1` (steps 3, 10, 12a)
- All 111 tests pass
- Committed and pushed

---

## 12. Health Endpoint for Post-Deploy Verification

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-02  
**Status:** Implemented

### Decision

Added `/api/health` endpoint and post-deploy verification to deploy script with 10 retries × 15s intervals (2.5min max tolerance for Azure cold starts).

### Key Points

1. **Health endpoint returns configuration state** — Not just "ok" but also which settings are configured, what Node.js version is running, and which functions are loaded. This separates "runtime alive" from "app configured correctly."

2. **Deploy script polls health first, negotiate second** — Health is a better primary check because it's anonymous, has no dependencies (no WebPubSub connection string needed), and returns diagnostic JSON. Negotiate is kept as a secondary check.

3. **10 retries × 15s = 2.5 minutes max wait** — Azure Functions Consumption plan cold starts can take 30-60s. Previous check (6 × 15s) sometimes wasn't enough.

4. **Diagnostic, not blocking** — Verification failures print warnings and diagnostic steps but do NOT fail the deployment. The deployment may still be warming up.

### Convention Going Forward

- When adding new Azure Function files, add them to both `api/src/index.js` (import) AND the `functionsLoaded` array in `health.js`.
- When adding new required app settings, add a check for them in the health endpoint's `settings` object.

### Impact

- Created: `api/src/functions/health.js`
- Modified: `api/src/index.js`, `deploy/deploy.ps1`
- All 111 tests pass
- Committed and pushed

---

## 13. Deploy Script: Resilience & WEBSITE_RUN_FROM_PACKAGE Handling

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-04  
**Status:** Needs Implementation

### Decision

Two fixes required in `deploy/deploy.ps1`:

1. **Provisioning loop stderr resilience (step 5, lines 230-242):** Wrap loop body in `try/catch` to handle Azure CLI Python warnings that trigger `$ErrorActionPreference = 'Stop'` even with `2>$null` redirection. PowerShell treats native command stderr as terminating exception in strict mode.

2. **WEBSITE_RUN_FROM_PACKAGE handling (post-deploy, lines 493-523):** On Linux Consumption, `config-zip` deploys to blob storage and sets `WEBSITE_RUN_FROM_PACKAGE` to a SAS URL (correct). Do NOT override to hardcoded `1` — Linux Consumption with blob deployment requires the SAS URL, not `1`. Overriding causes persistent 503.

### Problem Resolved

**2026-04-04 deployment session:**

- Subscription switched successfully, but `deploy.ps1 -Location westus2` failed at provisioning check (step 5) when Azure CLI emitted Python cryptography warnings. Loop doesn't handle native command stderr properly.

- Manual deployment succeeded via `az functionapp deployment source config-zip`. Post-deploy, `WEBSITE_RUN_FROM_PACKAGE` was correctly set to blob SAS URL. Initially overwrote to `1` (per old logic), which broke the deployment (persistent 503). Removing the override and letting the blob URL persist fixed the issue.

### Key Learnings

1. **PowerShell stderr + $ErrorActionPreference:** Native command stderr (e.g., Python warnings from Azure CLI) can trigger exceptions when `$ErrorActionPreference = 'Stop'`, even with `2>$null` redirection. This is inconsistent across PowerShell 5.1 vs 7+. Solution: wrap in `try/catch`.

2. **WEBSITE_RUN_FROM_PACKAGE on Linux Consumption:** `config-zip` manages this value automatically. It sets it to a blob SAS URL (correct for blob-based deployment). Do NOT override to `1` — that's only correct for traditional "Run from Package" deployments in /home/data. On Consumption Linux with blob storage, the runtime reads from the blob URL, not the local directory.

3. **Zip deploy behavior:** `az functionapp deployment source config-zip` can reset or wipe custom app settings. The post-deploy re-apply logic is essential. However, `WEBSITE_RUN_FROM_PACKAGE` should be excluded from the drift check — let the deploy command manage it. Only re-apply connection strings, feature flags, and other non-deployment-specific settings.

### Convention Going Forward

- Provisioning loops in deploy scripts MUST wrap native command calls in `try/catch` to handle stderr output gracefully.
- WEBSITE_RUN_FROM_PACKAGE is managed by the deploy command (config-zip). Do not override it post-deploy. Post-deploy settings re-apply should exclude this value.
- After blob-based zip deployment (`config-zip`), verify `WEBSITE_RUN_FROM_PACKAGE` is non-empty (has a blob URL), but do not check for a specific value.

### Impact

- Modified: `deploy/deploy.ps1` (step 5 provisioning loop, post-deploy settings verification)
- No application code changes needed
- Requires redeployment to verify fix
- All 111 tests still pass

### Files

- `deploy/deploy.ps1` (lines 230-242 provisioning loop, lines 493-523 post-deploy settings)

---

## 14. Client Clipboard & Look Deduplication

**Author:** Data (Frontend Dev)  
**Date:** 2026-04-04  
**Status:** Implemented

### Decision

Fixed two client bugs: (1) share button crash when clipboard API unavailable, and (2) duplicate room view after host join.

### Key Decisions

1. **Clipboard helper (`copyToClipboard`)** — Centralized clipboard access behind a guard (`if (navigator.clipboard)`) + try/catch. All three clipboard call sites (share button, overlay copy, lobby copy) now use this helper. Clipboard is treated as optional enhancement; UI actions always complete even without it.

2. **Look message debounce** — Added 2-second same-room deduplication in `handleServerMessage`. If the same room name arrives in a `look` message within 2 seconds of the last, it's skipped. This prevents server-side retries or Web PubSub echo from rendering duplicate room views, while still allowing intentional player-initiated "look" commands.

3. **WebSocket cleanup** — `connectWebSocket()` now closes any existing `state.ws` before creating a new connection, preventing orphaned event listeners from processing stale messages.

### Impact

- Modified: `client/app.js` (clipboard helper, share overlay, look deduplication, WebSocket cleanup)
- No server-side changes
- All 150 tests pass unchanged

### Open Question

The exact server-side cause of the duplicate look was not pinpointed. Investigation confirmed `handleJoin` sends exactly one `look` via `sendToConnection`. The most likely cause is Web PubSub service behavior (response echo or retry on cold start). The client-side debounce is a robust fix regardless of root cause. If duplicate looks persist with >2s gaps, the server team should investigate the upstream handler's response format.

---

## 15. Azure Developer CLI (azd) Template

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-04  
**Status:** Implemented

### Context

Pat requested an azd template to complement the existing `deploy/deploy.ps1` script. The azd template provisions the same infrastructure and deploys the same code, giving the team an alternative deployment path using `azd up`.

### Decision

Created a full azd template (`azure.yaml` + `infra/` Bicep files) that provisions Storage Account, Web PubSub (Free), and Function App (Linux Consumption). Data-plane operations (static website hosting, Web PubSub event handler, client config generation) are handled via azure.yaml hooks.

### Key Trade-offs

1. **Two deployment paths coexist.** The PowerShell script is battle-tested with extensive retry logic and error handling. The azd template is cleaner but relies on azd's deployment machinery. Both provision identical resources.

2. **Postdeploy hook complexity.** Static website hosting and Web PubSub event handler require data-plane operations that Bicep can't do. The postdeploy hook handles both, plus client config generation and CORS updates. This is unavoidable but means `azd up` isn't purely declarative.

3. **Resource naming divergence.** The existing script uses `{appName}store` / `{appName}-func` / `{appName}-wps`. The azd template uses `st{token}` / `func-{token}` / `wps-{token}` with a uniqueString token. This means azd deployments create NEW resources, not reuse existing ones. This is intentional — azd environments are isolated.

### Impact

- **No existing files modified.** deploy/deploy.ps1 is untouched. All 150 tests pass.
- **New files:** `azure.yaml`, `infra/main.bicep`, `infra/resources.bicep`, `infra/main.parameters.json`, `infra/abbreviations.json`
- **Team usage:** Run `azd init` then `azd up` from repo root. Environment name and location are prompted.

---

## 18. Copilot Directive — Ghost Player Design

**Author:** Pat Altimore (via Copilot)  
**Date:** 2026-04-04  
**Status:** Design Accepted

### Decision

When a player disconnects, their character becomes a "ghost" (e.g., "Bob's ghost") that remains in the room. Other players in the same room can take the ghost's inventory. When reconnecting, the player can choose their ghost to rejoin with their previous state. This is the preferred design for disconnect/reconnect and inventory reclamation.

### Rationale

Creative alternative to simple inventory drop + auto-reconnect. User request.

---

## 19. Multi-World Support — Server-Side World Selection

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-05  
**Status:** Implemented

### Decision

- World ID = filename without `.json` (e.g., `space-adventure.json` → `space-adventure`)
- `GET /api/worlds` endpoint scans `world/` directory dynamically
- `worldId` in join message is optional, defaults to `default-world`
- `worldId` persisted in session metadata
- `getWorld(worldId)` generalized loader; `getDefaultWorld()` kept for backward compatibility

### Impact

- **New files:** `world/space-adventure.json`, `world/escape-room.json`, `api/src/functions/worlds.js`
- **Modified:** `api/src/functions/gameHub.js`, `api/src/index.js`
- **All 150 existing tests pass** — no regressions
- **Client changes needed:** Frontend should call `GET /api/worlds` to show world picker, then send `worldId` in the join message

---

## 20. World/Adventure Selector Frontend Integration

**Author:** Data (Frontend Dev)  
**Date:** 2026-04-04  
**Status:** Implemented

### Decision

- Selector placement: Between player name input and Host/Join buttons
- Graceful fallback: If `/api/worlds` fails, show "The Forgotten Castle" with value `default-world`
- `worldId` only sent by hosts; joiners' join messages remain unchanged
- Lobby shows adventure name in subtitle
- CSS custom select (no JavaScript dropdown library)

### API Contract

```
GET /api/worlds → [{ id: string, name: string, description: string }, ...]
```

### Impact

- Modified: `client/index.html`, `client/app.js`, `client/style.css`
- All 150 tests pass unchanged
- Depends on: Mouth's `/api/worlds` endpoint (falls back gracefully if not yet deployed)

---

## 21. World Selector Fetch Timeout & Fallback

**Author:** Data (Frontend Dev)  
**Date:** 2026-04-04  
**Status:** Implemented

### Decision

- 5-second fetch timeout via AbortController handles cold-start delays and hung connections
- HTML default is "The Forgotten Castle" (not a placeholder); dropdown usable before JS runs
- Extracted `setDefaultWorld()` with isolated try/catch to prevent error cascades

### Impact

- Modified: `client/app.js`, `client/index.html`
- All 204 tests pass unchanged
- No backend changes needed

---

## 22. World Validation Test Strategy

**Author:** Stef (Tester)  
**Date:** 2026-04-02  
**Status:** Implemented

### Decision

- Reusable `validateWorldJson()` function runs 10 checks (schema, connectivity, items, puzzles, reachability)
- `test.skip` for missing world files so CI doesn't break while backends build them
- BFS reachability includes puzzle-unlocked exits
- Gameplay tests use BFS pathfinding to walk player to correct room

### Impact

- New file: `tests/world-selection.test.js` (32 tests)
- All 172 existing tests still pass
- Future world authors: add world ID to `worldEntries` array and get full validation

---

## 23. Ghost Player System

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-05  
**Status:** Implemented

### Decision

- Ghosts keyed by player name (not player ID)
- Ghosts visible in room view via `ghosts` array in `getPlayerView`
- Two interaction commands: `loot <name>'s ghost` (all items, ghost fades) and `take <item> from <name>'s ghost` (one item)
- Ghost timeout 30 minutes (extended from 5 because players can loot ghosts)
- Reconnection restores remaining inventory; empty ghost fades immediately
- Timed-out ghost scatters items to room floor

### Impact

- Modified: `api/src/game-engine.js`, `api/src/functions/gameHub.js`, `api/src/command-parser.js`
- Updated: `tests/game-engine.test.js`
- Exports changed: `findDisconnectedPlayerByName` → `findGhostByName`, etc.
- **250 tests pass** (was 231)

### Convention

Disconnect state lives in `session.ghosts`. Ghost names match player display names (case-sensitive keys). New ghost-interaction commands use `findGhostByName()`.

---

## 24. Ghost Player UI Display

**Author:** Data (Frontend Dev)  
**Date:** 2026-04-04  
**Status:** Implemented

### Decision

- Ghost section ordering: Items → Players → Ghosts → Hazards → Exits
- Ghost styling: Faded italic text at 75-80% opacity in pale blue-grey (`#7a8a9e`), ethereal but muted
- Loot hint contextual: only appears when ghosts are present
- Reconnection message: "You reclaim your ghostly form" (ghost-themed)
- `playerDrop` repurposed with ghost styling; new `ghostEvent` message type for ghost lifecycle
- Room view messages should include `ghosts: string[]`

### Contract with Backend

- `ghosts: string[]` in room views (e.g., `["Bob's ghost"]`)
- Ghost lifecycle events: `{ type: 'ghostEvent', text: '...' }` or `playerDrop`
- Reconnection: `gameInfo` with `{ reconnected: true, room, inventory }`

### Impact

- Modified: `client/app.js`, `client/style.css`
- New CSS classes: `.msg-ghost`, `.room-ghosts`, `.room-ghost-hint`
- Backward compatible with existing `playerDrop` messages

---

## 25. Player Reconnection & Inventory Drop

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-06  
**Status:** Implemented

### Decision

- Disconnected players' state (room, inventory) preserved for 5 minutes via separate `session.disconnectedPlayers` map
- Rejoining with same name restores state
- After 5 minutes without reconnection, items drop into last room and become pickable by anyone
- Design B: Separate `disconnectedPlayers` map (not a `disconnected` flag) means all existing game logic excludes disconnected players automatically
- Name = identity for reconnection (checked via `findDisconnectedPlayerByName` before `resolvePlayerName`)
- Three disconnect states: `'disconnected'`, `'reconnected'`, `'left'`
- Lazy cleanup via activity triggers in `handleJoin`, `handleCommand`, `handleStartGame`
- `gameInfo.reconnected: true` flag signals client to skip lobby

### Impact

- Modified: `api/src/game-engine.js` (5 new exported functions), `api/src/functions/gameHub.js`
- 27 new tests in `tests/game-engine.test.js`
- **231 tests pass** (204 existing + 27 new)

### Client Impact

- Handle `playerEvent.event === 'disconnected'` (show "Alice lost connection")
- Handle `playerEvent.event === 'reconnected'` (show "Alice reconnected")
- Handle `gameInfo.reconnected === true` (skip lobby, restore game view)

---

## 26. Reconnection Flow Fix (Ghost Reclamation + Stale Disconnect)

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-05  
**Status:** Implemented

### Decision

- Three-path reconnection in `handleJoin`: Ghost match (normal), active player takeover (race condition), fresh join (ghost looted/expired). Ghost match takes priority.
- Stale disconnect protection: Disconnect handler checks that disconnecting connectionId matches player's active connectionId. Stale disconnects silently ignored.
- Reconnection `gameInfo` includes `inventory` and `ghosts` (e.g., `{ reconnected: true, inventory, ghosts }`)
- Reconnection `playerEvent` includes text (e.g., `"Bob's ghost stirs... Bob has reconnected!"`)

### Impact

- Modified: `api/src/functions/gameHub.js`, `tests/game-engine.test.js`
- +6 reconnection edge case tests
- **256 tests pass** (was 250)
- No client changes needed (server now sends text client already handles)

---

## 27. Reconnect vs Duplicate Name — Rejoin Flag Protocol

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-05  
**Status:** Implemented

### Decision

- Client sends `rejoin: true` on auto-rejoin only (from localStorage; fresh joins do NOT include flag)
- Server gates ghost reclamation behind `rejoin` flag in `handleJoin`
- `resolvePlayerName` now checks ghost names too (new players picking ghost names get adjective prefix)

### Impact

- Modified: `client/app.js` (1 line), `api/src/functions/gameHub.js`, `api/src/game-engine.js`
- 6 new tests; **263 tests pass**
- Cross-team: Data should know join message now optionally includes `rejoin: true`

---

## 28. Auto-Reconnect Missing pendingRejoin Flag (Fix)

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-06  
**Status:** Fixed

### Issue

WebSocket auto-reconnect and manual "tap to reconnect" created new players instead of reclaiming ghosts. Full page refreshes worked (init() set pendingRejoin), but network drops didn't.

### Root Cause

`attemptReconnect()` and `manualReconnect()` called `connectWebSocket()` without setting `state.pendingRejoin = true`.

### Key Decision

Guard `pendingRejoin` behind `state.playerId` check: `if (state.playerId) state.pendingRejoin = true`. Players with identity rejoin; players without (shouldn't happen) do normal join.

### Impact

- Modified: `client/app.js` (2 lines), `api/src/functions/gameHub.js` (logging + BinaryData-safe parsing)
- **274 tests pass**
- Requires redeployment

---

## 29. Player ID System — Ghost Matching by playerId

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-06  
**Status:** Implemented

### Decision

- Server generates `playerId` on first join using `crypto.randomUUID()`, stored in `session.players[connectionId].playerId`
- `playerId` sent in `gameInfo` response (both first join and reconnect); client must persist
- Ghost stores `playerId`; `findGhostByPlayerId()` searches by this field
- Reconnection requires both `rejoin: true` AND `data.playerId`
- Active player takeover (race condition) also uses `playerId` matching
- Name is display-only; `resolvePlayerName` handles collisions

### Protocol Change

`gameInfo` message now includes `playerId: string` — client must store and send back on rejoin

### Impact

- Modified: `api/src/game-engine.js`, `api/src/functions/gameHub.js`, `tests/game-engine.test.js`
- 11 new tests, 2 updated
- **274 tests pass** (was 263)

---

## 30. Reconnection Persistence — localStorage over sessionStorage

**Author:** Data (Frontend Dev)  
**Date:** 2026-04-04  
**Status:** Implemented

### Decision

- `localStorage` instead of `sessionStorage` (survives tab close, true "rejoin later" capability). Keys prefixed `gta_` to avoid collisions.
- Graceful fallback on rejoin failure: if auto-rejoin fails, clear stored session and fall back to landing page
- URL mismatch clears stale session: if URL has `?game=X` but localStorage has different gameId, clear before showing join screen
- Negotiate failure doesn't break retry chain: `attemptReconnect()` self-retries on negotiate failure

### Impact

- Modified: `client/app.js`
- **250 tests pass** unchanged
- No backend changes needed
- Players can reliably reconnect by refreshing, even after closing and reopening tab

---

## 31. Client-Side Reconnection & Session Persistence

**Author:** Data (Frontend Dev)  
**Date:** 2026-04-04  
**Status:** Implemented

### Decision

- `sessionStorage` (tab-scoped) for session persistence: cleared on tab close, persists on refresh (note: later replaced with `localStorage` in Decision #30)
- No sessionStorage clear on `beforeunload` (fires on refresh too, breaks reconnection)
- Exponential backoff for auto-reconnect: 2s base × 1.5^attempt, capped at 10s, max 5 attempts
- Reconnect skips lobby entirely: when server sends `gameInfo` with `reconnected: true`, go straight to game screen
- `playerDrop` message type for dropped inventory (displayed as player-event text)

### Message Contract

- Server sends `gameInfo` with `{ reconnected: true, room, inventory }` on same-name rejoin
- Server may send `{ type: 'playerDrop', playerName, text }` for inventory drops

### Impact

- Modified: `client/app.js`, `client/index.html`, `client/style.css`
- **204 tests pass** unchanged

---

## 32. Do NOT Declare `web` as an azd Service

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-05  
**Status:** Decision

### Context

The `web` (client) service was declared in `azure.yaml` as `host: staticwebapp`, but Bicep infrastructure creates a Storage Account with static website hosting — not an Azure Static Web App resource. This mismatch caused `azd up` to fail because azd couldn't find a resource tagged `azd-service-name: web`.

### Decision

Removed `web` service block from `azure.yaml`. Client files deployed entirely by global `postdeploy` hook, which:
1. Enables static website hosting on Storage Account
2. Generates `config.json` with Function App URL
3. Uploads client files to `$web` blob container
4. Configures Web PubSub and CORS

### Rule

If a service's deployment is fully handled by a custom hook, do NOT declare it as an azd service. azd expects each declared service to have a corresponding tagged Azure resource.

---

## 33. New Azure Function Endpoint Checklist

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-05  
**Status:** Decision

### Context

The `/api/worlds` endpoint was deployed but had no error logging, wasn't listed in `health.js`, and deploy scripts didn't validate its presence.

### Decision

Every new Azure Function endpoint must include:

1. **Handler error handling** — Wrap handler body in try/catch. Log with `context.log` (success) and `context.error` (failure). Return structured error response on failure.
2. **health.js update** — Add function name to `functionsLoaded` array so diagnostics reflect deployed functions.
3. **Deploy script validation** — Add function file to required files list in `deploy/deploy.ps1` and `deploy/deploy.sh`.

### Rationale

Silent production failures with no Application Insights logs. Health endpoint inaccurate. Deploy scripts could package incomplete zips.

---

## 34. Ghost Persistence — No Expiration, Loot Keeps Ghost

**Author:** Mouth (Backend Dev)  
**Date:** 2026-04-06  
**Status:** Implemented

### What

Changed ghost behavior in three ways:

1. **Looting a ghost only takes inventory, ghost stays.** `handleLoot` and `handleTakeFromGhost` transfer items; ghost entity remains in room with empty inventory. No "fades away" on loot.
2. **Rejoining starts in ghost's room.** `reconnectPlayer` already did this — no change needed. Even fully-looted ghost preserves player's room position.
3. **Ghosts never expire.** Removed `getExpiredGhosts`, `finalizeGhost`, `cleanupExpiredGhosts`, `GHOST_TIMEOUT_MS` entirely. Ghosts persist until player reconnects.

### Why

Ghosts are placeholders for disconnected players. Removing them on loot or timeout meant players who reconnected after being looted lost their position and had to start over. Now: ghost = "your seat is saved."

### Impact

- Modified: `api/src/game-engine.js` (2 functions removed, 2 modified), `api/src/functions/gameHub.js` (1 function + 3 call sites + 1 constant removed)
- Updated: `tests/game-engine.test.js` (13 tests removed, 4 updated, 1 added)
- **262 tests pass** (was 274; net -12 from removed expiration tests)
- No client changes needed

---

## 35. Ghost Persistence Test Coverage

**Author:** Stef (Tester)  
**Date:** 2026-04-06  
**Status:** Implemented

### What

Added 17 acceptance tests in new `describe('Ghost Persistence')` block in `tests/game-engine.test.js` covering three ghost behavior changes:

1. **Looting keeps ghost alive** — Ghost persists in `session.ghosts` after loot; only inventory taken. Empty ghosts remain visible in room descriptions.
2. **Rejoin uses ghost's room** — `reconnectPlayer` places returning player in ghost's room (not start room), even if ghost fully looted.
3. **Ghosts never expire** — `getExpiredGhosts` and `finalizeGhost` no longer exported. Ghosts with arbitrarily old timestamps persist and remain lootable/reconnectable.

### Impact

- Fixed broken imports in `game-engine.test.js` (removed expired functions from import list)
- **279 tests pass** across all 4 test suites
- These tests serve as acceptance criteria for ghost persistence

### Convention

Ghost persistence tests live in the `Ghost Persistence` describe block (section 17). Future ghost behavior changes should add tests there, not in older `Ghost Looting` or `Reconnection Edge Cases` blocks.
