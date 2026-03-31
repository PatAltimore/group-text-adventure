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
