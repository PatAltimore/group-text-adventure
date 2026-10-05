import { describe, test, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import {
  loadWorld,
  createGameSession,
  addPlayer,
  processCommand,
  getPlayerView,
  disconnectPlayer,
  reconnectPlayer,
  respawnPlayer,
} from '../api/src/game-engine.js';
import { validateWorld } from '../world/validate-world.js';

function makeWorld() {
  return loadWorld({
    name: 'Hazard Combat World',
    startRoom: 'hall',
    rooms: {
      hall: {
        name: 'Hall',
        description: 'A hall.',
        exits: { north: 'lab', east: 'sparks' },
        items: ['gloves', 'bandage', 'snack'],
        hazards: [],
      },
      lab: {
        name: 'Lab',
        description: 'A lab.',
        exits: { south: 'hall' },
        items: ['acid', 'bomb', 'gem'],
        hazards: [],
      },
      sparks: {
        name: 'Sparks Room',
        description: 'Live wires.',
        exits: { west: 'hall' },
        items: [],
        hazards: [
          {
            description: 'Live wires spit sparks.',
            probability: 0,
            deathText: 'The wires finish you off.',
            damage: 1,
            counteredBy: 'gloves',
            counterText: 'Your gloves shrug off the sparks.',
            damageText: 'Sparks sting you.',
          },
        ],
      },
    },
    items: {
      gloves: { name: 'Rubber Gloves', description: 'Insulated.', portable: true },
      bandage: { name: 'Bandage', description: 'Sterile.', portable: true, heal: 2, useText: 'You wrap the wound.' },
      snack: { name: 'Snack', description: 'Tasty.', portable: true, heal: 1 },
      gem: { name: 'Gem', description: 'Shiny.', portable: true },
      acid: {
        name: 'Acid Flask',
        description: 'Bubbling.',
        portable: true,
        hazardItem: true,
        damage: 2,
        counteredBy: ['gloves'],
        counterText: 'Your gloves hold.',
        damageText: 'The flask splashes you.',
        deathText: 'The acid eats you.',
      },
      bomb: {
        name: 'Bomb',
        description: 'Ticking.',
        portable: true,
        hazardItem: true,
        deathText: 'Boom.',
      },
    },
    puzzles: {},
  });
}

function start(...players) {
  let session = createGameSession(makeWorld());
  for (const [id, name] of players.length ? players : [['p1', 'Alice']]) {
    session = addPlayer(session, id, name);
  }
  return session;
}

function run(session, playerId, command) {
  return processCommand(session, playerId, command);
}

function messagesFor(responses, playerId, type) {
  return responses.filter((r) => r.playerId === playerId && r.message.type === type);
}

describe('Health', () => {
  test('players start at full health', () => {
    const session = start();
    expect(session.players.p1.hp).toBe(3);
    expect(getPlayerView(session, 'p1').hp).toEqual({ current: 3, max: 3 });
  });

  test('"health" reports current health', () => {
    let session = start();
    session.players.p1.hp = 1;
    const { responses } = run(session, 'p1', 'health');
    expect(responses[0].message.text).toContain('1/3');
  });

  test('sessions saved without hp are treated as full health', () => {
    const session = start();
    delete session.players.p1.hp;
    delete session.maxHp;
    expect(getPlayerView(session, 'p1').hp).toEqual({ current: 3, max: 3 });
  });

  test('respawning restores full health', () => {
    let session = start();
    ({ session } = run(session, 'p1', 'go north'));
    session.players.p1.hp = 1;
    ({ session } = run(session, 'p1', 'take bomb'));
    session = respawnPlayer(session, 'Alice', 'p1b');
    expect(session.players.p1b.hp).toBe(3);
  });

  test('a disconnect keeps current health through reconnect', () => {
    let session = start();
    session.players.p1.hp = 2;
    session = disconnectPlayer(session, 'p1');
    session = reconnectPlayer(session, 'Alice', 'p1b');
    expect(session.players.p1b.hp).toBe(2);
  });
});

describe('Hazard items with counters', () => {
  test('carrying the counter item makes the hazard harmless', () => {
    let session = start();
    ({ session } = run(session, 'p1', 'take gloves'));
    ({ session } = run(session, 'p1', 'go north'));
    const { session: after, responses } = run(session, 'p1', 'take acid');

    expect(after.players.p1.hp).toBe(3);
    expect(after.players.p1.inventory).toContain('acid');
    expect(responses.some((r) => r.message.text === 'Your gloves hold.')).toBe(true);
  });

  test('without the counter a non-lethal hazard deals damage and the item stays', () => {
    let session = start();
    ({ session } = run(session, 'p1', 'go north'));
    const { session: after, responses } = run(session, 'p1', 'take acid');

    expect(after.players.p1.hp).toBe(1);
    expect(after.players.p1.inventory).not.toContain('acid');
    expect(after.roomStates.lab.items).toContain('acid');
    const damage = messagesFor(responses, 'p1', 'damage');
    expect(damage).toHaveLength(1);
    expect(damage[0].message.text).toContain('The flask splashes you.');
    expect(damage[0].message.text).toContain('1/3');
  });

  test('damage that reaches zero health kills the player', () => {
    let session = start();
    ({ session } = run(session, 'p1', 'go north'));
    ({ session } = run(session, 'p1', 'take acid'));
    const { session: after, responses } = run(session, 'p1', 'take acid');

    expect(after.players.p1).toBeUndefined();
    expect(after.ghosts.Alice.isDeath).toBe(true);
    expect(messagesFor(responses, 'p1', 'death')[0].message.deathText).toBe('The acid eats you.');
  });

  test('a hazard item with no damage is lethal even at full health', () => {
    let session = start();
    ({ session } = run(session, 'p1', 'go north'));
    const { session: after, responses } = run(session, 'p1', 'take bomb');

    expect(after.players.p1).toBeUndefined();
    expect(messagesFor(responses, 'p1', 'death')[0].message.deathText).toBe('Boom.');
  });

  test('other players in the room are told when someone is hurt', () => {
    let session = start(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = run(session, 'p1', 'go north'));
    ({ session } = run(session, 'p2', 'go north'));
    const { responses } = run(session, 'p1', 'take acid');

    expect(responses.some((r) => r.playerId === 'p2' && r.message.text === 'Alice is hurt!')).toBe(true);
  });

  test('a counter held by another player does not protect you', () => {
    let session = start(['p1', 'Alice'], ['p2', 'Bob']);
    ({ session } = run(session, 'p1', 'take gloves'));
    ({ session } = run(session, 'p2', 'go north'));
    ({ session } = run(session, 'p2', 'take acid'));
    expect(session.players.p2.hp).toBe(1);
  });
});

describe('Get items with hazards', () => {
  test('survivable damage skips the hazard item and still picks up the rest', () => {
    let session = start();
    ({ session } = run(session, 'p1', 'go north'));
    session.players.p1.hp = 3;
    session.roomStates.lab.items = ['acid', 'gem'];
    const { session: after, responses } = run(session, 'p1', 'get items');

    expect(after.players.p1.hp).toBe(1);
    expect(after.players.p1.inventory).toEqual(['gem']);
    expect(after.roomStates.lab.items).toEqual(['acid']);
    expect(responses.some((r) => r.message.text === 'You picked up: Gem.')).toBe(true);
  });

  test('a lethal hazard item still ends the sweep', () => {
    let session = start();
    ({ session } = run(session, 'p1', 'go north'));
    const { session: after, responses } = run(session, 'p1', 'get items');

    expect(after.players.p1).toBeUndefined();
    expect(messagesFor(responses, 'p1', 'death')).toHaveLength(1);
  });

  test('a counter earlier in the room protects against hazards later in the sweep', () => {
    let session = start();
    ({ session } = run(session, 'p1', 'go north'));
    session.roomStates.lab.items = ['gem', 'acid'];
    session.players.p1.inventory = ['gloves'];
    const { session: after } = run(session, 'p1', 'get items');

    expect(after.players.p1.hp).toBe(3);
    expect(after.players.p1.inventory).toEqual(['gloves', 'gem', 'acid']);
  });

  test('when nothing could be picked up, no "picked up" message is sent', () => {
    let session = start();
    ({ session } = run(session, 'p1', 'go north'));
    session.roomStates.lab.items = ['acid'];
    const { responses } = run(session, 'p1', 'get items');

    expect(responses.some((r) => /You picked up/.test(r.message.text || ''))).toBe(false);
  });
});

describe('Room hazards with damage', () => {
  test('entering a damaging room hurts you after showing the room', () => {
    let session = start();
    const { session: after, responses } = run(session, 'p1', 'go east');

    expect(after.players.p1.hp).toBe(2);
    const types = responses.filter((r) => r.playerId === 'p1').map((r) => r.message.type);
    expect(types).toEqual(['look', 'damage']);
    expect(responses[0].message.room.hp.current).toBe(2);
  });

  test('the counter item prevents room damage', () => {
    let session = start();
    ({ session } = run(session, 'p1', 'take gloves'));
    const { session: after, responses } = run(session, 'p1', 'go east');

    expect(after.players.p1.hp).toBe(3);
    expect(responses.some((r) => r.message.text === 'Your gloves shrug off the sparks.')).toBe(true);
  });

  test('damage repeats on each entry and can kill', () => {
    let session = start();
    session.players.p1.hp = 1;
    const { session: after, responses } = run(session, 'p1', 'go east');

    expect(after.players.p1).toBeUndefined();
    expect(messagesFor(responses, 'p1', 'death')[0].message.deathText).toBe('The wires finish you off.');
    expect(messagesFor(responses, 'p1', 'look')).toHaveLength(0);
  });

  test('flavour-only hazards (no damage) are harmless', () => {
    const world = makeWorld();
    world.rooms.sparks.hazards = [{ description: 'Just atmosphere.', probability: 0, deathText: '' }];
    let session = createGameSession(world);
    session = addPlayer(session, 'p1', 'Alice');
    ({ session } = run(session, 'p1', 'go east'));
    expect(session.players.p1.hp).toBe(3);
  });
});

describe('Healing items', () => {
  test('using a healing item restores health and consumes it', () => {
    let session = start();
    session.players.p1.hp = 1;
    ({ session } = run(session, 'p1', 'take bandage'));
    const { session: after, responses } = run(session, 'p1', 'use bandage');

    expect(after.players.p1.hp).toBe(3);
    expect(after.players.p1.inventory).not.toContain('bandage');
    expect(responses[0].message.text).toContain('You wrap the wound.');
  });

  test('healing never goes above max health', () => {
    let session = start();
    session.players.p1.hp = 2;
    ({ session } = run(session, 'p1', 'take bandage'));
    ({ session } = run(session, 'p1', 'use bandage'));
    expect(session.players.p1.hp).toBe(3);
  });

  test('a healing item is not wasted at full health', () => {
    let session = start();
    ({ session } = run(session, 'p1', 'take snack'));
    const { session: after, responses } = run(session, 'p1', 'use snack');

    expect(after.players.p1.inventory).toContain('snack');
    expect(responses[0].message.text).toContain('full health');
  });
});

describe('World validation of combat fields', () => {
  function worldWith(patch) {
    const world = JSON.parse(JSON.stringify({
      name: 'W',
      startRoom: 'a',
      rooms: { a: { name: 'A', description: 'A', exits: {}, items: ['thing', 'tool'], hazards: [] } },
      items: {
        thing: { name: 'Thing', description: 'T', portable: true, hazardItem: true },
        tool: { name: 'Tool', description: 'T', portable: true },
      },
    }));
    patch(world);
    return validateWorld(world);
  }

  test('valid combat fields pass', () => {
    const result = worldWith((w) => {
      Object.assign(w.items.thing, { damage: 2, counteredBy: ['tool'], counterText: 'ok', damageText: 'ouch' });
    });
    expect(result.errors).toEqual([]);
  });

  test('counteredBy must reference an existing item', () => {
    const result = worldWith((w) => { w.items.thing.counteredBy = 'ghost-item'; });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('ghost-item');
  });

  test('damage must be a positive number', () => {
    expect(worldWith((w) => { w.items.thing.damage = 0; }).valid).toBe(false);
    expect(worldWith((w) => { w.items.thing.damage = 'lots'; }).valid).toBe(false);
  });

  test('heal must be a positive number', () => {
    expect(worldWith((w) => { w.items.tool.heal = -1; }).valid).toBe(false);
  });

  test('room hazards validate their counters too', () => {
    const result = worldWith((w) => {
      w.rooms.a.hazards = [{ description: 'd', probability: 0, deathText: '', damage: 1, counteredBy: 'nope' }];
    });
    expect(result.valid).toBe(false);
  });
});

const WORLD_DIR = new URL('../world/', import.meta.url);
const worldFiles = readdirSync(WORLD_DIR).filter((f) => f.endsWith('.json'));

describe.each(worldFiles)('combat data in %s', (file) => {
  const worldJson = JSON.parse(readFileSync(new URL(file, WORLD_DIR), 'utf8'));
  const hazardItems = Object.entries(worldJson.items).filter(([, item]) => item.hazardItem);
  const placed = new Set(Object.values(worldJson.rooms).flatMap((r) => r.items || []));
  const puzzleItems = new Set(Object.values(worldJson.puzzles || {}).map((p) => p.requiredItem));

  test('the world is valid', () => {
    expect(validateWorld(worldJson).errors).toEqual([]);
  });

  test('every hazard counter can actually be obtained and is not used up by a puzzle', () => {
    const hazards = [
      ...Object.values(worldJson.items),
      ...Object.values(worldJson.rooms).flatMap((r) => r.hazards || []),
    ].filter((h) => h.counteredBy);
    for (const hazard of hazards) {
      for (const counter of [].concat(hazard.counteredBy)) {
        expect(placed.has(counter)).toBe(true);
        expect(puzzleItems.has(counter)).toBe(false);
      }
    }
  });

  test('every counter has text for when it saves you', () => {
    for (const [id, item] of hazardItems.filter(([, i]) => i.counteredBy)) {
      expect([id, typeof item.counterText]).toEqual([id, 'string']);
    }
  });

  test('every hazard item that can hurt without killing explains the injury', () => {
    for (const [id, item] of hazardItems.filter(([, i]) => i.damage)) {
      expect([id, typeof item.damageText]).toEqual([id, 'string']);
    }
  });

  test('a player carrying every counter survives every hazard item', () => {
    const session = createGameSession(loadWorld(worldJson));
    for (const [id, item] of hazardItems.filter(([, i]) => i.counteredBy)) {
      const roomId = Object.keys(worldJson.rooms).find((r) => worldJson.rooms[r].items?.includes(id));
      const s = structuredClone(session);
      addPlayer(s, 'p1', 'Alice');
      s.players.p1.room = roomId;
      s.players.p1.inventory = [].concat(item.counteredBy);
      const { session: after } = processCommand(s, 'p1', `take ${item.name}`);
      expect([id, after.players.p1?.hp]).toEqual([id, 3]);
      expect([id, after.players.p1?.inventory.includes(id)]).toEqual([id, true]);
    }
  });

  test('without a counter, damaging hazards hurt and lethal ones kill', () => {
    const session = createGameSession(loadWorld(worldJson));
    for (const [id, item] of hazardItems) {
      const roomId = Object.keys(worldJson.rooms).find((r) => worldJson.rooms[r].items?.includes(id));
      const s = structuredClone(session);
      addPlayer(s, 'p1', 'Alice');
      s.players.p1.room = roomId;
      const { session: after } = processCommand(s, 'p1', `take ${item.name}`);
      if (item.damage && item.damage < 3) {
        expect([id, after.players.p1?.hp]).toEqual([id, 3 - item.damage]);
      } else {
        expect([id, after.players.p1]).toEqual([id, undefined]);
      }
    }
  });
});

describe('microsoft-escape-room pilot', () => {
  const worldJson = JSON.parse(readFileSync(new URL('microsoft-escape-room.json', WORLD_DIR), 'utf8'));

  test('the coolant canister is safe with gloves and merely painful without', () => {
    const session = createGameSession(loadWorld(worldJson));
    addPlayer(session, 'p1', 'Alice');
    session.players.p1.room = 'datacenter-2020';

    let hurt = run(structuredClone(session), 'p1', 'take canister').session;
    expect(hurt.players.p1.hp).toBe(1);

    session.players.p1.inventory = ['cryo-gloves'];
    const safe = run(session, 'p1', 'take canister').session;
    expect(safe.players.p1.hp).toBe(3);
    expect(safe.players.p1.inventory).toContain('toxic-coolant-canister');
  });
});
