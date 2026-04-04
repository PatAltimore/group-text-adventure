import { describe, test, expect } from '@jest/globals';
import {
  loadWorld,
  createGameSession,
  addPlayer,
  removePlayer,
  processCommand,
  getPlayerView,
} from '../api/src/game-engine.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const testWorldData = require('./test-world.json');

// ── Helpers ────────────────────────────────────────────────────────────

// Deep-clone the world fixture so each test is isolated
function getTestWorld() {
  return JSON.parse(JSON.stringify(testWorldData));
}

function freshSession() {
  const world = loadWorld(getTestWorld());
  return createGameSession(world);
}

function sessionWithPlayer(id = 'p1', name = 'Alice') {
  const session = freshSession();
  return addPlayer(session, id, name);
}

function sessionWithPlayers(...players) {
  let session = freshSession();
  for (const [id, name] of players) {
    session = addPlayer(session, id, name);
  }
  return session;
}

// ════════════════════════════════════════════════════════════════════════
// 1. World Loading
// ════════════════════════════════════════════════════════════════════════

describe('World Loading', () => {
  test('loads a valid world and returns a world object', () => {
    const world = loadWorld(getTestWorld());
    expect(world).toBeDefined();
    expect(world.name).toBe('Test World');
    expect(world.startRoom).toBe('room-a');
    expect(Object.keys(world.rooms)).toHaveLength(9);
  });

  test('preserves item definitions', () => {
    const world = loadWorld(getTestWorld());
    expect(world.items).toBeDefined();
    expect(world.items.key.name).toBe('Old Key');
  });

  test('preserves puzzle definitions', () => {
    const world = loadWorld(getTestWorld());
    expect(world.puzzles).toBeDefined();
    expect(world.puzzles['locked-passage']).toBeDefined();
  });

  test('rejects world missing rooms', () => {
    const invalid = { name: 'Bad', startRoom: 'room-a' };
    expect(() => loadWorld(invalid)).toThrow();
  });

  test('rejects world missing startRoom', () => {
    const invalid = { name: 'Bad', rooms: { 'room-a': { name: 'A', description: 'A', exits: {}, items: [], hazards: [] } } };
    expect(() => loadWorld(invalid)).toThrow();
  });

  test('rejects world where startRoom does not exist in rooms', () => {
    const invalid = {
      name: 'Bad',
      startRoom: 'nonexistent',
      rooms: { 'room-a': { name: 'A', description: 'A', exits: {}, items: [], hazards: [] } },
    };
    expect(() => loadWorld(invalid)).toThrow();
  });

  test('deep-clones rooms so mutations do not affect original', () => {
    const original = getTestWorld();
    const world = loadWorld(original);
    world.rooms['room-a'].name = 'MUTATED';
    expect(original.rooms['room-a'].name).toBe('Room A');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 2. Session Management
// ════════════════════════════════════════════════════════════════════════

describe('Session Management', () => {
  test('creates a game session from a world', () => {
    const session = freshSession();
    expect(session).toBeDefined();
    expect(session).toHaveProperty('world');
    expect(session).toHaveProperty('players');
    expect(session).toHaveProperty('roomStates');
    expect(session).toHaveProperty('puzzleStates');
  });

  test('session roomStates reflect initial room items', () => {
    const session = freshSession();
    expect(session.roomStates['room-a'].items).toContain('key');
    expect(session.roomStates['room-c'].items).toContain('torch');
  });

  test('session puzzleStates start as unsolved', () => {
    const session = freshSession();
    expect(session.puzzleStates['locked-passage'].solved).toBe(false);
  });

  test('adds a player to the session', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    expect(session.players).toBeDefined();
    expect(session.players['p1']).toBeDefined();
    expect(session.players['p1'].name).toBe('Alice');
  });

  test('new player starts in the startRoom', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    expect(session.players['p1'].room).toBe('room-a');
  });

  test('new player has empty inventory', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    expect(session.players['p1'].inventory).toEqual([]);
  });

  test('adds multiple players', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    expect(Object.keys(session.players)).toHaveLength(2);
    expect(session.players['p1'].name).toBe('Alice');
    expect(session.players['p2'].name).toBe('Bob');
  });

  test('removes a player', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = removePlayer(session, 'p1');
    expect(session.players['p1']).toBeUndefined();
    expect(session.players['p2']).toBeDefined();
  });

  test('removing a player drops their items back into the room', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    expect(session.players['p1'].inventory).toContain('key');
    session = removePlayer(session, 'p1');
    expect(session.roomStates['room-a'].items).toContain('key');
  });

  test('adding duplicate player id is a no-op', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    session = addPlayer(session, 'p1', 'AliceDupe');
    // Should still be Alice, not overwritten
    expect(session.players['p1'].name).toBe('Alice');
  });

  test('removing a non-existent player is a no-op', () => {
    const session = freshSession();
    const result = removePlayer(session, 'ghost');
    expect(result).toBe(session);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 3. Movement
// ════════════════════════════════════════════════════════════════════════

describe('Movement', () => {
  test('moves player to a valid exit direction', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { session: updated } = processCommand(session, 'p1', 'go north');
    expect(updated.players['p1'].room).toBe('room-b');
  });

  test('returns error for invalid direction', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    // room-a has no west exit
    const { responses } = processCommand(session, 'p1', 'go west');
    const playerMsg = responses.find(r => r.playerId === 'p1');
    expect(playerMsg).toBeDefined();
    expect(playerMsg.message.type).toBe('error');
  });

  test('returns error for go with no direction', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', 'go');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
  });

  test('player room changes after move', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    expect(session.players['p1'].room).toBe('room-a');
    const { session: updated } = processCommand(session, 'p1', 'go north');
    expect(updated.players['p1'].room).toBe('room-b');
  });

  test('moving shows the new room (look response)', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', 'go north');
    const lookMsg = responses.find(r => r.playerId === 'p1' && r.message.type === 'look');
    expect(lookMsg).toBeDefined();
    expect(lookMsg.message.room.name).toBe('Room B');
  });

  test('other players in old room receive departure notification', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    const { responses } = processCommand(session, 'p1', 'go north');
    const bobMsg = responses.find(r => r.playerId === 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.type).toBe('playerEvent');
    expect(bobMsg.message.event).toBe('left');
    expect(bobMsg.message.playerName).toBe('Alice');
  });

  test('other players in new room receive arrival notification', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    // Move Bob to room-b first
    ({ session } = processCommand(session, 'p2', 'go north'));
    expect(session.players['p2'].room).toBe('room-b');
    // Now move Alice to room-b
    const { responses } = processCommand(session, 'p1', 'go north');
    const bobMsg = responses.find(r => r.playerId === 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.type).toBe('playerEvent');
    expect(bobMsg.message.event).toBe('arrived');
    expect(bobMsg.message.playerName).toBe('Alice');
  });

  test('can move using direction shorthand aliases', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { session: updated } = processCommand(session, 'p1', 'n');
    expect(updated.players['p1'].room).toBe('room-b');
  });

  test('can move back to the previous room', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'go north'));
    expect(session.players['p1'].room).toBe('room-b');
    ({ session } = processCommand(session, 'p1', 'go south'));
    expect(session.players['p1'].room).toBe('room-a');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 4. Inventory
