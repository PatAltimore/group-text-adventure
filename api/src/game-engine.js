// game-engine.js — Core game logic. Pure module with NO Azure dependencies.
// All state is passed in and returned; functions are side-effect free.

import { parseCommand } from './command-parser.js';
import { validateWorld } from '../world/validate-world.js';

/**
 * Get ASCII art for a goal completion
 * @returns {string} ASCII art trophy
 */
export function getGoalAsciiArt() {
  return [
    '     ___________',
    "    '._==_==_=_.'",
    '    .-\\:      /-.',
    '   | (|:.     |) |',
    "    '-|:.     |-'",
    '      \\::.    /',
    "       '::. .'",
    '         ) (',
    "       _.' '._",
    '      |_______|',
  ].join('\n');
}

/**
 * Get ASCII art for final victory
 * @returns {string} ASCII art victory banner
 */
export function getVictoryAsciiArt() {
  return [
    '         ___________',
    "        '._==_==_=_.'",
    '        .-\\:      /-.',
    '       | (|:. #1  |) |',
    "        '-|:.     |-'",
    '          \\::.    /',
    "           '::. .'",
    '             ) (',
    "           _.' '._",
    '          |_______|',
    '',
    '      Congratulations!',
    'You conquered the adventure!',
  ].join('\n');
}

