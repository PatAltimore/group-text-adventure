import { describe, test, expect, jest } from '@jest/globals';
import {
  loadWorld,
  createGameSession,
  addPlayer,
  processCommand,
  getPlayerView,
} from '../api/src/game-engine.js';
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── World file paths ─────────────────────────────────────────────────
const worldDir = join(__dirname, '..', 'world');
const worldFiles = {
  'default-world': join(worldDir, 'default-world.json'),
  'space-adventure': join(worldDir, 'space-adventure.json'),
  'escape-room': join(worldDir, 'escape-room.json'),
};

// Load a world file if it exists, otherwise return null
function loadWorldFile(worldId) {
  const filePath = worldFiles[worldId];
  if (!filePath || !existsSync(filePath)) return null;
  return require(filePath);
}

// Deep-clone JSON to isolate mutations
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ════════════════════════════════════════════════════════════════════════
// Reusable World Validation
// ════════════════════════════════════════════════════════════════════════

/**
 * Validate a world JSON object against the full game world schema.
 * Returns an array of error strings. Empty array means valid.
 */
function validateWorldJson(worldJson) {
  const errors = [];

  // 1. Schema: required top-level fields
  for (const field of ['name', 'description', 'startRoom', 'rooms', 'items', 'puzzles']) {
    if (worldJson[field] === undefined || worldJson[field] === null) {
      errors.push(`Missing required field: "${field}"`);
    }
  }
  if (errors.length > 0) return errors; // Can't continue without basic schema

  const { startRoom, rooms, items, puzzles } = worldJson;

  // 2. startRoom exists in rooms
  if (!rooms[startRoom]) {
    errors.push(`startRoom "${startRoom}" not found in rooms`);
  }

  // 3. Room connectivity: every exit target exists in rooms
  for (const [roomId, room] of Object.entries(rooms)) {
    for (const [dir, target] of Object.entries(room.exits || {})) {
      if (!rooms[target]) {
        errors.push(`Room "${roomId}" exit "${dir}" targets non-existent room "${target}"`);
      }
    }
  }

  // 4. Item references in rooms are valid
  for (const [roomId, room] of Object.entries(rooms)) {
    for (const itemId of room.items || []) {
      if (!items[itemId]) {
        errors.push(`Room "${roomId}" references non-existent item "${itemId}"`);
      }
    }
  }

  // 5. Puzzle requiredItem references are valid
  for (const [puzzleId, puzzle] of Object.entries(puzzles)) {
    if (!items[puzzle.requiredItem]) {
      errors.push(`Puzzle "${puzzleId}" requires non-existent item "${puzzle.requiredItem}"`);
    }
  }

  // 6. Puzzle room references are valid
  for (const [puzzleId, puzzle] of Object.entries(puzzles)) {
    if (!rooms[puzzle.room]) {
      errors.push(`Puzzle "${puzzleId}" references non-existent room "${puzzle.room}"`);
    }
  }

  // 7. Puzzle action targets are valid
  for (const [puzzleId, puzzle] of Object.entries(puzzles)) {
    const action = puzzle.action;
    if (!action) continue;
    if (action.type === 'openExit') {
      if (action.targetRoom && !rooms[action.targetRoom]) {
        errors.push(`Puzzle "${puzzleId}" openExit targets non-existent room "${action.targetRoom}"`);
      }
    }
    if (action.type === 'addItem') {
      if (action.room && !rooms[action.room]) {
        errors.push(`Puzzle "${puzzleId}" addItem targets non-existent room "${action.room}"`);
      }
      if (action.itemId && !items[action.itemId]) {
        errors.push(`Puzzle "${puzzleId}" addItem references non-existent item "${action.itemId}"`);
      }
    }
    if (action.type === 'removeHazard') {
      if (action.room && !rooms[action.room]) {
        errors.push(`Puzzle "${puzzleId}" removeHazard targets non-existent room "${action.room}"`);
      }
    }
  }

  // 8. No orphan items: every item in `items` must be placed in a room or referenced by a puzzle
  const referencedItems = new Set();
  for (const room of Object.values(rooms)) {
    for (const itemId of room.items || []) {
      referencedItems.add(itemId);
    }
  }
  for (const puzzle of Object.values(puzzles)) {
    if (puzzle.requiredItem) referencedItems.add(puzzle.requiredItem);
    if (puzzle.action?.itemId) referencedItems.add(puzzle.action.itemId);
  }
  for (const itemId of Object.keys(items)) {
    if (!referencedItems.has(itemId)) {
      errors.push(`Orphan item "${itemId}" is defined but never placed in a room or referenced by a puzzle`);
    }
  }

  // 9. All rooms reachable from startRoom (considering puzzle-unlocked exits)
  const reachable = new Set();
  const queue = [startRoom];
  // Collect all exits that puzzles can open
  const puzzleExits = {};
  for (const puzzle of Object.values(puzzles)) {
    if (puzzle.action?.type === 'openExit') {
      const sourceRoom = puzzle.room;
      const targetRoom = puzzle.action.targetRoom;
      if (!puzzleExits[sourceRoom]) puzzleExits[sourceRoom] = [];
      puzzleExits[sourceRoom].push(targetRoom);
    }
  }

  while (queue.length > 0) {
    const roomId = queue.shift();
    if (reachable.has(roomId)) continue;
    reachable.add(roomId);
    const room = rooms[roomId];
    if (!room) continue;
    // Normal exits
    for (const target of Object.values(room.exits || {})) {
      if (!reachable.has(target)) queue.push(target);
    }
    // Puzzle-unlocked exits
    for (const target of puzzleExits[roomId] || []) {
      if (!reachable.has(target)) queue.push(target);
    }
  }

  for (const roomId of Object.keys(rooms)) {
    if (!reachable.has(roomId)) {
      errors.push(`Room "${roomId}" is unreachable from startRoom "${startRoom}"`);
    }
  }

  // 10. Room count: exactly 10 rooms
  const roomCount = Object.keys(rooms).length;
  if (roomCount !== 10) {
    errors.push(`Expected 10 rooms, found ${roomCount}`);
  }

  return errors;
}

