// command-parser.js — Parses player text commands into structured actions.
// Pure module, no Azure dependencies.

const DIRECTION_ALIASES = {
  n: 'north', north: 'north',
  s: 'south', south: 'south',
  e: 'east',  east: 'east',
  w: 'west',  west: 'west',
  u: 'up',    up: 'up',
  d: 'down',  down: 'down',
};

const TAKE_VERBS = new Set(['take', 'get', 'grab', 'pick']);
const DROP_VERBS = new Set(['drop', 'discard', 'toss']);
const LOOK_VERBS = new Set(['look', 'l', 'examine', 'inspect']);
const INVENTORY_VERBS = new Set(['inventory', 'i', 'inv']);
const USE_VERBS = new Set(['use', 'apply']);
const GIVE_VERBS = new Set(['give', 'hand', 'offer']);
const HELP_VERBS = new Set(['help', 'h', '?']);
const SAY_VERBS = new Set(['say', 'whisper']);
const YELL_VERBS = new Set(['yell', 'shout']);
const MAP_VERBS = new Set(['map', 'm']);

/**
 * Parse raw command text into a structured command object.
 * @param {string} text - Raw command text from the player.
 * @returns {{ verb: string, noun?: string, target?: string, raw: string }}
 */
export function parseCommand(text) {
  const raw = text.trim();
  if (!raw) return { verb: 'unknown', raw };

  const lower = raw.toLowerCase();
  const words = lower.split(/\s+/);
  const verb = words[0];

  // "g" standalone → pick up all items in the room
  if (verb === 'g' && words.length === 1) {
    return { verb: 'takeall', raw };
  }

  // Direct direction shorthand: "n", "north", etc.
  if (DIRECTION_ALIASES[verb] && words.length === 1) {
    return { verb: 'go', noun: DIRECTION_ALIASES[verb], raw };
  }

  // "go <direction>"
  if (verb === 'go' && words.length >= 2) {
    const dir = DIRECTION_ALIASES[words[1]];
    if (dir) return { verb: 'go', noun: dir, raw };
    return { verb: 'go', noun: words[1], raw };
  }

  // Take / get / grab / "pick up" — also handles "take <item> from <target>"
  if (TAKE_VERBS.has(verb)) {
    let noun = words.slice(1).join(' ');
    // handle "pick up <item>"
    if (verb === 'pick' && words[1] === 'up') {
      noun = words.slice(2).join(' ');
    }
    // "get items" / "take items" / "get all" / "take all" → pick up everything
    if (noun === 'items' || noun === 'all') {
      return { verb: 'takeall', raw };
    }
    return { verb: 'take', noun: noun || undefined, raw };
  }

  // Drop
  if (DROP_VERBS.has(verb)) {
    const noun = words.slice(1).join(' ');
    return { verb: 'drop', noun: noun || undefined, raw };
  }

  // Look / examine
  if (LOOK_VERBS.has(verb)) {
    const noun = words.slice(1).join(' ');
    return { verb: 'look', noun: noun || undefined, raw };
  }

  // Inventory
  if (INVENTORY_VERBS.has(verb)) {
    return { verb: 'inventory', raw };
  }

  // Use — "use <item>" or "use <item> on <target>"
  if (USE_VERBS.has(verb)) {
    const rest = words.slice(1).join(' ');
    const onIndex = rest.indexOf(' on ');
    if (onIndex !== -1) {
      return {
        verb: 'use',
        noun: rest.substring(0, onIndex).trim(),
        target: rest.substring(onIndex + 4).trim(),
        raw,
      };
    }
    return { verb: 'use', noun: rest || undefined, raw };
  }

  // Give — "give <item> to <player>"
  if (GIVE_VERBS.has(verb)) {
    const rest = words.slice(1).join(' ');
    const toIndex = rest.indexOf(' to ');
    if (toIndex !== -1) {
      return {
        verb: 'give',
        noun: rest.substring(0, toIndex).trim(),
        target: rest.substring(toIndex + 4).trim(),
        raw,
      };
    }
    return { verb: 'give', noun: rest || undefined, raw };
  }

  // Yell
  if (YELL_VERBS.has(verb)) {
    const noun = words.slice(1).join(' ');
    return { verb: 'yell', noun: noun || undefined, raw };
  }

  // Say
  if (SAY_VERBS.has(verb)) {
    const noun = words.slice(1).join(' ');
    return { verb: 'say', noun: noun || undefined, raw };
  }

  // Map
  if (MAP_VERBS.has(verb)) {
    return { verb: 'map', raw };
  }

  // Help
  if (HELP_VERBS.has(verb)) {
    return { verb: 'help', raw };
  }

  return { verb: 'unknown', raw };
}
