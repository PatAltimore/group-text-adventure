import { describe, test, expect, jest } from '@jest/globals';
import {
  loadWorld,
  createGameSession,
  addPlayer,
  removePlayer,
  processCommand,
  getPlayerView,
  disconnectPlayer,
  findGhostByName,
  findGhostByPlayerId,
  reconnectPlayer,
  getGhostsInRoom,
  resolvePlayerName,
  killPlayer,
  respawnPlayer,
  checkHazards,
} from '../api/src/game-engine.js';
import * as GameEngine from '../api/src/game-engine.js';
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
    // Giver gets confirmation
    const giverMsg = responses.find(r => r.playerId === 'p1');
    expect(giverMsg.message.text).toMatch(/give.*old key.*Bob/i);
    // Receiver gets notification
    const receiverMsg = responses.find(r => r.playerId === 'p2');
    expect(receiverMsg).toBeDefined();
    expect(receiverMsg.message.text).toMatch(/Alice.*gave.*old key/i);
  });

  test('notifies bystanders when a give happens', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = addPlayer(session, 'p3', 'Carol');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    const { responses } = processCommand(session, 'p1', 'give old key to Bob');
    const bystanderMsg = responses.find(r => r.playerId === 'p3');
    expect(bystanderMsg).toBeDefined();
    expect(bystanderMsg.message.text).toMatch(/Alice.*gave.*old key.*Bob/i);
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
    expect(view.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Old Key' })])
    );
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
    expect(view.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Old Key' })])
    );
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
    const names = view.items.map((i) => (typeof i === 'object' ? i.name : i));
    expect(names).toContain('Old Key');
    expect(names).not.toContain('key');
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
    session.players['p1'].playerId = 'uuid-alice';
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    expect(session.players['p1'].room).toBe('room-b');
    expect(session.players['p1'].inventory).toContain('key');

    session = disconnectPlayer(session, 'p1');
    const ghost = session.ghosts['Alice'];
    expect(ghost.room).toBe('room-b');
    expect(ghost.inventory).toEqual([]);
    expect(session.roomStates['room-b'].items).toContain('key');
    expect(ghost.playerId).toBe('uuid-alice');
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
    session.players['p1'].playerId = 'uuid-alice';
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    session = disconnectPlayer(session, 'p1');

    session = reconnectPlayer(session, 'Alice', 'p1-new');
    expect(session.players['p1']).toBeUndefined();
    expect(session.players['p1-new']).toBeDefined();
    expect(session.players['p1-new'].name).toBe('Alice');
    expect(session.players['p1-new'].playerId).toBe('uuid-alice');
    expect(session.players['p1-new'].room).toBe('room-b');
    expect(session.players['p1-new'].inventory).toEqual([]);
    expect(session.roomStates['room-b'].items).toContain('key');
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

    // Alice reconnects — inventory is empty (items were dropped on disconnect)
    session = reconnectPlayer(session, 'Alice', 'p1-new');
    expect(session.players['p1-new'].inventory).toEqual([]);
    expect(session.roomStates['room-c'].items).toContain('torch');
    expect(session.roomStates['room-b'].items).not.toContain('key'); // Was taken by p2
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

    // Alice reconnects with new connection (items dropped on disconnect, pick up key again)
    session = reconnectPlayer(session, 'Alice', 'p1-reconnected');
    const alice = session.players['p1-reconnected'];
    expect(alice.name).toBe('Alice');
    expect(alice.room).toBe('room-b');
    expect(alice.inventory).toEqual([]);
    expect(session.roomStates['room-b'].items).toContain('key');
    
    // Alice picks up the key again
    ({ session } = processCommand(session, 'p1-reconnected', 'take old key'));

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
// 11. Ghost Persistence (ghosts never expire)
// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// 12. Ghost Looting
// ════════════════════════════════════════════════════════════════════════

describe('Ghost Looting', () => {
  test('loot command on ghost with empty inventory gives appropriate message', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1'); // Items drop to floor, ghost has empty inventory

    const { session: afterLoot, responses } = processCommand(session, 'p2', "loot Alice's ghost");
    // Ghost has no inventory, so loot fails gracefully
    expect(afterLoot.players['p2'].inventory).not.toContain('key');
    const msg = responses.find(r => r.playerId === 'p2' && r.message.text?.includes('nothing to loot'));
    expect(msg).toBeDefined();
    // But items are on the floor
    expect(afterLoot.roomStates['room-a'].items).toContain('key');
  });

  test('ghost persists after loot attempt on empty inventory', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    const { session: afterLoot, responses } = processCommand(session, 'p2', "loot Alice's ghost");
    // Ghost stays in the room with empty inventory
    expect(afterLoot.ghosts['Alice']).toBeDefined();
    expect(afterLoot.ghosts['Alice'].inventory).toEqual([]);
    const fadeMsg = responses.find(r => r.message.text?.includes('fades away'));
    expect(fadeMsg).toBeUndefined();
  });

  test('items dropped on disconnect are accessible from floor', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take torch'));
    session = disconnectPlayer(session, 'p1'); // Items drop in room-c

    // Bob can take items from the floor
    ({ session } = processCommand(session, 'p2', 'go east'));
    const { session: afterTake } = processCommand(session, 'p2', 'take old key');
    expect(afterTake.players['p2'].inventory).toContain('key');
    expect(afterTake.roomStates['room-c'].items).not.toContain('key');
    expect(afterTake.roomStates['room-c'].items).toContain('torch');
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

  test('loot notifies other players when ghost has items (before new behavior)', () => {
    // This test is now outdated — ghosts always have empty inventory
    // Kept for historical reference but skipped
  });

  test.skip('take specific item from ghost - OBSOLETE: ghosts have no inventory now', () => {
    // Ghosts now have empty inventory. Items are on floor. Use "take" not "take from ghost"
  });

  test.skip('take last item from ghost keeps ghost in room - OBSOLETE', () => {
    // Ghosts now have empty inventory from creation
  });

  test('take item from empty ghost returns error', () => {
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

  test('loot works without ghost suffix but ghost has no items', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1'); // Items drop to floor

    const { session: afterLoot, responses } = processCommand(session, 'p2', 'loot Alice');
    // Ghost has no inventory
    expect(afterLoot.players['p2'].inventory).not.toContain('key');
    // Items are on the floor
    expect(afterLoot.roomStates['room-a'].items).toContain('key');
    // Ghost persists with empty inventory
    expect(afterLoot.ghosts['Alice']).toBeDefined();
    expect(afterLoot.ghosts['Alice'].inventory).toEqual([]);
  });

  test('looted ghost still visible in room view', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    ({ session } = processCommand(session, 'p2', "loot Alice's ghost"));
    const view = getPlayerView(session, 'p2');
    expect(view.ghosts).toContain("Alice's ghost");
  });

  test.skip('take from ghost works without ghost suffix - OBSOLETE', () => {
    // Ghosts now have empty inventory, items are on floor
  });
});

// ════════════════════════════════════════════════════════════════════════
// 13. Reconnection Edge Cases
// ════════════════════════════════════════════════════════════════════════

describe('Reconnection Edge Cases', () => {
  test('rejoin when ghost exists → reclaims ghost room, inventory is empty', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    session = disconnectPlayer(session, 'p1'); // Items drop to room-b floor

    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.ghosts['Alice'].room).toBe('room-b');
    expect(session.ghosts['Alice'].inventory).toEqual([]);
    expect(session.roomStates['room-b'].items).toContain('key');

    // Reconnect with new id
    session = reconnectPlayer(session, 'Alice', 'p1-new');

    expect(session.ghosts['Alice']).toBeUndefined();
    expect(session.players['p1-new']).toBeDefined();
    expect(session.players['p1-new'].name).toBe('Alice');
    expect(session.players['p1-new'].room).toBe('room-b');
    expect(session.players['p1-new'].inventory).toEqual([]);
    expect(session.roomStates['room-b'].items).toContain('key');
  });

  test.skip('rejoin when ghost was partially looted - OBSOLETE: ghosts have no inventory', () => {
    // Ghosts now have empty inventory from creation
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

  test('ghost fully looted → rejoin still reclaims ghost (empty inventory, ghost room)', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    session = disconnectPlayer(session, 'p1');

    // Bob loots everything from ghost — ghost persists with empty inventory
    ({ session } = processCommand(session, 'p2', 'go north'));
    ({ session } = processCommand(session, 'p2', "loot Alice's ghost"));
    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.ghosts['Alice'].inventory).toEqual([]);

    // Alice reconnects — reclaims ghost in room-b with empty inventory
    session = reconnectPlayer(session, 'Alice', 'p1-new');
    expect(session.players['p1-new'].room).toBe('room-b');
    expect(session.players['p1-new'].inventory).toEqual([]);
    expect(session.ghosts['Alice']).toBeUndefined();
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

  test('gameInfo inventory after ghost reclamation is empty (items on floor)', () => {
    // Simulate the gameHub reconnection flow: player picks up items, disconnects,
    // reconnects, inventory is now empty (items dropped to floor on disconnect).
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take torch'));
    expect(session.players['p1'].inventory).toEqual(['key', 'torch']);

    session = disconnectPlayer(session, 'p1'); // Items drop to room-c floor
    session = reconnectPlayer(session, 'Alice', 'p1-new');

    // Build inventory the same way gameHub.js does for gameInfo
    const restoredPlayer = session.players['p1-new'];
    const inventoryItems = restoredPlayer.inventory.map((itemId) => {
      const item = session.world.items[itemId];
      return item
        ? { name: item.name, description: item.description }
        : { name: itemId };
    });

    // Inventory is now empty after reconnect
    expect(inventoryItems).toHaveLength(0);
    expect(session.roomStates['room-c'].items).toContain('key');
    expect(session.roomStates['room-c'].items).toContain('torch');
  });
});

