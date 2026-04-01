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