// ════════════════════════════════════════════════════════════════════════
// 1. World JSON Validation Tests
// ════════════════════════════════════════════════════════════════════════

const worldEntries = [
  ['default-world', 'default-world.json'],
  ['space-adventure', 'space-adventure.json'],
  ['escape-room', 'escape-room.json'],
];

for (const [worldId, fileName] of worldEntries) {
  describe(`World Validation: ${worldId}`, () => {
    const worldJson = loadWorldFile(worldId);
    const available = worldJson !== null;

    // Skip entire block if file doesn't exist yet
    const conditionalTest = available ? test : test.skip;

    conditionalTest('has required schema fields (name, description, startRoom, rooms, items, puzzles)', () => {
      expect(worldJson).toHaveProperty('name');
      expect(worldJson).toHaveProperty('description');
      expect(worldJson).toHaveProperty('startRoom');
      expect(worldJson).toHaveProperty('rooms');
      expect(worldJson).toHaveProperty('items');
      expect(worldJson).toHaveProperty('puzzles');
    });

    conditionalTest('startRoom exists in rooms', () => {
      expect(worldJson.rooms[worldJson.startRoom]).toBeDefined();
    });

    conditionalTest('all room exits reference existing rooms', () => {
      for (const [roomId, room] of Object.entries(worldJson.rooms)) {
        for (const [dir, target] of Object.entries(room.exits || {})) {
          expect(worldJson.rooms[target]).toBeDefined();
        }
      }
    });

    conditionalTest('all item references in rooms are valid', () => {
      for (const [roomId, room] of Object.entries(worldJson.rooms)) {
        for (const itemId of room.items || []) {
          expect(worldJson.items[itemId]).toBeDefined();
        }
      }
    });

    conditionalTest('all puzzle requiredItem references are valid', () => {
      for (const [puzzleId, puzzle] of Object.entries(worldJson.puzzles)) {
        expect(worldJson.items[puzzle.requiredItem]).toBeDefined();
      }
    });

    conditionalTest('all puzzle room references are valid', () => {
      for (const [puzzleId, puzzle] of Object.entries(worldJson.puzzles)) {
        expect(worldJson.rooms[puzzle.room]).toBeDefined();
      }
    });

    conditionalTest('all puzzle action targets are valid', () => {
      for (const [puzzleId, puzzle] of Object.entries(worldJson.puzzles)) {
        const action = puzzle.action;
        if (!action) continue;
        if (action.type === 'openExit' && action.targetRoom) {
          expect(worldJson.rooms[action.targetRoom]).toBeDefined();
        }
        if (action.type === 'addItem') {
          if (action.room) expect(worldJson.rooms[action.room]).toBeDefined();
          if (action.itemId) expect(worldJson.items[action.itemId]).toBeDefined();
        }
        if (action.type === 'removeHazard' && action.room) {
          expect(worldJson.rooms[action.room]).toBeDefined();
        }
      }
    });

    conditionalTest('no orphan items — every item is placed or puzzle-referenced', () => {
      const referencedItems = new Set();
      for (const room of Object.values(worldJson.rooms)) {
        for (const itemId of room.items || []) referencedItems.add(itemId);
      }
      for (const puzzle of Object.values(worldJson.puzzles)) {
        if (puzzle.requiredItem) referencedItems.add(puzzle.requiredItem);
        if (puzzle.action?.itemId) referencedItems.add(puzzle.action.itemId);
      }
      for (const itemId of Object.keys(worldJson.items)) {
        expect(referencedItems.has(itemId)).toBe(true);
      }
    });

    conditionalTest('all rooms reachable from startRoom (including puzzle-unlocked exits)', () => {
      const { startRoom, rooms, puzzles } = worldJson;
      const reachable = new Set();
      const queue = [startRoom];

      const puzzleExits = {};
      for (const puzzle of Object.values(puzzles)) {
        if (puzzle.action?.type === 'openExit') {
          if (!puzzleExits[puzzle.room]) puzzleExits[puzzle.room] = [];
          puzzleExits[puzzle.room].push(puzzle.action.targetRoom);
        }
      }

      while (queue.length > 0) {
        const roomId = queue.shift();
        if (reachable.has(roomId)) continue;
        reachable.add(roomId);
        const room = rooms[roomId];
        if (!room) continue;
        for (const target of Object.values(room.exits || {})) {
          if (!reachable.has(target)) queue.push(target);
        }
        for (const target of puzzleExits[roomId] || []) {
          if (!reachable.has(target)) queue.push(target);
        }
      }

      for (const roomId of Object.keys(rooms)) {
        expect(reachable.has(roomId)).toBe(true);
      }
    });

    conditionalTest('has exactly 10 rooms', () => {
      expect(Object.keys(worldJson.rooms)).toHaveLength(10);
    });

    conditionalTest('passes full validation with zero errors', () => {
      const errors = validateWorldJson(worldJson);
      expect(errors).toEqual([]);
    });
  });
}