describe('Duplicate Name vs Reconnection', () => {
  function sessionWithPlayers(...specs) {
    const world = loadWorld(testWorldData);
    let session = createGameSession(world);
    session.started = true;
    for (const [id, name] of specs) {
      session = addPlayer(session, id, name);
    }
    return session;
  }

  test('resolvePlayerName treats ghost name as taken', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = disconnectPlayer(session, 'p1');
    expect(session.ghosts['Alice']).toBeDefined();

    // A new player picking "Alice" should get an adjective, not the bare name
    const resolved = resolvePlayerName(session, 'Alice');
    expect(resolved.wasChanged).toBe(true);
    expect(resolved.name).not.toBe('Alice');
    expect(resolved.originalName).toBe('Alice');
  });

  test('resolvePlayerName treats ghost name as taken (case-insensitive)', () => {
    let session = sessionWithPlayers(['p1', 'Alice']);
    session = disconnectPlayer(session, 'p1');

    const resolved = resolvePlayerName(session, 'alice');
    expect(resolved.wasChanged).toBe(true);
    expect(resolved.originalName).toBe('alice');
  });

  test('resolvePlayerName still renames when active player has same name', () => {
    const session = sessionWithPlayers(['p1', 'Alice']);
    const resolved = resolvePlayerName(session, 'Alice');
    expect(resolved.wasChanged).toBe(true);
    expect(resolved.name).not.toBe('Alice');
  });

  test('resolvePlayerName allows name when no ghost or active player matches', () => {
    let session = sessionWithPlayers(['p1', 'Alice']);
    const resolved = resolvePlayerName(session, 'Bob');
    expect(resolved.wasChanged).toBe(false);
    expect(resolved.name).toBe('Bob');
  });

  test('reconnectPlayer still works for legitimate rejoin with ghost', () => {
    let session = sessionWithPlayers(['p1', 'Alice']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1'); // Items drop to floor
    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.roomStates['room-a'].items).toContain('key');

    // Legitimate rejoin — reconnectPlayer reclaims the ghost, inventory is empty
    session = reconnectPlayer(session, 'Alice', 'p1-new');
    expect(session.ghosts['Alice']).toBeUndefined();
    expect(session.players['p1-new']).toBeDefined();
    expect(session.players['p1-new'].name).toBe('Alice');
    expect(session.players['p1-new'].inventory).toEqual([]);
    expect(session.roomStates['room-a'].items).toContain('key');
  });

  test('new player with ghost-matching name gets adjective, ghost untouched', () => {
    let session = sessionWithPlayers(['p1', 'Alice']);
    session = disconnectPlayer(session, 'p1');

    // New player picks "Alice" — should NOT reclaim the ghost
    const resolved = resolvePlayerName(session, 'Alice');
    expect(resolved.wasChanged).toBe(true);

    // Add the new player with the resolved name
    session = addPlayer(session, 'p2', resolved.name);
    // Ghost should still exist
    expect(session.ghosts['Alice']).toBeDefined();
    // New player has the adjective name
    expect(session.players['p2'].name).toBe(resolved.name);
    expect(session.players['p2'].name).not.toBe('Alice');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 16. Player ID System
// ════════════════════════════════════════════════════════════════════════

describe('Player ID System', () => {
  function sessionWithPlayersAndIds(...specs) {
    const world = loadWorld(testWorldData);
    let session = createGameSession(world);
    session.started = true;
    for (const [id, name, uid] of specs) {
      session = addPlayer(session, id, name);
      if (uid) session.players[id].playerId = uid;
    }
    return session;
  }

  test('disconnectPlayer copies playerId into ghost', () => {
    let session = sessionWithPlayersAndIds(['p1', 'Alice', 'uuid-alice']);
    session = disconnectPlayer(session, 'p1');
    expect(session.ghosts['Alice'].playerId).toBe('uuid-alice');
  });

  test('disconnectPlayer sets ghost.playerId to null when player has no playerId', () => {
    let session = sessionWithPlayersAndIds(['p1', 'Alice']);
    session = disconnectPlayer(session, 'p1');
    expect(session.ghosts['Alice'].playerId).toBeNull();
  });

  test('findGhostByPlayerId finds ghost with matching playerId', () => {
    let session = sessionWithPlayersAndIds(['p1', 'Alice', 'uuid-alice']);
    session = disconnectPlayer(session, 'p1');
    const found = findGhostByPlayerId(session, 'uuid-alice');
    expect(found).not.toBeNull();
    expect(found.ghostName).toBe('Alice');
    expect(found.ghost.playerId).toBe('uuid-alice');
  });

  test('findGhostByPlayerId returns null when no playerId matches', () => {
    let session = sessionWithPlayersAndIds(['p1', 'Alice', 'uuid-alice']);
    session = disconnectPlayer(session, 'p1');
    expect(findGhostByPlayerId(session, 'uuid-different')).toBeNull();
  });

  test('findGhostByPlayerId returns null with null/undefined playerId', () => {
    let session = sessionWithPlayersAndIds(['p1', 'Alice', 'uuid-alice']);
    session = disconnectPlayer(session, 'p1');
    expect(findGhostByPlayerId(session, null)).toBeNull();
    expect(findGhostByPlayerId(session, undefined)).toBeNull();
  });

  test('findGhostByPlayerId returns null on session without ghosts', () => {
    const session = sessionWithPlayersAndIds(['p1', 'Alice', 'uuid-alice']);
    expect(findGhostByPlayerId(session, 'uuid-alice')).toBeNull();
  });

  test('ghost reclamation by playerId restores room, inventory is empty', () => {
    let session = sessionWithPlayersAndIds(['p1', 'Alice', 'uuid-alice']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    session = disconnectPlayer(session, 'p1'); // Items drop to room-b

    // Find by playerId, then reconnect
    const ghostMatch = findGhostByPlayerId(session, 'uuid-alice');
    expect(ghostMatch).not.toBeNull();
    session = reconnectPlayer(session, ghostMatch.ghostName, 'p1-new');

    expect(session.players['p1-new'].name).toBe('Alice');
    expect(session.players['p1-new'].playerId).toBe('uuid-alice');
    expect(session.players['p1-new'].room).toBe('room-b');
    expect(session.players['p1-new'].inventory).toEqual([]);
    expect(session.roomStates['room-b'].items).toContain('key');
    expect(session.ghosts['Alice']).toBeUndefined();
  });

  test('different player with same name gets adjective when playerId does not match ghost', () => {
    let session = sessionWithPlayersAndIds(['p1', 'Alice', 'uuid-alice']);
    session = disconnectPlayer(session, 'p1');

    // New player sends playerId that does NOT match the ghost
    const ghostMatch = findGhostByPlayerId(session, 'uuid-stranger');
    expect(ghostMatch).toBeNull();

    // Falls through to name resolution — ghost name is treated as taken
    const resolved = resolvePlayerName(session, 'Alice');
    expect(resolved.wasChanged).toBe(true);
    expect(resolved.name).not.toBe('Alice');

    session = addPlayer(session, 'p2', resolved.name);
    // Ghost should still exist (not reclaimed)
    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.ghosts['Alice'].playerId).toBe('uuid-alice');
  });

  test('reconnectPlayer preserves playerId across reconnection', () => {
    let session = sessionWithPlayersAndIds(['p1', 'Alice', 'uuid-alice']);
    session = disconnectPlayer(session, 'p1');
    session = reconnectPlayer(session, 'Alice', 'p1-new');
    expect(session.players['p1-new'].playerId).toBe('uuid-alice');
  });

  test('findGhostByPlayerId picks correct ghost when multiple ghosts exist', () => {
    let session = sessionWithPlayersAndIds(
      ['p1', 'Alice', 'uuid-alice'],
      ['p2', 'Bob', 'uuid-bob']
    );
    session = disconnectPlayer(session, 'p1');
    session = disconnectPlayer(session, 'p2');

    const found = findGhostByPlayerId(session, 'uuid-bob');
    expect(found).not.toBeNull();
    expect(found.ghostName).toBe('Bob');
    expect(found.ghost.playerId).toBe('uuid-bob');

    // Alice's ghost should still be there
    expect(session.ghosts['Alice']).toBeDefined();
  });

});

// ════════════════════════════════════════════════════════════════════════
// 17. Ghost Persistence (new behavior)
// ════════════════════════════════════════════════════════════════════════

describe('Ghost Persistence', () => {
  // ── 1. Looting a ghost only takes inventory — ghost stays in room ──

  test('after looting, ghost still exists in session.ghosts', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    const { session: afterLoot } = processCommand(session, 'p2', "loot Alice's ghost");
    expect(afterLoot.ghosts['Alice']).toBeDefined();
    expect(afterLoot.ghosts['Alice'].playerName).toBe('Alice');
  });

  test('after looting, ghost inventory is empty', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    const { session: afterLoot } = processCommand(session, 'p2', "loot Alice's ghost");
    expect(afterLoot.ghosts['Alice'].inventory).toEqual([]);
  });

  test('after looting ghost with no items, looter gets nothing', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take torch'));
    session = disconnectPlayer(session, 'p1'); // Items drop to floor

    ({ session } = processCommand(session, 'p2', 'go east'));
    const { session: afterLoot, responses } = processCommand(session, 'p2', "loot Alice's ghost");
    // Ghost has no inventory, loot gets nothing
    expect(afterLoot.players['p2'].inventory).not.toContain('key');
    expect(afterLoot.players['p2'].inventory).not.toContain('torch');
    const msg = responses.find(r => r.playerId === 'p2');
    expect(msg.message.text).toContain('nothing to loot');
    // Ghost is still around with empty inventory
    expect(afterLoot.ghosts['Alice']).toBeDefined();
    expect(afterLoot.ghosts['Alice'].inventory).toEqual([]);
  });

  test('empty ghost is still visible in room description via look', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    // Loot to empty the ghost
    ({ session } = processCommand(session, 'p2', "loot Alice's ghost"));
    expect(session.ghosts['Alice'].inventory).toEqual([]);

    // Ghost should still show up in look/room view
    const view = getPlayerView(session, 'p2');
    expect(view.ghosts).toContain("Alice's ghost");

    // Also verify via look command response
    const { responses } = processCommand(session, 'p2', 'look');
    const lookMsg = responses.find(r => r.playerId === 'p2' && r.message.type === 'look');
    expect(lookMsg).toBeDefined();
    expect(lookMsg.message.room.ghosts).toContain("Alice's ghost");
  });

  test('looting an already-empty ghost works gracefully', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = disconnectPlayer(session, 'p1');

    // Ghost has no inventory to begin with
    expect(session.ghosts['Alice'].inventory).toEqual([]);

    const { session: afterLoot, responses } = processCommand(session, 'p2', "loot Alice's ghost");
    // No error thrown, no items transferred
    const msg = responses.find(r => r.playerId === 'p2');
    expect(msg).toBeDefined();
    expect(msg.message.text).toContain('nothing to loot');
    expect(afterLoot.players['p2'].inventory).toEqual([]);
    // Ghost persists
    expect(afterLoot.ghosts['Alice']).toBeDefined();
  });

  test('looting twice — second loot is graceful no-op', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1'); // Key drops to floor, ghost inventory empty

    // First loot — ghost has no inventory
    ({ session } = processCommand(session, 'p2', "loot Alice's ghost"));
    expect(session.players['p2'].inventory).not.toContain('key');
    expect(session.ghosts['Alice'].inventory).toEqual([]);

    // Second loot — no error, no items
    const { session: afterSecondLoot, responses } = processCommand(session, 'p2', "loot Alice's ghost");
    const msg = responses.find(r => r.playerId === 'p2');
    expect(msg.message.text).toContain('nothing to loot');
    expect(afterSecondLoot.ghosts['Alice']).toBeDefined();
  });

  test.skip('take last item from ghost - OBSOLETE: ghosts have empty inventory', () => {
    // Ghosts now have empty inventory from creation
  });

  // ── 2. Rejoining places player in ghost's room ──

  test('reconnectPlayer places player in ghost room', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    expect(session.players['p1'].room).toBe('room-b');

    session = disconnectPlayer(session, 'p1');
    expect(session.ghosts['Alice'].room).toBe('room-b');

    session = reconnectPlayer(session, 'Alice', 'p1-new');
    expect(session.players['p1-new'].room).toBe('room-b');
  });

  test('after reconnect, ghost is removed from session.ghosts', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'go north'));
    session = disconnectPlayer(session, 'p1');
    expect(session.ghosts['Alice']).toBeDefined();

    session = reconnectPlayer(session, 'Alice', 'p1-new');
    expect(session.ghosts['Alice']).toBeUndefined();
    expect(session.players['p1-new']).toBeDefined();
  });

  test('reconnect after ghost fully looted — player has empty inventory, placed in ghost room', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take torch'));
    session = disconnectPlayer(session, 'p1');

    // Bob loots everything
    ({ session } = processCommand(session, 'p2', 'go east'));
    ({ session } = processCommand(session, 'p2', "loot Alice's ghost"));
    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.ghosts['Alice'].inventory).toEqual([]);

    // Alice reconnects — placed in ghost's room (room-c) with no items
    session = reconnectPlayer(session, 'Alice', 'p1-new');
    expect(session.players['p1-new'].room).toBe('room-c');
    expect(session.players['p1-new'].inventory).toEqual([]);
    expect(session.players['p1-new'].name).toBe('Alice');
    expect(session.ghosts['Alice']).toBeUndefined();
  });

  test.skip('reconnect after partial loot - OBSOLETE: ghosts have no inventory', () => {
    // Ghosts now have empty inventory from creation, items are on floor
  });

  // ── 3. Ghosts never expire ──

  test('getExpiredGhosts is no longer exported from game-engine', async () => {
    const mod = await import('../api/src/game-engine.js');
    expect(mod.getExpiredGhosts).toBeUndefined();
  });

  test('finalizeGhost is no longer exported from game-engine', async () => {
    const mod = await import('../api/src/game-engine.js');
    expect(mod.finalizeGhost).toBeUndefined();
  });

  test('ghost with very old disconnectedAt timestamp still exists (never cleaned up)', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    session = disconnectPlayer(session, 'p1'); // Items drop to floor

    // Set disconnectedAt to 30 days ago
    session.ghosts['Alice'].disconnectedAt = Date.now() - (30 * 24 * 60 * 60 * 1000);

    // Ghost still exists — no cleanup mechanism to remove it
    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.ghosts['Alice'].room).toBe('room-b');
    expect(session.ghosts['Alice'].inventory).toEqual([]);
    expect(session.roomStates['room-b'].items).toContain('key');

    // Ghost is still visible in room
    const ghostsInRoom = getGhostsInRoom(session, 'room-b');
    expect(ghostsInRoom).toContain("Alice's ghost");
  });

  test('very old ghost can still be reconnected', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    session = disconnectPlayer(session, 'p1'); // Items drop in room-b

    // Set timestamp to 7 days ago
    session.ghosts['Alice'].disconnectedAt = Date.now() - (7 * 24 * 60 * 60 * 1000);

    // Reconnect still works, inventory is empty
    session = reconnectPlayer(session, 'Alice', 'p1-new');
    expect(session.players['p1-new']).toBeDefined();
    expect(session.players['p1-new'].name).toBe('Alice');
    expect(session.players['p1-new'].inventory).toEqual([]);
    expect(session.roomStates['room-b'].items).toContain('key');
    expect(session.ghosts['Alice']).toBeUndefined();
  });

  test('very old ghost can still be looted (gets nothing)', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1'); // Items drop to floor

    // Set timestamp to 90 days ago
    session.ghosts['Alice'].disconnectedAt = Date.now() - (90 * 24 * 60 * 60 * 1000);

    const { session: afterLoot, responses } = processCommand(session, 'p2', "loot Alice's ghost");
    // Ghost has no inventory
    expect(afterLoot.players['p2'].inventory).not.toContain('key');
    expect(afterLoot.ghosts['Alice']).toBeDefined();
    expect(afterLoot.ghosts['Alice'].inventory).toEqual([]);
    const msg = responses.find(r => r.playerId === 'p2');
    expect(msg.message.text).toContain('nothing to loot');
  });

  test('multiple old ghosts all persist simultaneously', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob'], ['p3', 'Charlie']);
    ({ session } = processCommand(session, 'p2', 'go north'));
    session = disconnectPlayer(session, 'p1');
    session = disconnectPlayer(session, 'p2');

    // Age them differently
    session.ghosts['Alice'].disconnectedAt = Date.now() - (1 * 24 * 60 * 60 * 1000);
    session.ghosts['Bob'].disconnectedAt = Date.now() - (60 * 24 * 60 * 60 * 1000);

    // Both still exist
    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.ghosts['Bob']).toBeDefined();
    expect(getGhostsInRoom(session, 'room-a')).toContain("Alice's ghost");
    expect(getGhostsInRoom(session, 'room-b')).toContain("Bob's ghost");
  });
});

