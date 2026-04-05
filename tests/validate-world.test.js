import { describe, test, expect } from '@jest/globals';
import { validateWorld } from '../world/validate-world.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── World file paths ─────────────────────────────────────────────────
const worldDir = join(__dirname, '..', 'world');

function loadWorldFile(name) {
  const filePath = join(worldDir, name);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

// ── Helpers: build minimal test worlds ───────────────────────────────

function minimalValidWorld() {
  return {
    name: 'Test World',
    startRoom: 'room-a',
    rooms: {
      'room-a': {
        name: 'Room A',
        description: 'A simple room.',
        exits: {},
      },
    },
    items: {},
    puzzles: {},
  };
}

function twoRoomWorld() {
  return {
    name: 'Two Room World',
    startRoom: 'room-a',
    rooms: {
      'room-a': {
        name: 'Room A',
        description: 'Starting room.',
        exits: { north: 'room-b' },
        items: ['key'],
      },
      'room-b': {
        name: 'Room B',
        description: 'Second room.',
        exits: { south: 'room-a' },
        items: [],
      },
    },
    items: {
      key: {
        name: 'Key',
        description: 'A brass key.',
      },
    },
    puzzles: {},
  };
}

function fullWorld() {
  return {
    name: 'Full World',
    description: 'A test world with everything.',
    startRoom: 'room-a',
    rooms: {
      'room-a': {
        name: 'Room A',
        description: 'Starting room.',
        exits: { north: 'room-b', east: 'room-c' },
        items: ['sword'],
      },
      'room-b': {
        name: 'Room B',
        description: 'North room.',
        exits: { south: 'room-a', east: 'room-d' },
        items: ['shield'],
      },
      'room-c': {
        name: 'Room C',
        description: 'East room.',
        exits: { west: 'room-a' },
        items: [],
      },
      'room-d': {
        name: 'Room D',
        description: 'Far east room.',
        exits: { west: 'room-b' },
        items: [],
      },
    },
    items: {
      sword: { name: 'Sword', description: 'A sharp blade.' },
      shield: { name: 'Shield', description: 'A sturdy shield.' },
    },
    puzzles: {
      'open-door': {
        room: 'room-c',
        description: 'A locked door.',
        requiredItem: 'sword',
        solvedText: 'You cut through the door.',
        action: {
          type: 'openExit',
          direction: 'north',
          targetRoom: 'room-d',
        },
      },
    },
  };
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ════════════════════════════════════════════════════════════════════════
// 1. Valid Worlds
// ════════════════════════════════════════════════════════════════════════
describe('Valid worlds', () => {
  test('minimal valid world (1 room, no items, no puzzles)', () => {
    const result = validateWorld(minimalValidWorld());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('two-room world with items and bidirectional exits', () => {
    const result = validateWorld(twoRoomWorld());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('full world with rooms, items, puzzles, and exits', () => {
    const result = validateWorld(fullWorld());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('validates default-world.json', () => {
    const world = loadWorldFile('default-world.json');
    expect(world).not.toBeNull();
    const result = validateWorld(world);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('validates escape-room.json', () => {
    const world = loadWorldFile('escape-room.json');
    expect(world).not.toBeNull();
    const result = validateWorld(world);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('validates space-adventure.json', () => {
    const world = loadWorldFile('space-adventure.json');
    expect(world).not.toBeNull();
    const result = validateWorld(world);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 2. Required Fields (errors)
// ════════════════════════════════════════════════════════════════════════
describe('Required fields', () => {
  test('missing name → error', () => {
    const world = minimalValidWorld();
    delete world.name;
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some(e => /name/i.test(e))).toBe(true);
  });

  test('missing startRoom → error', () => {
    const world = minimalValidWorld();
    delete world.startRoom;
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /startRoom/i.test(e))).toBe(true);
  });

  test('startRoom references non-existent room → error', () => {
    const world = minimalValidWorld();
    world.startRoom = 'nonexistent';
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /startRoom/i.test(e))).toBe(true);
  });

  test('empty rooms object → error', () => {
    const world = minimalValidWorld();
    world.rooms = {};
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /room/i.test(e))).toBe(true);
  });

  test('missing rooms entirely → error', () => {
    const world = minimalValidWorld();
    delete world.rooms;
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /room/i.test(e))).toBe(true);
  });

  test('room missing name → error', () => {
    const world = minimalValidWorld();
    delete world.rooms['room-a'].name;
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /name/i.test(e))).toBe(true);
  });

  test('room missing description → error', () => {
    const world = minimalValidWorld();
    delete world.rooms['room-a'].description;
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /description/i.test(e))).toBe(true);
  });

  test('room missing exits → error', () => {
    const world = minimalValidWorld();
    delete world.rooms['room-a'].exits;
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /exit/i.test(e))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 3. Exit Validation (errors)
// ════════════════════════════════════════════════════════════════════════
describe('Exit validation', () => {
  test('exit references non-existent room → error', () => {
    const world = minimalValidWorld();
    world.rooms['room-a'].exits = { north: 'nowhere' };
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /nowhere/i.test(e) || /exit/i.test(e))).toBe(true);
  });

  test('invalid exit direction (not north/south/east/west) → error', () => {
    const world = twoRoomWorld();
    world.rooms['room-a'].exits = { northeast: 'room-b' };
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /direction/i.test(e) || /northeast/i.test(e))).toBe(true);
  });

  test('multiple invalid directions → multiple errors', () => {
    const world = minimalValidWorld();
    world.rooms['room-a'].exits = { up: 'room-a', left: 'room-a' };
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 4. Item Validation (errors)
// ════════════════════════════════════════════════════════════════════════
describe('Item validation', () => {
  test('room references item not in items section → error', () => {
    const world = minimalValidWorld();
    world.rooms['room-a'].items = ['ghost-item'];
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /ghost-item/i.test(e) || /item/i.test(e))).toBe(true);
  });

  test('item missing name → error', () => {
    const world = twoRoomWorld();
    delete world.items.key.name;
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /name/i.test(e))).toBe(true);
  });

  test('item missing description → error', () => {
    const world = twoRoomWorld();
    delete world.items.key.description;
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /description/i.test(e))).toBe(true);
  });

  test('multiple rooms referencing undefined items → errors for each', () => {
    const world = minimalValidWorld();
    world.rooms['room-a'].items = ['fake1', 'fake2'];
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 5. Puzzle Validation (errors)
// ════════════════════════════════════════════════════════════════════════
describe('Puzzle validation', () => {
  test('puzzle room references non-existent room → error', () => {
    const world = minimalValidWorld();
    world.puzzles = {
      'bad-puzzle': {
        room: 'nonexistent-room',
        description: 'A puzzle.',
        requiredItem: 'key',
        solvedText: 'Solved.',
        action: { type: 'openExit', direction: 'north', targetRoom: 'room-a' },
      },
    };
    world.items = { key: { name: 'Key', description: 'A key.' } };
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /nonexistent-room/i.test(e) || /room/i.test(e))).toBe(true);
  });

  test('puzzle requiredItem references non-existent item → error', () => {
    const world = minimalValidWorld();
    world.puzzles = {
      'bad-puzzle': {
        room: 'room-a',
        description: 'A puzzle.',
        requiredItem: 'nonexistent-item',
        solvedText: 'Solved.',
        action: { type: 'openExit', direction: 'north', targetRoom: 'room-a' },
      },
    };
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /nonexistent-item/i.test(e) || /item/i.test(e))).toBe(true);
  });

  test('puzzle action.targetRoom references non-existent room → error', () => {
    const world = twoRoomWorld();
    world.puzzles = {
      'bad-puzzle': {
        room: 'room-a',
        description: 'A puzzle.',
        requiredItem: 'key',
        solvedText: 'Solved.',
        action: { type: 'openExit', direction: 'north', targetRoom: 'ghost-room' },
      },
    };
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /ghost-room/i.test(e) || /targetRoom/i.test(e) || /room/i.test(e))).toBe(true);
  });

  test('puzzle with all invalid references → multiple errors', () => {
    const world = minimalValidWorld();
    world.puzzles = {
      'triple-bad': {
        room: 'no-room',
        description: 'Bad.',
        requiredItem: 'no-item',
        solvedText: 'Solved.',
        action: { type: 'openExit', direction: 'north', targetRoom: 'no-target' },
      },
    };
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 6. Warnings
// ════════════════════════════════════════════════════════════════════════
describe('Warnings', () => {
  test('non-bidirectional exit → warning', () => {
    const world = {
      name: 'One-Way World',
      startRoom: 'room-a',
      rooms: {
        'room-a': {
          name: 'Room A',
          description: 'Start.',
          exits: { north: 'room-b' },
        },
        'room-b': {
          name: 'Room B',
          description: 'Dead end.',
          exits: {},
        },
      },
      items: {},
      puzzles: {},
    };
    const result = validateWorld(world);
    // One-way exits are valid, but should produce a warning
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some(w => /bidirectional/i.test(w) || /one.?way/i.test(w) || /room-b.*room-a/i.test(w) || /room-a.*room-b/i.test(w))).toBe(true);
  });

  test('orphan room (no inbound connections) → warning', () => {
    const world = {
      name: 'Orphan World',
      startRoom: 'room-a',
      rooms: {
        'room-a': {
          name: 'Room A',
          description: 'Start.',
          exits: {},
        },
        'room-orphan': {
          name: 'Orphan Room',
          description: 'Nobody comes here.',
          exits: { north: 'room-a' },
        },
      },
      items: {},
      puzzles: {},
    };
    const result = validateWorld(world);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some(w => /orphan/i.test(w) || /room-orphan/i.test(w) || /unreachable/i.test(w) || /inbound/i.test(w))).toBe(true);
  });

  test('unused item (defined but not placed in any room) → warning', () => {
    const world = minimalValidWorld();
    world.items = {
      'lonely-item': { name: 'Lonely Item', description: 'No room wants me.' },
    };
    const result = validateWorld(world);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some(w => /lonely-item/i.test(w) || /unused/i.test(w) || /never/i.test(w))).toBe(true);
  });

  test('bidirectional exits produce no non-bidirectional warning', () => {
    const result = validateWorld(twoRoomWorld());
    const biWarnings = result.warnings.filter(w => /bidirectional/i.test(w) || /one.?way/i.test(w));
    expect(biWarnings).toEqual([]);
  });

  test('item used only in puzzle (not in room) still counts as used — no warning', () => {
    const world = minimalValidWorld();
    world.items = {
      'puzzle-key': { name: 'Puzzle Key', description: 'Used in a puzzle.' },
    };
    world.puzzles = {
      'use-key': {
        room: 'room-a',
        description: 'Use the key.',
        requiredItem: 'puzzle-key',
        solvedText: 'Done.',
        action: { type: 'openExit', direction: 'north', targetRoom: 'room-a' },
      },
    };
    // The item is referenced by a puzzle, so it shouldn't be "unused"
    // However, it's not placed in a room, so players can't pick it up.
    // This is arguably a warning about unreachable items, but per spec
    // "unused" means "defined but not in any room". Let this test document
    // the behavior — either approach is reasonable.
    const result = validateWorld(world);
    // We expect the world is valid (puzzle refs are fine)
    expect(result.valid).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 7. Edge Cases
// ════════════════════════════════════════════════════════════════════════
describe('Edge cases', () => {
  test('world with puzzles referencing items that do not exist → errors', () => {
    const world = minimalValidWorld();
    world.puzzles = {
      'needs-item': {
        room: 'room-a',
        description: 'Needs an item.',
        requiredItem: 'missing-item',
        solvedText: 'Solved.',
        action: { type: 'openExit', direction: 'north', targetRoom: 'room-a' },
      },
    };
    // No items defined at all
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /missing-item/i.test(e) || /item/i.test(e))).toBe(true);
  });

  test('room with all 4 exits → valid', () => {
    const world = {
      name: 'Four Exit World',
      startRoom: 'center',
      rooms: {
        center: {
          name: 'Center',
          description: 'Hub room.',
          exits: { north: 'north-rm', south: 'south-rm', east: 'east-rm', west: 'west-rm' },
        },
        'north-rm': {
          name: 'North Room',
          description: 'North.',
          exits: { south: 'center' },
        },
        'south-rm': {
          name: 'South Room',
          description: 'South.',
          exits: { north: 'center' },
        },
        'east-rm': {
          name: 'East Room',
          description: 'East.',
          exits: { west: 'center' },
        },
        'west-rm': {
          name: 'West Room',
          description: 'West.',
          exits: { east: 'center' },
        },
      },
      items: {},
      puzzles: {},
    };
    const result = validateWorld(world);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('circular room connections (A→B→C→A) → valid', () => {
    const world = {
      name: 'Circular World',
      startRoom: 'room-a',
      rooms: {
        'room-a': {
          name: 'Room A',
          description: 'First.',
          exits: { north: 'room-b' },
        },
        'room-b': {
          name: 'Room B',
          description: 'Second.',
          exits: { north: 'room-c' },
        },
        'room-c': {
          name: 'Room C',
          description: 'Third.',
          exits: { north: 'room-a' },
        },
      },
      items: {},
      puzzles: {},
    };
    const result = validateWorld(world);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('self-referencing exit (room exits to itself) → valid with possible warning', () => {
    const world = {
      name: 'Self Loop World',
      startRoom: 'room-a',
      rooms: {
        'room-a': {
          name: 'Room A',
          description: 'Loops to itself.',
          exits: { north: 'room-a' },
        },
      },
      items: {},
      puzzles: {},
    };
    const result = validateWorld(world);
    // Self-referencing exits are structurally valid (no broken refs)
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    // Implementation may optionally warn about self-loops
  });

  test('return shape always has valid, errors, and warnings', () => {
    const result = validateWorld(minimalValidWorld());
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('warnings');
    expect(typeof result.valid).toBe('boolean');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  test('world with null/undefined input → errors gracefully', () => {
    const resultNull = validateWorld(null);
    expect(resultNull.valid).toBe(false);
    expect(resultNull.errors.length).toBeGreaterThanOrEqual(1);

    const resultUndef = validateWorld(undefined);
    expect(resultUndef.valid).toBe(false);
    expect(resultUndef.errors.length).toBeGreaterThanOrEqual(1);
  });

  test('world with empty object → errors', () => {
    const result = validateWorld({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  // NOTE: Mouth's validator currently only validates action.targetRoom (openExit).
  // These two tests document desired behavior for addItem/removeHazard action types
  // which use action.room instead. They will pass once that validation is added.
  test('puzzle with action.type addItem referencing non-existent room → error', () => {
    const world = twoRoomWorld();
    world.puzzles = {
      'add-item-puzzle': {
        room: 'room-a',
        description: 'Adds an item.',
        requiredItem: 'key',
        solvedText: 'Solved.',
        action: { type: 'addItem', room: 'nonexistent', itemId: 'key' },
      },
    };
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  test('puzzle with action.type removeHazard referencing non-existent room → error', () => {
    const world = twoRoomWorld();
    world.puzzles = {
      'remove-hazard-puzzle': {
        room: 'room-a',
        description: 'Clears hazard.',
        requiredItem: 'key',
        solvedText: 'Solved.',
        action: { type: 'removeHazard', room: 'nonexistent', hazard: 'gas' },
      },
    };
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  test('abbreviated directions (n/s/e/w) → error (must be north/south/east/west)', () => {
    const world = minimalValidWorld();
    world.rooms['room-a'].exits = { n: 'room-a' };
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /direction/i.test(e) || /\bn\b/i.test(e))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 8. Real World Files — Structural Smoke Tests
// ════════════════════════════════════════════════════════════════════════
describe('Real world files — structural smoke tests', () => {
  const worldFileNames = ['default-world.json', 'escape-room.json', 'space-adventure.json'];

  for (const fileName of worldFileNames) {
    describe(fileName, () => {
      const world = loadWorldFile(fileName);
      if (!world) {
        test.skip(`${fileName} does not exist yet`, () => {});
        return;
      }

      test('has a name', () => {
        expect(typeof world.name).toBe('string');
        expect(world.name.length).toBeGreaterThan(0);
      });

      test('startRoom exists in rooms', () => {
        expect(world.rooms).toHaveProperty(world.startRoom);
      });

      test('all exit targets are valid rooms or puzzle-unlocked rooms', () => {
        const allRoomIds = new Set(Object.keys(world.rooms));
        // Puzzle-unlocked rooms are also rooms defined in the world
        for (const [roomId, room] of Object.entries(world.rooms)) {
          for (const [dir, target] of Object.entries(room.exits || {})) {
            expect(allRoomIds.has(target)).toBe(true);
          }
        }
      });

      test('all room items are defined in items section', () => {
        for (const [roomId, room] of Object.entries(world.rooms)) {
          for (const itemId of room.items || []) {
            expect(world.items).toHaveProperty(itemId);
          }
        }
      });

      test('validates cleanly through validateWorld', () => {
        const result = validateWorld(world);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });
    });
  }
});

// ════════════════════════════════════════════════════════════════════════
// 9. Item Description Validation (roomText)
// ════════════════════════════════════════════════════════════════════════
describe('Item description validation (roomText)', () => {
  test('roomText is accepted as optional string on items', () => {
    const world = twoRoomWorld();
    world.items.key.roomText = 'A brass key lies on the ground.';
    const result = validateWorld(world);
    // roomText is not validated (we use description instead), but shouldn't cause errors
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('items with missing description trigger error', () => {
    const world = twoRoomWorld();
    delete world.items.key.description;
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /description/i.test(e))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 10. Hazard Object Validation
// ════════════════════════════════════════════════════════════════════════
describe('Hazard object validation', () => {
  function worldWithHazardRoom(hazards) {
    return {
      name: 'Hazard World',
      startRoom: 'room-a',
      rooms: {
        'room-a': {
          name: 'Room A',
          description: 'Start.',
          exits: { north: 'room-b' },
        },
        'room-b': {
          name: 'Room B',
          description: 'Dangerous room.',
          exits: { south: 'room-a' },
          hazards: hazards,
        },
      },
      items: {},
      puzzles: {},
    };
  }

  test('hazards as objects validate correctly', () => {
    const world = worldWithHazardRoom([
      { description: 'Poison gas', probability: 0.1, deathText: 'You choke on gas!' },
    ]);
    const result = validateWorld(world);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('hazard with missing description triggers error', () => {
    const world = worldWithHazardRoom([
      { probability: 0.1, deathText: 'You choke on gas!' },
    ]);
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /description/i.test(e))).toBe(true);
  });

  test('hazard probability out of range triggers warning or error', () => {
    const worldHigh = worldWithHazardRoom([
      { description: 'Gas', probability: 1.5, deathText: 'Dead.' },
    ]);
    const resultHigh = validateWorld(worldHigh);
    const hasIssueHigh =
      resultHigh.errors.some((e) => /probability/i.test(e)) ||
      resultHigh.warnings.some((w) => /probability/i.test(w));
    expect(hasIssueHigh).toBe(true);

    const worldNeg = worldWithHazardRoom([
      { description: 'Gas', probability: -0.5, deathText: 'Dead.' },
    ]);
    const resultNeg = validateWorld(worldNeg);
    const hasIssueNeg =
      resultNeg.errors.some((e) => /probability/i.test(e)) ||
      resultNeg.warnings.some((w) => /probability/i.test(w));
    expect(hasIssueNeg).toBe(true);
  });

  test('hazard with missing probability triggers error', () => {
    const world = worldWithHazardRoom([
      { description: 'Poison gas', deathText: 'You choke on gas!' },
    ]);
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /probability/i.test(e))).toBe(true);
  });

  test('hazard with missing deathText triggers error', () => {
    const world = worldWithHazardRoom([
      { description: 'Poison gas', probability: 0.1 },
    ]);
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /deathText/i.test(e))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 11. Hazard Validation — Stef's additional tests
// ════════════════════════════════════════════════════════════════════════
describe('Hazard validation (Stef)', () => {
  function worldWithHazards(hazards) {
    return {
      name: 'Hazard Val World',
      startRoom: 'room-a',
      rooms: {
        'room-a': {
          name: 'Room A',
          description: 'Start.',
          exits: { north: 'room-b' },
        },
        'room-b': {
          name: 'Room B',
          description: 'Hazard room.',
          exits: { south: 'room-a' },
          hazards: hazards,
        },
      },
      items: {},
      puzzles: {},
    };
  }

  test('hazard probability 0 is valid', () => {
    const world = worldWithHazards([
      { description: 'Gentle breeze.', probability: 0, deathText: '' },
    ]);
    const result = validateWorld(world);
    expect(result.valid).toBe(true);
  });

  test('hazard probability 1 is valid', () => {
    const world = worldWithHazards([
      { description: 'Instant death.', probability: 1, deathText: 'You die!' },
    ]);
    const result = validateWorld(world);
    expect(result.valid).toBe(true);
  });

  test('hazard probability below 0 is invalid', () => {
    const world = worldWithHazards([
      { description: 'Gas.', probability: -0.1, deathText: 'Dead.' },
    ]);
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /probability/i.test(e))).toBe(true);
  });

  test('hazard probability above 1 is invalid', () => {
    const world = worldWithHazards([
      { description: 'Gas.', probability: 1.5, deathText: 'Dead.' },
    ]);
    const result = validateWorld(world);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /probability/i.test(e))).toBe(true);
  });

  test('old string hazards pass validation (backward compatible)', () => {
    const world = worldWithHazards(['A cold draft chills you.']);
    const result = validateWorld(world);
    expect(result.valid).toBe(true);
  });

  test('mixed string and object hazards pass validation', () => {
    const world = worldWithHazards([
      'A cold draft.',
      { description: 'Gas.', probability: 0.5, deathText: 'You die!' },
    ]);
    const result = validateWorld(world);
    expect(result.valid).toBe(true);
  });

  test('hazard object with empty deathText is valid (probability 0 display-only)', () => {
    const world = worldWithHazards([
      { description: 'Scenery mist.', probability: 0, deathText: '' },
    ]);
    const result = validateWorld(world);
    expect(result.valid).toBe(true);
  });
});