// ════════════════════════════════════════════════════════════════════════
// 2. World Selection — Game Engine Integration
// ════════════════════════════════════════════════════════════════════════

describe('World Selection — Game Engine Integration', () => {
  // ── loadWorld + createGameSession ──────────────────────────────────

  const spaceJson = loadWorldFile('space-adventure');
  const escapeJson = loadWorldFile('escape-room');
  const defaultJson = loadWorldFile('default-world');

  const hasSpace = spaceJson !== null;
  const hasEscape = escapeJson !== null;
  const hasDefault = defaultJson !== null;

  const spaceTest = hasSpace ? test : test.skip;
  const escapeTest = hasEscape ? test : test.skip;
  const defaultTest = hasDefault ? test : test.skip;

  spaceTest('loadWorld(space-adventure) succeeds and returns a valid world', () => {
    const world = loadWorld(clone(spaceJson));
    expect(world).toBeDefined();
    expect(world.name).toBeDefined();
    expect(world.startRoom).toBeDefined();
    expect(world.rooms).toBeDefined();
  });

  escapeTest('loadWorld(escape-room) succeeds and returns a valid world', () => {
    const world = loadWorld(clone(escapeJson));
    expect(world).toBeDefined();
    expect(world.name).toBeDefined();
    expect(world.startRoom).toBeDefined();
    expect(world.rooms).toBeDefined();
  });

  spaceTest('createGameSession(space-adventure) creates session with correct startRoom', () => {
    const world = loadWorld(clone(spaceJson));
    const session = createGameSession(world);
    expect(session).toHaveProperty('world');
    expect(session).toHaveProperty('roomStates');
    expect(session).toHaveProperty('puzzleStates');
    expect(session.world.startRoom).toBe(spaceJson.startRoom);
    // Player added to session starts in the correct room
    const withPlayer = addPlayer(session, 'p1', 'Astronaut');
    expect(withPlayer.players['p1'].room).toBe(spaceJson.startRoom);
  });

  escapeTest('createGameSession(escape-room) creates session with correct startRoom', () => {
    const world = loadWorld(clone(escapeJson));
    const session = createGameSession(world);
    expect(session).toHaveProperty('world');
    expect(session).toHaveProperty('roomStates');
    expect(session).toHaveProperty('puzzleStates');
    expect(session.world.startRoom).toBe(escapeJson.startRoom);
    const withPlayer = addPlayer(session, 'p1', 'Escapee');
    expect(withPlayer.players['p1'].room).toBe(escapeJson.startRoom);
  });

  // ── Navigation in each world ──────────────────────────────────────

  spaceTest('player can navigate between rooms in space-adventure', () => {
    const world = loadWorld(clone(spaceJson));
    const session = createGameSession(world);
    const withPlayer = addPlayer(session, 'p1', 'Astronaut');

    const startRoom = spaceJson.startRoom;
    const startExits = Object.entries(world.rooms[startRoom].exits);
    expect(startExits.length).toBeGreaterThan(0);

    // Mock Math.random to prevent hazard deaths during navigation
    jest.spyOn(Math, 'random').mockReturnValue(0.99);

    // Move in the first available direction
    const [direction, targetRoomId] = startExits[0];
    const { session: moved, responses } = processCommand(withPlayer, 'p1', `go ${direction}`);

    Math.random.mockRestore();

    expect(moved.players['p1'].room).toBe(targetRoomId);

    // Should get a look response
    const lookResp = responses.find(r => r.playerId === 'p1' && r.message.type === 'look');
    expect(lookResp).toBeDefined();
  });

  escapeTest('player can navigate between rooms in escape-room', () => {
    const world = loadWorld(clone(escapeJson));
    const session = createGameSession(world);
    const withPlayer = addPlayer(session, 'p1', 'Escapee');

    const startRoom = escapeJson.startRoom;
    const startExits = Object.entries(world.rooms[startRoom].exits);
    expect(startExits.length).toBeGreaterThan(0);

    jest.spyOn(Math, 'random').mockReturnValue(0.99);

    const [direction, targetRoomId] = startExits[0];
    const { session: moved, responses } = processCommand(withPlayer, 'p1', `go ${direction}`);

    Math.random.mockRestore();

    expect(moved.players['p1'].room).toBe(targetRoomId);

    const lookResp = responses.find(r => r.playerId === 'p1' && r.message.type === 'look');
    expect(lookResp).toBeDefined();
  });

  // ── Item pickup in each world ─────────────────────────────────────

  spaceTest('player can pick up an item in space-adventure', () => {
    const world = loadWorld(clone(spaceJson));
    const session = createGameSession(world);
    let current = addPlayer(session, 'p1', 'Astronaut');

    // Find a room with items — might need to walk to it
    const itemRoom = findRoomWithItem(world);
    expect(itemRoom).not.toBeNull();

    current = navigateToRoom(current, 'p1', world, itemRoom.roomId);
    expect(current.players['p1'].room).toBe(itemRoom.roomId);

    const itemName = world.items[itemRoom.itemId].name;
    const { session: afterTake, responses } = processCommand(current, 'p1', `take ${itemName}`);
    expect(afterTake.players['p1'].inventory).toContain(itemRoom.itemId);
  });

  escapeTest('player can pick up an item in escape-room', () => {
    const world = loadWorld(clone(escapeJson));
    const session = createGameSession(world);
    let current = addPlayer(session, 'p1', 'Escapee');

    const itemRoom = findRoomWithItem(world);
    expect(itemRoom).not.toBeNull();

    current = navigateToRoom(current, 'p1', world, itemRoom.roomId);
    expect(current.players['p1'].room).toBe(itemRoom.roomId);

    const itemName = world.items[itemRoom.itemId].name;
    const { session: afterTake } = processCommand(current, 'p1', `take ${itemName}`);
    expect(afterTake.players['p1'].inventory).toContain(itemRoom.itemId);
  });

  // ── Puzzle solving in each world ──────────────────────────────────

  spaceTest('at least one puzzle is solvable in space-adventure', () => {
    testPuzzleSolvable(clone(spaceJson));
  });

  escapeTest('at least one puzzle is solvable in escape-room', () => {
    testPuzzleSolvable(clone(escapeJson));
  });

  // ── Edge cases ────────────────────────────────────────────────────

  defaultTest('missing worldId defaults to default-world behavior', () => {
    // When no worldId specified, the game should use default-world
    const world = loadWorld(clone(defaultJson));
    const session = createGameSession(world);
    expect(session.world.name).toBe(defaultJson.name);
    expect(session.world.startRoom).toBe(defaultJson.startRoom);
    const withPlayer = addPlayer(session, 'p1', 'Player');
    expect(withPlayer.players['p1'].room).toBe(defaultJson.startRoom);
  });

  test('loadWorld rejects invalid/empty input gracefully', () => {
    expect(() => loadWorld({})).toThrow();
    expect(() => loadWorld({ name: 'X' })).toThrow();
    expect(() => loadWorld({ name: 'X', startRoom: 'nope', rooms: {} })).toThrow();
    expect(() => loadWorld(null)).toThrow();
    expect(() => loadWorld(undefined)).toThrow();
  });

  test('loadWorld rejects world with startRoom missing from rooms', () => {
    const bad = {
      name: 'Bad',
      description: 'A bad world',
      startRoom: 'nonexistent',
      rooms: { lobby: { name: 'Lobby', description: 'A lobby', exits: {}, items: [], hazards: [] } },
      items: {},
      puzzles: {},
    };
    expect(() => loadWorld(bad)).toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════
// 3. Reusable Validation Function — Unit Tests
// ════════════════════════════════════════════════════════════════════════

describe('validateWorldJson utility', () => {
  test('returns empty array for a valid minimal world', () => {
    const validWorld = {
      name: 'Tiny World',
      description: 'A small world for testing.',
      startRoom: 'r1',
      rooms: Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [
          `r${i + 1}`,
          {
            name: `Room ${i + 1}`,
            description: `Room ${i + 1} desc`,
            exits: i < 9 ? { north: `r${i + 2}` } : { south: `r${i}` },
            items: i === 0 ? ['item1'] : [],
            hazards: [],
          },
        ])
      ),
      items: { item1: { name: 'Widget', description: 'A widget', pickupText: 'Got it!', portable: true } },
      puzzles: {},
    };
    // Make rooms link back so they're all reachable
    for (let i = 2; i <= 10; i++) {
      validWorld.rooms[`r${i}`].exits.south = `r${i - 1}`;
    }
    expect(validateWorldJson(validWorld)).toEqual([]);
  });

  test('detects missing required fields', () => {
    const errors = validateWorldJson({ name: 'X' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('startRoom'))).toBe(true);
  });

  test('detects startRoom not in rooms', () => {
    const world = {
      name: 'X', description: 'X', startRoom: 'missing',
      rooms: { r1: { name: 'R', description: 'R', exits: {}, items: [], hazards: [] } },
      items: {}, puzzles: {},
    };
    const errors = validateWorldJson(world);
    expect(errors.some(e => e.includes('startRoom') && e.includes('not found'))).toBe(true);
  });

  test('detects broken exit references', () => {
    const world = {
      name: 'X', description: 'X', startRoom: 'r1',
      rooms: { r1: { name: 'R', description: 'R', exits: { north: 'nowhere' }, items: [], hazards: [] } },
      items: {}, puzzles: {},
    };
    const errors = validateWorldJson(world);
    expect(errors.some(e => e.includes('non-existent room') && e.includes('nowhere'))).toBe(true);
  });

  test('detects orphan items', () => {
    const rooms = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        `r${i + 1}`,
        { name: `R${i + 1}`, description: 'X', exits: i < 9 ? { north: `r${i + 2}` } : {}, items: [], hazards: [] },
      ])
    );
    for (let i = 2; i <= 10; i++) rooms[`r${i}`].exits.south = `r${i - 1}`;
    const world = {
      name: 'X', description: 'X', startRoom: 'r1', rooms,
      items: { orphan: { name: 'Orphan', description: 'Lonely', pickupText: 'Got it', portable: true } },
      puzzles: {},
    };
    const errors = validateWorldJson(world);
    expect(errors.some(e => e.includes('Orphan item') && e.includes('orphan'))).toBe(true);
  });

  test('detects unreachable rooms', () => {
    const world = {
      name: 'X', description: 'X', startRoom: 'r1',
      rooms: {
        r1: { name: 'R1', description: 'X', exits: {}, items: [], hazards: [] },
        r2: { name: 'R2', description: 'X', exits: {}, items: [], hazards: [] },
      },
      items: {}, puzzles: {},
    };
    const errors = validateWorldJson(world);
    expect(errors.some(e => e.includes('unreachable') && e.includes('r2'))).toBe(true);
  });

  test('detects wrong room count', () => {
    const world = {
      name: 'X', description: 'X', startRoom: 'r1',
      rooms: {
        r1: { name: 'R1', description: 'X', exits: { north: 'r2' }, items: [], hazards: [] },
        r2: { name: 'R2', description: 'X', exits: { south: 'r1' }, items: [], hazards: [] },
      },
      items: {}, puzzles: {},
    };
    const errors = validateWorldJson(world);
    expect(errors.some(e => e.includes('Expected 10 rooms'))).toBe(true);
  });

  test('detects invalid puzzle item references', () => {
    const world = {
      name: 'X', description: 'X', startRoom: 'r1',
      rooms: { r1: { name: 'R1', description: 'X', exits: {}, items: [], hazards: [] } },
      items: {},
      puzzles: { p1: { room: 'r1', requiredItem: 'ghost-item', solvedText: 'Done', action: { type: 'openExit', direction: 'north', targetRoom: 'r1' } } },
    };
    const errors = validateWorldJson(world);
    expect(errors.some(e => e.includes('non-existent item') && e.includes('ghost-item'))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Helpers for gameplay tests
// ════════════════════════════════════════════════════════════════════════

/**
 * Find the first room in a world that contains at least one item.
 * Returns { roomId, itemId } or null.
 */
function findRoomWithItem(world) {
  for (const [roomId, room] of Object.entries(world.rooms)) {
    if (room.items && room.items.length > 0) {
      return { roomId, itemId: room.items[0] };
    }
  }
  return null;
}

/**
 * BFS pathfinding: navigate a player from their current room to a target room.
 * Returns updated session. Uses processCommand('go <dir>') for each step.
 */
function navigateToRoom(session, playerId, world, targetRoomId) {
  let current = session;
  const maxSteps = 20;
  let steps = 0;

  // Prevent hazard deaths during test navigation
  const origRandom = Math.random;
  Math.random = () => 0.99;

  while (current.players[playerId] && current.players[playerId].room !== targetRoomId && steps < maxSteps) {
    const currentRoom = current.players[playerId].room;
    const path = bfsPath(world, currentRoom, targetRoomId, current);
    if (!path || path.length === 0) break;

    const nextDirection = path[0];
    const result = processCommand(current, playerId, `go ${nextDirection}`);
    current = result.session;
    steps++;
  }

  Math.random = origRandom;
  return current;
}

/**
 * BFS to find shortest path (as directions) between two rooms.
 * Uses session roomStates for current exits (respects puzzle state).
 */
function bfsPath(world, fromRoom, toRoom, session) {
  if (fromRoom === toRoom) return [];

  const visited = new Set([fromRoom]);
  const queue = [{ roomId: fromRoom, path: [] }];

  while (queue.length > 0) {
    const { roomId, path } = queue.shift();
    const exits = session ? session.roomStates[roomId].exits : (world.rooms[roomId].exits || {});

    for (const [dir, target] of Object.entries(exits)) {
      if (visited.has(target)) continue;
      const newPath = [...path, dir];
      if (target === toRoom) return newPath;
      visited.add(target);
      queue.push({ roomId: target, path: newPath });
    }
  }

  return null;
}

/**
 * Test that at least one puzzle is fully solvable in a given world JSON.
 * Steps: get required item, go to puzzle room, use item.
 */
function testPuzzleSolvable(worldJson) {
  const world = loadWorld(worldJson);
  const session = createGameSession(world);
  let current = addPlayer(session, 'tester', 'Tester');

  const puzzleEntries = Object.entries(worldJson.puzzles);
  expect(puzzleEntries.length).toBeGreaterThan(0);

  // Find a puzzle whose requiredItem is placed in a room (so we can pick it up)
  let solved = false;

  for (const [puzzleId, puzzle] of puzzleEntries) {
    const itemId = puzzle.requiredItem;
    const puzzleRoom = puzzle.room;

    // Find where the item is
    let itemRoomId = null;
    for (const [roomId, room] of Object.entries(worldJson.rooms)) {
      if ((room.items || []).includes(itemId)) {
        itemRoomId = roomId;
        break;
      }
    }
    if (!itemRoomId) continue; // Item might be obtained another way

    // Try to navigate to the item room
    const atItem = navigateToRoom(current, 'tester', world, itemRoomId);
    if (atItem.players['tester'].room !== itemRoomId) continue; // Can't reach it

    // Pick up the item
    const itemName = world.items[itemId].name;
    const { session: afterTake } = processCommand(atItem, 'tester', `take ${itemName}`);
    if (!afterTake.players['tester'].inventory.includes(itemId)) continue; // Couldn't take it

    // Navigate to the puzzle room
    const atPuzzle = navigateToRoom(afterTake, 'tester', world, puzzleRoom);
    if (atPuzzle.players['tester'].room !== puzzleRoom) continue; // Can't reach it

    // Use the item
    const { session: afterUse, responses } = processCommand(atPuzzle, 'tester', `use ${itemName}`);

    // Verify the puzzle was solved
    if (afterUse.puzzleStates[puzzleId].solved) {
      solved = true;
      // Item should be consumed
      expect(afterUse.players['tester'].inventory).not.toContain(itemId);
      // Should have gotten the solved text
      const solvedResp = responses.find(r =>
        r.playerId === 'tester' && r.message.text === puzzle.solvedText
      );
      expect(solvedResp).toBeDefined();
      break;
    }
  }

  expect(solved).toBe(true);
}
