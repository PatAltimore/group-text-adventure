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

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