// ════════════════════════════════════════════════════════════════════════

describe('Inventory', () => {
  test('takes an item from the room using item display name', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { session: updated, responses } = processCommand(session, 'p1', 'take old key');
    expect(updated.players['p1'].inventory).toContain('key');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg).toBeDefined();
    expect(msg.message.type).toBe('message');
  });

  test('item is removed from room after taking', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { session: updated } = processCommand(session, 'p1', 'take old key');
    expect(updated.roomStates['room-a'].items).not.toContain('key');
  });

  test('drops an item — appears in room', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    const { session: afterDrop } = processCommand(session, 'p1', 'drop old key');
    expect(afterDrop.players['p1'].inventory).not.toContain('key');
    expect(afterDrop.roomStates['room-a'].items).toContain('key');
  });

  test('returns error when taking an item not in the room', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', 'take sword');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
  });

  test('returns error when dropping an item not in inventory', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', 'drop sword');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
  });

  test('views inventory with items', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    const { responses } = processCommand(session, 'p1', 'inventory');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg).toBeDefined();
    expect(msg.message.type).toBe('inventory');
    expect(msg.message.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Old Key' })])
    );
  });

  test('empty inventory shows empty items array', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', 'inventory');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg).toBeDefined();
    expect(msg.message.type).toBe('inventory');
    expect(msg.message.items).toHaveLength(0);
  });

  test('inventory shortcut "i" works', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', 'i');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('inventory');
  });

  test('pick up uses pickupText from world definition', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', 'take old key');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.text).toBe('You take the key.');
  });

  test('other players see take notifications', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    const { responses } = processCommand(session, 'p1', 'take old key');
    const bobMsg = responses.find(r => r.playerId === 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text).toContain('Alice');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 5. Puzzles
// ════════════════════════════════════════════════════════════════════════

describe('Puzzles', () => {
  function setupPuzzleSession() {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    return session;
  }

  test('using required item solves puzzle and opens new exit', () => {
    let session = setupPuzzleSession();
    const { session: solved, responses } = processCommand(session, 'p1', 'use old key');
    // The north exit of room-b should now lead to room-d
    expect(solved.roomStates['room-b'].exits.north).toBe('room-d');
    // Player receives the solved text
    const msg = responses.find(r => r.playerId === 'p1' && r.message.type === 'message');
    expect(msg.message.text).toBe('The gate swings open!');
  });

  test('puzzle solution marks puzzle as solved', () => {
    let session = setupPuzzleSession();
    ({ session } = processCommand(session, 'p1', 'use old key'));
    expect(session.puzzleStates['locked-passage'].solved).toBe(true);
  });

  test('puzzle solution consumes the required item', () => {
    let session = setupPuzzleSession();
    ({ session } = processCommand(session, 'p1', 'use old key'));
    expect(session.players['p1'].inventory).not.toContain('key');
  });

  test('attempting puzzle without required item returns error', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'go north'));
    const { responses } = processCommand(session, 'p1', 'use old key');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
  });

  test('solved puzzle persists — exit stays open and walkable', () => {
    let session = setupPuzzleSession();
    ({ session } = processCommand(session, 'p1', 'use old key'));
    expect(session.roomStates['room-b'].exits.north).toBe('room-d');
    // Player can walk through
    const { session: afterMove } = processCommand(session, 'p1', 'go north');
    expect(afterMove.players['p1'].room).toBe('room-d');
  });

  test('puzzle solved text is broadcast to other players in the room', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    ({ session } = processCommand(session, 'p2', 'go north'));
    const { responses } = processCommand(session, 'p1', 'use old key');
    const bobMsg = responses.find(r => r.playerId === 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text).toBe('The gate swings open!');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 6. Give Item
// ════════════════════════════════════════════════════════════════════════

describe('Give Item', () => {
  test('gives an item to another player in the same room', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    const { session: afterGive, responses } = processCommand(session, 'p1', 'give old key to Bob');
    expect(afterGive.players['p1'].inventory).not.toContain('key');
    expect(afterGive.players['p2'].inventory).toContain('key');
    expect(responses.length).toBeGreaterThanOrEqual(2);
  });

  test('cannot give item to a player in a different room', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p2', 'go north'));
    const { responses } = processCommand(session, 'p1', 'give old key to Bob');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
  });

  test('cannot give item you do not have', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    const { responses } = processCommand(session, 'p1', 'give old key to Bob');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
  });

  test('give with no arguments returns error', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', 'give');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
  });

  test('give to non-existent player returns error', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    const { responses } = processCommand(session, 'p1', 'give old key to Nobody');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 7. Multiplayer
// ════════════════════════════════════════════════════════════════════════

describe('Multiplayer', () => {
  test('multiple players in same room see each other in view', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    const view = getPlayerView(session, 'p1');
    expect(view.players).toContain('Bob');
  });

  test('player actions visible to others in the same room', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    const { responses } = processCommand(session, 'p1', 'take old key');
    const bobMsg = responses.find(r => r.playerId === 'p2');
    expect(bobMsg).toBeDefined();
  });

  test('supports up to 20 players in one session', () => {
    let session = freshSession();
    for (let idx = 1; idx <= 20; idx++) {
      session = addPlayer(session, `p${idx}`, `Player${idx}`);
    }
    expect(Object.keys(session.players)).toHaveLength(20);
    const view = getPlayerView(session, 'p1');
    // Should see 19 other players
    expect(view.players).toHaveLength(19);
  });

  test('player disconnect — proper cleanup', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = removePlayer(session, 'p1');
    expect(session.players['p1']).toBeUndefined();
    const view = getPlayerView(session, 'p2');
    expect(view.players).not.toContain('Alice');
  });

  test('players in different rooms do not see each other', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p2', 'go north'));
    const view = getPlayerView(session, 'p1');
    expect(view.players).not.toContain('Bob');
  });

  test('player move notifications only go to players in the same rooms', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob'], ['p3', 'Charlie']);
    // Move Charlie to room-c
    ({ session } = processCommand(session, 'p3', 'go east'));
    // Alice moves north — only Bob (same room) should be notified, not Charlie
    const { responses } = processCommand(session, 'p1', 'go north');
    const charlieMsg = responses.find(r => r.playerId === 'p3');
    expect(charlieMsg).toBeUndefined();
    const bobMsg = responses.find(r => r.playerId === 'p2');
    expect(bobMsg).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// 8. Look / View
// ════════════════════════════════════════════════════════════════════════

describe('Look / View', () => {
  test('getPlayerView returns room name, description, exits, items, players, hazards', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const view = getPlayerView(session, 'p1');
    expect(view.name).toBe('Room A');
    expect(view.description).toBe('Starting room.');
    expect(view.exits).toEqual(expect.arrayContaining(['north', 'east']));
    expect(view.items).toContain('Old Key');
    expect(view.hazards).toEqual([]);
  });

  test('getPlayerView shows hazards when present', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'go north'));
    const view = getPlayerView(session, 'p1');
    expect(view.hazards).toContain('A cold draft chills you.');
  });

  test('getPlayerView after item is taken — item no longer listed', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    const view = getPlayerView(session, 'p1');
    expect(view.items).not.toContain('Old Key');
  });

  test('getPlayerView after puzzle solved — new exit visible', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    ({ session } = processCommand(session, 'p1', 'use old key'));
    const view = getPlayerView(session, 'p1');
    expect(view.exits).toContain('north');
  });

  test('look command via processCommand returns look response', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', 'look');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg).toBeDefined();
    expect(msg.message.type).toBe('look');
    expect(msg.message.room).toBeDefined();
    expect(msg.message.room.name).toBe('Room A');
  });

  test('look does not list the current player in the players list', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const view = getPlayerView(session, 'p1');
    expect(view.players).not.toContain('Alice');
  });

  test('getPlayerView returns null for non-existent player', () => {
    const session = freshSession();
    expect(getPlayerView(session, 'ghost')).toBeNull();
  });

  test('getPlayerView shows item display names, not IDs', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const view = getPlayerView(session, 'p1');
    // Should show "Old Key" (display name), not "key" (item ID)
    expect(view.items).toContain('Old Key');
    expect(view.items).not.toContain('key');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 9. Command Processing Edge Cases
// ════════════════════════════════════════════════════════════════════════

describe('Command Processing Edge Cases', () => {
  test('unknown command returns error', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', 'dance');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
  });

  test('command from non-existent player returns error', () => {
    const session = freshSession();
    const { responses } = processCommand(session, 'ghost', 'look');
    const msg = responses.find(r => r.playerId === 'ghost');
    expect(msg.message.type).toBe('error');
  });

  test('help command returns a message', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', 'help');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg).toBeDefined();
    expect(msg.message.type).toBe('message');
    expect(msg.message.text).toContain('help');
  });

  test('say command sends message to other players in room', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    const { responses } = processCommand(session, 'p1', 'say hello everyone');
    const bobMsg = responses.find(r => r.playerId === 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text).toContain('Alice');
    expect(bobMsg.message.text).toContain('hello everyone');
  });
});
