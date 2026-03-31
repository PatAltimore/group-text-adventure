// game-engine.js — Core game logic. Pure module with NO Azure dependencies.
// All state is passed in and returned; functions are side-effect free.

import { parseCommand } from './command-parser.js';

/**
 * Load and validate a world JSON object.
 * @param {object} worldJson - Raw world definition.
 * @returns {object} Parsed and validated world state.
 */
export function loadWorld(worldJson) {
  const { name, description, startRoom, rooms, items, puzzles } = worldJson;
  if (!name || !startRoom || !rooms) {
    throw new Error('Invalid world: must have name, startRoom, and rooms.');
  }
  if (!rooms[startRoom]) {
    throw new Error(`Invalid world: startRoom "${startRoom}" not found in rooms.`);
  }
  return {
    name,
    description: description || '',
    startRoom,
    rooms: structuredClone(rooms),
    items: structuredClone(items || {}),
    puzzles: structuredClone(puzzles || {}),
  };
}

/**
 * Create a new game session from a loaded world.
 * @param {object} world - A loaded world object.
 * @returns {object} A new game session.
 */
export function createGameSession(world) {
  // Build initial room states (track which items are still in each room)
  const roomStates = {};
  for (const [roomId, room] of Object.entries(world.rooms)) {
    roomStates[roomId] = {
      items: [...(room.items || [])],
      // Exits can be modified by puzzles, so copy them
      exits: { ...(room.exits || {}) },
    };
  }

  // Build initial puzzle states
  const puzzleStates = {};
  for (const [puzzleId] of Object.entries(world.puzzles || {})) {
    puzzleStates[puzzleId] = { solved: false };
  }

  return {
    world,
    roomStates,
    puzzleStates,
    players: {},
    createdAt: new Date().toISOString(),
  };
}

/**
 * Add a player to the game session.
 * @param {object} session - Current game session.
 * @param {string} playerId - Unique player identifier.
 * @param {string} playerName - Display name.
 * @returns {object} Updated session.
 */
export function addPlayer(session, playerId, playerName) {
  if (session.players[playerId]) {
    return session; // Already joined
  }

  session.players[playerId] = {
    name: playerName,
    room: session.world.startRoom,
    inventory: [],
  };

  return session;
}

/**
 * Remove a player from the game session.
 * @param {object} session - Current game session.
 * @param {string} playerId - Player to remove.
 * @returns {object} Updated session.
 */
export function removePlayer(session, playerId) {
  const player = session.players[playerId];
  if (!player) return session;

  // Drop all held items back into the room
  const roomState = session.roomStates[player.room];
  for (const itemId of player.inventory) {
    roomState.items.push(itemId);
  }

  delete session.players[playerId];
  return session;
}

/**
 * Build the view of a room for a specific player.
 * @param {object} session - Current game session.
 * @param {string} playerId - The player requesting the view.
 * @returns {object} Room view for the client.
 */
export function getPlayerView(session, playerId) {
  const player = session.players[playerId];
  if (!player) return null;

  const room = session.world.rooms[player.room];
  const roomState = session.roomStates[player.room];

  const otherPlayers = Object.entries(session.players)
    .filter(([id]) => id !== playerId && session.players[id].room === player.room)
    .map(([, p]) => p.name);

  const itemNames = roomState.items.map((itemId) => {
    const item = session.world.items[itemId];
    return item ? item.name : itemId;
  });

  return {
    name: room.name,
    description: room.description,
    exits: Object.keys(roomState.exits),
    items: itemNames,
    players: otherPlayers,
    hazards: room.hazards || [],
  };
}

/**
 * Process a player command and return updated session + responses.
 * @param {object} session - Current game session.
 * @param {string} playerId - Player issuing the command.
 * @param {string} commandText - Raw command text.
 * @returns {{ session: object, responses: Array<{ playerId: string, message: object }> }}
 */
