# Session Log — 2026-04-14T171439Z — Hazard Get-All Fix

## Objective
Update `handleTakeAll()` to include hazard items in bulk pickup, triggering death mechanics instead of skipping hazards.

## Agents Deployed
- **Mouth** (Backend Dev): Fixed `handleTakeAll()` logic, updated test fixtures
- **Stef** (Test Dev): Updated test expectations for new death behavior

## Outcomes
✅ All 567 tests pass  
✅ handleTakeAll() now includes hazard items  
✅ Test fixture cleaned (removed numbered-bracelet from nonary-game)  
✅ Death behavior verified for both "take all" and "g" shortcut  

## Key Deliverables
- Game engine: `handleTakeAll()` includes hazard items, triggers instant death
- Test suite: Updated 2 test cases to expect death instead of skip behavior
- Fixture cleanup: Removed hazard item from nonary-game flooded-cabin

## Technical Highlights
- `handleTakeAll()` now treats hazard items like regular items
- Both "get items" and "g" shortcut have consistent behavior
- Death response format unchanged, test coverage complete

## Next Steps
- Code review of changes
- Merge to main after approval
- Monitor player feedback on updated mechanics
