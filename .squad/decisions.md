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

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
