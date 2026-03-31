import { describe, test, expect } from '@jest/globals';
import { parseCommand } from '../api/src/command-parser.js';

describe('Command Parser', () => {

  // ── Movement Commands ──────────────────────────────────────────────

  describe('movement commands', () => {
    test.each([
      ['go north', 'north'],
      ['go south', 'south'],
      ['go east',  'east'],
      ['go west',  'west'],
    ])('parses "%s" → go %s', (input, dir) => {
      const result = parseCommand(input);
      expect(result.verb).toBe('go');
      expect(result.noun).toBe(dir);
    });

    test.each([
      ['north', 'north'],
      ['south', 'south'],
      ['east',  'east'],
      ['west',  'west'],
    ])('parses bare direction "%s" as go command', (input, dir) => {
      const result = parseCommand(input);
      expect(result.verb).toBe('go');
      expect(result.noun).toBe(dir);
    });

    test.each([
      ['n', 'north'],
      ['s', 'south'],
      ['e', 'east'],
      ['w', 'west'],
    ])('parses single-letter alias "%s" as go %s', (input, dir) => {
      const result = parseCommand(input);
      expect(result.verb).toBe('go');
      expect(result.noun).toBe(dir);
    });

    test('supports up/down directions', () => {
      expect(parseCommand('u').verb).toBe('go');
      expect(parseCommand('u').noun).toBe('up');
      expect(parseCommand('go down').noun).toBe('down');
    });
  });

  // ── Item Commands ──────────────────────────────────────────────────

  describe('item commands', () => {
    test('parses "take key"', () => {
      const result = parseCommand('take key');
      expect(result.verb).toBe('take');
      expect(result.noun).toBe('key');
    });

    test('parses "pick up key" as take', () => {
      const result = parseCommand('pick up key');
      expect(result.verb).toBe('take');
      expect(result.noun).toBe('key');
    });

    test('parses "get key" as take', () => {
      const result = parseCommand('get key');
      expect(result.verb).toBe('take');
      expect(result.noun).toBe('key');
    });

    test('parses "grab key" as take', () => {
      const result = parseCommand('grab key');
      expect(result.verb).toBe('take');
      expect(result.noun).toBe('key');
    });

    test('parses "drop key"', () => {
      const result = parseCommand('drop key');
      expect(result.verb).toBe('drop');
      expect(result.noun).toBe('key');
    });

    test('parses "take" with no noun', () => {
      const result = parseCommand('take');
      expect(result.verb).toBe('take');
      expect(result.noun).toBeFalsy();
    });
  });

  // ── Inventory Commands ─────────────────────────────────────────────

  describe('inventory commands', () => {
    test('parses "inventory"', () => {
      expect(parseCommand('inventory').verb).toBe('inventory');
    });

    test('parses "i" as inventory', () => {
      expect(parseCommand('i').verb).toBe('inventory');
    });

    test('parses "inv" as inventory', () => {
      expect(parseCommand('inv').verb).toBe('inventory');
    });
  });

  // ── Look Commands ──────────────────────────────────────────────────

  describe('look commands', () => {
    test('parses "look" with no noun', () => {
      const result = parseCommand('look');
      expect(result.verb).toBe('look');
      expect(result.noun).toBeFalsy();
    });

    test('parses "l" as look', () => {
      expect(parseCommand('l').verb).toBe('look');
    });

    test('parses "examine room"', () => {
      const result = parseCommand('examine room');
      expect(result.verb).toBe('look');
      expect(result.noun).toBe('room');
    });

    test('parses "inspect sword"', () => {
      const result = parseCommand('inspect sword');
      expect(result.verb).toBe('look');
      expect(result.noun).toBe('sword');
    });
  });

  // ── Give Commands ──────────────────────────────────────────────────

  describe('give commands', () => {
    test('parses "give key to Alice"', () => {
      const result = parseCommand('give key to Alice');
      expect(result.verb).toBe('give');
      expect(result.noun).toBe('key');
      expect(result.target).toBe('alice');
    });

    test('parses "give torch to Bob"', () => {
      const result = parseCommand('give torch to Bob');
      expect(result.verb).toBe('give');
      expect(result.noun).toBe('torch');
      expect(result.target).toBe('bob');
    });

    test('parses "give" with no arguments', () => {
      const result = parseCommand('give');
      expect(result.verb).toBe('give');
      expect(result.target).toBeFalsy();
    });
  });

  // ── Use Commands ───────────────────────────────────────────────────

  describe('use commands', () => {
    test('parses "use key" with no target', () => {
      const result = parseCommand('use key');
      expect(result.verb).toBe('use');
      expect(result.noun).toBe('key');
      expect(result.target).toBeFalsy();
    });

    test('parses "use key on door"', () => {
      const result = parseCommand('use key on door');
      expect(result.verb).toBe('use');
      expect(result.noun).toBe('key');
      expect(result.target).toBe('door');
    });
  });

  // ── Say Commands ───────────────────────────────────────────────────

  describe('say commands', () => {
    test('parses "say hello"', () => {
      const result = parseCommand('say hello');
      expect(result.verb).toBe('say');
      expect(result.noun).toBe('hello');
    });

    test('parses "shout help" as say', () => {
      const result = parseCommand('shout help');
      expect(result.verb).toBe('say');
    });
  });

  // ── Help Command ───────────────────────────────────────────────────

  describe('help command', () => {
    test('parses "help"', () => {
      expect(parseCommand('help').verb).toBe('help');
    });

    test('parses "?" as help', () => {
      expect(parseCommand('?').verb).toBe('help');
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────────────

  describe('edge cases', () => {
    test('handles empty input', () => {
      const result = parseCommand('');
      expect(result.verb).toBe('unknown');
    });

    test('handles whitespace-only input', () => {
      const result = parseCommand('   ');
      expect(result.verb).toBe('unknown');
    });

    test('handles unknown commands gracefully', () => {
      const result = parseCommand('dance wildly');
      expect(result.verb).toBe('unknown');
    });

    test('handles extra whitespace between words', () => {
      const result = parseCommand('  go   north  ');
      expect(result.verb).toBe('go');
      expect(result.noun).toBe('north');
    });

    test('handles mixed case input', () => {
      const result = parseCommand('GO NORTH');
      expect(result.verb).toBe('go');
      expect(result.noun).toBe('north');
    });

    test('handles mixed case aliases', () => {
      const result = parseCommand('N');
      expect(result.verb).toBe('go');
      expect(result.noun).toBe('north');
    });

    test('handles mixed case item commands', () => {
      const result = parseCommand('TAKE KEY');
      expect(result.verb).toBe('take');
      expect(result.noun).toBe('key');
    });

    test('preserves raw text in output', () => {
      const result = parseCommand('go north');
      expect(result.raw).toBe('go north');
    });

    test('preserves raw text with extra whitespace trimmed', () => {
      const result = parseCommand('  go north  ');
      expect(result.raw).toBe('go north');
    });

    test('multi-word item name in take command', () => {
      const result = parseCommand('take old key');
      expect(result.verb).toBe('take');
      expect(result.noun).toBe('old key');
    });
  });
});
