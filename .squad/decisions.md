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

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
