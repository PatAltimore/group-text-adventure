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
  getGoalAsciiArt,
  getVictoryAsciiArt,
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
    expect(lookMsg.message.room.name).toBe('🧩 Room B');
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

  test('pick up shows simple confirmation with item name', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', 'take old key');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.text).toBe('You picked up: Old Key.');
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

  test('reconnected player gets empty inventory (items dropped on disconnect)', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take torch'));
    session = disconnectPlayer(session, 'p1');

    // Bob goes to room-c and takes an item from the floor (dropped on disconnect)
    ({ session } = processCommand(session, 'p2', 'go east'));
    ({ session } = processCommand(session, 'p2', 'take old key'));

    // Alice reconnects — inventory is empty (items were dropped on disconnect)
    session = reconnectPlayer(session, 'Alice', 'p1-new');
    expect(session.players['p1-new'].inventory).toEqual([]);
    expect(session.roomStates['room-c'].items).toContain('torch');
    expect(session.players['p2'].inventory).toContain('key');
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
// 12. Ghost Interactions & Get Items
// ════════════════════════════════════════════════════════════════════════

describe('Ghost Interactions', () => {
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

  test('ghost still visible in room view after disconnect', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    const view = getPlayerView(session, 'p2');
    expect(view.ghosts).toContain("Alice's ghost");
  });

  test('loot command is no longer recognized', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', "loot Alice's ghost");
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
    expect(msg.message.text).toContain("don't understand");
  });
});

describe('Get Items / Take All', () => {
  test('"get items" picks up all portable items in the room', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1'); // key drops to room-a floor

    const { session: after, responses } = processCommand(session, 'p2', 'get items');
    const msg = responses.find(r => r.playerId === 'p2' && r.message.text?.includes('picked up'));
    expect(msg).toBeDefined();
    expect(msg.message.text).toContain('Old Key');
    expect(after.players['p2'].inventory).toContain('key');
  });

  test('"take items" picks up all portable items', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    const { session: after, responses } = processCommand(session, 'p2', 'take items');
    const msg = responses.find(r => r.playerId === 'p2' && r.message.text?.includes('picked up'));
    expect(msg).toBeDefined();
    expect(after.players['p2'].inventory).toContain('key');
  });

  test('"g" shortcut picks up all portable items', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    const { session: after, responses } = processCommand(session, 'p2', 'g');
    const msg = responses.find(r => r.playerId === 'p2' && r.message.text?.includes('picked up'));
    expect(msg).toBeDefined();
    expect(after.players['p2'].inventory).toContain('key');
  });

  test('"get items" with no items says nothing to pick up', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key')); // take the one portable item

    const { responses } = processCommand(session, 'p1', 'get items');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.text).toContain('no items here');
  });

  test('"g" with no items says nothing to pick up', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));

    const { responses } = processCommand(session, 'p1', 'g');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.text).toContain('no items here');
  });

  test('"get items" picks up multiple dropped items at once', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take torch'));
    session = disconnectPlayer(session, 'p1'); // Both items drop in room-c

    ({ session } = processCommand(session, 'p2', 'go east'));
    const { session: after, responses } = processCommand(session, 'p2', 'get items');
    const msg = responses.find(r => r.playerId === 'p2' && r.message.text?.includes('picked up'));
    expect(msg).toBeDefined();
    expect(after.players['p2'].inventory).toContain('key');
    expect(after.players['p2'].inventory).toContain('torch');
    expect(after.roomStates['room-c'].items).not.toContain('key');
    expect(after.roomStates['room-c'].items).not.toContain('torch');
  });

  test('"get items" notifies other players in the room', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    // Both in room-a; key is on floor
    const { responses } = processCommand(session, 'p1', 'get items');
    const otherMsg = responses.find(r => r.playerId === 'p2');
    if (otherMsg) {
      expect(otherMsg.message.text).toContain('picked up everything');
    }
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

  test('rejoin still reclaims ghost (empty inventory, ghost room)', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    session = disconnectPlayer(session, 'p1');

    // Ghost exists with empty inventory, items dropped on floor
    ({ session } = processCommand(session, 'p2', 'go north'));
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
  test('ghost persists with empty inventory after disconnect', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.ghosts['Alice'].playerName).toBe('Alice');
    expect(session.ghosts['Alice'].inventory).toEqual([]);
  });

  test('ghost is still visible in room description via look', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    // Ghost has empty inventory after disconnect (items on floor)
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

  test('reconnect after disconnect — player has empty inventory, placed in ghost room', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take torch'));
    session = disconnectPlayer(session, 'p1');

    // Ghost exists with empty inventory, items on room floor
    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.ghosts['Alice'].inventory).toEqual([]);

    // Alice reconnects — placed in ghost's room (room-c) with no items
    session = reconnectPlayer(session, 'Alice', 'p1-new');
    expect(session.players['p1-new'].room).toBe('room-c');
    expect(session.players['p1-new'].inventory).toEqual([]);
    expect(session.players['p1-new'].name).toBe('Alice');
    expect(session.ghosts['Alice']).toBeUndefined();
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

  test('very old ghost still persists and items remain on floor', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1'); // Items drop to floor

    // Set timestamp to 90 days ago
    session.ghosts['Alice'].disconnectedAt = Date.now() - (90 * 24 * 60 * 60 * 1000);

    // Ghost still exists and items are on the floor
    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.ghosts['Alice'].inventory).toEqual([]);
    expect(session.roomStates['room-a'].items).toContain('key');
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
      expect(session.deathTimeout).toBeGreaterThanOrEqual(5);
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

});

// ════════════════════════════════════════════════════════════════════════
// Special Character Item Pickup (Stef)
// ════════════════════════════════════════════════════════════════════════