// Strip non-alphanumeric characters (except spaces) for fuzzy item matching.
// Handles apostrophes, hyphens, em-dashes, and other special characters.
function normalizeForMatch(str) {
  return str.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// Match user input against item name: exact, normalized, or startsWith (both raw and normalized).
function matchesItemName(itemName, input) {
  const nameLC = itemName.toLowerCase();
  const inputLC = input.toLowerCase();
  if (nameLC === inputLC) return true;
  const nameNorm = normalizeForMatch(itemName);
  const inputNorm = normalizeForMatch(input);
  if (nameNorm === inputNorm) return true;
  if (nameLC.startsWith(inputLC)) return true;
  if (nameNorm.startsWith(inputNorm)) return true;
  return false;
}

// Fuzzy substring match: returns true if input appears anywhere in itemName (not just start).
function fuzzyMatchesItemName(itemName, input) {
  const nameLower = itemName.toLowerCase();
  const inputLower = input.toLowerCase();
  if (nameLower.includes(inputLower)) return true;
  const nameNorm = normalizeForMatch(itemName);
  const inputNorm = normalizeForMatch(input);
  if (inputNorm && nameNorm.includes(inputNorm)) return true;
  return false;
}

/**
 * Find items matching a search term from a list of item IDs.
 * Prioritizes exact/startsWith matches over fuzzy substring matches.
 * @param {string} searchTerm - The user's input (e.g. "key", "journal")
 * @param {string[]} itemIds - Array of item IDs to search within
 * @param {object} worldItems - The world.items map (id → item definition)
 * @returns {string[]} Array of matching item IDs
 */
function findMatchingItems(searchTerm, itemIds, worldItems) {
  if (!searchTerm || !itemIds || itemIds.length === 0) return [];

  // 1. Exact / startsWith matches (existing logic) — highest priority
  const exactMatches = itemIds.filter((id) => {
    const item = worldItems[id];
    return item && matchesItemName(item.name, searchTerm);
  });
  if (exactMatches.length > 0) return exactMatches;

  // 2. Substring matches (fuzzy) — case-insensitive, on both raw and normalized names
  const fuzzyMatches = itemIds.filter((id) => {
    const item = worldItems[id];
    return item && fuzzyMatchesItemName(item.name, searchTerm);
  });
  return fuzzyMatches;
}

// Format a disambiguation message when multiple items match.
function disambiguationMessage(searchTerm, itemIds, worldItems) {
  const names = itemIds.map((id) => worldItems[id].name);
  return `Did you mean:\n${names.map((n) => ` - ${n}`).join('\n')}\nPlease be more specific.`;
}

// Funny adjectives for resolving duplicate player names
const SILLY_ADJECTIVES = [
  'Evil','Sparkly', 'Grumpy', 'Wobbly', 'Sneaky', 'Fluffy',
  'Cranky', 'Dizzy', 'Goofy', 'Jumpy', 'Sassy',
  'Spooky', 'Wacky', 'Bouncy', 'Clumsy', 'Giggly',
  'Sleepy', 'Snazzy', 'Zippy', 'Funky', 'Quirky',
];

/**
 * Check if a player name is already taken in the session.
 * If so, prepend a random silly adjective to make it unique.
 * @param {object} session - Current game session.
 * @param {string} playerName - Desired display name.
 * @returns {{ name: string, wasChanged: boolean, originalName: string }}
 */
export function resolvePlayerName(session, playerName) {
  const existingNames = new Set(
    Object.values(session.players).map((p) => p.name.toLowerCase())
  );
  // Also treat ghost names as taken so new players don't collide
  if (session.ghosts) {
    for (const ghost of Object.values(session.ghosts)) {
      existingNames.add(ghost.playerName.toLowerCase());
    }
  }

  if (!existingNames.has(playerName.toLowerCase())) {
    return { name: playerName, wasChanged: false, originalName: playerName };
  }

  // Shuffle adjectives to avoid predictable ordering
  const shuffled = [...SILLY_ADJECTIVES].sort(() => Math.random() - 0.5);

  for (const adj of shuffled) {
    const candidate = `${adj} ${playerName}`;
    if (!existingNames.has(candidate.toLowerCase())) {
      return { name: candidate, wasChanged: true, originalName: playerName };
    }
  }

  // Extremely unlikely fallback: all adjectives exhausted, append a number
  let counter = 2;
  while (true) {
    const candidate = `${playerName} ${counter}`;
    if (!existingNames.has(candidate.toLowerCase())) {
      return { name: candidate, wasChanged: true, originalName: playerName };
    }
    counter++;
  }
}

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

  // Run full validation — errors block, warnings are logged
  const validation = validateWorld(worldJson);
  if (!validation.valid) {
    throw new Error(`Invalid world: ${validation.errors.join('; ')}`);
  }
  if (validation.warnings.length > 0) {
    for (const warning of validation.warnings) {
      console.warn(`[world-validation] ${warning}`);
    }
  }

  // Normalize hazards: convert old-style strings to structured objects
  const clonedRooms = structuredClone(rooms);
  for (const room of Object.values(clonedRooms)) {
    if (Array.isArray(room.hazards)) {
      room.hazards = room.hazards.map((h) => {
        if (typeof h === 'string') {
          return { description: h, probability: 0, deathText: '' };
        }
        return h;
      });
    }
  }

  return {
    name,
    description: description || '',
    startRoom,
    rooms: clonedRooms,
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

  // Count total goals
  const totalGoals = Object.values(world.puzzles || {}).filter(p => p.isGoal === true).length;

  return {
    world,
    roomStates,
    puzzleStates,
    players: {},
    goalsCompleted: 0,
    totalGoals,
    deathTimeout: 30,
    hazardHintsEnabled: true,
    sayScope: 'room',
    hintsEnabled: true,
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
    visitedRooms: [session.world.startRoom],
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

// ── Ghost System (Disconnect Persistence) ─────────────────────────────

/**
 * Mark a player as disconnected — creates a ghost entity in the room and drops
 * their inventory immediately. The ghost is visible to other players.
 * @param {object} session - Current game session.
 * @param {string} playerId - Player to mark as disconnected.
 * @returns {object} Updated session.
 */
export function disconnectPlayer(session, playerId) {
  const player = session.players[playerId];
  if (!player) return session;

  if (!session.ghosts) session.ghosts = {};
  
  // Drop all inventory items into the room immediately
  const roomState = session.roomStates[player.room];
  if (roomState && player.inventory.length > 0) {
    for (const itemId of player.inventory) {
      roomState.items.push(itemId);
    }
  }
  
  session.ghosts[player.name] = {
    playerName: player.name,
    playerId: player.playerId || null,
    room: player.room,
    inventory: [],
    disconnectedAt: Date.now(),
    visitedRooms: player.visitedRooms || [],
  };

  delete session.players[playerId];
  return session;
}

/**
 * Find a ghost by player name (case-insensitive).
 * @param {object} session - Current game session.
 * @param {string} playerName - Name to search for.
 * @returns {{ ghostName: string, ghost: object }|null}
 */
export function findGhostByName(session, playerName) {
  if (!session.ghosts) return null;
  for (const [name, ghost] of Object.entries(session.ghosts)) {
    if (name.toLowerCase() === playerName.toLowerCase()) {
      return { ghostName: name, ghost };
    }
  }
  return null;
}

/**
 * Find a ghost by its unique playerId (not display name).
 * @param {object} session - Current game session.
 * @param {string} playerId - Unique player ID to search for.
 * @returns {{ ghostName: string, ghost: object }|null}
 */
export function findGhostByPlayerId(session, playerId) {
  if (!session.ghosts || !playerId) return null;
  for (const [name, ghost] of Object.entries(session.ghosts)) {
    if (ghost.playerId === playerId) {
      return { ghostName: name, ghost };
    }
  }
  return null;
}

/**
 * Reconnect a player via their ghost — restores room with empty inventory.
 * Items were already dropped when the ghost was created.
 * Preserves the original playerId so the identity survives across reconnections.
 * @param {object} session - Current game session.
 * @param {string} ghostName - The ghost's player name key.
 * @param {string} newPlayerId - The new connection-based player ID.
 * @returns {object} Updated session.
 */
export function reconnectPlayer(session, ghostName, newPlayerId) {
  if (!session.ghosts || !session.ghosts[ghostName]) {
    return session;
  }

  const ghost = session.ghosts[ghostName];
  session.players[newPlayerId] = {
    name: ghost.playerName,
    playerId: ghost.playerId || null,
    room: ghost.room,
    inventory: [],
    visitedRooms: ghost.visitedRooms || [ghost.room],
  };

  delete session.ghosts[ghostName];
  return session;
}

/**
 * Kill a player — creates a death ghost in the room and drops their inventory
 * immediately. The player can revive after a timeout.
 * @param {object} session - Current game session.
 * @param {string} playerId - Player to kill.
 * @returns {object} Updated session.
 */
export function killPlayer(session, playerId) {
  const player = session.players[playerId];
  if (!player) return session;

  if (!session.ghosts) session.ghosts = {};
  
  // Drop all inventory items into the room immediately
  const roomState = session.roomStates[player.room];
  if (roomState && player.inventory.length > 0) {
    for (const itemId of player.inventory) {
      roomState.items.push(itemId);
    }
  }
  
  session.ghosts[player.name] = {
    playerName: player.name,
    playerId: player.playerId || null,
    room: player.room,
    inventory: [],
    disconnectedAt: Date.now(),
    diedAt: Date.now(),
    isDeath: true,
    visitedRooms: player.visitedRooms || [],
  };

  delete session.players[playerId];
  return session;
}

/**
 * Respawn a dead player — removes their death ghost and recreates the player
 * with empty inventory. Items were already dropped when the ghost was created.
 * @param {object} session - Current game session.
 * @param {string} ghostName - The ghost's player name key.
 * @param {string} newPlayerId - The new connection-based player ID.
 * @returns {object} Updated session.
 */
export function respawnPlayer(session, ghostName, newPlayerId) {
  if (!session.ghosts || !session.ghosts[ghostName]) return session;

  const ghost = session.ghosts[ghostName];
  if (!ghost.isDeath) return session;

  // Items were already dropped when the ghost was created — no need to drop again

  session.players[newPlayerId] = {
    name: ghost.playerName,
    playerId: ghost.playerId,
    room: ghost.room,
    inventory: [],
    visitedRooms: ghost.visitedRooms || [ghost.room],
  };

  delete session.ghosts[ghostName];
  return session;
}

/**
 * Revive a player from death — restores the player from their ghost
 * with empty inventory. Items were already dropped when the ghost was created.
 * @param {object} session - Current game session.
 * @param {string} ghostName - The ghost's player name key.
 * @param {string} newPlayerId - The new connection-based player ID.
 * @returns {object} Updated session.
 */
export function revivePlayer(session, ghostName, newPlayerId) {
  if (!session.ghosts || !session.ghosts[ghostName]) {
    return session;
  }

  const ghost = session.ghosts[ghostName];
  session.players[newPlayerId] = {
    name: ghost.playerName,
    playerId: ghost.playerId || null,
    room: ghost.room,
    inventory: [],
    visitedRooms: ghost.visitedRooms || [ghost.room],
  };

  delete session.ghosts[ghostName];
  return session;
}

/**
 * Get ghosts in a specific room.
 * @param {object} session - Current game session.
 * @param {string} roomId - Room to check.
 * @returns {string[]} Array of ghost display strings (e.g. "Bob's ghost").
 */
export function getGhostsInRoom(session, roomId) {
  if (!session.ghosts) return [];
  return Object.values(session.ghosts)
    .filter((ghost) => ghost.room === roomId)
    .map((ghost) => `${ghost.playerName}'s ghost`);
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

  const worldRoomItems = room.items || [];
  const items = roomState.items.map((itemId) => {
    const item = session.world.items[itemId];
    const isNative = worldRoomItems.includes(itemId);
    if (!item) return { name: itemId, displaced: !isNative };
    return {
      name: item.name,
      roomText: isNative ? (item.roomText || `A ${item.name.toLowerCase()} lies here.`) : undefined,
      displaced: !isNative,
    };
  });

  // Check if room has an unsolved puzzle
  let roomName = room.name;
  let hintText;
  
  // Check puzzle state for this room
  const roomPuzzles = Object.entries(session.world.puzzles || {})
    .filter(([, puzzle]) => puzzle.room === player.room);
  
  if (roomPuzzles.length > 0) {
    const allSolved = roomPuzzles.every(([puzzleId]) => session.puzzleStates[puzzleId]?.solved);
    const hasUnsolved = roomPuzzles.some(([puzzleId]) => !session.puzzleStates[puzzleId]?.solved);
    
    if (allSolved) {
      roomName = `✅ ${room.name}`;
    } else if (hasUnsolved) {
      roomName = `🧩 ${room.name}`;
      // Find hint text from any unsolved puzzle
      for (const [puzzleId, puzzle] of roomPuzzles) {
        if (!session.puzzleStates[puzzleId]?.solved && session.hintsEnabled && puzzle.hintText) {
          hintText = puzzle.hintText;
          break;
        }
      }
    }
  }

  // Use solvedDescription if ALL puzzles in this room have been solved
  let description = room.description;
  if (room.solvedDescription) {
    const roomPuzzles = Object.entries(session.world.puzzles || {})
      .filter(([, puzzle]) => puzzle.room === player.room);
    if (roomPuzzles.length > 0 &&
        roomPuzzles.every(([puzzleId]) => session.puzzleStates[puzzleId]?.solved)) {
      description = room.solvedDescription;
    }
  }

  const view = {
    name: roomName,
    description,
    exits: Object.keys(roomState.exits),
    items,
    players: otherPlayers,
    ghosts: getGhostsInRoom(session, player.room),
  };

  // Only include hazard hints if hazardHintsEnabled is not explicitly false
  if (session.hazardHintsEnabled !== false) {
    view.hazards = (room.hazards || []).map((h) =>
      typeof h === 'string' ? h : h.description
    );
  }

  if (hintText) {
    view.hintText = hintText;
  }

  // Add goal progress if there are goals in the session
  if (session.totalGoals > 0) {
    view.goalProgress = {
      completed: session.goalsCompleted || 0,
      total: session.totalGoals,
    };
  }

  return view;
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

  let result;

  switch (cmd.verb) {
    case 'go':
      result = handleGo(session, playerId, cmd);
      break;
    case 'look':
      result = handleLook(session, playerId, cmd);
      break;
    case 'take':
      result = handleTake(session, playerId, cmd);
      break;
    case 'takeall':
      result = handleTakeAll(session, playerId);
      break;
    case 'drop':
      result = handleDrop(session, playerId, cmd);
      break;
    case 'use':
      result = handleUse(session, playerId, cmd);
      break;
    case 'give':
      result = handleGive(session, playerId, cmd);
      break;
    case 'say':
      result = handleSay(session, playerId, cmd);
      break;
    case 'yell':
      result = handleYell(session, playerId, cmd);
      break;
    case 'help':
      return handleHelp(session, playerId);
    case 'map':
      return handleMap(session, playerId);
    case 'inventory':
      return handleInventory(session, playerId);
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

  return result;
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
          event: 'moved',
          playerName: player.name,
          text: `${player.name} went ${cmd.noun}.`,
        },
      });
    }
  }

  // Move the player
  player.room = targetRoom;

  // Track visited rooms for map
  if (!player.visitedRooms) player.visitedRooms = [];
  if (!player.visitedRooms.includes(targetRoom)) {
    player.visitedRooms.push(targetRoom);
  }

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

  // "examine <item>" — fuzzy match inventory first, then room
  const roomState = session.roomStates[player.room];
  const invMatches = findMatchingItems(cmd.noun, player.inventory, session.world.items);
  const roomMatches = findMatchingItems(cmd.noun, roomState.items, session.world.items);

  // Prefer inventory matches; fall back to room matches
  const matches = invMatches.length > 0 ? invMatches : roomMatches;

  if (matches.length > 1) {
    responses.push({
      playerId,
      message: { type: 'error', text: disambiguationMessage(cmd.noun, matches, session.world.items) },
    });
    return { session, responses };
  }

  if (matches.length === 1) {
    const item = session.world.items[matches[0]];
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

  const matches = findMatchingItems(cmd.noun, roomState.items, session.world.items);

  if (matches.length > 1) {
    responses.push({
      playerId,
      message: { type: 'error', text: disambiguationMessage(cmd.noun, matches, session.world.items) },
    });
    return { session, responses };
  }

  if (matches.length === 0) {
    responses.push({
      playerId,
      message: { type: 'error', text: `You don't see "${cmd.noun}" here.` },
    });
    return { session, responses };
  }

  const itemId = matches[0];
  const idx = roomState.items.indexOf(itemId);
  const item = session.world.items[itemId];

  if (!item.portable) {
    responses.push({
      playerId,
      message: { type: 'error', text: `You can't pick up the ${item.name}.` },
    });
    return { session, responses };
  }

  // Hazard item — picking it up kills the player
  if (item.hazardItem) {
    const playerName = player.name;
    const playerRoom = player.room;
    // Remove hazard item from room so it can't kill again
    roomState.items.splice(idx, 1);
    session = killPlayer(session, playerId);

    responses.push({
      playerId,
      message: {
        type: 'death',
        deathText: item.deathText,
        deathTimeout: session.deathTimeout || 30,
      },
    });

    // Notify other players in the room
    for (const [otherId, otherPlayer] of Object.entries(session.players)) {
      if (otherPlayer.room === playerRoom) {
        responses.push({
          playerId: otherId,
          message: {
            type: 'playerEvent',
            event: 'died',
            playerName,
            text: `${playerName} has died! ${item.deathText}`,
          },
        });
        responses.push({
          playerId: otherId,
          message: {
            type: 'ghostEvent',
            text: `${playerName}'s ghost appears.`,
          },
        });
      }
    }

    return { session, responses };
  }

  // Move item from room to player inventory
  roomState.items.splice(idx, 1);
  player.inventory.push(itemId);

  const text = `You picked up: ${item.name}.`;
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

/**
 * Pick up all portable items from the current room.
 */
function handleTakeAll(session, playerId) {
  const player = session.players[playerId];
  const roomState = session.roomStates[player.room];
  const responses = [];

  const portableItems = roomState.items.filter((itemId) => {
    const item = session.world.items[itemId];
    return item && item.portable;
  });

  if (portableItems.length === 0) {
    responses.push({
      playerId,
      message: { type: 'message', text: 'There are no items here to pick up.' },
    });
    return { session, responses };
  }

  const pickedUpNames = [];
  for (const itemId of portableItems) {
    const item = session.world.items[itemId];

    // Hazard item — picking it up kills the player
    if (item && item.hazardItem) {
      const playerName = player.name;
      const playerRoom = player.room;
      const idx = roomState.items.indexOf(itemId);
      roomState.items.splice(idx, 1);
      session = killPlayer(session, playerId);

      responses.push({
        playerId,
        message: {
          type: 'death',
          deathText: item.deathText,
          deathTimeout: session.deathTimeout || 30,
        },
      });

      for (const [otherId, otherPlayer] of Object.entries(session.players)) {
        if (otherPlayer.room === playerRoom) {
          responses.push({
            playerId: otherId,
            message: {
              type: 'playerEvent',
              event: 'died',
              playerName,
              text: `${playerName} has died! ${item.deathText}`,
            },
          });
          responses.push({
            playerId: otherId,
            message: {
              type: 'ghostEvent',
              text: `${playerName}'s ghost appears.`,
            },
          });
        }
      }

      return { session, responses };
    }

    const idx = roomState.items.indexOf(itemId);
    roomState.items.splice(idx, 1);
    player.inventory.push(itemId);
    pickedUpNames.push(item ? item.name : itemId);
  }

  const itemList = pickedUpNames.join(', ');
  responses.push({
    playerId,
    message: { type: 'message', text: `You picked up: ${itemList}.` },
  });

  for (const [otherId, otherPlayer] of Object.entries(session.players)) {
    if (otherId !== playerId && otherPlayer.room === player.room) {
      responses.push({
        playerId: otherId,
        message: { type: 'message', text: `${player.name} picked up everything on the ground.` },
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

  const matches = findMatchingItems(cmd.noun, player.inventory, session.world.items);

  if (matches.length > 1) {
    responses.push({
      playerId,
      message: { type: 'error', text: disambiguationMessage(cmd.noun, matches, session.world.items) },
    });
    return { session, responses };
  }

  if (matches.length === 0) {
    responses.push({
      playerId,
      message: { type: 'error', text: `You don't have "${cmd.noun}".` },
    });
    return { session, responses };
  }

  const itemId = matches[0];
  const idx = player.inventory.indexOf(itemId);
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
    return { id: itemId, name: item.name, description: item.description };
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

  // Check player has the item
  const matches = findMatchingItems(cmd.noun, player.inventory, session.world.items);

  if (matches.length > 1) {
    responses.push({
      playerId,
      message: { type: 'error', text: disambiguationMessage(cmd.noun, matches, session.world.items) },
    });
    return { session, responses };
  }

  if (matches.length === 0) {
    responses.push({
      playerId,
      message: { type: 'error', text: `You don't have "${cmd.noun}".` },
    });
    return { session, responses };
  }

  const itemId = matches[0];

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

      // Check if this puzzle is a goal
      if (puzzle.isGoal === true) {
        session.goalsCompleted = (session.goalsCompleted || 0) + 1;

        // Broadcast goal completion to ALL players
        responses.push({
          playerId: 'all',
          message: {
            type: 'goalComplete',
            playerName: player.name,
            goalName: puzzle.goalName || puzzle.solvedText,
            goalNumber: session.goalsCompleted,
            totalGoals: session.totalGoals,
            asciiArt: getGoalAsciiArt(),
          },
        });

        // Check if all goals are complete
        if (session.goalsCompleted === session.totalGoals && session.totalGoals > 0) {
          responses.push({
            playerId: 'all',
            message: {
              type: 'victoryComplete',
              asciiArt: getVictoryAsciiArt(),
            },
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
        const idx = room.hazards.findIndex(
          (h) => (typeof h === 'string' ? h : h.description) === action.hazard
        );
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

  const targetName = cmd.target.toLowerCase();

  // Find the item in inventory
  const matches = findMatchingItems(cmd.noun, player.inventory, session.world.items);

  if (matches.length > 1) {
    responses.push({
      playerId,
      message: { type: 'error', text: disambiguationMessage(cmd.noun, matches, session.world.items) },
    });
    return { session, responses };
  }

  if (matches.length === 0) {
    responses.push({
      playerId,
      message: { type: 'error', text: `You don't have "${cmd.noun}".` },
    });
    return { session, responses };
  }

  const itemId = matches[0];
  const idx = player.inventory.indexOf(itemId);

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
  const item = session.world.items[itemId];

  // Transfer the item
  player.inventory.splice(idx, 1);
  targetPlayer.inventory.push(itemId);

  responses.push({
    playerId,
    message: { type: 'message', text: `You give the ${item.name} to ${targetPlayer.name}.` },
  });

  responses.push({
    playerId: targetId,
    message: {
      type: 'message',
      text: `${player.name} gave you ${item.name}.`,
    },
  });

  // Notify other players in the room
  for (const [otherId, otherPlayer] of Object.entries(session.players)) {
    if (otherId !== playerId && otherId !== targetId && otherPlayer.room === player.room) {
      responses.push({
        playerId: otherId,
        message: { type: 'message', text: `${player.name} gave ${item.name} to ${targetPlayer.name}.` },
      });
    }
  }

  return { session, responses };
}

function handleSay(session, playerId, cmd) {
  const player = session.players[playerId];
  const responses = [];

  if (!cmd.noun) {
    responses.push({ playerId, message: { type: 'error', text: 'Say what?' } });
    return { session, responses };
  }

  const isGlobal = session.sayScope === 'global';
  for (const [otherId, otherPlayer] of Object.entries(session.players)) {
    if (otherId === playerId) continue;
    if (isGlobal || otherPlayer.room === player.room) {
      const prefix = isGlobal && otherPlayer.room !== player.room
        ? `[from ${session.world.rooms[player.room]?.name || player.room}] `
        : '';
      responses.push({
        playerId: otherId,
        message: { type: 'message', text: `${prefix}${player.name} says: "${cmd.noun}"` },
      });
    }
  }

  responses.push({
    playerId,
    message: { type: 'message', text: `You say: "${cmd.noun}"` },
  });

  return { session, responses };
}

/**
 * BFS to find the direction of the first step on the shortest path
 * from one room to another. Returns null if no path exists.
 */
function findDirectionToRoom(session, fromRoomId, toRoomId) {
  const visited = new Set([fromRoomId]);
  const queue = [];

  const exits = session.roomStates[fromRoomId].exits;
  for (const [dir, nextRoom] of Object.entries(exits)) {
    if (nextRoom === toRoomId) return dir;
    if (!visited.has(nextRoom)) {
      visited.add(nextRoom);
      queue.push([nextRoom, dir]);
    }
  }

  while (queue.length > 0) {
    const [currentRoom, firstDir] = queue.shift();
    const currentExits = session.roomStates[currentRoom].exits;

    for (const [, nextRoom] of Object.entries(currentExits)) {
      if (nextRoom === toRoomId) return firstDir;
      if (!visited.has(nextRoom)) {
        visited.add(nextRoom);
        queue.push([nextRoom, firstDir]);
      }
    }
  }

  return null;
}

function handleYell(session, playerId, cmd) {
  const player = session.players[playerId];
  const responses = [];

  if (!cmd.noun) {
    responses.push({ playerId, message: { type: 'error', text: 'Yell what?' } });
    return { session, responses };
  }

  const yellerRoom = player.room;

  // Determine adjacent rooms (directly connected via exits from yeller's room)
  const adjacentRoomIds = new Set();
  const yellerExits = session.roomStates[yellerRoom].exits;
  for (const targetRoom of Object.values(yellerExits)) {
    adjacentRoomIds.add(targetRoom);
  }

  let sameRoomOthers = false;

  for (const [otherId, otherPlayer] of Object.entries(session.players)) {
    if (otherId === playerId) continue;

    if (otherPlayer.room === yellerRoom) {
      // Same room — hear the yell clearly
      sameRoomOthers = true;
      responses.push({
        playerId: otherId,
        message: { type: 'message', text: `${player.name} yells: "${cmd.noun}"` },
      });
    } else if (adjacentRoomIds.has(otherPlayer.room)) {
      // Adjacent room — hear the yell with direction
      const direction = findDirectionToRoom(session, otherPlayer.room, yellerRoom);
      if (direction) {
        responses.push({
          playerId: otherId,
          message: {
            type: 'message',
            text: `You hear someone yell from the ${direction}: "${cmd.noun}"`,
          },
        });
      }
    } else {
      // Far room (2+ away) — muffled yelling with general direction
      const direction = findDirectionToRoom(session, otherPlayer.room, yellerRoom);
      if (direction) {
        responses.push({
          playerId: otherId,
          message: {
            type: 'message',
            text: `You hear muffled yelling from somewhere to the ${direction}.`,
          },
        });
      }
    }
  }

  // Feedback to the yeller
  if (sameRoomOthers) {
    responses.push({
      playerId,
      message: {
        type: 'message',
        text: `You yell: "${cmd.noun}" — the other players in the room look annoyed.`,
      },
    });
  } else {
    responses.push({
      playerId,
      message: { type: 'message', text: `You yell: "${cmd.noun}"` },
    });
  }

  return { session, responses };
}

function handleHelp(session, playerId) {
  const helpText = [
    '── HELP ─────────────────',
    '',
    '▸ MOVEMENT',
    '  GO <dir>    Move (n/s/e/w)',
    '  LOOK        Look around',
    '  EXAMINE <x> Inspect an item',
    '  MAP         Show visited rooms',
    '',
    '▸ ITEMS',
    '  TAKE <x>    Pick up an item',
    '  GET ITEMS   Pick up all items (g)',
    '  DROP <x>    Drop an item',
    '  USE <x>     Use an item',
    '  USE <x> ON <y>  Use on target',
    '  GIVE <x> TO <p> Give to player',
    '  INVENTORY   Your items (i)',
    '',
    '▸ COMMUNICATION',
    '  SAY <msg>   Talk (same room)',
    '  YELL <msg>  Shout (nearby hear)',
    '',
    '▸ GAME',
    '  HELP        Show this message',
    '',
    'Type help anytime.',
    '─────────────────────────',
  ].join('\n');

  return {
    session,
    responses: [{ playerId, message: { type: 'message', text: helpText } }],
  };
}

/**
 * Generate an ASCII map of rooms the player has visited.
 * BFS outward from current room, max depth 2.
 * @param {object} session - Current game session.
 * @param {string} playerId - The requesting player.
 * @returns {{ session: object, responses: Array }}
 */
export function handleMap(session, playerId) {
  const player = session.players[playerId];
  if (!player) {
    return {
      session,
      responses: [{ playerId, message: { type: 'error', text: 'Player not found.' } }],
    };
  }

  const currentRoom = player.room;
  const visited = new Set(player.visitedRooms || [currentRoom]);
  const shownRooms = new Set([currentRoom]);

  const currentPrefix = getRoomPuzzlePrefix(session, currentRoom);
  const currentName = currentPrefix + session.world.rooms[currentRoom].name;
  const lines = [];
  lines.push('── MAP ──────────────────');
  lines.push(`[*] ${trimName(currentName, 20)} (you)`);

  // Depth-1: exits from current room
  const exits1 = Object.entries(session.roomStates[currentRoom].exits);

  for (let i = 0; i < exits1.length; i++) {
    const [dir, roomId] = exits1[i];
    const isLast = i === exits1.length - 1;
    const branch = isLast ? '└' : '├';
    const cont = isLast ? ' ' : '│';
    const isVisited = visited.has(roomId);

    const label = isVisited
      ? trimName(getRoomPuzzlePrefix(session, roomId) + session.world.rooms[roomId].name, 18)
      : '???';
    shownRooms.add(roomId);

    lines.push(` ${branch}─ ${dir[0].toUpperCase()} ─ ${label}`);

    // Depth-2: exits from this depth-1 room
    if (isVisited) {
      const exits2 = Object.entries(session.roomStates[roomId].exits)
        .filter(([, rid]) => !shownRooms.has(rid));

      for (let j = 0; j < exits2.length; j++) {
        const [dir2, roomId2] = exits2[j];
        const isLast2 = j === exits2.length - 1;
        const branch2 = isLast2 ? '└' : '├';
        const isVisited2 = visited.has(roomId2);

        const label2 = isVisited2
          ? trimName(getRoomPuzzlePrefix(session, roomId2) + session.world.rooms[roomId2].name, 16)
          : '???';
        shownRooms.add(roomId2);

        lines.push(` ${cont}  ${branch2}─ ${dir2[0].toUpperCase()} ─ ${label2}`);

        // Depth-3: exits from this depth-2 room
        if (isVisited2) {
          const cont2 = isLast2 ? ' ' : '│';
          const exits3 = Object.entries(session.roomStates[roomId2].exits)
            .filter(([, rid]) => !shownRooms.has(rid));

          for (let k = 0; k < exits3.length; k++) {
            const [dir3, roomId3] = exits3[k];
            const isLast3 = k === exits3.length - 1;
            const branch3 = isLast3 ? '└' : '├';
            const isVisited3 = visited.has(roomId3);

            const label3 = isVisited3
              ? trimName(getRoomPuzzlePrefix(session, roomId3) + session.world.rooms[roomId3].name, 14)
              : '???';
            shownRooms.add(roomId3);

            lines.push(` ${cont}  ${cont2}  ${branch3}─ ${dir3[0].toUpperCase()} ─ ${label3}`);
          }
        }
      }
    }
  }

  lines.push('─────────────────────────');

  return {
    session,
    responses: [{ playerId, message: { type: 'message', text: lines.join('\n') } }],
  };
}

function trimName(name, maxLen) {
  if (name.length <= maxLen) return name;
  return name.substring(0, maxLen - 1) + '…';
}

function getRoomPuzzlePrefix(session, roomId) {
  const roomPuzzles = Object.entries(session.world.puzzles || {})
    .filter(([, puzzle]) => puzzle.room === roomId);
  
  if (roomPuzzles.length === 0) {
    return '';
  }
  
  const allSolved = roomPuzzles.every(([puzzleId]) => session.puzzleStates[puzzleId]?.solved);
  if (allSolved) {
    return '✅ ';
  }
  
  const hasUnsolved = roomPuzzles.some(([puzzleId]) => !session.puzzleStates[puzzleId]?.solved);
  if (hasUnsolved) {
    return '🧩 ';
  }
  
  return '';
}
