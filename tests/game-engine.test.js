import { describe, test, expect } from '@jest/globals';
import {
  loadWorld,
  createGameSession,
  addPlayer,
  removePlayer,
  processCommand,
  getPlayerView,
  disconnectPlayer,
  findGhostByName,
  reconnectPlayer,
  getExpiredGhosts,
  finalizeGhost,
  getGhostsInRoom,
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
    expect(bobMsg.message.event).toBe('moved');
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

// ════════════════════════════════════════════════════════════════════════
// 10. Player Reconnection
// ════════════════════════════════════════════════════════════════════════

describe('Player Reconnection (Ghost System)', () => {
  test('disconnectPlayer creates a ghost in session.ghosts', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    session = disconnectPlayer(session, 'p1');
    expect(session.players['p1']).toBeUndefined();
    expect(session.ghosts).toBeDefined();
    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.ghosts['Alice'].playerName).toBe('Alice');
  });

  test('ghost preserves room and inventory', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    expect(session.players['p1'].room).toBe('room-b');
    expect(session.players['p1'].inventory).toContain('key');

    session = disconnectPlayer(session, 'p1');
    const ghost = session.ghosts['Alice'];
    expect(ghost.room).toBe('room-b');
    expect(ghost.inventory).toContain('key');
  });

  test('ghost has a disconnectedAt timestamp', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    const before = Date.now();
    session = disconnectPlayer(session, 'p1');
    const after = Date.now();
    const ts = session.ghosts['Alice'].disconnectedAt;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test('disconnectPlayer on non-existent player is a no-op', () => {
    const session = freshSession();
    const result = disconnectPlayer(session, 'ghost');
    expect(result).toBe(session);
  });

  test('disconnected player does not appear in room view as player', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = disconnectPlayer(session, 'p1');
    const view = getPlayerView(session, 'p2');
    expect(view.players).not.toContain('Alice');
  });

  test('ghost appears in room view ghosts list', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = disconnectPlayer(session, 'p1');
    const view = getPlayerView(session, 'p2');
    expect(view.ghosts).toContain("Alice's ghost");
  });

  test('ghost does not appear in room view of different room', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p2', 'go north'));
    session = disconnectPlayer(session, 'p1');
    const view = getPlayerView(session, 'p2');
    expect(view.ghosts).not.toContain("Alice's ghost");
  });

  test('disconnected player does not receive movement notifications', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob'], ['p3', 'Charlie']);
    session = disconnectPlayer(session, 'p2');
    const { responses } = processCommand(session, 'p1', 'go north');
    const bobMsg = responses.find(r => r.playerId === 'p2');
    expect(bobMsg).toBeUndefined();
  });

  test('findGhostByName finds by exact name', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    session = disconnectPlayer(session, 'p1');
    const found = findGhostByName(session, 'Alice');
    expect(found).not.toBeNull();
    expect(found.ghostName).toBe('Alice');
    expect(found.ghost.playerName).toBe('Alice');
  });

  test('findGhostByName is case-insensitive', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    session = disconnectPlayer(session, 'p1');
    const found = findGhostByName(session, 'alice');
    expect(found).not.toBeNull();
    expect(found.ghostName).toBe('Alice');
  });

  test('findGhostByName returns null when no match', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    session = disconnectPlayer(session, 'p1');
    expect(findGhostByName(session, 'Bob')).toBeNull();
  });

  test('findGhostByName returns null on session without ghosts', () => {
    const session = freshSession();
    expect(findGhostByName(session, 'Alice')).toBeNull();
  });

  test('reconnectPlayer restores player from ghost with new ID', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    session = disconnectPlayer(session, 'p1');

    session = reconnectPlayer(session, 'Alice', 'p1-new');
    expect(session.players['p1']).toBeUndefined();
    expect(session.players['p1-new']).toBeDefined();
    expect(session.players['p1-new'].name).toBe('Alice');
    expect(session.players['p1-new'].room).toBe('room-b');
    expect(session.players['p1-new'].inventory).toContain('key');
  });

  test('reconnectPlayer removes the ghost', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    session = disconnectPlayer(session, 'p1');
    session = reconnectPlayer(session, 'Alice', 'p1-new');
    expect(session.ghosts['Alice']).toBeUndefined();
  });

  test('reconnectPlayer on non-existent ghost is a no-op', () => {
    const session = freshSession();
    const result = reconnectPlayer(session, 'Nobody', 'ghost-new');
    expect(result).toBe(session);
  });

  test('reconnected player appears in room view for others', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = disconnectPlayer(session, 'p1');
    // Bob should NOT see Alice as a player
    expect(getPlayerView(session, 'p2').players).not.toContain('Alice');

    // Alice reconnects
    session = reconnectPlayer(session, 'Alice', 'p1-new');
    // Bob should see Alice again
    expect(getPlayerView(session, 'p2').players).toContain('Alice');
    // Ghost should be gone
    expect(getPlayerView(session, 'p2').ghosts).not.toContain("Alice's ghost");
  });

  test('reconnected player can issue commands', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    session = disconnectPlayer(session, 'p1');
    session = reconnectPlayer(session, 'Alice', 'p1-new');

    const { responses } = processCommand(session, 'p1-new', 'look');
    const msg = responses.find(r => r.playerId === 'p1-new');
    expect(msg).toBeDefined();
    expect(msg.message.type).toBe('look');
    expect(msg.message.room.name).toBe('Room A');
  });

  test('reconnected player gets remaining ghost inventory (after partial loot)', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take torch'));
    session = disconnectPlayer(session, 'p1');

    // Bob goes to room-c and takes one item from the ghost
    ({ session } = processCommand(session, 'p2', 'go east'));
    ({ session } = processCommand(session, 'p2', 'take old key from Alice\'s ghost'));

    // Alice reconnects — should have only the torch
    session = reconnectPlayer(session, 'Alice', 'p1-new');
    expect(session.players['p1-new'].inventory).toContain('torch');
    expect(session.players['p1-new'].inventory).not.toContain('key');
    expect(session.players['p1-new'].room).toBe('room-c');
  });

  test('full reconnection cycle: disconnect, reconnect, take items, move', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);

    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    expect(session.players['p1'].room).toBe('room-b');
    expect(session.players['p1'].inventory).toContain('key');

    // Alice disconnects — ghost created
    session = disconnectPlayer(session, 'p1');
    expect(session.players['p1']).toBeUndefined();
    expect(session.ghosts['Alice']).toBeDefined();

    // Alice reconnects with new connection
    session = reconnectPlayer(session, 'Alice', 'p1-reconnected');
    const alice = session.players['p1-reconnected'];
    expect(alice.name).toBe('Alice');
    expect(alice.room).toBe('room-b');
    expect(alice.inventory).toContain('key');

    // Alice can use the key to solve the puzzle
    const { session: solved } = processCommand(session, 'p1-reconnected', 'use old key');
    expect(solved.puzzleStates['locked-passage'].solved).toBe(true);
    expect(solved.roomStates['room-b'].exits.north).toBe('room-d');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 11. Disconnect Timeout & Inventory Drop
// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// 11. Ghost Timeout & Inventory Drop
// ════════════════════════════════════════════════════════════════════════

describe('Ghost Timeout & Inventory Drop', () => {
  test('getExpiredGhosts returns empty when no ghosts', () => {
    const session = freshSession();
    expect(getExpiredGhosts(session, 1000)).toEqual([]);
  });

  test('getExpiredGhosts returns empty when timeout not reached', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    session = disconnectPlayer(session, 'p1');
    expect(getExpiredGhosts(session, 1800000)).toEqual([]);
  });

  test('getExpiredGhosts returns expired ghosts', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    session = disconnectPlayer(session, 'p1');
    session.ghosts['Alice'].disconnectedAt = Date.now() - 2000000;
    const expired = getExpiredGhosts(session, 1800000);
    expect(expired).toContain('Alice');
  });

  test('getExpiredGhosts only returns expired, not recent', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = disconnectPlayer(session, 'p1');
    session = disconnectPlayer(session, 'p2');
    session.ghosts['Alice'].disconnectedAt = Date.now() - 2000000;
    const expired = getExpiredGhosts(session, 1800000);
    expect(expired).toContain('Alice');
    expect(expired).not.toContain('Bob');
  });

  test('finalizeGhost drops inventory into room', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    expect(session.roomStates['room-a'].items).not.toContain('key');

    session = disconnectPlayer(session, 'p1');
    const result = finalizeGhost(session, 'Alice');
    session = result.session;

    expect(result.droppedItems).toContain('Old Key');
    expect(result.roomId).toBe('room-a');
    expect(result.playerName).toBe('Alice');
    expect(session.roomStates['room-a'].items).toContain('key');
  });

  test('finalizeGhost removes the ghost', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    session = disconnectPlayer(session, 'p1');
    const { session: updated } = finalizeGhost(session, 'Alice');
    expect(updated.ghosts['Alice']).toBeUndefined();
  });

  test('finalizeGhost on non-existent ghost is a no-op', () => {
    const session = freshSession();
    const result = finalizeGhost(session, 'Nobody');
    expect(result.droppedItems).toEqual([]);
    expect(result.roomId).toBeNull();
  });

  test('dropped items are pickable by other players', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));

    session = disconnectPlayer(session, 'p1');
    const { session: afterDrop } = finalizeGhost(session, 'Alice');

    expect(afterDrop.roomStates['room-a'].items).toContain('key');
    const { session: afterTake, responses } = processCommand(afterDrop, 'p2', 'take old key');
    expect(afterTake.players['p2'].inventory).toContain('key');
    const msg = responses.find(r => r.playerId === 'p2');
    expect(msg.message.type).toBe('message');
  });

  test('dropped items appear in room view (look)', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');
    finalizeGhost(session, 'Alice');

    const view = getPlayerView(session, 'p2');
    expect(view.items).toContain('Old Key');
  });

  test('multiple items dropped from ghost with full inventory', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take torch'));
    expect(session.players['p1'].inventory).toEqual(['key', 'torch']);
    expect(session.players['p1'].room).toBe('room-c');

    session = disconnectPlayer(session, 'p1');
    const result = finalizeGhost(session, 'Alice');

    expect(result.droppedItems).toContain('Old Key');
    expect(result.droppedItems).toContain('Torch');
    expect(result.roomId).toBe('room-c');
    expect(result.session.roomStates['room-c'].items).toContain('key');
    expect(result.session.roomStates['room-c'].items).toContain('torch');
  });

  test('ghost with empty inventory — finalize still cleans up', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    session = disconnectPlayer(session, 'p1');
    const result = finalizeGhost(session, 'Alice');
    expect(result.droppedItems).toEqual([]);
    expect(result.playerName).toBe('Alice');
    expect(result.roomId).toBe('room-a');
    expect(result.session.ghosts['Alice']).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// 12. Ghost Looting
// ════════════════════════════════════════════════════════════════════════

describe('Ghost Looting', () => {
  test('loot command takes all items from ghost', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    const { session: afterLoot, responses } = processCommand(session, 'p2', "loot Alice's ghost");
    expect(afterLoot.players['p2'].inventory).toContain('key');
    const msg = responses.find(r => r.playerId === 'p2' && r.message.text?.includes('loot'));
    expect(msg).toBeDefined();
    expect(msg.message.text).toContain('Old Key');
  });

  test('loot command removes ghost when inventory emptied', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    const { session: afterLoot, responses } = processCommand(session, 'p2', "loot Alice's ghost");
    expect(afterLoot.ghosts['Alice']).toBeUndefined();
    const fadeMsg = responses.find(r => r.message.text?.includes('fades away'));
    expect(fadeMsg).toBeDefined();
  });

  test('loot transfers multiple items from ghost', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take torch'));
    session = disconnectPlayer(session, 'p1');

    ({ session } = processCommand(session, 'p2', 'go east'));
    const { session: afterLoot, responses } = processCommand(session, 'p2', "loot Alice's ghost");
    expect(afterLoot.players['p2'].inventory).toContain('key');
    expect(afterLoot.players['p2'].inventory).toContain('torch');
    const msg = responses.find(r => r.playerId === 'p2' && r.message.text?.includes('loot'));
    expect(msg.message.text).toContain('Old Key');
    expect(msg.message.text).toContain('Torch');
  });

  test('loot empty ghost reports nothing to loot', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = disconnectPlayer(session, 'p1');

    const { responses } = processCommand(session, 'p2', "loot Alice's ghost");
    const msg = responses.find(r => r.playerId === 'p2');
    expect(msg.message.text).toContain('nothing to loot');
  });

  test('loot ghost in different room returns error', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    session = disconnectPlayer(session, 'p1');

    // Bob is in room-a, ghost is in room-b
    const { responses } = processCommand(session, 'p2', "loot Alice's ghost");
    const msg = responses.find(r => r.playerId === 'p2');
    expect(msg.message.type).toBe('error');
  });

  test('loot non-existent ghost returns error', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', "loot Bob's ghost");
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
  });

  test('loot with no argument returns error', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', 'loot');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
  });

  test('loot notifies other players in the room', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob'], ['p3', 'Charlie']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    const { responses } = processCommand(session, 'p2', "loot Alice's ghost");
    const charlieMsg = responses.find(r => r.playerId === 'p3' && r.message.text?.includes('loots'));
    expect(charlieMsg).toBeDefined();
    expect(charlieMsg.message.text).toContain('Bob');
    expect(charlieMsg.message.text).toContain('Old Key');
  });

  test('take specific item from ghost', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take torch'));
    session = disconnectPlayer(session, 'p1');

    ({ session } = processCommand(session, 'p2', 'go east'));
    const { session: afterTake, responses } = processCommand(session, 'p2', "take old key from Alice's ghost");
    expect(afterTake.players['p2'].inventory).toContain('key');
    expect(afterTake.players['p2'].inventory).not.toContain('torch');
    // Ghost should still exist with torch
    expect(afterTake.ghosts['Alice']).toBeDefined();
    expect(afterTake.ghosts['Alice'].inventory).toContain('torch');
    const msg = responses.find(r => r.playerId === 'p2' && r.message.text?.includes('take'));
    expect(msg).toBeDefined();
  });

  test('take last item from ghost causes ghost to fade', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    const { session: afterTake, responses } = processCommand(session, 'p2', "take old key from Alice's ghost");
    expect(afterTake.ghosts['Alice']).toBeUndefined();
    const fadeMsg = responses.find(r => r.message.text?.includes('fades away'));
    expect(fadeMsg).toBeDefined();
  });

  test('take item ghost does not have returns error', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = disconnectPlayer(session, 'p1');

    const { responses } = processCommand(session, 'p2', "take sword from Alice's ghost");
    const msg = responses.find(r => r.playerId === 'p2');
    expect(msg.message.type).toBe('error');
    expect(msg.message.text).toContain("doesn't have");
  });

  test('take from ghost in different room returns error', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    session = disconnectPlayer(session, 'p1');

    const { responses } = processCommand(session, 'p2', "take old key from Alice's ghost");
    const msg = responses.find(r => r.playerId === 'p2');
    expect(msg.message.type).toBe('error');
  });

  test('multiple ghosts can exist in different rooms', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob'], ['p3', 'Charlie']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p2', 'go north'));
    session = disconnectPlayer(session, 'p1');
    session = disconnectPlayer(session, 'p2');

    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.ghosts['Alice'].room).toBe('room-a');
    expect(session.ghosts['Bob']).toBeDefined();
    expect(session.ghosts['Bob'].room).toBe('room-b');

    // Charlie should see Alice's ghost in room-a
    const viewA = getPlayerView(session, 'p3');
    expect(viewA.ghosts).toContain("Alice's ghost");
    expect(viewA.ghosts).not.toContain("Bob's ghost");
  });

  test('getGhostsInRoom returns correct ghosts', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p2', 'go north'));
    session = disconnectPlayer(session, 'p1');
    session = disconnectPlayer(session, 'p2');

    expect(getGhostsInRoom(session, 'room-a')).toContain("Alice's ghost");
    expect(getGhostsInRoom(session, 'room-a')).not.toContain("Bob's ghost");
    expect(getGhostsInRoom(session, 'room-b')).toContain("Bob's ghost");
  });

  test('loot works without ghost suffix', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    const { session: afterLoot } = processCommand(session, 'p2', 'loot Alice');
    expect(afterLoot.players['p2'].inventory).toContain('key');
    expect(afterLoot.ghosts['Alice']).toBeUndefined();
  });

  test('take from ghost works without ghost suffix on target', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    const { session: afterTake } = processCommand(session, 'p2', "take old key from Alice");
    // Should fail — "Alice" without "'s ghost" won't match the ghost
    // Actually our code strips "'s ghost" suffix, but if not present, it uses the raw name
    // The findGhostByName will match by player name
    expect(afterTake.players['p2'].inventory).toContain('key');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 13. Reconnection Edge Cases
// ════════════════════════════════════════════════════════════════════════

describe('Reconnection Edge Cases', () => {
  test('rejoin when ghost exists → reclaims ghost room and inventory', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    session = disconnectPlayer(session, 'p1');

    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.ghosts['Alice'].room).toBe('room-b');
    expect(session.ghosts['Alice'].inventory).toContain('key');

    // Reconnect with new id
    session = reconnectPlayer(session, 'Alice', 'p1-new');

    expect(session.ghosts['Alice']).toBeUndefined();
    expect(session.players['p1-new']).toBeDefined();
    expect(session.players['p1-new'].name).toBe('Alice');
    expect(session.players['p1-new'].room).toBe('room-b');
    expect(session.players['p1-new'].inventory).toContain('key');
  });

  test('rejoin when ghost was partially looted → gets remaining inventory only', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take torch'));
    expect(session.players['p1'].inventory).toEqual(['key', 'torch']);

    session = disconnectPlayer(session, 'p1');

    // Bob loots one item
    ({ session } = processCommand(session, 'p2', 'go east'));
    ({ session } = processCommand(session, 'p2', "take old key from Alice's ghost"));
    expect(session.ghosts['Alice'].inventory).toEqual(['torch']);

    // Alice reconnects — gets only the torch (key was looted)
    session = reconnectPlayer(session, 'Alice', 'p1-new');
    expect(session.players['p1-new'].inventory).toEqual(['torch']);
    expect(session.players['p1-new'].inventory).not.toContain('key');
    expect(session.players['p1-new'].room).toBe('room-c');
  });

  test('stale disconnect after reconnection does not create duplicate ghost', () => {
    // Simulate: Alice connects as p1, disconnects (ghost created), reconnects as p1-new
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session.players['p1'].connectionId = 'conn-A';

    ({ session } = processCommand(session, 'p1', 'take old key'));

    // Alice disconnects — ghost created
    session = disconnectPlayer(session, 'p1');
    expect(session.ghosts['Alice']).toBeDefined();

    // Alice reconnects with new id
    session = reconnectPlayer(session, 'Alice', 'p1-new');
    session.players['p1-new'].connectionId = 'conn-B';
    expect(session.ghosts['Alice']).toBeUndefined();
    expect(session.players['p1-new'].name).toBe('Alice');

    // Stale disconnect for conn-A arrives — player p1 no longer exists in session
    const stalePlayer = session.players['p1'];
    expect(stalePlayer).toBeUndefined();

    // Even if we tried to disconnect p1 again, it's a no-op
    const afterStale = disconnectPlayer(session, 'p1');
    expect(afterStale.ghosts?.['Alice']).toBeUndefined();
    expect(afterStale.players['p1-new'].name).toBe('Alice');
  });

  test('ghost fully looted and faded → rejoin creates new player at start', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    session = disconnectPlayer(session, 'p1');

    // Bob loots everything from ghost, causing it to fade
    ({ session } = processCommand(session, 'p2', 'go north'));
    ({ session } = processCommand(session, 'p2', "loot Alice's ghost"));
    expect(session.ghosts['Alice']).toBeUndefined();

    // Alice tries to rejoin — no ghost to reclaim
    const ghostResult = findGhostByName(session, 'Alice');
    expect(ghostResult).toBeNull();

    // Normal join: new player at start room with empty inventory
    session = addPlayer(session, 'p1-new', 'Alice');
    expect(session.players['p1-new'].room).toBe('room-a');
    expect(session.players['p1-new'].inventory).toEqual([]);
  });

  test('ghost fully expired and finalized → rejoin creates new player at start', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    session = disconnectPlayer(session, 'p1');

    // Force ghost to expire
    session.ghosts['Alice'].disconnectedAt = Date.now() - 2000000;
    const expired = getExpiredGhosts(session, 1800000);
    expect(expired).toContain('Alice');

    // Finalize the ghost (drops items, removes ghost)
    const result = finalizeGhost(session, 'Alice');
    session = result.session;
    expect(session.ghosts['Alice']).toBeUndefined();

    // Alice tries to rejoin — no ghost to reclaim
    expect(findGhostByName(session, 'Alice')).toBeNull();

    // Normal join: new player at start room
    session = addPlayer(session, 'p1-new', 'Alice');
    expect(session.players['p1-new'].room).toBe('room-a');
    expect(session.players['p1-new'].inventory).toEqual([]);
  });

  test('reconnected player connectionId is independent of old player entry', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    session.players['p1'].connectionId = 'conn-old';

    session = disconnectPlayer(session, 'p1');
    session = reconnectPlayer(session, 'Alice', 'p1-new');
    session.players['p1-new'].connectionId = 'conn-new';

    // Only the new player entry should exist
    expect(session.players['p1']).toBeUndefined();
    expect(session.players['p1-new'].connectionId).toBe('conn-new');
  });
});
