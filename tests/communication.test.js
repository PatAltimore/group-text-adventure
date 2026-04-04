import { describe, test, expect } from '@jest/globals';
import { parseCommand } from '../api/src/command-parser.js';
import {
  loadWorld,
  createGameSession,
  addPlayer,
  processCommand,
} from '../api/src/game-engine.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const testWorldData = require('./test-world.json');

// ── Helpers ────────────────────────────────────────────────────────────

function getTestWorld() {
  return JSON.parse(JSON.stringify(testWorldData));
}

function freshSession() {
  const world = loadWorld(getTestWorld());
  return createGameSession(world);
}

function sessionWithPlayers(...players) {
  let session = freshSession();
  for (const [id, name] of players) {
    session = addPlayer(session, id, name);
  }
  return session;
}

/** Move a player via the engine, return updated session */
function movePlayer(session, playerId, direction) {
  const result = processCommand(session, playerId, `go ${direction}`);
  return result.session;
}

/** Place a player directly into a specific room (bypasses exits) */
function placePlayer(session, playerId, roomId) {
  session.players[playerId].room = roomId;
  return session;
}

/** Get all responses targeted at a specific player */
function responsesFor(responses, playerId) {
  return responses.filter(r => r.playerId === playerId);
}

/** Get the first response targeted at a specific player */
function responseFor(responses, playerId) {
  return responses.find(r => r.playerId === playerId);
}

// ════════════════════════════════════════════════════════════════════════
// COMMAND PARSER — say / yell
// ════════════════════════════════════════════════════════════════════════

describe('Command Parser — say', () => {
  test('parses "say hello" → verb=say, noun="hello"', () => {
    const result = parseCommand('say hello');
    expect(result.verb).toBe('say');
    expect(result.noun).toBe('hello');
  });

  test('captures full phrase: "say hello world"', () => {
    const result = parseCommand('say hello world');
    expect(result.verb).toBe('say');
    expect(result.noun).toBe('hello world');
  });

  test('case insensitive: "SAY hello"', () => {
    const result = parseCommand('SAY hello');
    expect(result.verb).toBe('say');
    expect(result.noun).toBe('hello');
  });

  test('"Say Hello World" mixed case', () => {
    const result = parseCommand('Say Hello World');
    expect(result.verb).toBe('say');
    // noun should be lowercased per parser convention
    expect(result.noun).toBe('hello world');
  });

  test('"say" with no argument returns say verb with no noun', () => {
    const result = parseCommand('say');
    expect(result.verb).toBe('say');
    expect(result.noun).toBeFalsy();
  });

  test('"say" preserves raw text', () => {
    const result = parseCommand('say hello world');
    expect(result.raw).toBe('say hello world');
  });

  test('"say" with extra whitespace', () => {
    const result = parseCommand('  say   hello   world  ');
    expect(result.verb).toBe('say');
    expect(result.noun).toBe('hello world');
  });

  test('"say" with special characters', () => {
    const result = parseCommand('say hello! how are you?');
    expect(result.verb).toBe('say');
    expect(result.noun).toBe('hello! how are you?');
  });
});

describe('Command Parser — yell', () => {
  test('parses "yell help me" → verb=yell, noun="help me"', () => {
    const result = parseCommand('yell help me');
    expect(result.verb).toBe('yell');
    expect(result.noun).toBe('help me');
  });

  test('captures full phrase: "yell is anyone there"', () => {
    const result = parseCommand('yell is anyone there');
    expect(result.verb).toBe('yell');
    expect(result.noun).toBe('is anyone there');
  });

  test('case insensitive: "YELL fire"', () => {
    const result = parseCommand('YELL fire');
    expect(result.verb).toBe('yell');
  });

  test('"yell" with no argument returns yell verb with no noun', () => {
    const result = parseCommand('yell');
    expect(result.verb).toBe('yell');
    expect(result.noun).toBeFalsy();
  });

  test('"yell" preserves raw text', () => {
    const result = parseCommand('yell help me');
    expect(result.raw).toBe('yell help me');
  });
});

