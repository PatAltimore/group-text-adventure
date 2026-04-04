// gameHub.js — Web PubSub event handler for the game hub.
// Handles connect, message, and disconnect events for players.

import { app, trigger } from '@azure/functions';
import { WebPubSubServiceClient } from '@azure/web-pubsub';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import {
  loadWorld,
  createGameSession,
  addPlayer,
  removePlayer,
  processCommand,
  getPlayerView,
  resolvePlayerName,
} from '../game-engine.js';

import {
  initTables,
  saveGameSession,
  getGameSession,
  savePlayer,
  deletePlayer,
  findPlayerByConnectionId,
  saveGameState,
  loadGameState,
} from '../table-storage.js';

const connectionString = process.env.WebPubSubConnectionString;
const hubName = process.env.WebPubSubHubName || 'gameHub';

let tablesInitialized = false;

async function ensureTables() {
  if (!tablesInitialized) {
    await initTables();
    tablesInitialized = true;
  }
}

function getServiceClient() {
  return new WebPubSubServiceClient(connectionString, hubName);
}

/**
 * Load a world JSON file by its ID (filename without .json).
 * Checks two paths: deployed (world/ alongside api code) and local dev (project root).
 */
async function getWorld(worldId) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const filename = `${worldId}.json`;
  const candidates = [
    join(__dirname, '..', '..', 'world', filename),
    join(__dirname, '..', '..', '..', 'world', filename),
  ];
  for (const worldPath of candidates) {
    try {
      const raw = await readFile(worldPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      continue;
    }
  }
  throw new Error(`Could not find world file: ${filename}`);
}

/**
 * Load the default world JSON from disk (backward-compatible wrapper).
 */
async function getDefaultWorld() {
  return getWorld('default-world');
}

/**
 * Send a message to a specific connection.
 */
async function sendToConnection(serviceClient, connectionId, message) {
  try {
    // Pass the object directly — the SDK serializes it via JSON.stringify
    // internally when contentType is application/json. Pre-stringifying
    // would cause double-serialization (client receives a string, not an object).
    await serviceClient.sendToConnection(connectionId, message, {
      contentType: 'application/json',
    });
  } catch (err) {
    // Connection may have dropped; log and continue
    console.warn(`Failed to send to connection ${connectionId}:`, err.message);
  }
}

/**
 * Send a message to all connections in a game group.
 */
async function sendToGame(serviceClient, gameId, message) {
  try {
    // Use serviceClient.group(gameId).sendToAll() — the service client
    // does not have a sendToGroup() method. Pass the object directly
    // (SDK handles JSON serialization internally).
    await serviceClient.group(gameId).sendToAll(message, {
      contentType: 'application/json',
    });
  } catch (err) {
    console.warn(`Failed to send to group ${gameId}:`, err.message);
  }
}

/**
 * Route responses from the game engine to the appropriate connections.
 */
async function routeResponses(serviceClient, gameId, session, responses) {
  for (const resp of responses) {
    if (resp.playerId === 'all') {
      await sendToGame(serviceClient, gameId, resp.message);
    } else {
      // Look up the player's connectionId
      const player = session.players[resp.playerId];
      if (player && player.connectionId) {
        await sendToConnection(serviceClient, player.connectionId, resp.message);
      }
    }
  }
}

// ── Connect Event ─────────────────────────────────────────────────────
// Web PubSub fires this when a client WebSocket connects.

app.generic('gameHubConnect', {
  trigger: trigger.generic({
    type: 'webPubSubTrigger',
    name: 'request',
    hub: hubName,
    eventName: 'connect',
    eventType: 'system',
  }),
  handler: async (request, context) => {
    context.log(`Client connected: ${request.connectionContext.connectionId}`);

    return {
      body: JSON.stringify({ userId: request.connectionContext.connectionId }),
      status: 200,
    };
  },
});

// ── Message Event ─────────────────────────────────────────────────────
// Web PubSub fires this when a client sends a message.