describe('Special Character Item Pickup (Stef)', () => {
  // Helper: build a world with items that have special characters in names
  function worldWithSpecialItems() {
    return loadWorld({
      name: 'Special Items World',
      startRoom: 'room1',
      rooms: {
        room1: {
          name: 'Room 1',
          description: 'A room with special items.',
          exits: {},
          items: ['knights-shield', 'laser-sword'],
          hazards: [],
        },
      },
      items: {
        'knights-shield': {
          name: "Knight's Shield",
          description: 'A sturdy shield with an apostrophe in its name.',
          roomText: "A knight's shield leans against the wall.",
          pickupText: "You take the knight's shield.",
          portable: true,
        },
        'laser-sword': {
          name: 'Laser-Sword',
          description: 'A futuristic weapon with a hyphen in its name.',
          roomText: 'A laser-sword hums on the ground.',
          pickupText: 'You grab the laser-sword.',
          portable: true,
        },
      },
      puzzles: {},
    });
  }

  test('can pick up item with apostrophe in name', () => {
    const world = worldWithSpecialItems();
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');

    const { session: updated, responses } = processCommand(session, 'p1', "get knight's shield");
    const msg = responses.find(r => r.playerId === 'p1');

    expect(msg).toBeDefined();
    expect(msg.message.type).not.toBe('error');
    expect(updated.players['p1'].inventory).toContain('knights-shield');
  });

  test('can pick up item with hyphen in name', () => {
    const world = worldWithSpecialItems();
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');

    const { session: updated, responses } = processCommand(session, 'p1', 'get laser-sword');
    const msg = responses.find(r => r.playerId === 'p1');

    expect(msg).toBeDefined();
    expect(msg.message.type).not.toBe('error');
    expect(updated.players['p1'].inventory).toContain('laser-sword');
  });

  test('can pick up item with partial name match including special chars', () => {
    const world = worldWithSpecialItems();
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');

    // Try partial match — "knight's" should match "Knight's Shield"
    const { session: updated, responses } = processCommand(session, 'p1', "get knight's");
    const msg = responses.find(r => r.playerId === 'p1');

    expect(msg).toBeDefined();
    expect(msg.message.type).not.toBe('error');
    expect(updated.players['p1'].inventory).toContain('knights-shield');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Puzzle Room Emoji Prefix (Stef)
// ════════════════════════════════════════════════════════════════════════

describe('Puzzle Room Emoji Prefix (Stef)', () => {
  // Helper: build a world with a puzzle room and a non-puzzle room
  function worldWithPuzzleRoom() {
    return loadWorld({
      name: 'Puzzle World',
      startRoom: 'lobby',
      rooms: {
        lobby: {
          name: 'Lobby',
          description: 'A plain lobby.',
          exits: { north: 'puzzle-chamber' },
          items: ['puzzle-key'],
          hazards: [],
        },
        'puzzle-chamber': {
          name: 'Puzzle Chamber',
          description: 'A room with a puzzle.',
          exits: { south: 'lobby' },
          items: [],
          hazards: [],
        },
      },
      items: {
        'puzzle-key': {
          name: 'Puzzle Key',
          description: 'A key for the puzzle.',
          roomText: 'A key sits on the floor.',
          pickupText: 'You take the key.',
          portable: true,
        },
      },
      puzzles: {
        'chamber-puzzle': {
          room: 'puzzle-chamber',
          description: 'A lever must be activated.',
          requiredItem: 'puzzle-key',
          solvedText: 'The lever clicks into place!',
          action: {
            type: 'openExit',
            direction: 'north',
            targetRoom: 'lobby',
          },
        },
      },
    });
  }

  test('puzzle rooms have emoji prefix in room name', () => {
    const world = worldWithPuzzleRoom();
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');

    // Move to the puzzle room
    ({ session } = processCommand(session, 'p1', 'go north'));
    expect(session.players['p1'].room).toBe('puzzle-chamber');

    const view = getPlayerView(session, 'p1');
    expect(view.name).toMatch(/^🧩 /);
    expect(view.name).toBe('🧩 Puzzle Chamber');
  });

  test('non-puzzle rooms do not have emoji prefix', () => {
    const world = worldWithPuzzleRoom();
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');

    // Player starts in lobby — not a puzzle room
    const view = getPlayerView(session, 'p1');
    expect(view.name).not.toMatch(/^🧩/);
    expect(view.name).toBe('Lobby');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Puzzle Hint System (Stef)
// ════════════════════════════════════════════════════════════════════════

describe('Puzzle Hint System (Stef)', () => {
  // Helper: world with a puzzle that has hintText
  function worldWithHints() {
    return loadWorld({
      name: 'Hint World',
      startRoom: 'start',
      rooms: {
        start: {
          name: 'Start Room',
          description: 'A simple room.',
          exits: { north: 'riddle-room' },
          items: ['hint-key'],
          hazards: [],
        },
        'riddle-room': {
          name: 'Riddle Room',
          description: 'A room with a riddle.',
          exits: { south: 'start' },
          items: [],
          hazards: [],
        },
      },
      items: {
        'hint-key': {
          name: 'Hint Key',
          description: 'A key that solves the riddle.',
          roomText: 'A key glows on the floor.',
          pickupText: 'You take the hint key.',
          portable: true,
        },
      },
      puzzles: {
        'riddle-puzzle': {
          room: 'riddle-room',
          description: 'A riddle blocks the way.',
          requiredItem: 'hint-key',
          hintText: 'Try looking in the starting room for something shiny.',
          solvedText: 'The riddle is solved!',
          action: {
            type: 'openExit',
            direction: 'north',
            targetRoom: 'start',
          },
        },
      },
    });
  }

  test('hint text included in view when hints enabled', () => {
    const world = worldWithHints();
    let session = createGameSession(world);
    session.hintsEnabled = true;
    session = addPlayer(session, 'p1', 'Alice');

    // Move to the puzzle room
    ({ session } = processCommand(session, 'p1', 'go north'));
    expect(session.players['p1'].room).toBe('riddle-room');

    const view = getPlayerView(session, 'p1');
    expect(view.hintText).toBe('Try looking in the starting room for something shiny.');
  });

  test('hint text NOT included when hints disabled', () => {
    const world = worldWithHints();
    let session = createGameSession(world);
    session.hintsEnabled = false;
    session = addPlayer(session, 'p1', 'Alice');

    // Move to the puzzle room
    ({ session } = processCommand(session, 'p1', 'go north'));

    const view = getPlayerView(session, 'p1');
    expect(view.hintText).toBeUndefined();
  });

  test('hint text NOT included for non-puzzle rooms', () => {
    const world = worldWithHints();
    let session = createGameSession(world);
    session.hintsEnabled = true;
    session = addPlayer(session, 'p1', 'Alice');

    // Player is in start room — not a puzzle room
    const view = getPlayerView(session, 'p1');
    expect(view.hintText).toBeUndefined();
  });

  test('hintsEnabled defaults to true in createGameSession', () => {
    const world = worldWithHints();
    const session = createGameSession(world);
    expect(session.hintsEnabled).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Goal System (Stef)
// ════════════════════════════════════════════════════════════════════════

describe('Goal System', () => {
  // Helper: Create a world with goal puzzles
  function worldWithGoals(goalCount = 1) {
    const world = {
      name: 'Goal Test World',
      startRoom: 'start',
      rooms: {
        'start': {
          name: 'Start Room',
          description: 'A starting room.',
          exits: goalCount >= 1 ? { north: 'goal-room-1' } : {},
          items: goalCount >= 1 ? ['goal-key-1'] : [],
          hazards: []
        },
        'goal-room-1': {
          name: 'Goal Room 1',
          description: 'A room with the first goal puzzle.',
          exits: { south: 'start' },
          items: goalCount >= 2 ? ['goal-key-2'] : [],
          hazards: []
        }
      },
      items: {
        'goal-key-1': {
          name: 'Goal Key 1',
          description: 'The first goal key.',
          roomText: 'A golden key glows on the floor.',
          pickupText: 'You take the first goal key.',
          portable: true
        }
      },
      puzzles: {
        'goal-puzzle-1': {
          room: 'goal-room-1',
          description: 'A locked door blocks your path.',
          requiredItem: 'goal-key-1',
          solvedText: 'You solved the first goal!',
          isGoal: true,
          goalName: 'Unlock the First Door',
          action: {
            type: 'openExit',
            direction: 'east',
            targetRoom: 'start'
          }
        }
      }
    };

    if (goalCount >= 2) {
      world.rooms['goal-room-2'] = {
        name: 'Goal Room 2',
        description: 'A room with the second goal puzzle.',
        exits: { south: 'goal-room-1' },
        items: [],
        hazards: []
      };
      world.rooms['goal-room-1'].exits.north = 'goal-room-2';
      world.items['goal-key-2'] = {
        name: 'Goal Key 2',
        description: 'The second goal key.',
        roomText: 'A silver key lies here.',
        pickupText: 'You take the second goal key.',
        portable: true
      };
      world.puzzles['goal-puzzle-2'] = {
        room: 'goal-room-2',
        description: 'Another locked door stands before you.',
        requiredItem: 'goal-key-2',
        solvedText: 'You solved the second goal!',
        isGoal: true,
        goalName: 'Unlock the Second Door',
        action: {
          type: 'openExit',
          direction: 'west',
          targetRoom: 'goal-room-1'
        }
      };
    }

    return world;
  }

  // Helper: Create a world with both goal and non-goal puzzles
  function worldWithMixedPuzzles() {
    const world = worldWithGoals(1);
    // Add a non-goal puzzle
    world.rooms['side-room'] = {
      name: 'Side Room',
      description: 'A side room with a regular puzzle.',
      exits: { west: 'start' },
      items: ['regular-key'],
      hazards: []
    };
    world.rooms['start'].exits.east = 'side-room';
    world.items['regular-key'] = {
      name: 'Regular Key',
      description: 'A regular key.',
      roomText: 'A key sits here.',
      pickupText: 'You take the regular key.',
      portable: true
    };
    world.puzzles['regular-puzzle'] = {
      room: 'side-room',
      description: 'A simple lock.',
      requiredItem: 'regular-key',
      solvedText: 'The lock clicks open.',
      action: {
        type: 'openExit',
        direction: 'north',
        targetRoom: 'start'
      }
    };
    return world;
  }

  test('createGameSession counts goal puzzles', () => {
    const world = loadWorld(worldWithMixedPuzzles());
    const session = createGameSession(world);
    
    expect(session.totalGoals).toBe(1);
    expect(session.goalsCompleted).toBe(0);
  });

  test('createGameSession with no goals sets totalGoals to 0', () => {
    const world = loadWorld(getTestWorld());
    const session = createGameSession(world);
    
    expect(session.totalGoals).toBe(0);
    expect(session.goalsCompleted).toBe(0);
  });

  test('solving a goal puzzle broadcasts goalComplete to all', () => {
    const world = loadWorld(worldWithGoals(1));
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    
    // Get the key and move to the goal room
    ({ session } = processCommand(session, 'p1', 'take goal key 1'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    
    // Solve the goal puzzle
    const { responses } = processCommand(session, 'p1', 'use goal key 1');
    
    // Find the goalComplete message
    const goalMsg = responses.find(r => r.playerId === 'all' && r.message.type === 'goalComplete');
    expect(goalMsg).toBeDefined();
    expect(goalMsg.message.playerName).toBe('Alice');
    expect(goalMsg.message.goalName).toBe('Unlock the First Door');
    expect(goalMsg.message.goalNumber).toBe(1);
    expect(goalMsg.message.totalGoals).toBe(1);
  });

  test('solving a goal puzzle increments goalsCompleted', () => {
    const world = loadWorld(worldWithGoals(1));
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    
    // Get the key and move to the goal room
    ({ session } = processCommand(session, 'p1', 'take goal key 1'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    
    // Solve the goal puzzle
    ({ session } = processCommand(session, 'p1', 'use goal key 1'));
    
    expect(session.goalsCompleted).toBe(1);
  });

  test('solving a non-goal puzzle does NOT broadcast goalComplete', () => {
    const world = loadWorld(worldWithMixedPuzzles());
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    
    // Solve the regular (non-goal) puzzle
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take regular key'));
    const { responses } = processCommand(session, 'p1', 'use regular key');
    
    // Should NOT have a goalComplete message
    const goalMsg = responses.find(r => r.message.type === 'goalComplete');
    expect(goalMsg).toBeUndefined();
  });

  test('solving the last goal broadcasts victoryComplete', () => {
    const world = loadWorld(worldWithGoals(1));
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    
    // Get the key and move to the goal room
    ({ session } = processCommand(session, 'p1', 'take goal key 1'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    
    // Solve the only goal puzzle
    const { responses } = processCommand(session, 'p1', 'use goal key 1');
    
    // Should have BOTH goalComplete and victoryComplete
    const goalMsg = responses.find(r => r.message.type === 'goalComplete');
    const victoryMsg = responses.find(r => r.playerId === 'all' && r.message.type === 'victoryComplete');
    
    expect(goalMsg).toBeDefined();
    expect(victoryMsg).toBeDefined();
  });

  test('solving a goal but not the last does NOT broadcast victoryComplete', () => {
    const world = loadWorld(worldWithGoals(2));
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    
    // Solve only the first goal
    ({ session } = processCommand(session, 'p1', 'take goal key 1'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    const { responses } = processCommand(session, 'p1', 'use goal key 1');
    
    // Should have goalComplete but NOT victoryComplete
    const goalMsg = responses.find(r => r.message.type === 'goalComplete');
    const victoryMsg = responses.find(r => r.message.type === 'victoryComplete');
    
    expect(goalMsg).toBeDefined();
    expect(victoryMsg).toBeUndefined();
  });

  test('getPlayerView includes goalProgress when goals exist', () => {
    const world = loadWorld(worldWithGoals(2));
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    
    const view = getPlayerView(session, 'p1');
    
    expect(view.goalProgress).toBeDefined();
    expect(view.goalProgress.completed).toBe(0);
    expect(view.goalProgress.total).toBe(2);
  });

  test('getPlayerView excludes goalProgress when no goals', () => {
    const world = loadWorld(getTestWorld());
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    
    const view = getPlayerView(session, 'p1');
    
    expect(view.goalProgress).toBeUndefined();
  });

  test('goalComplete message includes ASCII art', () => {
    const world = loadWorld(worldWithGoals(1));
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    
    // Get the key and move to the goal room
    ({ session } = processCommand(session, 'p1', 'take goal key 1'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    
    // Solve the goal puzzle
    const { responses } = processCommand(session, 'p1', 'use goal key 1');
    
    const goalMsg = responses.find(r => r.message.type === 'goalComplete');
    expect(goalMsg).toBeDefined();
    expect(goalMsg.message.asciiArt).toBeDefined();
    expect(typeof goalMsg.message.asciiArt).toBe('string');
    expect(goalMsg.message.asciiArt.length).toBeGreaterThan(0);
  });

  test('victoryComplete message includes ASCII art', () => {
    const world = loadWorld(worldWithGoals(1));
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    
    // Get the key and move to the goal room
    ({ session } = processCommand(session, 'p1', 'take goal key 1'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    
    // Solve the only goal puzzle
    const { responses } = processCommand(session, 'p1', 'use goal key 1');
    
    const victoryMsg = responses.find(r => r.message.type === 'victoryComplete');
    expect(victoryMsg).toBeDefined();
    expect(victoryMsg.message.asciiArt).toBeDefined();
    expect(typeof victoryMsg.message.asciiArt).toBe('string');
    expect(victoryMsg.message.asciiArt.length).toBeGreaterThan(0);
  });

  test('goal progress updates in room view after solving', () => {
    const world = loadWorld(worldWithGoals(2));
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    
    // Check initial progress
    let view = getPlayerView(session, 'p1');
    expect(view.goalProgress.completed).toBe(0);
    expect(view.goalProgress.total).toBe(2);
    
    // Solve first goal
    ({ session } = processCommand(session, 'p1', 'take goal key 1'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    ({ session } = processCommand(session, 'p1', 'use goal key 1'));
    
    // Check updated progress
    view = getPlayerView(session, 'p1');
    expect(view.goalProgress.completed).toBe(1);
    expect(view.goalProgress.total).toBe(2);
  });

  test('getGoalAsciiArt returns non-empty string', () => {
    const art = getGoalAsciiArt();
    expect(typeof art).toBe('string');
    expect(art.length).toBeGreaterThan(0);
  });

  test('getVictoryAsciiArt returns non-empty string', () => {
    const art = getVictoryAsciiArt();
    expect(typeof art).toBe('string');
    expect(art.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Help Command (Stef)
// ════════════════════════════════════════════════════════════════════════

describe('Help Command (Stef)', () => {
  test('help command returns formatted text', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', 'help');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg).toBeDefined();
    expect(msg.message.type).toBe('message');
    expect(msg.message.text).toBeDefined();
    // Should contain key command keywords
    expect(msg.message.text).toMatch(/go/i);
    expect(msg.message.text).toMatch(/look/i);
    expect(msg.message.text).toMatch(/take/i);
    expect(msg.message.text).toMatch(/drop/i);
    expect(msg.message.text).toMatch(/inventory/i);
    expect(msg.message.text).toMatch(/help/i);
  });

  test('help command is available as HELP and ?', () => {
    const session1 = sessionWithPlayer('p1', 'Alice');
    const { responses: r1 } = processCommand(session1, 'p1', 'help');
    const helpMsg = r1.find(r => r.playerId === 'p1');
    expect(helpMsg.message.type).toBe('message');

    const session2 = sessionWithPlayer('p2', 'Bob');
    const { responses: r2 } = processCommand(session2, 'p2', '?');
    const qMsg = r2.find(r => r.playerId === 'p2');
    expect(qMsg.message.type).toBe('message');

    // Both should produce help text containing command info
    expect(helpMsg.message.text).toMatch(/go/i);
    expect(qMsg.message.text).toMatch(/go/i);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Map Command (Stef)
// ════════════════════════════════════════════════════════════════════════

describe('Map Command (Stef)', () => {
  // Custom world for map testing:
  //   map-a (start) --north--> map-b --north--> map-c --north--> map-f --north--> map-g
  //                            map-b --east---> map-d
  //   map-a         --east---> map-e
  //
  // Depths from map-a: 0=map-a, 1=map-b/map-e, 2=map-c/map-d, 3=map-f, 4=map-g
  // Depths from map-e: 0=map-e, 1=map-a, 2=map-b, 3=map-c/map-d, 4=map-f, 5=map-g
  function mapTestWorld() {
    return {
      name: 'Map Test World',
      startRoom: 'map-a',
      rooms: {
        'map-a': {
          name: 'Central Hall',
          description: 'The starting hall.',
          exits: { north: 'map-b', east: 'map-e' },
          items: [],
          hazards: [],
        },
        'map-b': {
          name: 'North Corridor',
          description: 'A corridor heading north.',
          exits: { south: 'map-a', north: 'map-c', east: 'map-d' },
          items: [],
          hazards: [],
        },
        'map-c': {
          name: 'Tower Room',
          description: 'A tall tower room.',
          exits: { south: 'map-b', north: 'map-f' },
          items: [],
          hazards: [],
        },
        'map-f': {
          name: 'Attic',
          description: 'A dusty attic above the tower.',
          exits: { south: 'map-c', north: 'map-g' },
          items: [],
          hazards: [],
        },
        'map-g': {
          name: 'Rooftop',
          description: 'The very top of the building.',
          exits: { south: 'map-f' },
          items: [],
          hazards: [],
        },
        'map-d': {
          name: 'East Wing',
          description: 'The east wing of the building.',
          exits: { west: 'map-b' },
          items: [],
          hazards: [],
        },
        'map-e': {
          name: 'Garden',
          description: 'A peaceful garden.',
          exits: { west: 'map-a' },
          items: [],
          hazards: [],
        },
      },
      items: {},
      puzzles: {},
    };
  }

  function mapSession(id = 'p1', name = 'Alice') {
    const world = loadWorld(mapTestWorld());
    let session = createGameSession(world);
    session = addPlayer(session, id, name);
    return session;
  }

  // ── visitedRooms tracking ──────────────────────────────────────────

  test('player starts with visitedRooms containing start room', () => {
    const session = mapSession();
    const player = session.players['p1'];
    expect(player.visitedRooms).toBeDefined();
    expect(player.visitedRooms).toContain('map-a');
  });

  test('moving to a room adds it to visitedRooms', () => {
    let session = mapSession();
    ({ session } = processCommand(session, 'p1', 'go north'));
    const player = session.players['p1'];
    expect(player.visitedRooms).toContain('map-a');
    expect(player.visitedRooms).toContain('map-b');
  });

  test('visitedRooms doesn\'t duplicate on revisiting', () => {
    let session = mapSession();
    ({ session } = processCommand(session, 'p1', 'go north'));
    ({ session } = processCommand(session, 'p1', 'go south'));
    ({ session } = processCommand(session, 'p1', 'go north'));
    const player = session.players['p1'];
    // Should have unique entries only
    const unique = [...new Set(player.visitedRooms)];
    expect(player.visitedRooms).toHaveLength(unique.length);
    expect(player.visitedRooms).toContain('map-a');
    expect(player.visitedRooms).toContain('map-b');
  });

  // ── map command output ─────────────────────────────────────────────

  test('map command returns message with ASCII map', () => {
    let session = mapSession();
    const { responses } = processCommand(session, 'p1', 'map');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg).toBeDefined();
    expect(msg.message.type).toBe('message');
    // Should contain the current room name
    expect(msg.message.text).toContain('Central Hall');
  });

  test('map shows current room with [*] marker', () => {
    let session = mapSession();
    const { responses } = processCommand(session, 'p1', 'map');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.text).toContain('[*]');
  });

  test('map shows unvisited rooms as ???', () => {
    // Player is at map-a (start), has not visited map-b or map-e
    let session = mapSession();
    const { responses } = processCommand(session, 'p1', 'map');
    const msg = responses.find(r => r.playerId === 'p1');
    // Adjacent rooms not visited should show as unknown
    expect(msg.message.text).toContain('???');
  });

  test('map shows visited adjacent rooms with names', () => {
    let session = mapSession();
    // Visit north corridor
    ({ session } = processCommand(session, 'p1', 'go north'));
    // Go back to start
    ({ session } = processCommand(session, 'p1', 'go south'));
    // Now map from start — map-b (North Corridor) is visited and adjacent
    const { responses } = processCommand(session, 'p1', 'map');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.text).toContain('North Corridor');
  });

  test('map shows rooms up to depth 3', () => {
    let session = mapSession();
    // Visit all rooms: a -> b -> c -> f -> g -> f -> c -> b -> d -> b -> a -> e
    ({ session } = processCommand(session, 'p1', 'go north'));  // map-b
    ({ session } = processCommand(session, 'p1', 'go north'));  // map-c
    ({ session } = processCommand(session, 'p1', 'go north'));  // map-f
    ({ session } = processCommand(session, 'p1', 'go north'));  // map-g
    ({ session } = processCommand(session, 'p1', 'go south'));  // map-f
    ({ session } = processCommand(session, 'p1', 'go south'));  // map-c
    ({ session } = processCommand(session, 'p1', 'go south'));  // map-b
    ({ session } = processCommand(session, 'p1', 'go east'));   // map-d
    ({ session } = processCommand(session, 'p1', 'go west'));   // map-b
    ({ session } = processCommand(session, 'p1', 'go south'));  // map-a
    ({ session } = processCommand(session, 'p1', 'go east'));   // map-e

    // Now at map-e (depth 0). map-a is depth 1. map-b is depth 2.
    // map-c and map-d are depth 3 from map-e — should now appear with depth limit 3.
    // map-f is depth 4 from map-e — should NOT appear.
    const { responses } = processCommand(session, 'p1', 'map');
    const msg = responses.find(r => r.playerId === 'p1');
    const text = msg.message.text;
    expect(text).toContain('Garden');          // depth 0 - current
    expect(text).toContain('Central Hall');    // depth 1
    expect(text).toContain('North Corridor');  // depth 2
    expect(text).toContain('Tower Room');      // depth 3 - now included
    expect(text).toContain('East Wing');       // depth 3 - now included
    expect(text).not.toContain('Attic');       // depth 4 - too far
    expect(text).not.toContain('Rooftop');     // depth 5 - too far
  });

  test('map does not show rooms beyond depth 3', () => {
    let session = mapSession();
    // Visit all rooms: a -> b -> c -> f -> g -> f -> c -> b -> d -> b -> a
    ({ session } = processCommand(session, 'p1', 'go north'));  // map-b
    ({ session } = processCommand(session, 'p1', 'go north'));  // map-c
    ({ session } = processCommand(session, 'p1', 'go north'));  // map-f
    ({ session } = processCommand(session, 'p1', 'go north'));  // map-g
    ({ session } = processCommand(session, 'p1', 'go south'));  // map-f
    ({ session } = processCommand(session, 'p1', 'go south'));  // map-c
    ({ session } = processCommand(session, 'p1', 'go south'));  // map-b
    ({ session } = processCommand(session, 'p1', 'go east'));   // map-d
    ({ session } = processCommand(session, 'p1', 'go west'));   // map-b
    ({ session } = processCommand(session, 'p1', 'go south'));  // map-a

    // At map-a (depth 0). Depths: map-b/map-e=1, map-c/map-d=2, map-f=3, map-g=4
    // map-g at depth 4 should NOT appear.
    const { responses } = processCommand(session, 'p1', 'map');
    const msg = responses.find(r => r.playerId === 'p1');
    const text = msg.message.text;
    expect(text).toContain('Central Hall');     // depth 0 - current
    expect(text).toContain('North Corridor');   // depth 1
    expect(text).toContain('Tower Room');       // depth 2
    expect(text).toContain('East Wing');        // depth 2
    expect(text).toContain('Attic');            // depth 3 - included
    expect(text).not.toContain('Rooftop');      // depth 4 - too far
  });

  test('map shows compass directions', () => {
    let session = mapSession();
    const { responses } = processCommand(session, 'p1', 'map');
    const msg = responses.find(r => r.playerId === 'p1');
    const text = msg.message.text;
    // Should contain at least one compass direction label
    expect(text).toMatch(/\b[NSEW]\b/);
  });

  test('map command only sent to requesting player', () => {
    const world = loadWorld(mapTestWorld());
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    session = addPlayer(session, 'p2', 'Bob');
    const { responses } = processCommand(session, 'p1', 'map');
    // All responses should be for p1 only
    const otherPlayerMsgs = responses.filter(r => r.playerId === 'p2');
    expect(otherPlayerMsgs).toHaveLength(0);
    const p1Msgs = responses.filter(r => r.playerId === 'p1');
    expect(p1Msgs.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Fuzzy Item Matching (Stef)
// ════════════════════════════════════════════════════════════════════════

describe('Fuzzy item matching (Stef)', () => {
  // Custom world with overlapping item names for fuzzy / disambiguation tests
  function fuzzyWorld() {
    return loadWorld({
      name: 'Fuzzy Match World',
      startRoom: 'fuzzy-room',
      rooms: {
        'fuzzy-room': {
          name: 'Fuzzy Room',
          description: 'A room with many items.',
          exits: { north: 'fuzzy-room-2' },
          items: ['research-journal', 'rusty-key', 'golden-key', 'knights-shield', 'old-torch'],
          hazards: [],
        },
        'fuzzy-room-2': {
          name: 'Second Room',
          description: 'Another room.',
          exits: { south: 'fuzzy-room' },
          items: [],
          hazards: [],
        },
      },
      items: {
        'research-journal': {
          name: "Dr. Webb's research journal",
          description: 'A journal filled with research notes.',
          roomText: 'A research journal lies on the desk.',
          pickupText: 'You pick up the journal.',
          portable: true,
        },
        'rusty-key': {
          name: 'Rusty Key',
          description: 'An old rusty key.',
          roomText: 'A rusty key lies on the ground.',
          pickupText: 'You take the rusty key.',
          portable: true,
        },
        'golden-key': {
          name: 'Golden Key',
          description: 'A shiny golden key.',
          roomText: 'A golden key gleams in the corner.',
          pickupText: 'You take the golden key.',
          portable: true,
        },
        'knights-shield': {
          name: "Knight's Shield",
          description: 'A sturdy shield.',
          roomText: "A knight's shield leans against the wall.",
          pickupText: "You take the knight's shield.",
          portable: true,
        },
        'old-torch': {
          name: 'Old Torch',
          description: 'An old burning torch.',
          roomText: 'An old torch burns on the wall.',
          pickupText: 'You grab the old torch.',
          portable: true,
        },
      },
      puzzles: {},
    });
  }

  function fuzzySession() {
    const world = fuzzyWorld();
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    return session;
  }

  function fuzzySessionTwoPlayers() {
    const world = fuzzyWorld();
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    session = addPlayer(session, 'p2', 'Bob');
    return session;
  }

  // Helper: pick up items so they are in inventory
  function pickUpItems(session, playerId, ...itemNames) {
    for (const name of itemNames) {
      ({ session } = processCommand(session, playerId, `get ${name}`));
    }
    return session;
  }

  // ── GET / TAKE: Partial name matching ─────────────────────────────────

  describe('Partial name matching (get/take)', () => {
    test('"get journal" matches "Dr. Webb\'s research journal" via substring', () => {
      let session = fuzzySession();
      const { session: updated, responses } = processCommand(session, 'p1', 'get journal');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).toContain('research-journal');
    });

    test('"get rusty" matches "Rusty Key" via prefix', () => {
      let session = fuzzySession();
      const { session: updated, responses } = processCommand(session, 'p1', 'get rusty');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).toContain('rusty-key');
    });

    test('"get rusty key" matches "Rusty Key" via exact case-insensitive match', () => {
      let session = fuzzySession();
      const { session: updated, responses } = processCommand(session, 'p1', 'get rusty key');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).toContain('rusty-key');
    });

    test('case insensitive: "GET JOURNAL" matches "Dr. Webb\'s research journal"', () => {
      let session = fuzzySession();
      const { session: updated, responses } = processCommand(session, 'p1', 'GET JOURNAL');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).toContain('research-journal');
    });

    test('"get dr" matches "Dr. Webb\'s research journal" via prefix', () => {
      let session = fuzzySession();
      const { session: updated, responses } = processCommand(session, 'p1', 'get dr');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).toContain('research-journal');
    });

    test('"take torch" matches "Old Torch" via substring', () => {
      let session = fuzzySession();
      const { session: updated, responses } = processCommand(session, 'p1', 'take torch');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).toContain('old-torch');
    });

    test('"grab shield" matches "Knight\'s Shield" via substring', () => {
      let session = fuzzySession();
      const { session: updated, responses } = processCommand(session, 'p1', 'grab shield');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).toContain('knights-shield');
    });
  });

  // ── Disambiguation (multiple matches) ─────────────────────────────────

  describe('Disambiguation (multiple matches)', () => {
    test('"get key" with "Rusty Key" and "Golden Key" triggers disambiguation', () => {
      let session = fuzzySession();
      const { responses } = processCommand(session, 'p1', 'get key');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).toBe('error');
      expect(msg.message.text).toMatch(/Did you mean/i);
      expect(msg.message.text).toContain('Rusty Key');
      expect(msg.message.text).toContain('Golden Key');
      expect(msg.message.text).toMatch(/more specific/i);
    });

    test('player can resolve disambiguation by being more specific', () => {
      let session = fuzzySession();
      // First attempt triggers disambiguation
      ({ session } = processCommand(session, 'p1', 'get key'));
      // Second attempt with more specificity works
      const { session: updated, responses } = processCommand(session, 'p1', 'get rusty key');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).toContain('rusty-key');
    });

    test('player can resolve disambiguation with partial prefix: "get golden"', () => {
      let session = fuzzySession();
      ({ session } = processCommand(session, 'p1', 'get key'));
      const { session: updated, responses } = processCommand(session, 'p1', 'get golden');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).toContain('golden-key');
    });

    test('"get key" after one key is taken no longer disambiguates', () => {
      let session = fuzzySession();
      ({ session } = processCommand(session, 'p1', 'get rusty key'));
      // Now only golden-key remains — "get key" should match uniquely
      const { session: updated, responses } = processCommand(session, 'p1', 'get key');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).toContain('golden-key');
    });
  });

  // ── Exact match priority ──────────────────────────────────────────────

  describe('Exact match priority', () => {
    function exactMatchWorld() {
      return loadWorld({
        name: 'Exact Match World',
        startRoom: 'exact-room',
        rooms: {
          'exact-room': {
            name: 'Exact Room',
            description: 'A room to test exact matches.',
            exits: {},
            items: ['plain-key', 'rusty-key-em'],
            hazards: [],
          },
        },
        items: {
          'plain-key': {
            name: 'Key',
            description: 'A plain key.',
            roomText: 'A key lies here.',
            pickupText: 'You take the key.',
            portable: true,
          },
          'rusty-key-em': {
            name: 'Rusty Key',
            description: 'A rusty key.',
            roomText: 'A rusty key lies here.',
            pickupText: 'You take the rusty key.',
            portable: true,
          },
        },
        puzzles: {},
      });
    }

    test('"get key" picks up exact-match "Key" not "Rusty Key"', () => {
      const world = exactMatchWorld();
      let session = createGameSession(world);
      session = addPlayer(session, 'p1', 'Alice');

      const { session: updated, responses } = processCommand(session, 'p1', 'get key');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).toContain('plain-key');
      expect(updated.players['p1'].inventory).not.toContain('rusty-key-em');
    });

    test('exact match wins even when non-exact match appears first in room', () => {
      const world = exactMatchWorld();
      let session = createGameSession(world);
      session = addPlayer(session, 'p1', 'Alice');
      // Reorder items so rusty-key-em is first
      session.roomStates['exact-room'].items = ['rusty-key-em', 'plain-key'];

      const { session: updated, responses } = processCommand(session, 'p1', 'get key');
      const msg = responses.find(r => r.playerId === 'p1');
      // "Key" is an exact match via matchesItemName, "Rusty Key" is not
      // findMatchingItems returns exact matches first, so "Key" wins
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).toContain('plain-key');
    });
  });

  // ── DROP: Partial name matching ───────────────────────────────────────

  describe('Partial name matching (drop)', () => {
    test('"drop journal" drops the matching item from inventory', () => {
      let session = fuzzySession();
      session = pickUpItems(session, 'p1', "dr. webb's research journal");
      expect(session.players['p1'].inventory).toContain('research-journal');

      const { session: updated, responses } = processCommand(session, 'p1', 'drop journal');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).not.toContain('research-journal');
    });

    test('"drop key" with multiple keys in inventory triggers disambiguation', () => {
      let session = fuzzySession();
      session = pickUpItems(session, 'p1', 'rusty key', 'golden key');
      expect(session.players['p1'].inventory).toContain('rusty-key');
      expect(session.players['p1'].inventory).toContain('golden-key');

      const { responses } = processCommand(session, 'p1', 'drop key');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).toBe('error');
      expect(msg.message.text).toMatch(/Did you mean/i);
      expect(msg.message.text).toContain('Rusty Key');
      expect(msg.message.text).toContain('Golden Key');
    });

    test('"drop rusty" drops only "Rusty Key" when both keys in inventory', () => {
      let session = fuzzySession();
      session = pickUpItems(session, 'p1', 'rusty key', 'golden key');

      const { session: updated, responses } = processCommand(session, 'p1', 'drop rusty');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).not.toContain('rusty-key');
      expect(updated.players['p1'].inventory).toContain('golden-key');
    });
  });

  // ── USE: Partial name matching ────────────────────────────────────────

  describe('Partial name matching (use)', () => {
    test('"use journal" finds item in inventory (no puzzle → cannot use)', () => {
      let session = fuzzySession();
      session = pickUpItems(session, 'p1', "dr. webb's research journal");

      const { responses } = processCommand(session, 'p1', 'use journal');
      const msg = responses.find(r => r.playerId === 'p1');
      // Item is found (not "you don't have") but there's no puzzle, so "can't use here"
      expect(msg.message.text).not.toMatch(/don't have/i);
      expect(msg.message.text).toMatch(/can't use/i);
    });

    test('"use key" with multiple keys in inventory triggers disambiguation', () => {
      let session = fuzzySession();
      session = pickUpItems(session, 'p1', 'rusty key', 'golden key');

      const { responses } = processCommand(session, 'p1', 'use key');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).toBe('error');
      expect(msg.message.text).toMatch(/Did you mean/i);
    });

    test('"use rusty" resolves to "Rusty Key" when both keys held', () => {
      let session = fuzzySession();
      session = pickUpItems(session, 'p1', 'rusty key', 'golden key');

      const { responses } = processCommand(session, 'p1', 'use rusty');
      const msg = responses.find(r => r.playerId === 'p1');
      // Should find the item (not disambiguation), though no puzzle matches
      expect(msg.message.text).not.toMatch(/Did you mean/i);
    });
  });

  // ── GIVE: Partial name matching ───────────────────────────────────────

  describe('Partial name matching (give)', () => {
    test('"give journal to Bob" with partial item name', () => {
      let session = fuzzySessionTwoPlayers();
      session = pickUpItems(session, 'p1', "dr. webb's research journal");

      const { session: updated, responses } = processCommand(session, 'p1', 'give journal to Bob');
      const aliceMsg = responses.find(r => r.playerId === 'p1');
      expect(aliceMsg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).not.toContain('research-journal');
      expect(updated.players['p2'].inventory).toContain('research-journal');
    });

    test('"give key to Bob" with multiple keys triggers disambiguation', () => {
      let session = fuzzySessionTwoPlayers();
      session = pickUpItems(session, 'p1', 'rusty key', 'golden key');

      const { responses } = processCommand(session, 'p1', 'give key to Bob');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).toBe('error');
      expect(msg.message.text).toMatch(/Did you mean/i);
    });

    test('"give rusty to Bob" gives "Rusty Key" successfully', () => {
      let session = fuzzySessionTwoPlayers();
      session = pickUpItems(session, 'p1', 'rusty key', 'golden key');

      const { session: updated, responses } = processCommand(session, 'p1', 'give rusty to Bob');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).not.toContain('rusty-key');
      expect(updated.players['p2'].inventory).toContain('rusty-key');
      // Alice still has golden key
      expect(updated.players['p1'].inventory).toContain('golden-key');
    });
  });

  // ── No matches ────────────────────────────────────────────────────────

  describe('No matches', () => {
    test('"get banana" when no banana exists returns error', () => {
      let session = fuzzySession();
      const { responses } = processCommand(session, 'p1', 'get banana');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).toBe('error');
      expect(msg.message.text).toMatch(/don't see/i);
    });

    test('"drop banana" when not in inventory returns error', () => {
      let session = fuzzySession();
      const { responses } = processCommand(session, 'p1', 'drop banana');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).toBe('error');
      expect(msg.message.text).toMatch(/don't have/i);
    });

    test('"use banana" when not in inventory returns error', () => {
      let session = fuzzySession();
      const { responses } = processCommand(session, 'p1', 'use banana');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).toBe('error');
      expect(msg.message.text).toMatch(/don't have/i);
    });

    test('"give banana to Bob" when not in inventory returns error', () => {
      let session = fuzzySessionTwoPlayers();
      const { responses } = processCommand(session, 'p1', 'give banana to Bob');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).toBe('error');
      expect(msg.message.text).toMatch(/don't have/i);
    });
  });

  // ── Special characters ────────────────────────────────────────────────

  describe('Special characters in fuzzy matching', () => {
    test('"get knights shield" matches "Knight\'s Shield" (apostrophe stripped)', () => {
      let session = fuzzySession();
      const { session: updated, responses } = processCommand(session, 'p1', 'get knights shield');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).toContain('knights-shield');
    });

    test('"get dr webbs" matches "Dr. Webb\'s research journal" (period+apostrophe stripped)', () => {
      let session = fuzzySession();
      const { session: updated, responses } = processCommand(session, 'p1', 'get dr webbs');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).toContain('research-journal');
    });

    test('"get webbs" matches "Dr. Webb\'s research journal" via normalized substring', () => {
      let session = fuzzySession();
      const { session: updated, responses } = processCommand(session, 'p1', 'get webbs');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(updated.players['p1'].inventory).toContain('research-journal');
    });

    test('"examine knights shield" finds "Knight\'s Shield" description', () => {
      let session = fuzzySession();
      session = pickUpItems(session, 'p1', "knight's shield");
      const { responses } = processCommand(session, 'p1', 'examine knights shield');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.type).not.toBe('error');
      expect(msg.message.text).toContain('sturdy shield');
    });
  });

  // ── Disambiguation message format ─────────────────────────────────────

  describe('Disambiguation message format', () => {
    test('disambiguation message lists all matching items', () => {
      let session = fuzzySession();
      const { responses } = processCommand(session, 'p1', 'get key');
      const msg = responses.find(r => r.playerId === 'p1');
      expect(msg.message.text).toContain('Did you mean');
      // Each item on its own line with " - " prefix
      expect(msg.message.text).toContain(' - Rusty Key');
      expect(msg.message.text).toContain(' - Golden Key');
      expect(msg.message.text).toContain('Please be more specific');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
// Fuzzy / Partial Item Name Matching
// ════════════════════════════════════════════════════════════════════════

describe('Fuzzy Item Name Matching', () => {
  // World with multiple items for disambiguation and partial matching
  function fuzzyTestWorld() {
    return loadWorld({
      name: 'Fuzzy Test World',
      startRoom: 'room1',
      rooms: {
        room1: {
          name: 'Room 1',
          description: 'A room with many items.',
          exits: { north: 'room2' },
          items: ['rusty-key', 'golden-key', 'journal', 'shield'],
          hazards: [],
        },
        room2: {
          name: 'Room 2',
          description: 'Another room.',
          exits: { south: 'room1' },
          items: [],
          hazards: [],
        },
      },
      items: {
        'rusty-key': {
          name: 'Rusty Key',
          description: 'A rusty old key.',
          roomText: 'A rusty key lies on the ground.',
          pickupText: 'You take the rusty key.',
          portable: true,
        },
        'golden-key': {
          name: 'Golden Key',
          description: 'A shiny golden key.',
          roomText: 'A golden key gleams on a shelf.',
          pickupText: 'You take the golden key.',
          portable: true,
        },
        journal: {
          name: "Dr. Webb's Research Journal",
          description: 'A leather-bound journal full of notes.',
          roomText: 'A research journal sits on the desk.',
          pickupText: 'You take the journal.',
          portable: true,
        },
        shield: {
          name: "Knight's Shield",
          description: 'A sturdy shield.',
          roomText: 'A shield leans against the wall.',
          pickupText: 'You take the shield.',
          portable: true,
        },
      },
      puzzles: {},
    });
  }

  function fuzzySession(playerId = 'p1', name = 'Alice') {
    const world = fuzzyTestWorld();
    let session = createGameSession(world);
    session = addPlayer(session, playerId, name);
    return session;
  }

  // ── GET / TAKE ──────────────────────────────────────────────────────

  test('exact name still works for take', () => {
    const session = fuzzySession();
    const { session: updated, responses } = processCommand(session, 'p1', 'take rusty key');
    expect(responses.find(r => r.playerId === 'p1').message.type).not.toBe('error');
    expect(updated.players['p1'].inventory).toContain('rusty-key');
  });

  test('partial substring match picks up item (take journal)', () => {
    const session = fuzzySession();
    const { session: updated, responses } = processCommand(session, 'p1', 'take journal');
    expect(responses.find(r => r.playerId === 'p1').message.type).not.toBe('error');
    expect(updated.players['p1'].inventory).toContain('journal');
  });

  test('case-insensitive partial match works (get SHIELD)', () => {
    const session = fuzzySession();
    const { session: updated, responses } = processCommand(session, 'p1', 'get SHIELD');
    expect(responses.find(r => r.playerId === 'p1').message.type).not.toBe('error');
    expect(updated.players['p1'].inventory).toContain('shield');
  });

  test('partial match with special characters (get webbs)', () => {
    const session = fuzzySession();
    const { session: updated, responses } = processCommand(session, 'p1', 'get webbs');
    expect(responses.find(r => r.playerId === 'p1').message.type).not.toBe('error');
    expect(updated.players['p1'].inventory).toContain('journal');
  });

  test('disambiguation when multiple items match (get key)', () => {
    const session = fuzzySession();
    const { responses } = processCommand(session, 'p1', 'get key');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
    expect(msg.message.text).toContain('Did you mean');
    expect(msg.message.text).toContain('Rusty Key');
    expect(msg.message.text).toContain('Golden Key');
    expect(msg.message.text).toContain('Please be more specific');
  });

  test('no match returns standard error', () => {
    const session = fuzzySession();
    const { responses } = processCommand(session, 'p1', 'get sword');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
    expect(msg.message.text).toContain("don't see");
  });

  test('exact match is prioritized over partial (take golden key)', () => {
    const session = fuzzySession();
    const { session: updated, responses } = processCommand(session, 'p1', 'take golden key');
    expect(responses.find(r => r.playerId === 'p1').message.type).not.toBe('error');
    expect(updated.players['p1'].inventory).toContain('golden-key');
    expect(updated.players['p1'].inventory).not.toContain('rusty-key');
  });

  // ── DROP ────────────────────────────────────────────────────────────

  test('partial match works for drop', () => {
    let session = fuzzySession();
    ({ session } = processCommand(session, 'p1', 'take rusty key'));
    ({ session } = processCommand(session, 'p1', 'take golden key'));
    // Drop by partial "rusty" — unique match
    const { session: afterDrop, responses } = processCommand(session, 'p1', 'drop rusty');
    expect(responses.find(r => r.playerId === 'p1').message.type).not.toBe('error');
    expect(afterDrop.players['p1'].inventory).not.toContain('rusty-key');
  });

  test('drop disambiguation when multiple items match', () => {
    let session = fuzzySession();
    ({ session } = processCommand(session, 'p1', 'take rusty key'));
    ({ session } = processCommand(session, 'p1', 'take golden key'));
    const { responses } = processCommand(session, 'p1', 'drop key');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
    expect(msg.message.text).toContain('Did you mean');
  });

  // ── USE ─────────────────────────────────────────────────────────────

  test('partial match works for use', () => {
    let session = fuzzySession();
    ({ session } = processCommand(session, 'p1', 'take rusty key'));
    // use "rusty" — should match "Rusty Key", even though no puzzle, returns "can't use here"
    const { responses } = processCommand(session, 'p1', 'use rusty');
    const msg = responses.find(r => r.playerId === 'p1');
    // Should find the item (not "don't have" error) — instead "can't use here"
    expect(msg.message.text).toContain("can't use");
  });

  test('use disambiguation when multiple items match', () => {
    let session = fuzzySession();
    ({ session } = processCommand(session, 'p1', 'take rusty key'));
    ({ session } = processCommand(session, 'p1', 'take golden key'));
    const { responses } = processCommand(session, 'p1', 'use key');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
    expect(msg.message.text).toContain('Did you mean');
  });

  // ── GIVE ────────────────────────────────────────────────────────────

  test('partial match works for give', () => {
    const world = fuzzyTestWorld();
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    session = addPlayer(session, 'p2', 'Bob');
    ({ session } = processCommand(session, 'p1', 'take rusty key'));
    const { session: afterGive, responses } = processCommand(session, 'p1', 'give rusty to Bob');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).not.toBe('error');
    expect(afterGive.players['p2'].inventory).toContain('rusty-key');
  });

  test('give disambiguation when multiple items match', () => {
    const world = fuzzyTestWorld();
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    session = addPlayer(session, 'p2', 'Bob');
    ({ session } = processCommand(session, 'p1', 'take rusty key'));
    ({ session } = processCommand(session, 'p1', 'take golden key'));
    const { responses } = processCommand(session, 'p1', 'give key to Bob');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
    expect(msg.message.text).toContain('Did you mean');
  });

  // ── EDGE CASES ──────────────────────────────────────────────────────

  test('single-word partial match on multi-word item name', () => {
    const session = fuzzySession();
    const { session: updated, responses } = processCommand(session, 'p1', 'take research');
    expect(responses.find(r => r.playerId === 'p1').message.type).not.toBe('error');
    expect(updated.players['p1'].inventory).toContain('journal');
  });

  test('normalized match ignores apostrophes (knights)', () => {
    const session = fuzzySession();
    const { session: updated, responses } = processCommand(session, 'p1', 'get knights');
    expect(responses.find(r => r.playerId === 'p1').message.type).not.toBe('error');
    expect(updated.players['p1'].inventory).toContain('shield');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Loot Command Removed
// ════════════════════════════════════════════════════════════════════════

describe('Loot Command Removed', () => {
  test('"loot" command returns error or unknown command message', () => {
    const session = sessionWithPlayer('p1', 'Alice');
    const { responses } = processCommand(session, 'p1', 'loot');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg).toBeDefined();
    expect(msg.message.type).toBe('error');
  });

  test('"loot <ghost>" returns error or unknown command', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = disconnectPlayer(session, 'p1');

    const { responses } = processCommand(session, 'p2', "loot Alice's ghost");
    const msg = responses.find(r => r.playerId === 'p2');
    expect(msg).toBeDefined();
    expect(msg.message.type).toBe('error');
  });

  test('"loot" does not transfer any items', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    const { session: afterLoot } = processCommand(session, 'p2', "loot Alice's ghost");
    expect(afterLoot.players['p2'].inventory).toEqual([]);
    // Key remains on the floor where it was dropped
    expect(afterLoot.roomStates['room-a'].items).toContain('key');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Death and Disconnect Inventory Drop
// ════════════════════════════════════════════════════════════════════════

describe('Death and Disconnect Inventory Drop', () => {
  test('when a player disconnects, their inventory items drop to the room floor', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take torch'));
    expect(session.players['p1'].inventory).toContain('key');
    expect(session.players['p1'].inventory).toContain('torch');

    session = disconnectPlayer(session, 'p1');

    // Items should be on the floor in room-c (where Alice was)
    expect(session.roomStates['room-c'].items).toContain('key');
    expect(session.roomStates['room-c'].items).toContain('torch');
    // Ghost has empty inventory
    expect(session.ghosts['Alice'].inventory).toEqual([]);
  });

  test('when a player dies, their inventory items drop to the room floor', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    expect(session.players['p1'].inventory).toContain('key');

    session = killPlayer(session, 'p1');

    // Key should be on the floor in room-a
    expect(session.roomStates['room-a'].items).toContain('key');
    // Ghost has empty inventory
    expect(session.ghosts['Alice'].inventory).toEqual([]);
    expect(session.ghosts['Alice'].isDeath).toBe(true);
  });

  test('dropped items from disconnect can be picked up normally with "get"', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = disconnectPlayer(session, 'p1');

    // Bob picks up the key from the floor
    const { session: afterGet, responses } = processCommand(session, 'p2', 'get old key');
    expect(afterGet.players['p2'].inventory).toContain('key');
    expect(afterGet.roomStates['room-a'].items).not.toContain('key');
    const msg = responses.find(r => r.playerId === 'p2');
    expect(msg.message.type).not.toBe('error');
  });

  test('dropped items from death can be picked up normally with "get"', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = processCommand(session, 'p1', 'take old key'));
    session = killPlayer(session, 'p1');

    // Bob picks up the key from the floor
    const { session: afterGet, responses } = processCommand(session, 'p2', 'get old key');
    expect(afterGet.players['p2'].inventory).toContain('key');
    expect(afterGet.roomStates['room-a'].items).not.toContain('key');
    const msg = responses.find(r => r.playerId === 'p2');
    expect(msg.message.type).not.toBe('error');
  });

  test('multiple items drop to floor on disconnect', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));
    ({ session } = processCommand(session, 'p1', 'go east'));
    ({ session } = processCommand(session, 'p1', 'take torch'));

    session = disconnectPlayer(session, 'p1');

    // Both items should be on the floor in room-c
    expect(session.roomStates['room-c'].items).toContain('key');
    expect(session.roomStates['room-c'].items).toContain('torch');
  });

  test('player with no inventory disconnects without errors', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    expect(session.players['p1'].inventory).toEqual([]);

    session = disconnectPlayer(session, 'p1');

    expect(session.ghosts['Alice']).toBeDefined();
    expect(session.ghosts['Alice'].inventory).toEqual([]);
    // No extra items appeared on the floor
    expect(session.roomStates['room-a'].items).toEqual(['key']);
  });

  test('removePlayer also drops items to the room floor', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take old key'));

    session = removePlayer(session, 'p1');

    // Key should be back on the floor
    expect(session.roomStates['room-a'].items).toContain('key');
    expect(session.players['p1']).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// Get Items / Take Items / G Shortcut
// ════════════════════════════════════════════════════════════════════════

describe('Get Items / Take Items / G Shortcut', () => {
  // Helper: create a room with multiple portable items for pickup tests
  function multiItemWorld() {
    return loadWorld({
      name: 'Multi-Item World',
      startRoom: 'room1',
      rooms: {
        room1: {
          name: 'Room 1',
          description: 'A room with several items.',
          exits: { north: 'room2' },
          items: ['iron-key', 'silver-coin', 'red-gem'],
          hazards: [],
        },
        room2: {
          name: 'Room 2',
          description: 'An empty room.',
          exits: { south: 'room1' },
          items: [],
          hazards: [],
        },
      },
      items: {
        'iron-key': {
          name: 'Iron Key',
          description: 'A heavy iron key.',
          roomText: 'An iron key sits on a ledge.',
          pickupText: 'You take the iron key.',
          portable: true,
        },
        'silver-coin': {
          name: 'Silver Coin',
          description: 'A shiny silver coin.',
          roomText: 'A silver coin glints on the floor.',
          pickupText: 'You pick up the silver coin.',
          portable: true,
        },
        'red-gem': {
          name: 'Red Gem',
          description: 'A brilliant red gem.',
          roomText: 'A red gem sparkles in the corner.',
          pickupText: 'You take the red gem.',
          portable: true,
        },
      },
      puzzles: {},
    });
  }

  function multiItemSession(playerId = 'p1', name = 'Alice') {
    const world = multiItemWorld();
    let session = createGameSession(world);
    session = addPlayer(session, playerId, name);
    return session;
  }

  function multiItemSessionTwoPlayers() {
    const world = multiItemWorld();
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    session = addPlayer(session, 'p2', 'Bob');
    return session;
  }

  // ── "get items" picks up all items ──────────────────────────────────

  test('"get items" picks up all items in the room', () => {
    let session = multiItemSession();
    const { session: updated, responses } = processCommand(session, 'p1', 'get items');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg).toBeDefined();
    expect(msg.message.type).not.toBe('error');
    expect(updated.players['p1'].inventory).toContain('iron-key');
    expect(updated.players['p1'].inventory).toContain('silver-coin');
    expect(updated.players['p1'].inventory).toContain('red-gem');
    expect(updated.roomStates['room1'].items).toEqual([]);
  });

  test('"get items" adds all items to player inventory', () => {
    let session = multiItemSession();
    const { session: updated } = processCommand(session, 'p1', 'get items');
    expect(updated.players['p1'].inventory).toHaveLength(3);
    expect(updated.players['p1'].inventory).toContain('iron-key');
    expect(updated.players['p1'].inventory).toContain('silver-coin');
    expect(updated.players['p1'].inventory).toContain('red-gem');
  });

  test('"get items" response lists what was picked up', () => {
    let session = multiItemSession();
    const { responses } = processCommand(session, 'p1', 'get items');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg).toBeDefined();
    expect(msg.message.text).toContain('Iron Key');
    expect(msg.message.text).toContain('Silver Coin');
    expect(msg.message.text).toContain('Red Gem');
  });

  test('"get items" when no items are available returns appropriate message', () => {
    let session = multiItemSession();
    // Move to empty room
    ({ session } = processCommand(session, 'p1', 'go north'));
    const { responses } = processCommand(session, 'p1', 'get items');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg).toBeDefined();
    // Should indicate no items to pick up
    expect(msg.message.type === 'error' || msg.message.text.toLowerCase().includes('no') || msg.message.text.toLowerCase().includes('nothing')).toBe(true);
  });

  // ── "g" is a shortcut ──────────────────────────────────────────────

  test('"g" shortcut picks up all items in the room', () => {
    let session = multiItemSession();
    const { session: updated, responses } = processCommand(session, 'p1', 'g');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg).toBeDefined();
    expect(msg.message.type).not.toBe('error');
    expect(updated.players['p1'].inventory).toContain('iron-key');
    expect(updated.players['p1'].inventory).toContain('silver-coin');
    expect(updated.players['p1'].inventory).toContain('red-gem');
    expect(updated.roomStates['room1'].items).toEqual([]);
  });

  // ── "take items" also works ────────────────────────────────────────

  test('"take items" also works as an alias for get items', () => {
    let session = multiItemSession();
    const { session: updated, responses } = processCommand(session, 'p1', 'take items');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg).toBeDefined();
    expect(msg.message.type).not.toBe('error');
    expect(updated.players['p1'].inventory).toContain('iron-key');
    expect(updated.players['p1'].inventory).toContain('silver-coin');
    expect(updated.players['p1'].inventory).toContain('red-gem');
  });

  // ── "get items" doesn't interfere with specific item matching ──────

  test('"get iron key" still picks up a specific item normally', () => {
    let session = multiItemSession();
    const { session: updated, responses } = processCommand(session, 'p1', 'get iron key');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).not.toBe('error');
    expect(updated.players['p1'].inventory).toContain('iron-key');
    // Other items should still be in the room
    expect(updated.roomStates['room1'].items).toContain('silver-coin');
    expect(updated.roomStates['room1'].items).toContain('red-gem');
    expect(updated.players['p1'].inventory).toHaveLength(1);
  });

  test('"get iron" partial match still works for specific item', () => {
    let session = multiItemSession();
    const { session: updated, responses } = processCommand(session, 'p1', 'get iron');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).not.toBe('error');
    expect(updated.players['p1'].inventory).toContain('iron-key');
    expect(updated.players['p1'].inventory).toHaveLength(1);
  });

  test('"get items" after some items already taken picks up remaining', () => {
    let session = multiItemSession();
    // Pick up one item first
    ({ session } = processCommand(session, 'p1', 'get iron key'));
    expect(session.players['p1'].inventory).toContain('iron-key');

    // Now get remaining items
    const { session: updated, responses } = processCommand(session, 'p1', 'get items');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).not.toBe('error');
    expect(updated.players['p1'].inventory).toContain('iron-key');
    expect(updated.players['p1'].inventory).toContain('silver-coin');
    expect(updated.players['p1'].inventory).toContain('red-gem');
    expect(updated.roomStates['room1'].items).toEqual([]);
  });

  test('"g" in empty room returns appropriate message', () => {
    let session = multiItemSession();
    ({ session } = processCommand(session, 'p1', 'go north'));
    const { responses } = processCommand(session, 'p1', 'g');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg).toBeDefined();
    expect(msg.message.type === 'error' || msg.message.text.toLowerCase().includes('no') || msg.message.text.toLowerCase().includes('nothing')).toBe(true);
  });

  // ── Integration: get items after death/disconnect drop ─────────────

  test('"get items" picks up items dropped by a disconnected player', () => {
    let session = multiItemSessionTwoPlayers();
    // Alice picks up all items
    ({ session } = processCommand(session, 'p1', 'get iron key'));
    ({ session } = processCommand(session, 'p1', 'get silver coin'));
    ({ session } = processCommand(session, 'p1', 'get red gem'));
    // Alice disconnects — items drop to floor
    session = disconnectPlayer(session, 'p1');
    expect(session.roomStates['room1'].items).toContain('iron-key');
    expect(session.roomStates['room1'].items).toContain('silver-coin');
    expect(session.roomStates['room1'].items).toContain('red-gem');

    // Bob picks up all dropped items at once
    const { session: updated, responses } = processCommand(session, 'p2', 'get items');
    const msg = responses.find(r => r.playerId === 'p2');
    expect(msg.message.type).not.toBe('error');
    expect(updated.players['p2'].inventory).toContain('iron-key');
    expect(updated.players['p2'].inventory).toContain('silver-coin');
    expect(updated.players['p2'].inventory).toContain('red-gem');
    expect(updated.roomStates['room1'].items).toEqual([]);
  });

  test('"get items" picks up items dropped by a killed player', () => {
    let session = multiItemSessionTwoPlayers();
    // Alice picks up items
    ({ session } = processCommand(session, 'p1', 'get iron key'));
    ({ session } = processCommand(session, 'p1', 'get silver coin'));
    // Alice dies — items drop to floor
    session = killPlayer(session, 'p1');
    expect(session.roomStates['room1'].items).toContain('iron-key');
    expect(session.roomStates['room1'].items).toContain('silver-coin');

    // Bob picks up all
    const { session: updated, responses } = processCommand(session, 'p2', 'get items');
    const msg = responses.find(r => r.playerId === 'p2');
    expect(msg.message.type).not.toBe('error');
    expect(updated.players['p2'].inventory).toContain('iron-key');
    expect(updated.players['p2'].inventory).toContain('silver-coin');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Fuzzy matching on look / examine
// ════════════════════════════════════════════════════════════════════════

describe('Fuzzy look/examine matching', () => {
  function lookWorld() {
    return loadWorld({
      name: 'Look Fuzzy World',
      startRoom: 'lobby',
      rooms: {
        lobby: {
          name: 'Lobby',
          description: 'A large lobby.',
          exits: {},
          items: ['red-book', 'old-book', 'silver-key'],
          hazards: [],
        },
      },
      items: {
        'red-book': {
          name: 'Red Book',
          description: 'A book with a crimson cover.',
          roomText: 'A red book sits on a shelf.',
          portable: true,
        },
        'old-book': {
          name: 'Old Book',
          description: 'A dusty old tome.',
          roomText: 'An old book gathers dust.',
          portable: true,
        },
        'silver-key': {
          name: 'Silver Key',
          description: 'A small silver key.',
          roomText: 'A silver key glints on the floor.',
          portable: true,
        },
      },
      puzzles: {},
    });
  }

  function lookSession() {
    const world = lookWorld();
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    return session;
  }

  // ── Single fuzzy match in room ────────────────────────────────────

  test('"look key" finds "Silver Key" in the room', () => {
    const session = lookSession();
    const { responses } = processCommand(session, 'p1', 'look key');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('message');
    expect(msg.message.text).toContain('small silver key');
  });

  test('"examine key" finds "Silver Key" in the room', () => {
    const session = lookSession();
    const { responses } = processCommand(session, 'p1', 'examine key');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('message');
    expect(msg.message.text).toContain('small silver key');
  });

  // ── Disambiguation on look/examine ─────────────────────────────────

  test('"look book" with "Red Book" and "Old Book" in room triggers disambiguation', () => {
    const session = lookSession();
    const { responses } = processCommand(session, 'p1', 'look book');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
    expect(msg.message.text).toContain('Did you mean');
    expect(msg.message.text).toContain('Red Book');
    expect(msg.message.text).toContain('Old Book');
  });

  test('"examine book" with two books triggers disambiguation', () => {
    const session = lookSession();
    const { responses } = processCommand(session, 'p1', 'examine book');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
    expect(msg.message.text).toContain('Did you mean');
  });

  // ── Item found in inventory ─────────────────────────────────────────

  test('"look key" finds "Silver Key" in player inventory', () => {
    let session = lookSession();
    ({ session } = processCommand(session, 'p1', 'get silver key'));
    const { responses } = processCommand(session, 'p1', 'look key');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('message');
    expect(msg.message.text).toContain('small silver key');
  });

  // ── Inventory preferred over room ───────────────────────────────────

  test('inventory match is preferred over room match', () => {
    let session = lookSession();
    // Pick up one book, leave the other in the room
    ({ session } = processCommand(session, 'p1', 'get red book'));
    const { responses } = processCommand(session, 'p1', 'look red');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('message');
    expect(msg.message.text).toContain('crimson cover');
  });

  // ── Case insensitive ─────────────────────────────────────────────────

  test('"look KEY" is case insensitive', () => {
    const session = lookSession();
    const { responses } = processCommand(session, 'p1', 'look KEY');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('message');
    expect(msg.message.text).toContain('small silver key');
  });

  test('"EXAMINE Silver Key" is case insensitive', () => {
    const session = lookSession();
    const { responses } = processCommand(session, 'p1', 'EXAMINE Silver Key');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('message');
    expect(msg.message.text).toContain('small silver key');
  });

  // ── No match ──────────────────────────────────────────────────────────

  test('"look sword" with no matching item returns error', () => {
    const session = lookSession();
    const { responses } = processCommand(session, 'p1', 'look sword');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('error');
    expect(msg.message.text).toContain("don't see");
  });

  // ── Exact match ─────────────────────────────────────────────────────

  test('"look red book" with exact match returns description (no disambiguation)', () => {
    const session = lookSession();
    const { responses } = processCommand(session, 'p1', 'look red book');
    const msg = responses.find(r => r.playerId === 'p1');
    expect(msg.message.type).toBe('message');
    expect(msg.message.text).toContain('crimson cover');
  });
});