// ════════════════════════════════════════════════════════════════════════
// Start Game Flow (getPlayerView for initial room)
// ════════════════════════════════════════════════════════════════════════

describe('Start Game — Initial Room View', () => {
  test('getPlayerView returns valid room view for host in start room', () => {
    const session = sessionWithPlayer('host1', 'Pat');
    const view = getPlayerView(session, 'host1');
    expect(view).not.toBeNull();
    expect(view.name).toBe('Room A');
    expect(view.description).toBe('Starting room.');
    expect(view.exits).toEqual(expect.arrayContaining(['north', 'east']));
    expect(view.items).toEqual([expect.objectContaining({ name: 'Old Key' })]);
    expect(view.players).toEqual([]);
    expect(view.hazards).toEqual([]);
    expect(view.ghosts).toEqual([]);
  });

  test('getPlayerView shows other players but not self', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    const view = getPlayerView(session, 'p1');
    expect(view.players).toEqual(['Bob']);
    expect(view.players).not.toContain('Alice');
  });

  test('getPlayerView for multiple players each see others', () => {
    const session = sessionWithPlayers(
      ['p1', 'Alice'], ['p2', 'Bob'], ['p3', 'Charlie']
    );
    const view1 = getPlayerView(session, 'p1');
    const view2 = getPlayerView(session, 'p2');
    const view3 = getPlayerView(session, 'p3');

    expect(view1.players).toContain('Bob');
    expect(view1.players).toContain('Charlie');
    expect(view1.players).not.toContain('Alice');

    expect(view2.players).toContain('Alice');
    expect(view2.players).toContain('Charlie');
    expect(view2.players).not.toContain('Bob');

    expect(view3.players).toContain('Alice');
    expect(view3.players).toContain('Bob');
    expect(view3.players).not.toContain('Charlie');
  });

  test('getPlayerView includes ghosts in starting room', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = disconnectPlayer(session, 'p1');
    const view = getPlayerView(session, 'p2');
    expect(view.ghosts).toContain("Alice's ghost");
  });

  test('getPlayerView includes items from start room', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const view = getPlayerView(session, 'p1');
    expect(view.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Old Key' })])
    );
  });

  test('getPlayerView returns null for non-existent player', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const view = getPlayerView(session, 'nonexistent');
    expect(view).toBeNull();
  });

  test('session round-trip through JSON preserves all fields needed for startGame', () => {
    let session = sessionWithPlayers(['host', 'Pat'], ['p2', 'Guest']);
    session.hostPlayerId = 'host';
    session.started = false;

    // Simulate Table Storage round-trip
    const restored = JSON.parse(JSON.stringify(session));

    expect(restored.hostPlayerId).toBe('host');
    expect(restored.started).toBe(false);
    expect(restored.world.startRoom).toBe('room-a');
    expect(restored.world.rooms['room-a']).toBeDefined();
    expect(restored.roomStates['room-a']).toBeDefined();
    expect(Object.keys(restored.players)).toHaveLength(2);
  });

  test('session without started field treats as not-started (undefined is falsy)', () => {
    const session = sessionWithPlayer('host', 'Pat');
    // createGameSession does NOT set session.started
    expect(session.started).toBeUndefined();
    expect(!session.started).toBe(true);
  });

  test('hostPlayerId survives JSON round-trip', () => {
    const session = sessionWithPlayer('conn-123', 'Pat');
    session.hostPlayerId = 'conn-123';
    const restored = JSON.parse(JSON.stringify(session));
    expect(restored.hostPlayerId).toBe('conn-123');
    expect(restored.hostPlayerId === 'conn-123').toBe(true);
  });

  test('getPlayerView works after JSON round-trip', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    const restored = JSON.parse(JSON.stringify(session));
    const view = getPlayerView(restored, 'p1');
    expect(view).not.toBeNull();
    expect(view.name).toBe('Room A');
    expect(view.players).toContain('Bob');
    expect(view.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Old Key' })])
    );
  });

  test('getPlayerView with ghosts after JSON round-trip', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = disconnectPlayer(session, 'p1');
    const restored = JSON.parse(JSON.stringify(session));
    const view = getPlayerView(restored, 'p2');
    expect(view.ghosts).toContain("Alice's ghost");
  });
});

// ════════════════════════════════════════════════════════════════════════
// 20. Item Descriptions
// ════════════════════════════════════════════════════════════════════════

