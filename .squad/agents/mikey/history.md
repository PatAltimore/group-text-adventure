# Project Context

- **Owner:** Pat Altimore
- **Project:** Group text adventure game — browser-based, text-based multiplayer game for 1-20 players. Rooms connected by compass directions, puzzles solved by collecting items, player inventories, host/join via URL or QR code.
- **Stack:** Azure (Web PubSub for WebSocket, Azure Functions for game logic, Azure Table Storage for persistence), JavaScript/TypeScript, HTML/CSS
- **Created:** 2026-03-31

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- **Deployment Architecture:** Single Storage Account holds both game state (Table Storage) and client files (static website hosting). Free/consumption tiers throughout (Web PubSub F1, Functions Consumption, Storage Standard_LRS). Deployment via single PowerShell or Bash script.
- **World file distribution:** `world/` directory bundled in Function App zip. `gameHub.js` tries deployed path first, then local dev path, enabling seamless local-to-production transition.
- **Client configuration:** `config.json` auto-generated at deploy time with Function App URL. Client uses relative paths for local dev (config file gitignored). No hardcoded endpoints.
- **Azure free tier constraints:** Web PubSub Free_F1 limited to 20 concurrent connections (sufficient for 1-20 player limit). Factored into architecture.
- **404 Architecture Review (2026-04-01):** DNS for `patcastle-func.azurewebsites.net` does not resolve (nslookup returns "Non-existent domain"), meaning the Function App may not exist or is stopped. Code-level architecture is correct: entry point (`src/index.js`), function registration (v4 `app.http`/`app.generic`), host.json extensionBundle (`[4.*, 5.0.0)`), ESM support, and production dependencies all check out. The cmd.exe settings-mangling fix (ARM REST API via `az rest`) is committed (`c1a6041`) but requires redeployment. Deploy scripts lack post-deploy verification (no check that functions are registered or endpoints respond). The bash `deploy.sh` also lacks provisioning-wait and deploy-retry logic that `deploy.ps1` has.