app.generic('gameHubMessage', {
  trigger: trigger.generic({
    type: 'webPubSubTrigger',
    name: 'request',
    hub: hubName,
    eventName: 'message',
    eventType: 'user',
  }),
  handler: async (request, context) => {
    await ensureTables();

    const connectionId = request.connectionContext.connectionId;
    const serviceClient = getServiceClient();

    let data;
    try {
      data = typeof request.data === 'string' ? JSON.parse(request.data) : request.data;
    } catch {
      await sendToConnection(serviceClient, connectionId, {
        type: 'error',
        text: 'Invalid message format. Send JSON.',
      });
      return { body: '', status: 200 };
    }

    const messageType = data.type;

    if (messageType === 'join') {
      return await handleJoin(serviceClient, connectionId, data, context);
    }

    if (messageType === 'command') {
      return await handleCommand(serviceClient, connectionId, data, context);
    }

    if (messageType === 'startGame') {
      return await handleStartGame(serviceClient, connectionId, data, context);
    }

    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: `Unknown message type: "${messageType}". Send "join", "command", or "startGame".`,
    });

    return { body: '', status: 200 };
  },
});

// ── Disconnect Event ──────────────────────────────────────────────────

app.generic('gameHubDisconnect', {
  trigger: trigger.generic({
    type: 'webPubSubTrigger',
    name: 'request',
    hub: hubName,
    eventName: 'disconnected',
    eventType: 'system',
  }),
  handler: async (request, context) => {
    await ensureTables();

    const connectionId = request.connectionContext.connectionId;
    context.log(`Client disconnected: ${connectionId}`);

    const serviceClient = getServiceClient();

    // Find the player by connection ID
    const found = await findPlayerByConnectionId(connectionId);
    if (!found) return;

    const { gameId, playerId } = found;

    // Load session, remove player, save
    let session = await loadGameState(gameId);
    if (!session) return;

    const playerName = session.players[playerId]?.name || 'Unknown';
    session = removePlayer(session, playerId);
    await saveGameState(gameId, session);
    await deletePlayer(gameId, playerId);

    // Notify remaining players
    await sendToGame(serviceClient, gameId, {
      type: 'playerEvent',
      event: 'left',
      playerName,
    });

    const playerCount = Object.keys(session.players).length;
    const players = Object.values(session.players).map((p) => p.name);
    await sendToGame(serviceClient, gameId, {
      type: 'gameInfo',
      gameId,
      playerCount,
      players,
    });
  },
});

// ── Handler: Join ─────────────────────────────────────────────────────

async function handleJoin(serviceClient, connectionId, data, context) {
  const playerName = (data.playerName || '').trim();
  if (!playerName) {
    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: 'Player name is required.',
    });
    return { body: '', status: 200 };
  }

  const gameId = data.gameId || 'default';
  const playerId = connectionId; // Use connection ID as player ID

  // Load or create game session
  let session = await loadGameState(gameId);
  if (!session) {
    const worldId = data.worldId || 'default-world';
    const worldJson = await getWorld(worldId);
    const world = loadWorld(worldJson);
    session = createGameSession(world);
    session.hostPlayerId = playerId;
    await saveGameSession(gameId, {
      worldId,
      worldName: world.name,
      createdAt: session.createdAt,
      hostConnectionId: connectionId,
    });
  }

  // Resolve duplicate names
  const resolved = resolvePlayerName(session, playerName);
  const finalName = resolved.name;

  // Add player
  session = addPlayer(session, playerId, finalName);
  session.players[playerId].connectionId = connectionId;

  // Persist
  await saveGameState(gameId, session);
  await savePlayer(gameId, playerId, {
    playerName: finalName,
    currentRoom: session.players[playerId].room,
    inventory: session.players[playerId].inventory,
    connectionId,
  });

  // Add connection to the game's Web PubSub group
  try {
    await serviceClient.addConnectionToGroup(gameId, connectionId);
  } catch (err) {
    context.warn('Failed to add connection to group:', err.message);
  }

  // Send game info — include room view only if game already started (late joiner)
  const playerCount = Object.keys(session.players).length;
  const players = Object.values(session.players).map((p) => p.name);
  const gameInfoMsg = { type: 'gameInfo', gameId, playerCount, players };
  if (session.started) {
    gameInfoMsg.room = getPlayerView(session, playerId);
  }
  await sendToConnection(serviceClient, connectionId, gameInfoMsg);

  // If the name was changed, tell the player
  if (resolved.wasChanged) {
    await sendToConnection(serviceClient, connectionId, {
      type: 'message',
      text: `The name '${resolved.originalName}' is already taken. You are now known as '${finalName}'!`,
    });
  }

  // Notify all players (including joining player via group broadcast)
  await sendToGame(serviceClient, gameId, {
    type: 'playerEvent',
    event: 'joined',
    playerName: finalName,
  });

  return { body: '', status: 200 };
}

