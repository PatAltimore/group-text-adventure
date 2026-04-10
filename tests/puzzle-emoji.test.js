import { describe, test, expect } from '@jest/globals';
import {
  loadWorld,
  createGameSession,
  addPlayer,
  processCommand,
  getPlayerView,
} from '../api/src/game-engine.js';

// ════════════════════════════════════════════════════════════════════════
// Puzzle Emoji Feature Tests
// ════════════════════════════════════════════════════════════════════════
//
// Three features under test:
//   1. Puzzle Room Emoji in Room Titles (getPlayerView)
//   2. Puzzle Emoji on Map (handleMap)
//   3. Camera Item Disambiguation (Alcatraz bug fix)
//
// Written TDD-style: tests define expected behavior before Mouth's
// implementation is complete. Some may fail until engine code lands.
// ════════════════════════════════════════════════════════════════════════

// ── Inline test world ──────────────────────────────────────────────────

const WORLD_DATA = {
  name: 'Puzzle Emoji Test World',
  startRoom: 'hub',
  rooms: {
    hub: {
      name: 'Central Hub',
      description: 'A central hub connecting all test rooms.',
      exits: {
        north: 'unsolved-room',
        east: 'solved-room',
        south: 'multi-puzzle-room',
        west: 'no-puzzle-room',
      },
      items: ['red-key', 'blue-key', 'green-key', 'yellow-key'],
      hazards: [],
    },
    'unsolved-room': {
      name: 'Unsolved Puzzle Room',
      description: 'A room with an unsolved puzzle.',
      exits: { south: 'hub' },
      items: [],
      hazards: [],
    },
    'solved-room': {
      name: 'Solved Puzzle Room',
      description: 'A room with a solved puzzle.',
      exits: { west: 'hub' },
      items: [],
      hazards: [],
    },
    'multi-puzzle-room': {
      name: 'Double Lock Chamber',
      description: 'A chamber with two puzzles.',
      exits: { north: 'hub' },
      items: [],
      hazards: [],
    },
    'no-puzzle-room': {
      name: 'Simple Room',
      description: 'A plain room with no puzzles.',
      exits: { east: 'hub', north: 'adjacent-puzzle-room', south: 'alcatraz-room' },
      items: [],
      hazards: [],
    },
    'adjacent-puzzle-room': {
      name: 'Adjacent Puzzle Room',
      description: 'A room next to the simple room, with a puzzle.',
      exits: { south: 'no-puzzle-room' },
      items: [],
      hazards: [],
    },
    'alcatraz-room': {
      name: 'Alcatraz Ghost Cell',
      description: 'A spooky cell where camera disambiguation matters.',
      exits: { north: 'no-puzzle-room' },
      items: ['full-spectrum-camera', 'verification-instructions'],
      hazards: [],
    },
  },
  items: {
    'red-key': {
      name: 'Red Key',
      description: 'A red key.',
      roomText: 'A red key rests here.',
      pickupText: 'You pick up the red key.',
      portable: true,
    },
    'blue-key': {
      name: 'Blue Key',
      description: 'A blue key.',
      roomText: 'A blue key rests here.',
      pickupText: 'You pick up the blue key.',
      portable: true,
    },
    'green-key': {
      name: 'Green Key',
      description: 'A green key.',
      roomText: 'A green key rests here.',
      pickupText: 'You pick up the green key.',
      portable: true,
    },
    'yellow-key': {
      name: 'Yellow Key',
      description: 'A yellow key.',
      roomText: 'A yellow key rests here.',
      pickupText: 'You pick up the yellow key.',
      portable: true,
    },
    'full-spectrum-camera': {
      name: 'Full-Spectrum Camera',
      description: 'A high-tech camera for detecting ghosts.',
      roomText: 'A full-spectrum camera sits on a shelf.',
      pickupText: 'You pick up the camera.',
      portable: true,
    },
    'verification-instructions': {
      name: 'Verification Instructions',
      description: 'Instructions for verifying ghost containment.',
      roomText: 'A document titled "Verification Instructions" lies on the floor.',
      pickupText: 'You pick up the instructions.',
      portable: true,
    },
  },
  puzzles: {
    'unsolved-puzzle': {
      room: 'unsolved-room',
      description: 'A locked door.',
      requiredItem: 'red-key',
      solvedText: 'The red key unlocks the door!',
      action: { type: 'openExit', direction: 'east', targetRoom: 'hub' },
    },
    'solved-puzzle': {
      room: 'solved-room',
      description: 'A lock already opened.',
      requiredItem: 'blue-key',
      solvedText: 'The blue key clicks into place!',
      action: { type: 'openExit', direction: 'north', targetRoom: 'hub' },
    },
    'multi-puzzle-1': {
      room: 'multi-puzzle-room',
      description: 'The first lock.',
      requiredItem: 'green-key',
      solvedText: 'The first lock opens!',
      action: { type: 'openExit', direction: 'east', targetRoom: 'hub' },
    },
    'multi-puzzle-2': {
      room: 'multi-puzzle-room',
      description: 'The second lock.',
      requiredItem: 'yellow-key',
      solvedText: 'The second lock opens!',
      action: { type: 'openExit', direction: 'west', targetRoom: 'hub' },
    },
    'adjacent-puzzle': {
      room: 'adjacent-puzzle-room',
      description: 'A puzzle in the adjacent room.',
      requiredItem: 'red-key',
      solvedText: 'Puzzle solved!',
      action: { type: 'openExit', direction: 'east', targetRoom: 'hub' },
    },
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────

function cloneWorld() {
  return JSON.parse(JSON.stringify(WORLD_DATA));
}

function freshSession() {
  const world = loadWorld(cloneWorld());
  const session = createGameSession(world);
  // Pre-solve the 'solved-puzzle' so solved-room starts with all puzzles solved
  session.puzzleStates['solved-puzzle'] = { solved: true };
  return session;
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

/** Navigate player to target room. */
function goToRoom(session, playerId, targetRoom) {
  const directionMap = {
    'unsolved-room': 'north',
    'solved-room': 'east',
    'multi-puzzle-room': 'south',
    'no-puzzle-room': 'west',
    'adjacent-puzzle-room': 'west north', // two hops: west then north
    'alcatraz-room': 'west south', // two hops: west then south
  };
  const dirs = directionMap[targetRoom];
  if (!dirs) return session;
  
  const steps = dirs.split(' ');
  for (const dir of steps) {
    ({ session } = processCommand(session, playerId, `go ${dir}`));
  }
  return session;
}

// ════════════════════════════════════════════════════════════════════════
// Feature 1: Puzzle Room Emoji in Room Titles (getPlayerView)
// ════════════════════════════════════════════════════════════════════════

describe('Feature 1: Puzzle Room Emoji in Room Titles', () => {
  
  describe('unsolved puzzle shows 🧩 prefix', () => {
    test('room with unsolved puzzle gets 🧩 prefix', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = goToRoom(session, 'p1', 'unsolved-room');
      const view = getPlayerView(session, 'p1');
      expect(view.name).toBe('🧩 Unsolved Puzzle Room');
    });

    test('room with multiple puzzles, some solved some not, gets 🧩', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      // Pick up green key and solve first puzzle
      ({ session } = processCommand(session, 'p1', 'take Green Key'));
      session = goToRoom(session, 'p1', 'multi-puzzle-room');
      ({ session } = processCommand(session, 'p1', 'use Green Key'));
      
      const view = getPlayerView(session, 'p1');
      // Only one of two puzzles solved — should still show 🧩
      expect(view.name).toBe('🧩 Double Lock Chamber');
    });
  });

  describe('all puzzles solved shows ✅ prefix', () => {
    test('room with single solved puzzle gets ✅ prefix', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = goToRoom(session, 'p1', 'solved-room');
      const view = getPlayerView(session, 'p1');
      expect(view.name).toBe('✅ Solved Puzzle Room');
    });

    test('room with multiple puzzles all solved gets ✅', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      // Pick up both keys
      ({ session } = processCommand(session, 'p1', 'take Green Key'));
      ({ session } = processCommand(session, 'p1', 'take Yellow Key'));
      session = goToRoom(session, 'p1', 'multi-puzzle-room');
      
      // Solve both puzzles
      ({ session } = processCommand(session, 'p1', 'use Green Key'));
      ({ session } = processCommand(session, 'p1', 'use Yellow Key'));
      
      const view = getPlayerView(session, 'p1');
      expect(view.name).toBe('✅ Double Lock Chamber');
    });
  });

  describe('no puzzle shows no prefix', () => {
    test('room with no puzzles gets no prefix', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = goToRoom(session, 'p1', 'no-puzzle-room');
      const view = getPlayerView(session, 'p1');
      expect(view.name).toBe('Simple Room');
    });

    test('starting hub room with no puzzles gets no prefix', () => {
      const session = sessionWithPlayer('p1', 'Alice');
      const view = getPlayerView(session, 'p1');
      expect(view.name).toBe('Central Hub');
    });
  });

  describe('puzzle state transition (🧩 → ✅)', () => {
    test('room transitions from 🧩 to ✅ after solving puzzle', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      ({ session } = processCommand(session, 'p1', 'take Red Key'));
      session = goToRoom(session, 'p1', 'unsolved-room');
      
      // Before solving
      let view = getPlayerView(session, 'p1');
      expect(view.name).toBe('🧩 Unsolved Puzzle Room');
      
      // Solve puzzle
      ({ session } = processCommand(session, 'p1', 'use Red Key'));
      
      // After solving
      view = getPlayerView(session, 'p1');
      expect(view.name).toBe('✅ Unsolved Puzzle Room');
    });

    test('emoji persists after leaving and returning', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      ({ session } = processCommand(session, 'p1', 'take Red Key'));
      session = goToRoom(session, 'p1', 'unsolved-room');
      ({ session } = processCommand(session, 'p1', 'use Red Key'));
      
      // Leave
      ({ session } = processCommand(session, 'p1', 'go south'));
      // Return
      ({ session } = processCommand(session, 'p1', 'go north'));
      
      const view = getPlayerView(session, 'p1');
      expect(view.name).toBe('✅ Unsolved Puzzle Room');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
// Feature 2: Puzzle Emoji on Map
// ════════════════════════════════════════════════════════════════════════

describe('Feature 2: Puzzle Emoji on Map', () => {
  
  test('current room with unsolved puzzle shows 🧩 in map', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    session = goToRoom(session, 'p1', 'unsolved-room');
    
    const { responses } = processCommand(session, 'p1', 'map');
    const mapMsg = responses.find(r => r.playerId === 'p1' && r.message.type === 'message');
    expect(mapMsg).toBeDefined();
    // Current room is trimmed to 20 chars, so just check for the prefix
    expect(mapMsg.message.text).toContain('🧩 Unsolved Puzzle');
  });

  test('current room with all puzzles solved shows ✅ in map', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    session = goToRoom(session, 'p1', 'solved-room');
    
    const { responses } = processCommand(session, 'p1', 'map');
    const mapMsg = responses.find(r => r.playerId === 'p1' && r.message.type === 'message');
    expect(mapMsg).toBeDefined();
    expect(mapMsg.message.text).toContain('✅ Solved Puzzle Room');
  });

  test('adjacent visited room with unsolved puzzle shows 🧩 in map', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    // Visit unsolved-room then go back to hub
    session = goToRoom(session, 'p1', 'unsolved-room');
    ({ session } = processCommand(session, 'p1', 'go south'));
    
    const { responses } = processCommand(session, 'p1', 'map');
    const mapMsg = responses.find(r => r.playerId === 'p1' && r.message.type === 'message');
    expect(mapMsg).toBeDefined();
    // Room name is trimmed to 18 chars for depth-1, so verify prefix is present
    expect(mapMsg.message.text).toContain('🧩 Unsolved Puzzl');
  });

  test('adjacent visited room with solved puzzle shows ✅ in map', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    // Visit solved-room then go back to hub
    session = goToRoom(session, 'p1', 'solved-room');
    ({ session } = processCommand(session, 'p1', 'go west'));
    
    const { responses } = processCommand(session, 'p1', 'map');
    const mapMsg = responses.find(r => r.playerId === 'p1' && r.message.type === 'message');
    expect(mapMsg).toBeDefined();
    // Room name is trimmed, so just check for ✅ prefix
    expect(mapMsg.message.text).toContain('✅ Solved Puzzle');
  });

  test('rooms without puzzles show plain names in map', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    session = goToRoom(session, 'p1', 'no-puzzle-room');
    ({ session } = processCommand(session, 'p1', 'go east')); // back to hub
    
    const { responses } = processCommand(session, 'p1', 'map');
    const mapMsg = responses.find(r => r.playerId === 'p1' && r.message.type === 'message');
    expect(mapMsg).toBeDefined();
    expect(mapMsg.message.text).toContain('Simple Room');
    expect(mapMsg.message.text).not.toContain('🧩 Simple Room');
    expect(mapMsg.message.text).not.toContain('✅ Simple Room');
  });

  test('map reflects ✅ after solving a puzzle', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take Red Key'));
    session = goToRoom(session, 'p1', 'unsolved-room');
    
    // Map before solving
    let result = processCommand(session, 'p1', 'map');
    session = result.session;
    let mapMsg = result.responses.find(r => r.playerId === 'p1' && r.message.type === 'message');
    expect(mapMsg.message.text).toContain('🧩 Unsolved Puzzle');
    
    // Solve puzzle
    ({ session } = processCommand(session, 'p1', 'use Red Key'));
    
    // Map after solving
    result = processCommand(session, 'p1', 'map');
    mapMsg = result.responses.find(r => r.playerId === 'p1' && r.message.type === 'message');
    expect(mapMsg.message.text).toContain('✅ Unsolved Puzzle');
  });

  test('depth-2 rooms show correct emoji prefixes', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    // Visit no-puzzle-room, then adjacent-puzzle-room (depth-2 from hub)
    session = goToRoom(session, 'p1', 'no-puzzle-room');
    session = goToRoom(session, 'p1', 'adjacent-puzzle-room');
    ({ session } = processCommand(session, 'p1', 'go south')); // back to no-puzzle-room
    ({ session } = processCommand(session, 'p1', 'go east')); // back to hub
    
    const { responses } = processCommand(session, 'p1', 'map');
    const mapMsg = responses.find(r => r.playerId === 'p1' && r.message.type === 'message');
    expect(mapMsg).toBeDefined();
    // Should show adjacent-puzzle-room at depth-2 with 🧩 (trimmed to 16 chars at depth-2)
    expect(mapMsg.message.text).toContain('🧩 Adjacent Puz');
  });

  test('multi-puzzle room shows 🧩 when partially solved, ✅ when fully solved', () => {
    let session = sessionWithPlayer('p1', 'Alice');
    ({ session } = processCommand(session, 'p1', 'take Green Key'));
    ({ session } = processCommand(session, 'p1', 'take Yellow Key'));
    session = goToRoom(session, 'p1', 'multi-puzzle-room');
    
    // Solve first puzzle only
    ({ session } = processCommand(session, 'p1', 'use Green Key'));
    ({ session } = processCommand(session, 'p1', 'go north')); // back to hub
    
    // Map should show 🧩 (not all solved)
    let result = processCommand(session, 'p1', 'map');
    session = result.session;
    let mapMsg = result.responses.find(r => r.playerId === 'p1' && r.message.type === 'message');
    expect(mapMsg.message.text).toContain('🧩 Double Lock');
    
    // Go back and solve second puzzle
    session = goToRoom(session, 'p1', 'multi-puzzle-room');
    ({ session } = processCommand(session, 'p1', 'use Yellow Key'));
    ({ session } = processCommand(session, 'p1', 'go north')); // back to hub
    
    // Map should show ✅ (all solved)
    result = processCommand(session, 'p1', 'map');
    mapMsg = result.responses.find(r => r.playerId === 'p1' && r.message.type === 'message');
    expect(mapMsg.message.text).toContain('✅ Double Lock');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Feature 3: Camera Item Disambiguation (Alcatraz bug fix)
// ════════════════════════════════════════════════════════════════════════

describe('Feature 3: Camera Item Disambiguation', () => {
  
  describe('camera search should not match renamed instructions', () => {
    test('"use camera" matches only Full-Spectrum Camera, not Verification Instructions', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = goToRoom(session, 'p1', 'alcatraz-room');
      
      // Pick up both items
      ({ session } = processCommand(session, 'p1', 'take Full-Spectrum Camera'));
      ({ session } = processCommand(session, 'p1', 'take Verification Instructions'));
      
      // Use "camera" — should match only the camera
      const { session: afterUse, responses } = processCommand(session, 'p1', 'use camera');
      
      // Should either use the camera or say it's not useful here, but NOT disambiguate
      const response = responses.find(r => r.playerId === 'p1');
      expect(response).toBeDefined();
      expect(response.message.text).not.toContain('Did you mean');
      expect(response.message.text).not.toContain('Verification Instructions');
    });

    test('"take camera" from room matches only Full-Spectrum Camera', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = goToRoom(session, 'p1', 'alcatraz-room');
      
      const { session: afterTake, responses } = processCommand(session, 'p1', 'take camera');
      
      const response = responses.find(r => r.playerId === 'p1');
      expect(response).toBeDefined();
      expect(response.message.text).toContain('Full-Spectrum Camera');
      expect(response.message.text).not.toContain('Did you mean');
    });

    test('"examine camera" shows camera description (disambiguation test)', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = goToRoom(session, 'p1', 'alcatraz-room');
      
      // Examine camera — should show the camera's description, not instructions
      const { responses } = processCommand(session, 'p1', 'examine camera');
      
      const response = responses.find(r => r.playerId === 'p1');
      expect(response).toBeDefined();
      // The description field confirms it matched the camera, not instructions
      expect(response.message.text).toContain('high-tech camera');
      expect(response.message.text).not.toContain('Did you mean');
      expect(response.message.text).not.toContain('Verification');
    });
  });

  describe('full and full-spectrum searches', () => {
    test('"use full" matches Full-Spectrum Camera only', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = goToRoom(session, 'p1', 'alcatraz-room');
      ({ session } = processCommand(session, 'p1', 'take Full-Spectrum Camera'));
      ({ session } = processCommand(session, 'p1', 'take Verification Instructions'));
      
      const { responses } = processCommand(session, 'p1', 'use full');
      const response = responses.find(r => r.playerId === 'p1');
      expect(response).toBeDefined();
      expect(response.message.text).not.toContain('Did you mean');
      expect(response.message.text).not.toContain('Verification Instructions');
    });

    test('"use full spectrum camera" matches Full-Spectrum Camera', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = goToRoom(session, 'p1', 'alcatraz-room');
      ({ session } = processCommand(session, 'p1', 'take Full-Spectrum Camera'));
      ({ session } = processCommand(session, 'p1', 'take Verification Instructions'));
      
      const { responses } = processCommand(session, 'p1', 'use full spectrum camera');
      const response = responses.find(r => r.playerId === 'p1');
      expect(response).toBeDefined();
      expect(response.message.text).not.toContain('Did you mean');
    });

    test('"use full-spectrum camera" with hyphen matches Full-Spectrum Camera', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = goToRoom(session, 'p1', 'alcatraz-room');
      ({ session } = processCommand(session, 'p1', 'take Full-Spectrum Camera'));
      
      const { responses } = processCommand(session, 'p1', 'use full-spectrum camera');
      const response = responses.find(r => r.playerId === 'p1');
      expect(response).toBeDefined();
      expect(response.message.text).not.toContain('Did you mean');
    });
  });

  describe('verification instructions searches', () => {
    test('"use verification" matches Verification Instructions only', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = goToRoom(session, 'p1', 'alcatraz-room');
      ({ session } = processCommand(session, 'p1', 'take Full-Spectrum Camera'));
      ({ session } = processCommand(session, 'p1', 'take Verification Instructions'));
      
      const { responses } = processCommand(session, 'p1', 'use verification');
      const response = responses.find(r => r.playerId === 'p1');
      expect(response).toBeDefined();
      expect(response.message.text).not.toContain('Did you mean');
      expect(response.message.text).not.toContain('Full-Spectrum Camera');
    });

    test('"use instructions" matches Verification Instructions only', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = goToRoom(session, 'p1', 'alcatraz-room');
      ({ session } = processCommand(session, 'p1', 'take Full-Spectrum Camera'));
      ({ session } = processCommand(session, 'p1', 'take Verification Instructions'));
      
      const { responses } = processCommand(session, 'p1', 'use instructions');
      const response = responses.find(r => r.playerId === 'p1');
      expect(response).toBeDefined();
      expect(response.message.text).not.toContain('Did you mean');
      expect(response.message.text).not.toContain('Full-Spectrum Camera');
    });
  });

  describe('fuzzy matching and disambiguation', () => {
    test('ambiguous search with multiple valid matches still disambiguates', () => {
      // This tests that fuzzy matching still works for truly ambiguous cases
      // For example, if we had "red camera" and "blue camera", searching "camera"
      // should disambiguate. But we don't have that case in this world.
      // This test verifies the disambiguation system still works in general.
      
      let session = sessionWithPlayer('p1', 'Alice');
      // Take multiple keys with same pattern
      ({ session } = processCommand(session, 'p1', 'take Red Key'));
      ({ session } = processCommand(session, 'p1', 'take Blue Key'));
      
      // "use key" should disambiguate (both match "key")
      const { responses } = processCommand(session, 'p1', 'use key');
      const response = responses.find(r => r.playerId === 'p1');
      expect(response).toBeDefined();
      expect(response.message.text).toContain('Did you mean');
      expect(response.message.text).toContain('Red Key');
      expect(response.message.text).toContain('Blue Key');
    });

    test('single fuzzy match does not trigger disambiguation', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      ({ session } = processCommand(session, 'p1', 'take Red Key'));
      
      // "use red" should match only red key (no disambiguation)
      const { responses } = processCommand(session, 'p1', 'use red');
      const response = responses.find(r => r.playerId === 'p1');
      expect(response).toBeDefined();
      expect(response.message.text).not.toContain('Did you mean');
    });
  });

  describe('edge cases', () => {
    test('empty search term returns error, not disambiguation', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      session = goToRoom(session, 'p1', 'alcatraz-room');
      
      const { responses } = processCommand(session, 'p1', 'use');
      const response = responses.find(r => r.playerId === 'p1');
      expect(response).toBeDefined();
      expect(response.message.type).toBe('error');
    });

    test('no matching items returns appropriate error', () => {
      let session = sessionWithPlayer('p1', 'Alice');
      
      const { responses } = processCommand(session, 'p1', 'use unicorn');
      const response = responses.find(r => r.playerId === 'p1');
      expect(response).toBeDefined();
      expect(response.message.text).toContain("don't have");
    });
  });
});
