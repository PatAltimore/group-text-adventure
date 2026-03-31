# Decision: Vanilla JS Client with CDN QR Library

**By:** Data (Frontend Dev)
**Date:** 2026-03-31

## Context

The browser client needs to be lightweight with no build step for a text-based game.

## Decision

- **No framework** — vanilla HTML/CSS/JS for the entire client. Fast load, zero tooling.
- **QR code via CDN** — `qrcode@1.5.4` loaded from jsDelivr. No npm install needed.
- **Azure Web PubSub subprotocol** — using `json.webpubsub.azure.v1` for structured JSON messaging. Client wraps outgoing messages in `sendToGroup` envelope and unwraps incoming `data` field.
- **URL-based routing** — `?game=XXXX` parameter for join links. No SPA router needed.
- **CSS custom properties** — all theme colors in `:root` for easy theming.

## Impact

- Backend must implement `/api/negotiate?gameId=...` returning `{ url: "wss://..." }`.
- Server messages must match the agreed protocol types (`look`, `message`, `error`, `inventory`, `playerEvent`, `gameInfo`).