export function processCommand(session, playerId, commandText) {
  const player = session.players[playerId];
  if (!player) {
    return {
      session,
      responses: [{ playerId, message: { type: 'error', text: 'You are not in the game.' } }],
    };
  }

  const cmd = parseCommand(commandText);

  switch (cmd.verb) {
    case 'go':
      return handleGo(session, playerId, cmd);
    case 'look':
      return handleLook(session, playerId, cmd);
    case 'take':
      return handleTake(session, playerId, cmd);
    case 'drop':
      return handleDrop(session, playerId, cmd);
    case 'inventory':
      return handleInventory(session, playerId);
    case 'use':
      return handleUse(session, playerId, cmd);
    case 'give':
      return handleGive(session, playerId, cmd);
    case 'say':
      return handleSay(session, playerId, cmd);
    case 'help':
      return handleHelp(session, playerId);
    default:
      return {
        session,
        responses: [
          {
            playerId,
            message: {
              type: 'error',
              text: `I don't understand "${cmd.raw}". Type "help" for a list of commands.`,
            },
          },
        ],
      };
  }
}

// ── Command handlers ──────────────────────────────────────────────────

function handleGo(session, playerId, cmd) {
  const player = session.players[playerId];
  const roomState = session.roomStates[player.room];
  const responses = [];

  if (!cmd.noun) {
    responses.push({ playerId, message: { type: 'error', text: 'Go where? Try "go north".' } });
    return { session, responses };
  }

  const targetRoom = roomState.exits[cmd.noun];
  if (!targetRoom) {
    responses.push({
      playerId,
      message: { type: 'error', text: `You can't go ${cmd.noun} from here.` },
    });
    return { session, responses };
  }

  const oldRoom = player.room;

  // Notify others in the old room
  for (const [otherId, otherPlayer] of Object.entries(session.players)) {
    if (otherId !== playerId && otherPlayer.room === oldRoom) {
      responses.push({
        playerId: otherId,
        message: {
          type: 'playerEvent',
          event: 'left',
          playerName: player.name,
          text: `${player.name} went ${cmd.noun}.`,
        },
      });
    }
  }

  // Move the player
  player.room = targetRoom;

  // Notify others in the new room
  for (const [otherId, otherPlayer] of Object.entries(session.players)) {
    if (otherId !== playerId && otherPlayer.room === targetRoom) {
      responses.push({
        playerId: otherId,
        message: {
          type: 'playerEvent',
          event: 'arrived',
          playerName: player.name,
          text: `${player.name} arrived.`,
        },
      });
    }
  }

  // Show the player their new room
  const view = getPlayerView(session, playerId);
  responses.push({ playerId, message: { type: 'look', room: view } });

  return { session, responses };
}

function handleLook(session, playerId, cmd) {
  const player = session.players[playerId];
  const responses = [];

  // "look" with no noun → show the room
  if (!cmd.noun) {
    const view = getPlayerView(session, playerId);
    responses.push({ playerId, message: { type: 'look', room: view } });
    return { session, responses };
  }

  // "examine <item>" — check inventory first, then room
  const noun = cmd.noun.toLowerCase();
  const matchItem = (itemId) => {
    const item = session.world.items[itemId];
    return item && item.name.toLowerCase() === noun;
  };

  const invItem = player.inventory.find(matchItem);
  if (invItem) {
    const item = session.world.items[invItem];
    responses.push({
      playerId,
      message: { type: 'message', text: item.description },
    });
    return { session, responses };
  }

  const roomState = session.roomStates[player.room];
  const roomItem = roomState.items.find(matchItem);
  if (roomItem) {
    const item = session.world.items[roomItem];
    responses.push({
      playerId,
      message: { type: 'message', text: item.description },
    });
    return { session, responses };
  }

  responses.push({
    playerId,
    message: { type: 'error', text: `You don't see "${cmd.noun}" here.` },
  });
  return { session, responses };
}

