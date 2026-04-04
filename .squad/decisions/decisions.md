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