// ── Handler: Start Game ───────────────────────────────────────────────

async function handleStartGame(serviceClient, connectionId, data, context) {
  const found = await findPlayerByConnectionId(connectionId);
  if (!found) {
    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: 'You need to join a game first.',
    });
    return { body: '', status: 200 };
  }

  const { gameId, playerId } = found;

  let session = await loadGameState(gameId);
  if (!session) {
    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: 'Game session not found.',
    });
    return { body: '', status: 200 };
  }

  // Only the host can start the game
  if (session.hostPlayerId !== playerId) {
    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: 'Only the host can start the game.',
    });
    return { body: '', status: 200 };
  }

  if (session.started) {
    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: 'Game has already started.',
    });
    return { body: '', status: 200 };
  }

  // Mark the game as started and persist
  session.started = true;
  await saveGameState(gameId, session);

  // Build the initial room view for the starting room
  const startRoomId = session.world.startRoom;
  const room = session.world.rooms[startRoomId];
  const roomState = session.roomStates[startRoomId];

  const playerNames = Object.values(session.players).map((p) => p.name);
  const itemNames = roomState.items.map((itemId) => {
    const item = session.world.items[itemId];
    return item ? item.name : itemId;
  });

  const roomView = {
    name: room.name,
    description: room.description,
    exits: Object.keys(roomState.exits),
    items: itemNames,
    players: playerNames,
    hazards: room.hazards || [],
  };

  // Broadcast gameStart to all players in the group
  await sendToGame(serviceClient, gameId, {
    type: 'gameStart',
    room: roomView,
  });

  return { body: '', status: 200 };
}

// ── Handler: Command ──────────────────────────────────────────────────

async function handleCommand(serviceClient, connectionId, data, context) {
  const commandText = (data.text || '').trim();
  if (!commandText) {
    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: 'Empty command.',
    });
    return { body: '', status: 200 };
  }

  // Find the player
  const found = await findPlayerByConnectionId(connectionId);
  if (!found) {
    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: 'You need to join a game first. Send { "type": "join", "playerName": "YourName" }.',
    });
    return { body: '', status: 200 };
  }

  const { gameId, playerId } = found;

  // Load session
  let session = await loadGameState(gameId);
  if (!session) {
    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: 'Game session not found.',
    });
    return { body: '', status: 200 };
  }

  // Process the command
  const result = processCommand(session, playerId, commandText);
  session = result.session;

  // Persist updated state
  await saveGameState(gameId, session);

  // Update player record
  const player = session.players[playerId];
  if (player) {
    await savePlayer(gameId, playerId, {
      playerName: player.name,
      currentRoom: player.room,
      inventory: player.inventory,
      connectionId,
    });
  }

  // Route responses to the right clients
  await routeResponses(serviceClient, gameId, session, result.responses);

  return { body: '', status: 200 };
}