function handleTake(session, playerId, cmd) {
  const player = session.players[playerId];
  const roomState = session.roomStates[player.room];
  const responses = [];

  if (!cmd.noun) {
    responses.push({ playerId, message: { type: 'error', text: 'Take what?' } });
    return { session, responses };
  }

  const noun = cmd.noun.toLowerCase();
  const idx = roomState.items.findIndex((itemId) => {
    const item = session.world.items[itemId];
    return item && item.name.toLowerCase() === noun;
  });

  if (idx === -1) {
    responses.push({
      playerId,
      message: { type: 'error', text: `You don't see "${cmd.noun}" here.` },
    });
    return { session, responses };
  }

  const itemId = roomState.items[idx];
  const item = session.world.items[itemId];

  if (!item.portable) {
    responses.push({
      playerId,
      message: { type: 'error', text: `You can't pick up the ${item.name}.` },
    });
    return { session, responses };
  }

  // Move item from room to player inventory
  roomState.items.splice(idx, 1);
  player.inventory.push(itemId);

  const text = item.pickupText || `You pick up the ${item.name}.`;
  responses.push({ playerId, message: { type: 'message', text } });

  // Notify others
  for (const [otherId, otherPlayer] of Object.entries(session.players)) {
    if (otherId !== playerId && otherPlayer.room === player.room) {
      responses.push({
        playerId: otherId,
        message: { type: 'message', text: `${player.name} picked up the ${item.name}.` },
      });
    }
  }

  return { session, responses };
}

function handleDrop(session, playerId, cmd) {
  const player = session.players[playerId];
  const roomState = session.roomStates[player.room];
  const responses = [];

  if (!cmd.noun) {
    responses.push({ playerId, message: { type: 'error', text: 'Drop what?' } });
    return { session, responses };
  }

  const noun = cmd.noun.toLowerCase();
  const idx = player.inventory.findIndex((itemId) => {
    const item = session.world.items[itemId];
    return item && item.name.toLowerCase() === noun;
  });

  if (idx === -1) {
    responses.push({
      playerId,
      message: { type: 'error', text: `You don't have "${cmd.noun}".` },
    });
    return { session, responses };
  }

  const itemId = player.inventory[idx];
  const item = session.world.items[itemId];

  player.inventory.splice(idx, 1);
  roomState.items.push(itemId);

  responses.push({
    playerId,
    message: { type: 'message', text: `You drop the ${item.name}.` },
  });

  return { session, responses };
}

function handleInventory(session, playerId) {
  const player = session.players[playerId];
  const items = player.inventory.map((itemId) => {
    const item = session.world.items[itemId];
    return { name: item.name, description: item.description };
  });

  return {
    session,
    responses: [{ playerId, message: { type: 'inventory', items } }],
  };
}

function handleUse(session, playerId, cmd) {
  const player = session.players[playerId];
  const responses = [];

  if (!cmd.noun) {
    responses.push({ playerId, message: { type: 'error', text: 'Use what?' } });
    return { session, responses };
  }

  const noun = cmd.noun.toLowerCase();

  // Check player has the item
  const itemId = player.inventory.find((id) => {
    const item = session.world.items[id];
    return item && item.name.toLowerCase() === noun;
  });

  if (!itemId) {
    responses.push({
      playerId,
      message: { type: 'error', text: `You don't have "${cmd.noun}".` },
    });
    return { session, responses };
  }

  // Check for matching puzzles in the current room
  for (const [puzzleId, puzzle] of Object.entries(session.world.puzzles || {})) {
    if (
      puzzle.room === player.room &&
      puzzle.requiredItem === itemId &&
      !session.puzzleStates[puzzleId].solved
    ) {
      // Solve the puzzle
      session.puzzleStates[puzzleId].solved = true;

      // Consume the item
      player.inventory = player.inventory.filter((id) => id !== itemId);

      // Apply the puzzle action
      applyPuzzleAction(session, puzzle.action);

      responses.push({
        playerId,
        message: { type: 'message', text: puzzle.solvedText },
      });

      // Notify everyone in the room
      for (const [otherId, otherPlayer] of Object.entries(session.players)) {
        if (otherId !== playerId && otherPlayer.room === player.room) {
          responses.push({
            playerId: otherId,
            message: { type: 'message', text: puzzle.solvedText },
          });
        }
      }

      // Refresh the room view for the player
      const view = getPlayerView(session, playerId);
      responses.push({ playerId, message: { type: 'look', room: view } });

      return { session, responses };
    }
  }

  responses.push({
    playerId,
    message: { type: 'error', text: `You can't use the ${session.world.items[itemId].name} here.` },
  });
  return { session, responses };
}

