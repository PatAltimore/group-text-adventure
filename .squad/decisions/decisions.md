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