// ════════════════════════════════════════════════════════════════════════
// GAME ENGINE — say (room-local communication)
// ════════════════════════════════════════════════════════════════════════

describe('Game Engine — say command', () => {

  // ── Basic same-room delivery ──────────────────────────────────────

  test('other player in SAME room receives "PlayerName says: <text>"', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    // Both start in room-a
    const { responses } = processCommand(session, 'p1', 'say hello');
    const bobMsg = responseFor(responses, 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text).toContain('Alice');
    expect(bobMsg.message.text).toContain('hello');
  });

  test('saying player gets confirmation of what they said', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    const { responses } = processCommand(session, 'p1', 'say hello');
    const aliceMsg = responseFor(responses, 'p1');
    expect(aliceMsg).toBeDefined();
    expect(aliceMsg.message.text).toContain('hello');
  });

  test('player in OTHER room receives NOTHING', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = movePlayer(session, 'p2', 'north'); // Bob → room-b
    const { responses } = processCommand(session, 'p1', 'say secret message');
    const bobMsg = responseFor(responses, 'p2');
    expect(bobMsg).toBeUndefined();
  });

  // ── Multiple players ──────────────────────────────────────────────

  test('multiple players in room ALL get the message', () => {
    const session = sessionWithPlayers(
      ['p1', 'Alice'], ['p2', 'Bob'], ['p3', 'Charlie']
    );
    const { responses } = processCommand(session, 'p1', 'say hey everyone');
    const bobMsg = responseFor(responses, 'p2');
    const charlieMsg = responseFor(responses, 'p3');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text).toContain('hey everyone');
    expect(charlieMsg).toBeDefined();
    expect(charlieMsg.message.text).toContain('hey everyone');
  });

  test('only one other player in room — they get the message', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    const { responses } = processCommand(session, 'p1', 'say just us');
    const bobMsg = responseFor(responses, 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text).toContain('just us');
  });

  test('no other players in room — saying player still gets feedback', () => {
    const session = sessionWithPlayers(['p1', 'Alice']);
    const { responses } = processCommand(session, 'p1', 'say hello?');
    const aliceMsg = responseFor(responses, 'p1');
    expect(aliceMsg).toBeDefined();
    expect(aliceMsg.message.type).not.toBe('error');
  });

  // ── Error / edge cases ────────────────────────────────────────────

  test('say with no text → error feedback', () => {
    const session = sessionWithPlayers(['p1', 'Alice']);
    const { responses } = processCommand(session, 'p1', 'say');
    const msg = responseFor(responses, 'p1');
    expect(msg).toBeDefined();
    expect(msg.message.type).toBe('error');
  });

  test('say with special characters works', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    const { responses } = processCommand(session, 'p1', 'say hello! @#$% ???');
    const bobMsg = responseFor(responses, 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text).toContain('hello! @#$% ???');
  });

  test('say with very long text does not break', () => {
    const longText = 'a'.repeat(1000);
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    const { responses } = processCommand(session, 'p1', `say ${longText}`);
    const bobMsg = responseFor(responses, 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text).toContain(longText);
  });

  test('player who just joined can say immediately', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    // p2 just joined, still in start room — should be able to say
    const { responses } = processCommand(session, 'p2', 'say hi alice');
    const aliceMsg = responseFor(responses, 'p1');
    expect(aliceMsg).toBeDefined();
    expect(aliceMsg.message.text).toContain('hi alice');
  });

  test('say does not leak to non-same-room players when mixed rooms', () => {
    let session = sessionWithPlayers(
      ['p1', 'Alice'], ['p2', 'Bob'], ['p3', 'Charlie']
    );
    session = movePlayer(session, 'p3', 'north'); // Charlie → room-b
    const { responses } = processCommand(session, 'p1', 'say room a only');
    const bobMsg = responseFor(responses, 'p2');
    const charlieMsg = responseFor(responses, 'p3');
    expect(bobMsg).toBeDefined();
    expect(charlieMsg).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// GAME ENGINE — yell (multi-room communication with distance)
// ════════════════════════════════════════════════════════════════════════

describe('Game Engine — yell command', () => {

  // ── Same room ─────────────────────────────────────────────────────

  test('same room: other players receive the yelled text', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    const { responses } = processCommand(session, 'p1', 'yell fire');
    const bobMsg = responseFor(responses, 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text).toContain('fire');
  });

  test('same room: yeller gets "players look annoyed" feedback', () => {
    const session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    const { responses } = processCommand(session, 'p1', 'yell fire');
    const aliceMsg = responseFor(responses, 'p1');
    expect(aliceMsg).toBeDefined();
    // Expect some indication that same-room players are annoyed
    expect(aliceMsg.message.text.toLowerCase()).toMatch(/annoyed|loudly|yell/);
  });

  // ── Adjacent room (1 room away) ──────────────────────────────────

  test('adjacent room: players hear the yelled text', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    // Alice in room-a, Bob in room-b (adjacent via north)
    session = movePlayer(session, 'p2', 'north');
    const { responses } = processCommand(session, 'p1', 'yell help me');
    const bobMsg = responseFor(responses, 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text).toContain('help me');
  });

  test('adjacent room: players told which direction it came from', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    // Alice in room-a, Bob in room-b. room-b connects to room-a via "south"
    session = movePlayer(session, 'p2', 'north');
    const { responses } = processCommand(session, 'p1', 'yell over here');
    const bobMsg = responseFor(responses, 'p2');
    expect(bobMsg).toBeDefined();
    // Bob should be told the yelling comes from the south (room-b → room-a is south)
    expect(bobMsg.message.text.toLowerCase()).toContain('south');
  });

  test('direction accuracy: room-c player hears yell from room-a as "from the west"', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    // Alice in room-a, Bob in room-c. room-c connects to room-a via "west"
    session = movePlayer(session, 'p2', 'east');
    const { responses } = processCommand(session, 'p1', 'yell hello');
    const bobMsg = responseFor(responses, 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text.toLowerCase()).toContain('west');
  });

  // ── Non-adjacent room (2+ rooms away) ─────────────────────────────

  test('non-adjacent room (2+ away): players hear "muffled yelling"', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    // Alice in room-a, move Bob to room-d (2 rooms away: room-a → room-b → room-d)
    // Need to solve the puzzle first or place directly
    session = placePlayer(session, 'p2', 'room-d');
    const { responses } = processCommand(session, 'p1', 'yell hello out there');
    const bobMsg = responseFor(responses, 'p2');
    expect(bobMsg).toBeDefined();
    // Should hear muffled yelling but NOT the actual text
    expect(bobMsg.message.text.toLowerCase()).toContain('muffled');
    expect(bobMsg.message.text).not.toContain('hello out there');
  });

  test('non-adjacent room: general direction indicated', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    // Alice in room-a, Bob in room-d (via room-b)
    session = placePlayer(session, 'p2', 'room-d');
    const { responses } = processCommand(session, 'p1', 'yell hey');
    const bobMsg = responseFor(responses, 'p2');
    expect(bobMsg).toBeDefined();
    // Should give some directional hint (room-d connects to room-b via south)
    expect(bobMsg.message.text.toLowerCase()).toMatch(/south|somewhere|distance/);
  });

  // ── Multiple adjacent rooms ───────────────────────────────────────

  test('yell in room-a reaches both room-b AND room-c players', () => {
    let session = sessionWithPlayers(
      ['p1', 'Alice'], ['p2', 'Bob'], ['p3', 'Charlie']
    );
    session = movePlayer(session, 'p2', 'north'); // Bob → room-b
    session = movePlayer(session, 'p3', 'east');  // Charlie → room-c
    const { responses } = processCommand(session, 'p1', 'yell anyone there');
    const bobMsg = responseFor(responses, 'p2');
    const charlieMsg = responseFor(responses, 'p3');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text).toContain('anyone there');
    expect(charlieMsg).toBeDefined();
    expect(charlieMsg.message.text).toContain('anyone there');
  });

  test('hub room with 3+ exits: yell reaches all adjacent rooms', () => {
    let session = sessionWithPlayers(
      ['p1', 'Alice'], ['p2', 'Bob'], ['p3', 'Charlie'], ['p4', 'Diana']
    );
    // Place Alice in hub, others in each connected room
    session = placePlayer(session, 'p1', 'room-hub');
    session = placePlayer(session, 'p2', 'room-hub-n');
    session = placePlayer(session, 'p3', 'room-hub-e');
    session = placePlayer(session, 'p4', 'room-hub-w');
    const { responses } = processCommand(session, 'p1', 'yell echo');
    const bobMsg = responseFor(responses, 'p2');
    const charlieMsg = responseFor(responses, 'p3');
    const dianaMsg = responseFor(responses, 'p4');
    expect(bobMsg).toBeDefined();
    expect(charlieMsg).toBeDefined();
    expect(dianaMsg).toBeDefined();
    // Each should hear it from the correct direction
    expect(bobMsg.message.text.toLowerCase()).toContain('south');   // hub-n → hub via south
    expect(charlieMsg.message.text.toLowerCase()).toContain('west'); // hub-e → hub via west
    expect(dianaMsg.message.text.toLowerCase()).toContain('east');  // hub-w → hub via east
  });

  // ── Room with no exits (dead end) ─────────────────────────────────

  test('room with no exits: yell works for same-room players', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = placePlayer(session, 'p1', 'room-isolated');
    session = placePlayer(session, 'p2', 'room-isolated');
    const { responses } = processCommand(session, 'p1', 'yell help');
    const bobMsg = responseFor(responses, 'p2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg.message.text).toContain('help');
  });

  // ── Error / edge cases ────────────────────────────────────────────

  test('yelling with no text → error', () => {
    const session = sessionWithPlayers(['p1', 'Alice']);
    const { responses } = processCommand(session, 'p1', 'yell');
    const msg = responseFor(responses, 'p1');
    expect(msg).toBeDefined();
    expect(msg.message.type).toBe('error');
  });

  test('no other players anywhere → yeller gets appropriate feedback', () => {
    const session = sessionWithPlayers(['p1', 'Alice']);
    const { responses } = processCommand(session, 'p1', 'yell anyone?');
    const msg = responseFor(responses, 'p1');
    expect(msg).toBeDefined();
    // Should get some kind of feedback, not silence
    expect(msg.message.text).toBeTruthy();
  });

  test('very long yell text does not break', () => {
    const longText = 'help '.repeat(200).trim();
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = movePlayer(session, 'p2', 'north');
    const { responses } = processCommand(session, 'p1', `yell ${longText}`);
    // Should not throw and should produce responses
    expect(responses).toBeDefined();
    expect(responses.length).toBeGreaterThan(0);
  });

  test('player who just joined can yell immediately', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    session = movePlayer(session, 'p2', 'north');
    // p1 just joined, still in start room — should be able to yell
    const { responses } = processCommand(session, 'p1', 'yell hello');
    const bobMsg = responseFor(responses, 'p2');
    expect(bobMsg).toBeDefined();
  });

  test('yell does not modify game state (no side effects)', () => {
    let session = sessionWithPlayers(['p1', 'Alice'], ['p2', 'Bob']);
    const roomBefore = session.players['p1'].room;
    const invBefore = [...session.players['p1'].inventory];
    processCommand(session, 'p1', 'yell test');
    expect(session.players['p1'].room).toBe(roomBefore);
    expect(session.players['p1'].inventory).toEqual(invBefore);
  });
});
