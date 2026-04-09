### Retro Font: VT323 from Google Fonts

**By:** Data (Frontend Dev)  
**Date:** 2026-04-04

#### What

Switched the game's primary monospace font to **VT323** (Google Fonts), a pixel font inspired by the DEC VT320 terminal. Gives the game a strong retro CRT / Apple II aesthetic while keeping all existing fonts as fallbacks.

#### Key Decisions

1. **VT323 over Press Start 2P or Courier New** — VT323 hits the sweet spot: retro terminal pixel look (Apple II vibes Pat wanted) without being too aggressive for long reading sessions. Press Start 2P is too chunky at body text sizes; Courier New is too common/boring.

2. **Google Fonts with `display=swap`** — Font loads from Google CDN with font-display swap so text is visible immediately (falls back to existing monospace fonts while VT323 loads). Added `preconnect` hints for fast loading.

3. **Only `--font-mono` updated, not `--font-sans`** — The sans stack is used for titles and UI chrome where a clean system font still works well. The retro feel comes through the game text (output, commands, inventory) which all use `--font-mono`.

4. **No font-size changes needed** — VT323 renders cleanly at the existing 13–18px sizes used throughout the CSS. No adjustments required.

#### Impact

- Modified: `client/index.html` (Google Fonts link), `client/style.css` (--font-mono variable)
- No JavaScript changes
- All pre-existing tests unaffected (CSS-only change)