function applyPuzzleAction(session, action) {
  if (!action) return;

  switch (action.type) {
    case 'openExit': {
      const roomState = session.roomStates[action.room || action.targetRoom];
      // Add exit from the puzzle's room in the specified direction
      // We look up the puzzle's room from the action context
      for (const [puzzleId, puzzle] of Object.entries(session.world.puzzles || {})) {
        if (puzzle.action === action) {
          session.roomStates[puzzle.room].exits[action.direction] = action.targetRoom;
          break;
        }
      }
      break;
    }
    case 'removeHazard': {
      const room = session.world.rooms[action.room];
      if (room && room.hazards) {
        const idx = room.hazards.indexOf(action.hazard);
        if (idx !== -1) room.hazards.splice(idx, 1);
      }
      break;
    }
    case 'addItem': {
      const roomState = session.roomStates[action.room];
      if (roomState && action.itemId) {
        roomState.items.push(action.itemId);
      }
      break;
    }
  }
}

function handleGive(session, playerId, cmd) {
  const player = session.players[playerId];
  const responses = [];

  if (!cmd.noun || !cmd.target) {
    responses.push({
      playerId,
      message: { type: 'error', text: 'Give what to whom? Try "give key to Alice".' },
    });
    return { session, responses };
  }

  const noun = cmd.noun.toLowerCase();
  const targetName = cmd.target.toLowerCase();

  // Find the item in inventory
  const idx = player.inventory.findIndex((id) => {
    const item = session.world.items[id];
    return item && item.name.toLowerCase() === noun;
  });

  if (idx === -1) {
    responses.push({
      playerId,
      message: { type: 'error', text: `You don't have "${cmd.noun}".` },
    });
    return { session, responses };
  }

  // Find the target player in the same room
  const targetEntry = Object.entries(session.players).find(
    ([id, p]) => id !== playerId && p.name.toLowerCase() === targetName && p.room === player.room
  );

  if (!targetEntry) {
    responses.push({
      playerId,
      message: { type: 'error', text: `You don't see "${cmd.target}" here.` },
    });
    return { session, responses };
  }

  const [targetId, targetPlayer] = targetEntry;
  const itemId = player.inventory[idx];
  const item = session.world.items[itemId];

  // Transfer the item
  player.inventory.splice(idx, 1);
  targetPlayer.inventory.push(itemId);

  responses.push({
    playerId,
    message: { type: 'message', text: `You give the ${item.name} to ${targetPlayer.name}.` },
  });

  responses.push({
    targetId,
    message: {
      type: 'message',
      text: `${player.name} gives you the ${item.name}.`,
    },
  });

  return { session, responses };
}

function handleSay(session, playerId, cmd) {
  const player = session.players[playerId];
  const responses = [];

  if (!cmd.noun) {
    responses.push({ playerId, message: { type: 'error', text: 'Say what?' } });
    return { session, responses };
  }

  // Send to everyone in the same room
  for (const [otherId, otherPlayer] of Object.entries(session.players)) {
    if (otherId !== playerId && otherPlayer.room === player.room) {
      responses.push({
        playerId: otherId,
        message: { type: 'message', text: `${player.name} says: "${cmd.noun}"` },
      });
    }
  }

  responses.push({
    playerId,
    message: { type: 'message', text: `You say: "${cmd.noun}"` },
  });

  return { session, responses };
}

function handleHelp(session, playerId) {
  const helpText = [
    '📜 Available commands:',
    '  go <direction>  — Move (north, south, east, west) or use shortcuts (n, s, e, w)',
    '  look            — Look around the room',
    '  examine <item>  — Examine an item',
    '  take <item>     — Pick up an item',
    '  drop <item>     — Drop an item',
    '  inventory       — Check your inventory (shortcut: i)',
    '  use <item>      — Use an item (or "use <item> on <target>")',
    '  give <item> to <player> — Give an item to another player',
    '  say <message>   — Say something to players in the same room',
    '  help            — Show this help message',
  ].join('\n');

  return {
    session,
    responses: [{ playerId, message: { type: 'message', text: helpText } }],
  };
}