describe('Item descriptions', () => {
  // Helper: build a world where items carry roomText
  function worldWithRoomText() {
    return loadWorld({
      name: 'RoomText World',
      startRoom: 'room1',
      rooms: {
        room1: {
          name: 'Room 1',
          description: 'The first room.',
          exits: { north: 'room2' },
          items: ['gem', 'coin'],
          hazards: [],
        },
        room2: {
          name: 'Room 2',
          description: 'The second room.',
          exits: { south: 'room1' },
          items: [],
          hazards: [],
        },
      },
      items: {
        gem: {
          name: 'Ruby Gem',
          description: 'A sparkling red gem.',
          roomText: 'A ruby gem glimmers on the floor.',
          pickupText: 'You pick up the gem.',
          portable: true,
        },
        coin: {
          name: 'Gold Coin',
          description: 'A shiny gold coin.',
          roomText: 'A gold coin catches the light.',
          pickupText: 'You pocket the coin.',
          portable: true,
        },
      },
      puzzles: {},
    });
  }

  test('getPlayerView returns items with roomText', () => {
    const world = worldWithRoomText();
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');

    const view = getPlayerView(session, 'p1');
    expect(view.items).toBeDefined();
    expect(view.items.length).toBe(2);

    // Items should be objects with at least name; when roomText feature is
    // complete each should also carry roomText.
    for (const item of view.items) {
      expect(typeof item).toBe('object');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('roomText');
    }
  });

  test('getPlayerView omits roomText for taken items', () => {
    const world = worldWithRoomText();
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');

    // Take the gem
    ({ session } = processCommand(session, 'p1', 'take ruby gem'));

    const view = getPlayerView(session, 'p1');
    // The gem should no longer appear in the room items
    const gemEntry = view.items.find((i) =>
      typeof i === 'object' ? i.name === 'Ruby Gem' : i === 'Ruby Gem'
    );
    expect(gemEntry).toBeUndefined();

    // The coin should still be there
    const coinEntry = view.items.find((i) =>
      typeof i === 'object' ? i.name === 'Gold Coin' : i === 'Gold Coin'
    );
    expect(coinEntry).toBeDefined();
  });

  test('handleInventory shows item descriptions', () => {
    const world = worldWithRoomText();
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');

    ({ session } = processCommand(session, 'p1', 'take ruby gem'));

    const { responses } = processCommand(session, 'p1', 'inventory');
    const msg = responses.find((r) => r.playerId === 'p1');
    expect(msg.message.type).toBe('inventory');
    expect(msg.message.items.length).toBe(1);
    expect(msg.message.items[0]).toHaveProperty('name', 'Ruby Gem');
    expect(msg.message.items[0]).toHaveProperty('description', 'A sparkling red gem.');
  });

  test('items with no roomText get a default', () => {
    // Item without roomText should still work in getPlayerView
    const world = loadWorld({
      name: 'No RoomText World',
      startRoom: 'room1',
      rooms: {
        room1: {
          name: 'Room 1',
          description: 'A room.',
          exits: {},
          items: ['key'],
          hazards: [],
        },
      },
      items: {
        key: {
          name: 'Old Key',
          description: 'A brass key.',
          pickupText: 'You take the key.',
          portable: true,
        },
      },
      puzzles: {},
    });

    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');

    const view = getPlayerView(session, 'p1');
    expect(view.items).toBeDefined();
    expect(view.items.length).toBe(1);

    // The item should still be present and have a name regardless of roomText
    const item = view.items[0];
    if (typeof item === 'object') {
      expect(item.name).toBe('Old Key');
    } else {
      expect(item).toBe('Old Key');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// 21. Hazard Death System
// ════════════════════════════════════════════════════════════════════════

describe('Hazard Death System', () => {
  // Helper: create a world with a hazard room
  function hazardWorld(probability = 1.0) {
    return loadWorld({
      name: 'Hazard World',
      startRoom: 'safe-room',
      rooms: {
        'safe-room': {
          name: 'Safe Room',
          description: 'A safe room with no hazards.',
          exits: { north: 'danger-room' },
          items: ['sword', 'shield'],
          hazards: [],
        },
        'danger-room': {
          name: 'Danger Room',
          description: 'A dangerous room.',
          exits: { south: 'safe-room' },
          items: [],
          hazards: [
            {
              description: 'Poisonous gas fills the room.',
              probability: probability,
              deathText: 'You succumb to the poisonous gas!',
            },
          ],
        },
      },
      items: {
        sword: {
          name: 'Iron Sword',
          description: 'A sturdy blade.',
          pickupText: 'You grab the sword.',
          portable: true,
        },
        shield: {
          name: 'Wooden Shield',
          description: 'A simple shield.',
          pickupText: 'You grab the shield.',
          portable: true,
        },
      },
      puzzles: {},
    });
  }

  function hazardSession(probability = 1.0) {
    const world = hazardWorld(probability);
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    return session;
  }

  // ── killPlayer / respawnPlayer ───────────────────────────────────────

  const describeIfKillPlayer = killPlayer ? describe : describe.skip;

  describeIfKillPlayer('killPlayer / respawnPlayer', () => {
    test('killPlayer creates a death ghost and removes player', () => {
      let session = hazardSession();
      ({ session } = processCommand(session, 'p1', 'take iron sword'));

      session = killPlayer(session, 'p1');

      // Player should be removed
      expect(session.players['p1']).toBeUndefined();

      // A death ghost should exist with empty inventory
      const ghost = session.ghosts?.['Alice'];
      expect(ghost).toBeDefined();
      expect(ghost.room).toBe('safe-room');
      expect(ghost.inventory).toEqual([]);
      expect(ghost.isDeath).toBe(true);
      
      // Items dropped to room
      expect(session.roomStates['safe-room'].items).toContain('sword');
    });

    test('killPlayer ghost has disconnectedAt timestamp', () => {
      let session = hazardSession();
      const before = Date.now();
      session = killPlayer(session, 'p1');
      const after = Date.now();

      const ghost = session.ghosts['Alice'];
      expect(ghost.diedAt).toBeDefined();
      expect(ghost.diedAt).toBeGreaterThanOrEqual(before);
      expect(ghost.diedAt).toBeLessThanOrEqual(after);
    });

    test('respawnPlayer restores player from death ghost', () => {
      let session = hazardSession();
      ({ session } = processCommand(session, 'p1', 'take iron sword'));
      session = killPlayer(session, 'p1');

      expect(session.ghosts['Alice']).toBeDefined();

      // Respawn — drops ghost items into room, player gets empty inventory
      session = respawnPlayer(session, 'Alice', 'p1-revived');

      expect(session.players['p1-revived']).toBeDefined();
      expect(session.players['p1-revived'].name).toBe('Alice');
      expect(session.players['p1-revived'].room).toBe('safe-room');
      // respawnPlayer drops items back into the room; player starts fresh
      expect(session.players['p1-revived'].inventory).toEqual([]);
      // Items should be back in the room
      expect(session.roomStates['safe-room'].items).toContain('sword');

      // Ghost removed
      expect(session.ghosts['Alice']).toBeUndefined();
    });

    test.skip('respawnPlayer restores with remaining inventory after partial loot - OBSOLETE', () => {
      // Ghosts now have empty inventory from creation
    });

    test('respawnPlayer ignores non-death ghosts', () => {
      let session = hazardSession();
      // Create a disconnect ghost (not death)
      session = disconnectPlayer(session, 'p1');
      expect(session.ghosts['Alice']).toBeDefined();
      expect(session.ghosts['Alice'].isDeath).toBeUndefined();

      // respawnPlayer should not touch non-death ghosts
      const result = respawnPlayer(session, 'Alice', 'p1-new');
      expect(result).toBe(session);
    });
  });

  // ── Hazard triggers on room entry ────────────────────────────────────

  test('hazard triggers death on room entry', () => {
    let session = hazardSession(1.0);

    // Mock Math.random to always trigger the hazard
    jest.spyOn(Math, 'random').mockReturnValue(0.0);

    const { session: afterMove, responses } = processCommand(session, 'p1', 'go north');

    Math.random.mockRestore();

    // Player should be dead (removed from players)
    expect(afterMove.players['p1']).toBeUndefined();

    // Should have a death-type response
    const deathMsg = responses.find(
      (r) => r.playerId === 'p1' && r.message.type === 'death'
    );
    expect(deathMsg).toBeDefined();
    expect(deathMsg.message.deathText).toBe('You succumb to the poisonous gas!');
    // Ensure the field is named 'deathText', not 'text'
    expect(deathMsg.message).not.toHaveProperty('text');

    // Ghost should be created
    expect(afterMove.ghosts?.['Alice']).toBeDefined();
    expect(afterMove.ghosts['Alice'].isDeath).toBe(true);
  });

  test('hazard with probability 0 never triggers', () => {
    let session = hazardSession(0.0);

    // Even with a low random value, probability 0 should never trigger
    jest.spyOn(Math, 'random').mockReturnValue(0.0);

    const { session: afterMove, responses } = processCommand(session, 'p1', 'go north');

    Math.random.mockRestore();

    // Player should still be alive
    expect(afterMove.players['p1']).toBeDefined();
    expect(afterMove.players['p1'].room).toBe('danger-room');

    // Should get a normal look response, not a death
    const lookMsg = responses.find(
      (r) => r.playerId === 'p1' && r.message.type === 'look'
    );
    expect(lookMsg).toBeDefined();

    const deathMsg = responses.find(
      (r) => r.playerId === 'p1' && r.message.type === 'death'
    );
    expect(deathMsg).toBeUndefined();
  });

  test('getPlayerView returns hazard descriptions from objects', () => {
    let session = hazardSession();

    // Move Alice to the danger room (without triggering death)
    jest.spyOn(Math, 'random').mockReturnValue(1.0);
    ({ session } = processCommand(session, 'p1', 'go north'));
    Math.random.mockRestore();

    const view = getPlayerView(session, 'p1');
    expect(view.hazards).toBeDefined();
    expect(view.hazards.length).toBe(1);

    // hazards should contain the description string (not the full object)
    expect(view.hazards[0]).toBe('Poisonous gas fills the room.');
  });

  // ── Session defaults ─────────────────────────────────────────────────

  test('deathTimeout defaults to 30', () => {
    const world = hazardWorld();
    const session = createGameSession(world);
    expect(session.deathTimeout).toBe(30);
  });

  test('death response includes timeout from session', () => {
    let session = hazardSession(1.0);

    jest.spyOn(Math, 'random').mockReturnValue(0.0);

    const { responses } = processCommand(session, 'p1', 'go north');

    Math.random.mockRestore();

    const deathMsg = responses.find(
      (r) => r.playerId === 'p1' && r.message.type === 'death'
    );
    expect(deathMsg).toBeDefined();
    expect(deathMsg.message.deathTimeout).toBe(30);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 22. Item Descriptions — Stef's Tests
// ════════════════════════════════════════════════════════════════════════

describe('Item Descriptions (Stef)', () => {
  test('getPlayerView returns item objects with name and roomText', () => {
    // Room A starts with "key" item
    const session = sessionWithPlayer('p1', 'Alice');
    const view = getPlayerView(session, 'p1');
    expect(view.items).toHaveLength(1);
    const item = view.items[0];
    expect(typeof item).toBe('object');
    expect(item).toEqual(expect.objectContaining({
      name: 'Old Key',
      roomText: 'An old brass key lies on the ground.',
    }));
  });

  test('getPlayerView only shows items still in room (not picked up)', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    // Room A has "key"
    expect(getPlayerView(session, 'p1').items).toHaveLength(1);

    ({ session } = processCommand(session, 'p1', 'take old key'));
    const view = getPlayerView(session, 'p1');
    expect(view.items).toHaveLength(0);
  });

  test('inventory command shows item descriptions', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    const { responses } = processCommand(session, 'p1', 'inventory');
    const inv = responses.find(r => r.playerId === 'p1' && r.message.type === 'inventory');
    expect(inv).toBeDefined();
    expect(inv.message.items).toHaveLength(1);
    expect(inv.message.items[0]).toEqual(expect.objectContaining({
      name: 'Old Key',
      description: 'A brass key.',
    }));
  });

  test('pick up item — disappears from room, appears in inventory with description', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    // Before pick-up: room has one item object
    let view = getPlayerView(session, 'p1');
    expect(view.items.length).toBe(1);

    ({ session } = processCommand(session, 'p1', 'take old key'));

    // After: room empty
    view = getPlayerView(session, 'p1');
    expect(view.items).toHaveLength(0);

    // Inventory has item with description
    const { responses } = processCommand(session, 'p1', 'inventory');
    const inv = responses.find(r => r.message.type === 'inventory');
    expect(inv.message.items).toHaveLength(1);
    expect(inv.message.items[0].name).toBe('Old Key');
    expect(inv.message.items[0].description).toBe('A brass key.');
  });

  test('items given to another player show descriptions in their inventory', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'give old key to Bob'));

    // Bob checks inventory
    const { responses } = processCommand(session, 'p2', 'inventory');
    const inv = responses.find(r => r.message.type === 'inventory');
    expect(inv.message.items).toHaveLength(1);
    expect(inv.message.items[0]).toEqual(expect.objectContaining({
      name: 'Old Key',
      description: 'A brass key.',
    }));
  });
});

// ════════════════════════════════════════════════════════════════════════
// 23. Hazard Death System — Stef's Tests
// ════════════════════════════════════════════════════════════════════════

describe('Hazard Death System (Stef)', () => {
  // Resolve from namespace (handles case where functions don't exist yet)
  const _killPlayer = GameEngine.killPlayer;
  const _respawnPlayer = GameEngine.respawnPlayer;

  function hazardWorldStef() {
    return loadWorld({
      name: 'Hazard Test World (Stef)',
      startRoom: 'safe-room',
      rooms: {
        'safe-room': {
          name: 'Safe Room',
          description: 'A safe starting room.',
          exits: {
            north: 'deadly-room',
            east: 'harmless-room',
            west: 'multi-hazard-room',
            south: 'old-hazard-room',
          },
          items: ['sword', 'potion'],
          hazards: [],
        },
        'deadly-room': {
          name: 'Deadly Room',
          description: 'Extremely dangerous.',
          exits: { south: 'safe-room' },
          items: ['gem'],
          hazards: [
            {
              description: 'Toxic gas fills the room.',
              probability: 1,
              deathText: 'You choke on toxic gas and die!',
            },
          ],
        },
        'harmless-room': {
          name: 'Harmless Room',
          description: 'Looks dangerous but is not.',
          exits: { west: 'safe-room' },
          items: [],
          hazards: [
            {
              description: 'A gentle breeze.',
              probability: 0,
              deathText: 'The breeze kills you.',
            },
          ],
        },
        'multi-hazard-room': {
          name: 'Multi-Hazard Room',
          description: 'Multiple dangers.',
          exits: { east: 'safe-room' },
          items: [],
          hazards: [
            { description: 'Falling rocks.', probability: 0, deathText: 'Crushed by rocks!' },
            { description: 'A pit of spikes.', probability: 1, deathText: 'You fall into the spikes!' },
          ],
        },
        'old-hazard-room': {
          name: 'Old Hazard Room',
          description: 'Room with old-style hazards.',
          exits: { north: 'safe-room' },
          items: [],
          hazards: ['A cold draft chills you.'],
        },
      },
      items: {
        sword: { name: 'Sword', description: 'A sharp sword.', pickupText: 'You grab the sword.', portable: true },
        potion: { name: 'Potion', description: 'A healing potion.', pickupText: 'You take the potion.', portable: true },
        gem: { name: 'Ruby Gem', description: 'A sparkling ruby.', pickupText: 'You pocket the gem.', portable: true },
      },
      puzzles: {},
    });
  }

  function hazardSessionStef() {
    const world = hazardWorldStef();
    return createGameSession(world);
  }

  function hazardSessionWithPlayerStef(id = 'p1', name = 'Alice') {
    const session = hazardSessionStef();
    return addPlayer(session, id, name);
  }

  function hazardSessionWithPlayersStef(...players) {
    let session = hazardSessionStef();
    for (const [id, name] of players) {
      session = addPlayer(session, id, name);
    }
    return session;
  }

  // ── killPlayer ──────────────────────────────────────────────────────

  describe('killPlayer', () => {
    const it = _killPlayer ? test : test.skip;

    it('creates a ghost with empty inventory, items dropped to room', () => {
      let session = hazardSessionWithPlayerStef('p1', 'Alice');
      ({ session } = processCommand(session, 'p1', 'take sword'));
      ({ session } = processCommand(session, 'p1', 'take potion'));

      session = _killPlayer(session, 'p1');

      expect(session.players['p1']).toBeUndefined();
      expect(session.ghosts).toBeDefined();
      const ghost = session.ghosts['Alice'];
      expect(ghost).toBeDefined();
      expect(ghost.playerName).toBe('Alice');
      expect(ghost.room).toBe('safe-room');
      expect(ghost.inventory).toEqual([]);
      expect(session.roomStates['safe-room'].items).toContain('sword');
      expect(session.roomStates['safe-room'].items).toContain('potion');
    });

    it('drops items into the room immediately on death', () => {
      let session = hazardSessionWithPlayerStef('p1', 'Alice');
      ({ session } = processCommand(session, 'p1', 'take sword'));

      session = _killPlayer(session, 'p1');

      // Items should be in roomState, not on ghost
      const ghost = session.ghosts['Alice'];
      const roomItems = session.roomStates['safe-room'].items;
      expect(ghost.inventory).toEqual([]);
      expect(roomItems).toContain('sword');
    });

    it('sends death message to the player (via handleGo hazard trigger)', () => {
      let session = hazardSessionWithPlayerStef('p1', 'Alice');

      jest.spyOn(Math, 'random').mockReturnValue(0.0);
      const { responses } = processCommand(session, 'p1', 'go north');
      Math.random.mockRestore();

      const deathMsg = responses.find(
        r => r.playerId === 'p1' && (r.message.type === 'death' || r.message.deathText)
      );
      expect(deathMsg).toBeDefined();
      // Death response must use 'deathText' field (not 'text') so client can read it
      expect(deathMsg.message.deathText).toBe('You choke on toxic gas and die!');
      expect(deathMsg.message).not.toHaveProperty('text');
    });

    it('notifies other players in the room on death', () => {
      let session = hazardSessionWithPlayersStef(['p1', 'Alice'], ['p2', 'Bob']);
      // Move Bob to deadly-room first (survive by mocking random high)
      jest.spyOn(Math, 'random').mockReturnValue(1.0);
      ({ session } = processCommand(session, 'p2', 'go north'));
      Math.random.mockRestore();

      // Now Alice enters deadly room and dies
      jest.spyOn(Math, 'random').mockReturnValue(0.0);
      const { session: afterDeath, responses } = processCommand(session, 'p1', 'go north');
      Math.random.mockRestore();

      // Bob should see a death notification
      const bobMsg = responses.find(
        r => r.playerId === 'p2' &&
          (r.message.event === 'death' || (r.message.text && r.message.text.match(/died|death|Alice/i)))
      );
      expect(bobMsg).toBeDefined();
    });

    it('dead player items on floor can be picked up by others', () => {
      let session = hazardSessionWithPlayersStef(['p1', 'Alice'], ['p2', 'Bob']);
      ({ session } = processCommand(session, 'p1', 'take sword'));

      session = _killPlayer(session, 'p1');

      // Items are on the floor, not in ghost inventory
      expect(session.ghosts['Alice'].inventory).toEqual([]);
      expect(session.roomStates['safe-room'].items).toContain('sword');
      
      // Bob can take items from the floor
      const { session: afterTake } = processCommand(session, 'p2', "take sword");
      expect(afterTake.players['p2'].inventory).toContain('sword');
    });
  });

  // ── respawnPlayer ───────────────────────────────────────────────────

  describe('respawnPlayer', () => {
    const it = (_killPlayer && _respawnPlayer) ? test : test.skip;

    it('removes the ghost', () => {
      let session = hazardSessionWithPlayerStef('p1', 'Alice');
      session = _killPlayer(session, 'p1');
      expect(session.ghosts['Alice']).toBeDefined();

      session = _respawnPlayer(session, 'Alice', 'p1-new');
      expect(session.ghosts['Alice']).toBeUndefined();
    });

    it('recreates the player in the ghost room with empty inventory', () => {
      let session = hazardSessionWithPlayerStef('p1', 'Alice');
      ({ session } = processCommand(session, 'p1', 'take sword'));
      ({ session } = processCommand(session, 'p1', 'take potion'));

      session = _killPlayer(session, 'p1');
      const ghostRoom = session.ghosts['Alice'].room;

      session = _respawnPlayer(session, 'Alice', 'p1-new');

      expect(session.players['p1-new']).toBeDefined();
      expect(session.players['p1-new'].name).toBe('Alice');
      expect(session.players['p1-new'].room).toBe(ghostRoom);
      expect(session.players['p1-new'].inventory).toEqual([]);
    });

    it('sends room view to the respawned player', () => {
      let session = hazardSessionWithPlayerStef('p1', 'Alice');
      session = _killPlayer(session, 'p1');
      session = _respawnPlayer(session, 'Alice', 'p1-new');

      // After respawn, player should be able to see the room
      const view = getPlayerView(session, 'p1-new');
      expect(view).not.toBeNull();
      expect(view.name).toBeDefined();
    });
  });

  // ── Hazard probability ──────────────────────────────────────────────

  describe('Hazard probability', () => {
    test('probability 0 never kills', () => {
      let session = hazardSessionWithPlayerStef('p1', 'Alice');

      jest.spyOn(Math, 'random').mockReturnValue(0.0);
      const { session: after, responses } = processCommand(session, 'p1', 'go east');
      Math.random.mockRestore();

      expect(after.players['p1']).toBeDefined();
      expect(after.players['p1'].room).toBe('harmless-room');
      const death = responses.find(r => r.playerId === 'p1' && r.message.type === 'death');
      expect(death).toBeUndefined();
    });

    test('probability 1 always kills', () => {
      let session = hazardSessionWithPlayerStef('p1', 'Alice');

      jest.spyOn(Math, 'random').mockReturnValue(0.0);
      const { session: after, responses } = processCommand(session, 'p1', 'go north');
      Math.random.mockRestore();

      expect(after.players['p1']).toBeUndefined();
      const death = responses.find(
        r => r.playerId === 'p1' && (r.message.type === 'death' || r.message.deathText)
      );
      expect(death).toBeDefined();
      // Verify deathText field name and value match the hazard config
      expect(death.message.deathText).toBe('You choke on toxic gas and die!');
      expect(death.message).not.toHaveProperty('text');
    });

    test('hazard check fires on gameplay commands (look, say), but NOT meta commands (inventory, help)', () => {
      let session = hazardSessionWithPlayerStef('p1', 'Alice');
      // Place player directly in deadly room (bypass go)
      session.players['p1'].room = 'deadly-room';

      // Mock Math.random to always trigger hazards
      jest.spyOn(Math, 'random').mockReturnValue(0.0);

      // "look" IS a gameplay command — should trigger hazard check and kill
      let result = processCommand(session, 'p1', 'look');
      expect(result.session.players['p1']).toBeUndefined();
      const deathMsg = result.responses.find(
        (r) => r.playerId === 'p1' && r.message.type === 'death'
      );
      expect(deathMsg).toBeDefined();

      Math.random.mockRestore();

      // Start fresh for meta commands
      let session2 = hazardSessionWithPlayerStef('p1', 'Alice');
      session2.players['p1'].room = 'deadly-room';

      jest.spyOn(Math, 'random').mockReturnValue(0.0);

      // "inventory" is a meta command — should NOT trigger hazard
      result = processCommand(session2, 'p1', 'inventory');
      expect(result.session.players['p1']).toBeDefined();

      // "help" is a meta command — should NOT trigger hazard
      result = processCommand(result.session, 'p1', 'help');
      expect(result.session.players['p1']).toBeDefined();

      Math.random.mockRestore();
    });
  });

  // ── Session defaults ────────────────────────────────────────────────

  describe('Session defaults', () => {
    test('deathTimeout is included in session and defaults to 30', () => {
      const session = hazardSessionStef();
      expect(session.deathTimeout).toBe(30);
    });

    test('deathTimeout is passed to clients on game start (present on session)', () => {
      const session = hazardSessionStef();
      expect(typeof session.deathTimeout).toBe('number');
      expect(session.deathTimeout).toBeGreaterThanOrEqual(15);
      expect(session.deathTimeout).toBeLessThanOrEqual(60);
    });
  });

  // ── Backward compatibility ──────────────────────────────────────────

  describe('Backward compatibility', () => {
    test('old string hazards are backward compatible (display-only, never kill)', () => {
      let session = hazardSessionWithPlayerStef('p1', 'Alice');

      jest.spyOn(Math, 'random').mockReturnValue(0.0);
      const { session: after } = processCommand(session, 'p1', 'go south');
      Math.random.mockRestore();

      // Player should survive — old string hazards have probability 0
      expect(after.players['p1']).toBeDefined();
      expect(after.players['p1'].room).toBe('old-hazard-room');
    });

    test('old string hazards normalized to objects with probability 0', () => {
      const world = hazardWorldStef();
      const room = world.rooms['old-hazard-room'];
      for (const hazard of room.hazards) {
        expect(typeof hazard).toBe('object');
        expect(hazard.probability).toBe(0);
        expect(hazard.description).toBe('A cold draft chills you.');
        expect(hazard.deathText).toBe('');
      }
    });
  });

  // ── Multiple hazards ────────────────────────────────────────────────

  describe('Multiple hazards', () => {
    test('multiple hazards — each checked independently', () => {
      let session = hazardSessionWithPlayerStef('p1', 'Alice');

      // multi-hazard-room: prob 0 (rocks) + prob 1 (spikes)
      jest.spyOn(Math, 'random').mockReturnValue(0.0);
      const { session: after, responses } = processCommand(session, 'p1', 'go west');
      Math.random.mockRestore();

      // Prob 0 should not trigger, prob 1 should kill
      expect(after.players['p1']).toBeUndefined();
      const death = responses.find(
        r => r.playerId === 'p1' && (r.message.type === 'death' || r.message.deathText)
      );
      expect(death).toBeDefined();
      // The killing hazard is the spikes (prob 1), verify its deathText
      expect(death.message.deathText).toBe('You fall into the spikes!');
      expect(death.message).not.toHaveProperty('text');
    });
  });

  // ── Integration scenarios ───────────────────────────────────────────

  describe('Integration', () => {
    const it = (_killPlayer && _respawnPlayer) ? test : test.skip;

    it('player dies, items drop to floor, respawns with empty inventory', () => {
      let session = hazardSessionWithPlayersStef(['p1', 'Alice'], ['p2', 'Bob']);
      ({ session } = processCommand(session, 'p1', 'take sword'));
      ({ session } = processCommand(session, 'p1', 'take potion'));

      session = _killPlayer(session, 'p1');
      const ghostRoom = session.ghosts['Alice'].room;

      // Items dropped to floor, not on ghost
      expect(session.ghosts['Alice'].inventory).toEqual([]);
      expect(session.roomStates[ghostRoom].items).toContain('sword');
      expect(session.roomStates[ghostRoom].items).toContain('potion');

      // Bob can pick up items from floor
      ({ session } = processCommand(session, 'p2', 'take sword'));
      expect(session.players['p2'].inventory).toContain('sword');

      // Respawn Alice
      session = _respawnPlayer(session, 'Alice', 'p1-new');

      expect(session.players['p1-new']).toBeDefined();
      expect(session.players['p1-new'].room).toBe(ghostRoom);
      expect(session.players['p1-new'].inventory).toEqual([]);
      expect(session.ghosts['Alice']).toBeUndefined();
    });

    it('player dies in room with others — others see death notification', () => {
      let session = hazardSessionWithPlayersStef(['p1', 'Alice'], ['p2', 'Bob']);
      // Move both to deadly room: Bob survives via mock, Alice dies
      jest.spyOn(Math, 'random').mockReturnValue(1.0);
      ({ session } = processCommand(session, 'p2', 'go north'));
      Math.random.mockRestore();

      jest.spyOn(Math, 'random').mockReturnValue(0.0);
      const { responses } = processCommand(session, 'p1', 'go north');
      Math.random.mockRestore();

      const bobNotif = responses.find(
        r => r.playerId === 'p2' &&
          (r.message.event === 'death' || (r.message.text && r.message.text.match(/Alice|died/i)))
      );
      expect(bobNotif).toBeDefined();
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
// 24. Hazard Check on Every Gameplay Command (Stef)
// ════════════════════════════════════════════════════════════════════════

describe('Hazard check on every gameplay command (Stef)', () => {
  // World with deadly room (probability 1) and items in the deadly room
  function hazardEveryCommandWorld() {
    return loadWorld({
      name: 'Every-Command Hazard World',
      startRoom: 'safe-room',
      rooms: {
        'safe-room': {
          name: 'Safe Room',
          description: 'No hazards here.',
          exits: { north: 'deadly-room' },
          items: [],
          hazards: [],
        },
        'deadly-room': {
          name: 'Deadly Room',
          description: 'Full of deadly gas.',
          exits: { south: 'safe-room' },
          items: ['gem'],
          hazards: [
            {
              description: 'Toxic gas.',
              probability: 1,
              deathText: 'The toxic gas kills you!',
            },
          ],
        },
      },
      items: {
        gem: {
          name: 'Ruby Gem',
          description: 'A glittering red gem.',
          pickupText: 'You grab the gem.',
          portable: true,
        },
      },
      puzzles: {},
    });
  }

  // Place a player directly in the deadly room (skip the go-move hazard)
  function sessionInDeadlyRoom(playerId = 'p1', playerName = 'Alice') {
    const world = hazardEveryCommandWorld();
    let session = createGameSession(world);
    session = addPlayer(session, playerId, playerName);
    session.players[playerId].room = 'deadly-room';
    return session;
  }

  // ── 1. Hazard triggers on "look" ──────────────────────────────────

  test('hazard triggers on "look" command', () => {
    let session = sessionInDeadlyRoom();

    jest.spyOn(Math, 'random').mockReturnValue(0.0);
    const { session: after, responses } = processCommand(session, 'p1', 'look');
    Math.random.mockRestore();

    // Player should be dead
    expect(after.players['p1']).toBeUndefined();

    // Death response should be present
    const death = responses.find(r => r.playerId === 'p1' && r.message.type === 'death');
    expect(death).toBeDefined();
    expect(death.message.deathText).toBe('The toxic gas kills you!');

    // Ghost should exist
    expect(after.ghosts?.['Alice']).toBeDefined();
    expect(after.ghosts['Alice'].isDeath).toBe(true);
  });

  // ── 2. Hazard triggers on "take" ──────────────────────────────────

  test('hazard triggers on "take" command', () => {
    let session = sessionInDeadlyRoom();

    jest.spyOn(Math, 'random').mockReturnValue(0.0);
    const { session: after, responses } = processCommand(session, 'p1', 'take Ruby Gem');
    Math.random.mockRestore();

    // Player should be dead — hazard fires after the take
    expect(after.players['p1']).toBeUndefined();

    const death = responses.find(r => r.playerId === 'p1' && r.message.type === 'death');
    expect(death).toBeDefined();

    // Ghost has empty inventory, gem was dropped to floor (in danger-room, the room where player died)
    expect(after.ghosts?.['Alice']).toBeDefined();
    expect(after.ghosts['Alice'].inventory).toEqual([]);
    expect(after.roomStates['deadly-room'].items).toContain('gem');
  });

  // ── 3. Hazard triggers on "say" ───────────────────────────────────

  test('hazard triggers on "say" command', () => {
    let session = sessionInDeadlyRoom();

    jest.spyOn(Math, 'random').mockReturnValue(0.0);
    const { session: after, responses } = processCommand(session, 'p1', 'say hello');
    Math.random.mockRestore();

    expect(after.players['p1']).toBeUndefined();

    const death = responses.find(r => r.playerId === 'p1' && r.message.type === 'death');
    expect(death).toBeDefined();
    expect(death.message.deathText).toBe('The toxic gas kills you!');
  });

  // ── 4. Hazard does NOT trigger on "help" ──────────────────────────

  test('hazard does NOT trigger on "help" command', () => {
    let session = sessionInDeadlyRoom();

    jest.spyOn(Math, 'random').mockReturnValue(0.0);
    const { session: after, responses } = processCommand(session, 'p1', 'help');
    Math.random.mockRestore();

    // Player must still be alive — help is a meta command
    expect(after.players['p1']).toBeDefined();
    expect(after.players['p1'].room).toBe('deadly-room');

    const death = responses.find(r => r.playerId === 'p1' && r.message.type === 'death');
    expect(death).toBeUndefined();
  });

  // ── 5. Hazard does NOT trigger on "inventory" ─────────────────────

  test('hazard does NOT trigger on "inventory" command', () => {
    let session = sessionInDeadlyRoom();

    jest.spyOn(Math, 'random').mockReturnValue(0.0);
    const { session: after, responses } = processCommand(session, 'p1', 'inventory');
    Math.random.mockRestore();

    expect(after.players['p1']).toBeDefined();
    expect(after.players['p1'].room).toBe('deadly-room');

    const death = responses.find(r => r.playerId === 'p1' && r.message.type === 'death');
    expect(death).toBeUndefined();
  });

  // ── 6. Hazard does NOT trigger on invalid command ─────────────────

  test('hazard does NOT trigger on invalid command', () => {
    let session = sessionInDeadlyRoom();

    jest.spyOn(Math, 'random').mockReturnValue(0.0);
    const { session: after, responses } = processCommand(session, 'p1', 'dance around');
    Math.random.mockRestore();

    expect(after.players['p1']).toBeDefined();
    expect(after.players['p1'].room).toBe('deadly-room');

    const death = responses.find(r => r.playerId === 'p1' && r.message.type === 'death');
    expect(death).toBeUndefined();

    // Should get an error message instead
    const error = responses.find(r => r.playerId === 'p1' && r.message.type === 'error');
    expect(error).toBeDefined();
  });

  // ── 7. Ghost player skips hazard check ────────────────────────────

  test('ghost player skips hazard check — no additional death or error', () => {
    let session = sessionInDeadlyRoom();

    // Kill the player first to make them a ghost
    session = killPlayer(session, 'p1');
    expect(session.ghosts?.['Alice']).toBeDefined();
    expect(session.players['p1']).toBeUndefined();

    // Trying to run a command as a dead player should not cause errors
    jest.spyOn(Math, 'random').mockReturnValue(0.0);
    const { session: after, responses } = processCommand(session, 'p1', 'look');
    Math.random.mockRestore();

    // Player is still not in session.players (they're a ghost)
    expect(after.players['p1']).toBeUndefined();

    // No death response (they're already dead)
    const death = responses.find(r => r.playerId === 'p1' && r.message.type === 'death');
    expect(death).toBeUndefined();

    // Ghost should still exist unchanged
    expect(after.ghosts['Alice']).toBeDefined();
    expect(after.ghosts['Alice'].isDeath).toBe(true);
  });

  // ── 8. Hazard check targets NEW room after "go" ──────────────────

  test('hazard check after "go" uses the new room, not the old one', () => {
    const world = hazardEveryCommandWorld();
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    // Player starts in safe-room

    jest.spyOn(Math, 'random').mockReturnValue(0.0);
    const { session: after, responses } = processCommand(session, 'p1', 'go north');
    Math.random.mockRestore();

    // Player moved to deadly-room and should be killed by its hazard
    expect(after.players['p1']).toBeUndefined();

    const death = responses.find(r => r.playerId === 'p1' && r.message.type === 'death');
    expect(death).toBeDefined();
    expect(death.message.deathText).toBe('The toxic gas kills you!');

    // Ghost should be in the deadly room
    expect(after.ghosts?.['Alice']).toBeDefined();
    expect(after.ghosts['Alice'].room).toBe('deadly-room');
  });

  // ── checkHazards direct tests ─────────────────────────────────────

  describe('checkHazards (direct)', () => {
    test('returns empty responses when player is in a safe room', () => {
      const world = hazardEveryCommandWorld();
      let session = createGameSession(world);
      session = addPlayer(session, 'p1', 'Alice');

      const result = checkHazards(session, 'p1');
      expect(result.responses).toEqual([]);
      expect(result.session.players['p1']).toBeDefined();
    });

    test('kills player in a room with probability-1 hazard', () => {
      let session = sessionInDeadlyRoom();

      jest.spyOn(Math, 'random').mockReturnValue(0.0);
      const result = checkHazards(session, 'p1');
      Math.random.mockRestore();

      expect(result.session.players['p1']).toBeUndefined();
      expect(result.session.ghosts?.['Alice']).toBeDefined();

      const death = result.responses.find(r => r.message.type === 'death');
      expect(death).toBeDefined();
      expect(death.message.deathText).toBe('The toxic gas kills you!');
      expect(death.message.deathTimeout).toBe(30);
    });

    test('returns empty responses for non-existent player', () => {
      let session = sessionInDeadlyRoom();
      const result = checkHazards(session, 'nonexistent');
      expect(result.responses).toEqual([]);
    });

    test('skips hazard check for ghost player', () => {
      let session = sessionInDeadlyRoom();
      session = killPlayer(session, 'p1');

      jest.spyOn(Math, 'random').mockReturnValue(0.0);
      const result = checkHazards(session, 'p1');
      Math.random.mockRestore();

      // No additional death responses
      expect(result.responses).toEqual([]);
    });

    test('high random value avoids death even with probability < 1', () => {
      let session = sessionInDeadlyRoom();

      // probability is 1, so Math.random returning 0.99 still < 1 → dies
      // Use a world with lower probability to test survival
      const world = loadWorld({
        name: 'Low Prob World',
        startRoom: 'room-a',
        rooms: {
          'room-a': {
            name: 'Room A',
            description: 'Slightly dangerous.',
            exits: {},
            items: [],
            hazards: [
              { description: 'Loose rocks.', probability: 0.5, deathText: 'Crushed!' },
            ],
          },
        },
        items: {},
        puzzles: {},
      });
      let session2 = createGameSession(world);
      session2 = addPlayer(session2, 'p1', 'Alice');

      // random returns 0.99 → 0.99 >= 0.5 → survives
      jest.spyOn(Math, 'random').mockReturnValue(0.99);
      const result = checkHazards(session2, 'p1');
      Math.random.mockRestore();

      expect(result.session.players['p1']).toBeDefined();
      expect(result.responses).toEqual([]);
    });

    test('notifies other players in room when someone dies', () => {
      const world = hazardEveryCommandWorld();
      let session = createGameSession(world);
      session = addPlayer(session, 'p1', 'Alice');
      session = addPlayer(session, 'p2', 'Bob');
      session.players['p1'].room = 'deadly-room';
      session.players['p2'].room = 'deadly-room';

      // Only check hazards for Alice — mock so Alice dies
      jest.spyOn(Math, 'random').mockReturnValue(0.0);
      const result = checkHazards(session, 'p1');
      Math.random.mockRestore();

      // Alice should be dead
      expect(result.session.players['p1']).toBeUndefined();

      // Bob should get a death notification
      const bobNotif = result.responses.find(
        r => r.playerId === 'p2' && r.message.event === 'died'
      );
      expect(bobNotif).toBeDefined();
      expect(bobNotif.message.text).toMatch(/Alice.*died/i);

      // Bob should also get a ghost event
      const ghostNotif = result.responses.find(
        r => r.playerId === 'p2' && r.message.type === 'ghostEvent'
      );
      expect(ghostNotif).toBeDefined();
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
// 25. Hazard Multiplier (Stef)
// ════════════════════════════════════════════════════════════════════════

describe('hazard multiplier', () => {
  // Helper: Create world with moderate hazard probability
  function multiplierWorld() {
    return loadWorld({
      name: 'Multiplier Test World',
      startRoom: 'safe-room',
      rooms: {
        'safe-room': {
          name: 'Safe Room',
          description: 'A safe starting room.',
          exits: { north: 'hazard-room' },
          items: [],
          hazards: [],
        },
        'hazard-room': {
          name: 'Hazard Room',
          description: 'Moderately dangerous.',
          exits: { south: 'safe-room' },
          items: [],
          hazards: [
            {
              description: 'Falling debris.',
              probability: 0.3,
              deathText: 'You are crushed by falling debris!',
            },
          ],
        },
        'high-prob-room': {
          name: 'High Probability Room',
          description: 'Very dangerous.',
          exits: { south: 'safe-room' },
          items: [],
          hazards: [
            {
              description: 'Massive hazard.',
              probability: 0.8,
              deathText: 'Massive hazard kills you!',
            },
          ],
        },
      },
      items: {},
      puzzles: {},
    });
  }

  test('createGameSession includes hazardMultiplier default', () => {
    const world = multiplierWorld();
    const session = createGameSession(world);
    expect(session.hazardMultiplier).toBe(1);
  });

  test('medium multiplier (1.0) uses world file probability as-is', () => {
    const world = multiplierWorld();
    let session = createGameSession(world);
    session.hazardMultiplier = 1;
    session = addPlayer(session, 'p1', 'Alice');
    session.players['p1'].room = 'hazard-room';

    // Hazard probability is 0.3, multiplier 1.0 → effective 0.3
    // Mock Math.random to return 0.2 (below 0.3) → should die
    jest.spyOn(Math, 'random').mockReturnValue(0.2);
    const result = checkHazards(session, 'p1');
    Math.random.mockRestore();

    expect(result.session.players['p1']).toBeUndefined();
    const death = result.responses.find(r => r.message.type === 'death');
    expect(death).toBeDefined();
  });

  test('low multiplier (0.5) halves the effective probability', () => {
    const world = multiplierWorld();
    let session = createGameSession(world);
    session.hazardMultiplier = 0.5;
    session = addPlayer(session, 'p1', 'Alice');
    session.players['p1'].room = 'hazard-room';

    // Hazard probability is 0.3, multiplier 0.5 → effective 0.15
    // Mock Math.random to return 0.2 (above 0.15) → should NOT die
    jest.spyOn(Math, 'random').mockReturnValue(0.2);
    let result = checkHazards(session, 'p1');
    Math.random.mockRestore();

    expect(result.session.players['p1']).toBeDefined();
    expect(result.responses).toEqual([]);

    // Now test 0.1 (below 0.15) → should die
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    result = checkHazards(result.session, 'p1');
    Math.random.mockRestore();

    expect(result.session.players['p1']).toBeUndefined();
    const death = result.responses.find(r => r.message.type === 'death');
    expect(death).toBeDefined();
  });

  test('high multiplier (2.0) doubles the effective probability', () => {
    const world = multiplierWorld();
    let session = createGameSession(world);
    session.hazardMultiplier = 2;
    session = addPlayer(session, 'p1', 'Alice');
    session.players['p1'].room = 'hazard-room';

    // Hazard probability is 0.3, multiplier 2.0 → effective 0.6
    // Mock Math.random to return 0.5 (below 0.6) → should die
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const result = checkHazards(session, 'p1');
    Math.random.mockRestore();

    expect(result.session.players['p1']).toBeUndefined();
    const death = result.responses.find(r => r.message.type === 'death');
    expect(death).toBeDefined();
  });

  test('multiplier is clamped so adjusted probability never exceeds 1', () => {
    const world = multiplierWorld();
    let session = createGameSession(world);
    session.hazardMultiplier = 2;
    session = addPlayer(session, 'p1', 'Alice');
    session.players['p1'].room = 'high-prob-room';

    // Hazard probability is 0.8, multiplier 2.0 → raw = 1.6, clamped to 1.0
    // Mock Math.random to return 0.99 → should die (0.99 < 1.0)
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    const result = checkHazards(session, 'p1');
    Math.random.mockRestore();

    expect(result.session.players['p1']).toBeUndefined();
    const death = result.responses.find(r => r.message.type === 'death');
    expect(death).toBeDefined();
  });

  test('missing multiplier defaults to 1', () => {
    const world = multiplierWorld();
    let session = createGameSession(world);
    delete session.hazardMultiplier;
    session = addPlayer(session, 'p1', 'Alice');
    session.players['p1'].room = 'hazard-room';

    // Hazard probability is 0.3, missing multiplier defaults to 1 → effective 0.3
    // Mock Math.random to return 0.2 (below 0.3) → should die
    jest.spyOn(Math, 'random').mockReturnValue(0.2);
    const result = checkHazards(session, 'p1');
    Math.random.mockRestore();

    expect(result.session.players['p1']).toBeUndefined();
    const death = result.responses.find(r => r.message.type === 'death');
    expect(death).toBeDefined();
  });

  test('multiplier of 0.5 can prevent death that would occur at 1.0', () => {
    // Create a world with probability 0.4
    const world = loadWorld({
      name: 'Comparative Test World',
      startRoom: 'room-a',
      rooms: {
        'room-a': {
          name: 'Room A',
          description: 'Moderately dangerous.',
          exits: {},
          items: [],
          hazards: [
            {
              description: 'Danger zone.',
              probability: 0.4,
              deathText: 'You succumb to the danger!',
            },
          ],
        },
      },
      items: {},
      puzzles: {},
    });

    let session = createGameSession(world);
    session.hazardMultiplier = 0.5;
    session = addPlayer(session, 'p1', 'Alice');

    // Hazard probability 0.4, multiplier 0.5 → effective 0.2
    // Mock Math.random to return 0.3
    // At 1.0x this would kill (0.3 < 0.4), but at 0.5x it doesn't (0.3 > 0.2)
    jest.spyOn(Math, 'random').mockReturnValue(0.3);
    const result = checkHazards(session, 'p1');
    Math.random.mockRestore();

    expect(result.session.players['p1']).toBeDefined();
    expect(result.responses).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 26. Displaced Items (Stef)
// ════════════════════════════════════════════════════════════════════════

describe('displaced items', () => {
  // Helper: create a world with items in specific rooms
  function displacedWorld() {
    return loadWorld({
      name: 'Displaced Items Test World',
      startRoom: 'room-a',
      rooms: {
        'room-a': {
          name: 'Room A',
          description: 'First room with a torch.',
          exits: { north: 'room-b' },
          items: ['torch'],
          hazards: [],
        },
        'room-b': {
          name: 'Room B',
          description: 'Second room with a sword.',
          exits: { south: 'room-a' },
          items: ['sword'],
          hazards: [],
        },
      },
      items: {
        torch: {
          name: 'Torch',
          description: 'A flickering torch.',
          roomText: 'A torch flickers on the wall.',
          pickupText: 'You take the torch.',
          portable: true,
        },
        sword: {
          name: 'Sword',
          description: 'A sharp blade.',
          roomText: 'A sword lies here.',
          pickupText: 'You grab the sword.',
          portable: true,
        },
      },
      puzzles: {},
    });
  }

  function displacedSession() {
    const world = displacedWorld();
    return createGameSession(world);
  }

  function displacedSessionWithPlayer(id = 'p1', name = 'Alice') {
    const session = displacedSession();
    return addPlayer(session, id, name);
  }

  test('items in their original room are not displaced', () => {
    const session = displacedSessionWithPlayer('p1', 'Alice');
    const view = getPlayerView(session, 'p1');

    expect(view.items).toHaveLength(1);
    const torchItem = view.items[0];
    expect(torchItem.name).toBe('Torch');
    expect(torchItem.displaced).toBe(false);
    expect(torchItem.roomText).toBe('A torch flickers on the wall.');
  });

  test('items dropped in a different room are marked displaced', () => {
    let session = displacedSessionWithPlayer('p1', 'Alice');
    
    // Manually push sword into room-a (where it doesn't belong)
    session.roomStates['room-a'].items.push('sword');

    const view = getPlayerView(session, 'p1');
    
    // Should have torch (native) and sword (displaced)
    expect(view.items).toHaveLength(2);
    
    const torchItem = view.items.find(i => i.name === 'Torch');
    expect(torchItem.displaced).toBe(false);
    expect(torchItem.roomText).toBeDefined();
    
    const swordItem = view.items.find(i => i.name === 'Sword');
    expect(swordItem.displaced).toBe(true);
    expect(swordItem.roomText).toBeUndefined();
  });

  test('native and displaced items coexist in same room', () => {
    let session = displacedSessionWithPlayer('p1', 'Alice');
    
    // Add sword (non-native) to room-a which already has torch (native)
    session.roomStates['room-a'].items.push('sword');

    const view = getPlayerView(session, 'p1');
    
    expect(view.items).toHaveLength(2);
    
    // Torch is native to room-a
    const torchItem = view.items.find(i => i.name === 'Torch');
    expect(torchItem).toBeDefined();
    expect(torchItem.displaced).toBe(false);
    expect(torchItem.roomText).toBe('A torch flickers on the wall.');
    
    // Sword is not native to room-a
    const swordItem = view.items.find(i => i.name === 'Sword');
    expect(swordItem).toBeDefined();
    expect(swordItem.displaced).toBe(true);
    expect(swordItem.roomText).toBeUndefined();
  });

  test('item dropped after death is displaced in death room', () => {
    let session = displacedSessionWithPlayer('p1', 'Alice');
    
    // Pick up torch from room-a
    ({ session } = processCommand(session, 'p1', 'take torch'));
    expect(session.players['p1'].inventory).toContain('torch');
    
    // Move to room-b
    ({ session } = processCommand(session, 'p1', 'go north'));
    expect(session.players['p1'].room).toBe('room-b');
    
    // Kill player (torch drops to room-b floor)
    session = killPlayer(session, 'p1');
    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.ghosts['Alice'].inventory).toEqual([]);
    expect(session.roomStates['room-b'].items).toContain('torch');
    
    // Respawn player in same room with empty inventory
    session = respawnPlayer(session, 'Alice', 'p1-respawn');
    expect(session.players['p1-respawn']).toBeDefined();
    expect(session.roomStates['room-b'].items).toContain('torch');
    
    // Check view in room-b — torch is displaced (belongs to room-a)
    const view = getPlayerView(session, 'p1-respawn');
    
    const torchItem = view.items.find(i => i.name === 'Torch');
    expect(torchItem).toBeDefined();
    expect(torchItem.displaced).toBe(true);
    expect(torchItem.roomText).toBeUndefined();
    
    // Sword should be native to room-b
    const swordItem = view.items.find(i => i.name === 'Sword');
    expect(swordItem).toBeDefined();
    expect(swordItem.displaced).toBe(false);
    expect(swordItem.roomText).toBe('A sword lies here.');
  });

  test('item in its original room after being dropped there is not displaced', () => {
    let session = displacedSessionWithPlayer('p1', 'Alice');
    
    // Pick up torch from room-a
    ({ session } = processCommand(session, 'p1', 'take torch'));
    expect(session.players['p1'].inventory).toContain('torch');
    
    // Drop it back in room-a
    ({ session } = processCommand(session, 'p1', 'drop torch'));
    expect(session.roomStates['room-a'].items).toContain('torch');
    
    // Check view — torch should not be displaced (it's back home)
    const view = getPlayerView(session, 'p1');
    
    const torchItem = view.items.find(i => i.name === 'Torch');
    expect(torchItem).toBeDefined();
    expect(torchItem.displaced).toBe(false);
    expect(torchItem.roomText).toBe('A torch flickers on the wall.');
  });

  test('unknown items (not in world.items) are handled gracefully', () => {
    let session = displacedSessionWithPlayer('p1', 'Alice');
    
    // Push a fake item ID that doesn't exist in world.items
    session.roomStates['room-a'].items.push('mystery-item');
    
    const view = getPlayerView(session, 'p1');
    
    // Find the mystery item
    const mysteryItem = view.items.find(i => i.name === 'mystery-item');
    expect(mysteryItem).toBeDefined();
    expect(mysteryItem.name).toBe('mystery-item');
    expect(mysteryItem.displaced).toBe(true); // Not in room's native items list
    expect(mysteryItem.roomText).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// Say Scope
// ════════════════════════════════════════════════════════════════════════

describe('say scope', () => {
  test('createGameSession includes sayScope default', () => {
    const session = freshSession();
    expect(session.sayScope).toBe('room');
  });

  test('room scope: say only reaches players in same room', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    // Move Bob to a different room
    session.players['p2'].room = 'room-b';
    session.sayScope = 'room';

    const { responses } = processCommand(session, 'p1', 'say hello');

    // Alice gets confirmation
    const aliceMsg = responses.find(r => r.playerId === 'p1');
    expect(aliceMsg).toBeDefined();
    expect(aliceMsg.message.text).toContain('You say:');

    // Bob gets nothing
    const bobMsg = responses.find(r => r.playerId === 'p2');
    expect(bobMsg).toBeUndefined();
  });

  test('room scope: say reaches all players in same room', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session.sayScope = 'room';

    const { responses } = processCommand(session, 'p1', 'say hello everyone');

    // Alice gets confirmation
    const aliceMsg = responses.find(r => r.playerId === 'p1');
    expect(aliceMsg).toBeDefined();
    expect(aliceMsg.message.text).toContain('You say:');

    // Bob gets message without prefix
    const bobMsg = responses.find(r => r.playerId === 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text).toContain('Alice says:');
    expect(bobMsg.message.text).toContain('hello everyone');
    expect(bobMsg.message.text).not.toContain('[from');
  });

  test('global scope: say reaches players in different rooms', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    // Move Bob to a different room
    session.players['p2'].room = 'room-b';
    session.sayScope = 'global';

    const { responses } = processCommand(session, 'p1', 'say hello from afar');

    // Alice gets confirmation
    const aliceMsg = responses.find(r => r.playerId === 'p1');
    expect(aliceMsg).toBeDefined();
    expect(aliceMsg.message.text).toContain('You say:');

    // Bob gets message WITH room prefix
    const bobMsg = responses.find(r => r.playerId === 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text).toContain('[from');
    expect(bobMsg.message.text).toContain('Alice says:');
    expect(bobMsg.message.text).toContain('hello from afar');
  });

  test('global scope: same-room players don\'t get room prefix', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session.sayScope = 'global';

    const { responses } = processCommand(session, 'p1', 'say hey buddy');

    // Alice gets confirmation
    const aliceMsg = responses.find(r => r.playerId === 'p1');
    expect(aliceMsg).toBeDefined();
    expect(aliceMsg.message.text).toContain('You say:');

    // Bob gets message WITHOUT prefix
    const bobMsg = responses.find(r => r.playerId === 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text).toContain('Alice says:');
    expect(bobMsg.message.text).toContain('hey buddy');
    expect(bobMsg.message.text).not.toContain('[from');
  });

  test('global scope: message includes room name in prefix', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    // Alice stays in room-a (Room A), Bob moves to room-b
    session.players['p2'].room = 'room-b';
    session.sayScope = 'global';

    const { responses } = processCommand(session, 'p1', 'say greetings');

    // Bob gets message with room name
    const bobMsg = responses.find(r => r.playerId === 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text).toContain('[from Room A]');
    expect(bobMsg.message.text).toContain('Alice says:');
    expect(bobMsg.message.text).toContain('greetings');
  });

  test('missing sayScope defaults to room behavior', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    // Move Bob to a different room
    session.players['p2'].room = 'room-b';
    // Delete sayScope to test default behavior
    delete session.sayScope;

    const { responses } = processCommand(session, 'p1', 'say test message');

    // Alice gets confirmation
    const aliceMsg = responses.find(r => r.playerId === 'p1');
    expect(aliceMsg).toBeDefined();
    expect(aliceMsg.message.text).toContain('You say:');

    // Bob gets nothing (room-only behavior)
    const bobMsg = responses.find(r => r.playerId === 'p2');
    expect(bobMsg).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// Ghost Item Drop Behavior (Stef)
// ════════════════════════════════════════════════════════════════════════

describe('ghost item drop', () => {
  test('killPlayer drops all inventory items into the room', () => {
    let session = freshSession();
    session = addPlayer(session, 'p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take torch'));
    
    const roomBefore = session.players['p1'].room;
    expect(session.players['p1'].inventory).toEqual(['key', 'torch']);
    
    session = killPlayer(session, 'p1');
    
    // Ghost has empty inventory
    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.ghosts['Alice'].inventory).toEqual([]);
    
    // Items are in the room
    expect(session.roomStates[roomBefore].items).toContain('key');
    expect(session.roomStates[roomBefore].items).toContain('torch');
  });

  test('killPlayer with empty inventory creates ghost with no items to drop', () => {
    let session = freshSession();
    session = addPlayer(session, 'p1', 'Alice');
    
    expect(session.players['p1'].inventory).toEqual([]);
    const roomBefore = session.players['p1'].room;
    const roomItemsBefore = [...session.roomStates[roomBefore].items];
    
    session = killPlayer(session, 'p1');
    
    // Ghost has empty inventory
    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.ghosts['Alice'].inventory).toEqual([]);
    
    // Room items unchanged
    expect(session.roomStates[roomBefore].items).toEqual(roomItemsBefore);
  });

  test('items dropped on death are in the room for other players to get', () => {
    let session = freshSession();
    session = addPlayer(session, 'p1', 'Alice');
    session = addPlayer(session, 'p2', 'Bob');
    
    ({ session } = processCommand(session, 'p1', 'take old key'));
    
    session = killPlayer(session, 'p1');
    
    // Bob can see items in room view
    const view = getPlayerView(session, 'p2');
    const keyItem = view.items.find(i => i.name === 'Old Key');
    expect(keyItem).toBeDefined();
    
    // Bob can pick up the items
    ({ session } = processCommand(session, 'p2', 'take old key'));
    expect(session.players['p2'].inventory).toContain('key');
  });

  test('respawnPlayer gives empty inventory to revived player', () => {
    let session = freshSession();
    session = addPlayer(session, 'p1', 'Alice');
    
    ({ session } = processCommand(session, 'p1', 'take old key'));
    
    const roomBefore = session.players['p1'].room;
    session = killPlayer(session, 'p1');
    session = respawnPlayer(session, 'Alice', 'p1-new');
    
    // Respawned player has empty inventory
    expect(session.players['p1-new']).toBeDefined();
    expect(session.players['p1-new'].inventory).toEqual([]);
    
    // Items are still in the room
    expect(session.roomStates[roomBefore].items).toContain('key');
  });

  test('items dropped on death are marked as displaced', () => {
    let session = freshSession();
    session = addPlayer(session, 'p1', 'Alice');
    
    // Go to room-c and pick up torch
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take torch'));
    expect(session.players['p1'].inventory).toContain('torch');
    
    // Move to room-b
    ({ session } = processCommand(session, 'p1', 'go west'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    expect(session.players['p1'].room).toBe('room-b');
    
    // Kill player - torch drops to room-b (not its native room-c)
    session = killPlayer(session, 'p1');
    expect(session.roomStates['room-b'].items).toContain('torch');
    
    // Check getPlayerView - item should be displaced
    session = addPlayer(session, 'p2', 'Bob');
    session.players['p2'].room = 'room-b';
    const view = getPlayerView(session, 'p2');
    
    const torchItem = view.items.find(i => i.name === 'Torch');
    expect(torchItem).toBeDefined();
    expect(torchItem.displaced).toBe(true);
    expect(torchItem.roomText).toBeUndefined();
  });

  test('loot on ghost with no inventory gives appropriate message', () => {
    let session = freshSession();
    session = addPlayer(session, 'p1', 'Alice');
    session = addPlayer(session, 'p2', 'Bob');
    
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = killPlayer(session, 'p1');
    
    // Ghost has no inventory
    expect(session.ghosts['Alice'].inventory).toEqual([]);
    
    // Try to loot the ghost
    const { responses } = processCommand(session, 'p2', "loot Alice's ghost");
    const msg = responses.find(r => r.playerId === 'p2');
    
    expect(msg).toBeDefined();
    expect(msg.message.text).toContain('nothing to loot');
  });
});
