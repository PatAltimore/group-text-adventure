import { describe, test, expect } from '@jest/globals';
import {
  loadWorld,
  createGameSession,
  addPlayer,
  processCommand,
  getPlayerView,
} from '../api/src/game-engine.js';

// ════════════════════════════════════════════════════════════════════════
// Solved Description Feature Tests
// ════════════════════════════════════════════════════════════════════════
//
// When a room has a `solvedDescription` field and ALL puzzles in that
// room are solved, `getPlayerView()` should return `solvedDescription`
// instead of the normal `description`.
//
// Written TDD-style: tests define the expected behaviour before
// Mouth's implementation is complete. Some may fail until the engine
// code lands.
// ════════════════════════════════════════════════════════════════════════

// ── Inline test world ──────────────────────────────────────────────────

const WORLD_DATA = {
  name: 'Solved Description Test World',
  startRoom: 'start',
  rooms: {
    start: {
      name: 'Starting Room',
      description: 'A plain starting room.',
      exits: {
        north: 'puzzle-room',
        east: 'no-sd-room',
        south: 'multi-puzzle-room',
        west: 'unrelated-room',
      },
      items: ['magic-gem', 'bronze-coin', 'silver-key', 'gold-ring'],
      hazards: [],
    },
    'puzzle-room': {
      name: 'Enchanted Library',
      description: 'A dusty library filled with cobwebs.',
      solvedDescription: 'The library sparkles with magical light. The cobwebs are gone.',
      exits: { south: 'start' },
      items: [],
      hazards: [],
    },
    'no-sd-room': {
      name: 'Simple Lock Room',
      description: 'A room with a locked door.',
      // No solvedDescription — backward-compat test
      exits: { west: 'start' },
      items: [],
      hazards: [],
    },
    'multi-puzzle-room': {
      name: 'Double Lock Chamber',
      description: 'A chamber with two sealed mechanisms.',
      solvedDescription: 'The chamber hums with energy. Both mechanisms are active.',
      exits: { north: 'start' },
      items: [],
      hazards: [],
    },
    'unrelated-room': {
      name: 'Quiet Garden',
      description: 'A peaceful garden.',
      exits: { east: 'start' },
      items: [],
      hazards: [],
    },
    'sd-no-puzzle-room': {
      name: 'Decorative Hall',
      description: 'A grand hall with painted walls.',
      solvedDescription: 'This should never appear because there are no puzzles here.',
      exits: {},
      items: [],
      hazards: [],
    },
  },
  items: {
    'magic-gem': {
      name: 'Magic Gem',
      description: 'A glowing gem.',
      roomText: 'A glowing gem sits on the floor.',
      pickupText: 'You pick up the gem.',
      portable: true,
    },
    'bronze-coin': {
      name: 'Bronze Coin',
      description: 'An old coin.',
      roomText: 'A bronze coin lies here.',
      pickupText: 'You take the coin.',
      portable: true,
    },
    'silver-key': {
      name: 'Silver Key',
      description: 'A silver key.',
      roomText: 'A silver key rests here.',
      pickupText: 'You pick up the silver key.',
      portable: true,
    },
    'gold-ring': {
      name: 'Gold Ring',
      description: 'A golden ring.',
      roomText: 'A golden ring gleams here.',
      pickupText: 'You take the gold ring.',
      portable: true,
    },
  },
  puzzles: {
    'library-curse': {
      room: 'puzzle-room',
      description: 'A magical curse covers the library in cobwebs.',
      requiredItem: 'magic-gem',
      solvedText: 'The gem glows brightly and the curse shatters!',
      action: { type: 'openExit', direction: 'north', targetRoom: 'start' },
    },
    'simple-lock': {
      room: 'no-sd-room',
      description: 'A simple lock on the door.',
      requiredItem: 'bronze-coin',
      solvedText: 'The coin clicks into place and the door opens!',
      action: { type: 'openExit', direction: 'east', targetRoom: 'start' },
    },
    'mechanism-1': {
      room: 'multi-puzzle-room',
      description: 'The first mechanism needs a key.',
      requiredItem: 'silver-key',
      solvedText: 'The first mechanism whirs to life!',
      action: { type: 'openExit', direction: 'east', targetRoom: 'start' },
    },
    'mechanism-2': {
      room: 'multi-puzzle-room',
      description: 'The second mechanism needs a ring.',
      requiredItem: 'gold-ring',
      solvedText: 'The second mechanism activates!',
      action: { type: 'openExit', direction: 'west', targetRoom: 'start' },
    },
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────

function cloneWorld() {
  return JSON.parse(JSON.stringify(WORLD_DATA));
}

function freshSession() {
  const world = loadWorld(cloneWorld());
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

/** Pick up all items named in `names`, then navigate the player to `room`. */
function setupPlayer(session, playerId, itemNames, targetRoom) {
  for (const name of itemNames) {
    ({ session } = processCommand(session, playerId, `take ${name}`));
  }
  // Navigate to target room (simple one-hop — all puzzle rooms exit from start)
  const directionMap = {
    'puzzle-room': 'north',
    'no-sd-room': 'east',
    'multi-puzzle-room': 'south',
    'unrelated-room': 'west',
  };
  const dir = directionMap[targetRoom];
  if (dir) {
    ({ session } = processCommand(session, playerId, `go ${dir}`));
  }
  return session;
}

// ════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════

describe('Solved Description Feature', () => {
  // ── 1. Basic behaviour: unsolved room shows normal description ──────

  describe('unsolved room description', () => {
    test('room with solvedDescription shows normal description when puzzle is unsolved', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = setupPlayer(session, 'p1', [], 'puzzle-room');
      const view = getPlayerView(session, 'p1');
      expect(view.description).toBe('A dusty library filled with cobwebs.');
    });

    test('room with solvedDescription and multiple puzzles shows normal description when none solved', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = setupPlayer(session, 'p1', [], 'multi-puzzle-room');
      const view = getPlayerView(session, 'p1');
      expect(view.description).toBe('A chamber with two sealed mechanisms.');
    });
  });

  // ── 2. Solved state: description changes after puzzle solved ────────

  describe('solved room shows solvedDescription', () => {
    test('room description changes to solvedDescription after puzzle is solved', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = setupPlayer(session, 'p1', ['Magic Gem'], 'puzzle-room');
      ({ session } = processCommand(session, 'p1', 'use Magic Gem'));
      const view = getPlayerView(session, 'p1');
      expect(view.description).toBe(
        'The library sparkles with magical light. The cobwebs are gone.'
      );
    });

    test('solvedDescription persists on subsequent looks', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = setupPlayer(session, 'p1', ['Magic Gem'], 'puzzle-room');
      ({ session } = processCommand(session, 'p1', 'use Magic Gem'));

      // First look
      let view = getPlayerView(session, 'p1');
      expect(view.description).toBe(
        'The library sparkles with magical light. The cobwebs are gone.'
      );

      // Leave and come back
      ({ session } = processCommand(session, 'p1', 'go south'));
      ({ session } = processCommand(session, 'p1', 'go north'));
      view = getPlayerView(session, 'p1');
      expect(view.description).toBe(
        'The library sparkles with magical light. The cobwebs are gone.'
      );
    });
  });

  // ── 3. Backward compatibility ──────────────────────────────────────

  describe('backward compatibility', () => {
    test('room WITHOUT solvedDescription shows normal description even after puzzle solved', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = setupPlayer(session, 'p1', ['Bronze Coin'], 'no-sd-room');
      ({ session } = processCommand(session, 'p1', 'use Bronze Coin'));
      const view = getPlayerView(session, 'p1');
      expect(view.description).toBe('A room with a locked door.');
    });

    test('room with solvedDescription but NO puzzles shows normal description', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      // Teleport player to the room with no puzzles
      session.players['p1'].room = 'sd-no-puzzle-room';
      const view = getPlayerView(session, 'p1');
      expect(view.description).toBe('A grand hall with painted walls.');
    });
  });

  // ── 4. Multiple puzzles ────────────────────────────────────────────

  describe('multiple puzzles in one room', () => {
    test('solvedDescription NOT shown when only first of two puzzles is solved', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = setupPlayer(session, 'p1', ['Silver Key'], 'multi-puzzle-room');
      ({ session } = processCommand(session, 'p1', 'use Silver Key'));

      const view = getPlayerView(session, 'p1');
      // Only one of two puzzles solved — should still show normal description
      expect(view.description).toBe('A chamber with two sealed mechanisms.');
    });

    test('solvedDescription NOT shown when only second of two puzzles is solved', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = setupPlayer(session, 'p1', ['Gold Ring'], 'multi-puzzle-room');
      ({ session } = processCommand(session, 'p1', 'use Gold Ring'));

      const view = getPlayerView(session, 'p1');
      expect(view.description).toBe('A chamber with two sealed mechanisms.');
    });

    test('solvedDescription shown when ALL puzzles in room are solved', () => {
      let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
      // Alice picks up Silver Key, Bob picks up Gold Ring
      ({ session } = processCommand(session, 'p1', 'take Silver Key'));
      ({ session } = processCommand(session, 'p2', 'take Gold Ring'));

      // Both go south to multi-puzzle-room
      ({ session } = processCommand(session, 'p1', 'go south'));
      ({ session } = processCommand(session, 'p2', 'go south'));

      // Alice solves first puzzle
      ({ session } = processCommand(session, 'p1', 'use Silver Key'));
      // Bob solves second puzzle
      ({ session } = processCommand(session, 'p2', 'use Gold Ring'));

      const view = getPlayerView(session, 'p1');
      expect(view.description).toBe(
        'The chamber hums with energy. Both mechanisms are active.'
      );
    });
  });

  // ── 5. Room isolation: solving puzzle in room A does not affect B ──

  describe('room isolation', () => {
    test('solving puzzle in puzzle-room does not change unrelated-room description', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = setupPlayer(session, 'p1', ['Magic Gem'], 'puzzle-room');
      ({ session } = processCommand(session, 'p1', 'use Magic Gem'));

      // Verify puzzle-room changed
      let view = getPlayerView(session, 'p1');
      expect(view.description).toBe(
        'The library sparkles with magical light. The cobwebs are gone.'
      );

      // Go back to start, then to unrelated-room
      ({ session } = processCommand(session, 'p1', 'go south'));
      ({ session } = processCommand(session, 'p1', 'go west'));
      view = getPlayerView(session, 'p1');
      expect(view.description).toBe('A peaceful garden.');
    });

    test('solving puzzle in puzzle-room does not change no-sd-room description', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = setupPlayer(session, 'p1', ['Magic Gem'], 'puzzle-room');
      ({ session } = processCommand(session, 'p1', 'use Magic Gem'));

      ({ session } = processCommand(session, 'p1', 'go south'));
      ({ session } = processCommand(session, 'p1', 'go east'));
      const view = getPlayerView(session, 'p1');
      expect(view.description).toBe('A room with a locked door.');
    });
  });

  // ── 6. Player view integration via processCommand ──────────────────

  describe('getPlayerView integration', () => {
    test('look command returns solvedDescription in room view after puzzle solved', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = setupPlayer(session, 'p1', ['Magic Gem'], 'puzzle-room');
      ({ session } = processCommand(session, 'p1', 'use Magic Gem'));

      const { responses } = processCommand(session, 'p1', 'look');
      const lookMsg = responses.find(
        (r) => r.playerId === 'p1' && r.message.type === 'look'
      );
      expect(lookMsg).toBeDefined();
      expect(lookMsg.message.room.description).toBe(
        'The library sparkles with magical light. The cobwebs are gone.'
      );
    });

    test('room view embedded in use-command response shows solvedDescription', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = setupPlayer(session, 'p1', ['Magic Gem'], 'puzzle-room');
      const { responses } = processCommand(session, 'p1', 'use Magic Gem');

      // The engine sends a 'look' response after solving a puzzle
      const lookMsg = responses.find(
        (r) => r.playerId === 'p1' && r.message.type === 'look'
      );
      expect(lookMsg).toBeDefined();
      expect(lookMsg.message.room.description).toBe(
        'The library sparkles with magical light. The cobwebs are gone.'
      );
    });

    test('entering a room with already-solved puzzle shows solvedDescription', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = setupPlayer(session, 'p1', ['Magic Gem'], 'puzzle-room');
      ({ session } = processCommand(session, 'p1', 'use Magic Gem'));

      // Leave
      ({ session } = processCommand(session, 'p1', 'go south'));
      // Re-enter
      const { session: afterReturn, responses } = processCommand(
        session,
        'p1',
        'go north'
      );

      const lookMsg = responses.find(
        (r) => r.playerId === 'p1' && r.message.type === 'look'
      );
      expect(lookMsg).toBeDefined();
      expect(lookMsg.message.room.description).toBe(
        'The library sparkles with magical light. The cobwebs are gone.'
      );
    });
  });

  // ── 7. Multiplayer ─────────────────────────────────────────────────

  describe('multiplayer', () => {
    test('second player in room sees solvedDescription after first player solves puzzle', () => {
      let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);

      // Alice picks up gem
      ({ session } = processCommand(session, 'p1', 'take Magic Gem'));
      // Both go north to puzzle-room
      ({ session } = processCommand(session, 'p1', 'go north'));
      ({ session } = processCommand(session, 'p2', 'go north'));

      // Alice solves the puzzle
      ({ session } = processCommand(session, 'p1', 'use Magic Gem'));

      // Bob checks the room
      const bobView = getPlayerView(session, 'p2');
      expect(bobView.description).toBe(
        'The library sparkles with magical light. The cobwebs are gone.'
      );
    });

    test('player who joins the room AFTER puzzle was solved sees solvedDescription', () => {
      let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);

      ({ session } = processCommand(session, 'p1', 'take Magic Gem'));
      ({ session } = processCommand(session, 'p1', 'go north'));
      // Alice solves the puzzle alone
      ({ session } = processCommand(session, 'p1', 'use Magic Gem'));

      // Bob arrives later
      ({ session } = processCommand(session, 'p2', 'go north'));
      const bobView = getPlayerView(session, 'p2');
      expect(bobView.description).toBe(
        'The library sparkles with magical light. The cobwebs are gone.'
      );
    });

    test('both players see normal description before puzzle is solved', () => {
      let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
      ({ session } = processCommand(session, 'p1', 'go north'));
      ({ session } = processCommand(session, 'p2', 'go north'));

      const aliceView = getPlayerView(session, 'p1');
      const bobView = getPlayerView(session, 'p2');
      expect(aliceView.description).toBe('A dusty library filled with cobwebs.');
      expect(bobView.description).toBe('A dusty library filled with cobwebs.');
    });

    test('solving a puzzle updates description for all players simultaneously', () => {
      let session = sessionWithPlayers(
        ['p1', 'Alice'],
        ['p2', 'Bob'],
        ['p3', 'Charlie']
      );

      ({ session } = processCommand(session, 'p1', 'take Magic Gem'));
      ({ session } = processCommand(session, 'p1', 'go north'));
      ({ session } = processCommand(session, 'p2', 'go north'));
      ({ session } = processCommand(session, 'p3', 'go north'));

      // Alice solves it — check everyone sees the update
      ({ session } = processCommand(session, 'p1', 'use Magic Gem'));

      for (const pid of ['p1', 'p2', 'p3']) {
        const view = getPlayerView(session, pid);
        expect(view.description).toBe(
          'The library sparkles with magical light. The cobwebs are gone.'
        );
      }
    });
  });
});
