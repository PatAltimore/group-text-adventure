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
 * Load the default world JSON from disk.
 * Checks two paths: deployed (world/ alongside api code) and local dev (project root).
 */
async function getDefaultWorld() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const candidates = [
    join(__dirname, '..', '..', 'world', 'default-world.json'),
    join(__dirname, '..', '..', '..', 'world', 'default-world.json'),
  ];
  for (const worldPath of candidates) {
    try {
      const raw = await readFile(worldPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      continue;
    }
  }
  throw new Error('Could not find default-world.json');
}

/**
 * Send a message to a specific connection.
 */
async function sendToConnection(serviceClient, connectionId, message) {
  try {
    await serviceClient.sendToConnection(connectionId, JSON.stringify(message), {
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
    await serviceClient.sendToGroup(gameId, JSON.stringify(message), {
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

    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: `Unknown message type: "${messageType}". Send "join" or "command".`,
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
    await sendToGame(serviceClient, gameId, {
      type: 'gameInfo',
      gameId,
      playerCount,
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
    const worldJson = await getDefaultWorld();
    const world = loadWorld(worldJson);
    session = createGameSession(world);
    await saveGameSession(gameId, {
      worldName: world.name,
      createdAt: session.createdAt,
      hostConnectionId: connectionId,
    });
  }

  // Add player
  session = addPlayer(session, playerId, playerName);
  session.players[playerId].connectionId = connectionId;

  // Persist
  await saveGameState(gameId, session);
  await savePlayer(gameId, playerId, {
    playerName,
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

  // Send the player their initial room view
  const view = getPlayerView(session, playerId);
  await sendToConnection(serviceClient, connectionId, { type: 'look', room: view });

  // Notify other players
  await sendToGame(serviceClient, gameId, {
    type: 'playerEvent',
    event: 'joined',
    playerName,
  });

  // Send game info
  const playerCount = Object.keys(session.players).length;
  await sendToConnection(serviceClient, connectionId, {
    type: 'gameInfo',
    gameId,
    playerCount,
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
