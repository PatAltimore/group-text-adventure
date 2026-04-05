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
  disconnectPlayer,
  findGhostByName,
  reconnectPlayer,
  getExpiredGhosts,
  finalizeGhost,
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

// How long ghosts persist before fading and dropping items (30 minutes)
const GHOST_TIMEOUT_MS = 30 * 60 * 1000;

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

// ── Cleanup: Expired Ghosts ────────────────────────────────────────────

/**
 * Check for ghosts whose timeout has expired.
 * Drops their items into their room, notifies nearby players, and removes them.
 * Called at the start of each event handler (Azure Functions has no timers).
 */
async function cleanupExpiredGhosts(serviceClient, gameId, session) {
  const expired = getExpiredGhosts(session, GHOST_TIMEOUT_MS);
  if (expired.length === 0) return session;

  for (const ghostName of expired) {
    const { droppedItems, roomId, playerName } = finalizeGhost(
      session,
      ghostName
    );

    // Notify active players in the same room about the ghost fading
    if (roomId) {
      for (const [, activePlayer] of Object.entries(session.players)) {
        if (activePlayer.room === roomId && activePlayer.connectionId) {
          if (droppedItems.length > 0) {
            const itemList = droppedItems.join(', ');
            await sendToConnection(serviceClient, activePlayer.connectionId, {
              type: 'message',
              text: `${playerName}'s ghost fades away, scattering: ${itemList}.`,
            });
          } else {
            await sendToConnection(serviceClient, activePlayer.connectionId, {
              type: 'message',
              text: `${playerName}'s ghost fades away.`,
            });
          }
        }
      }
    }

    // Broadcast that the player has truly left
    if (playerName) {
      await sendToGame(serviceClient, gameId, {
        type: 'playerEvent',
        event: 'left',
        playerName,
      });
    }
  }

  return session;
}

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

    // Load session, mark player as disconnected (preserve state for reconnection)
    let session = await loadGameState(gameId);
    if (!session) return;

    const player = session.players[playerId];
    if (!player) {
      // Player already removed from session (stale disconnect) — clean up Table Storage
      await deletePlayer(gameId, playerId);
      return;
    }

    // If the player has reconnected with a new connectionId, this is a stale
    // disconnect from the old connection — ignore it to avoid duplicate ghosts.
    if (player.connectionId && player.connectionId !== connectionId) {
      await deletePlayer(gameId, playerId);
      return;
    }

    const playerName = player.name || 'Unknown';
    const playerRoom = player.room;
    session = disconnectPlayer(session, playerId);
    await saveGameState(gameId, session);
    await deletePlayer(gameId, playerId);

    // Notify remaining players — ghost appears in the room
    await sendToGame(serviceClient, gameId, {
      type: 'playerEvent',
      event: 'disconnected',
      playerName,
    });

    // Announce ghost to players in the same room
    if (playerRoom) {
      for (const [, activePlayer] of Object.entries(session.players)) {
        if (activePlayer.room === playerRoom && activePlayer.connectionId) {
          await sendToConnection(serviceClient, activePlayer.connectionId, {
            type: 'message',
            text: `${playerName}'s ghost lingers here.`,
          });
        }
      }
    }

    const players = Object.values(session.players).map((p) => p.name);
    await sendToGame(serviceClient, gameId, {
      type: 'gameInfo',
      gameId,
      playerCount: players.length,
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

  // Cleanup expired ghosts before processing the join
  session = await cleanupExpiredGhosts(serviceClient, gameId, session);

  // Only attempt reconnection if the client signals this is a rejoin
  // (i.e., auto-rejoin from localStorage). Without this flag a new player
  // who picks the same name would incorrectly reclaim the ghost.
  const isRejoin = data.rejoin === true;

  let ghostMatch = null;
  let activeMatch = null;

  if (isRejoin) {
    // Check for reconnection — does a ghost exist with this name?
    ghostMatch = findGhostByName(session, playerName);

    // Also check for an active player with the same name but a different
    // connectionId. This handles the race where the player refreshes and the
    // new join arrives before the server processes the old disconnect.
    if (!ghostMatch) {
      const entry = Object.entries(session.players).find(
        ([id, p]) =>
          p.name.toLowerCase() === playerName.toLowerCase() && id !== playerId
      );
      if (entry) {
        activeMatch = { oldPlayerId: entry[0], oldPlayer: entry[1] };
      }
    }
  }

  if (ghostMatch || activeMatch) {
    if (ghostMatch) {
      // Reconnect via ghost: restore the player's state from the ghost
      session = reconnectPlayer(session, ghostMatch.ghostName, playerId);
    } else {
      // Reconnect via active player takeover (stale connection still in session)
      const { oldPlayerId, oldPlayer } = activeMatch;
      session.players[playerId] = {
        name: oldPlayer.name,
        room: oldPlayer.room,
        inventory: [...oldPlayer.inventory],
      };
      delete session.players[oldPlayerId];
      await deletePlayer(gameId, oldPlayerId);
    }
    session.players[playerId].connectionId = connectionId;

    // Update host tracking if needed
    if (!session.players[session.hostPlayerId]) {
      session.hostPlayerId = playerId;
    }

    // Persist
    await saveGameState(gameId, session);
    await savePlayer(gameId, playerId, {
      playerName: session.players[playerId].name,
      currentRoom: session.players[playerId].room,
      inventory: session.players[playerId].inventory,
      connectionId,
    });

    // Add to Web PubSub group
    try {
      await serviceClient.addConnectionToGroup(gameId, connectionId);
    } catch (err) {
      context.warn('Failed to add connection to group:', err.message);
    }

    // Build reconnection gameInfo with inventory + ghosts
    const restoredPlayer = session.players[playerId];
    const players = Object.values(session.players).map((p) => p.name);
    const ghostNames = session.ghosts
      ? Object.values(session.ghosts).map((g) => g.playerName)
      : [];

    const inventoryItems = restoredPlayer.inventory.map((itemId) => {
      const item = session.world.items[itemId];
      return item
        ? { name: item.name, description: item.description }
        : { name: itemId };
    });

    const gameInfoMsg = {
      type: 'gameInfo',
      gameId,
      playerCount: players.length,
      players,
      reconnected: true,
      inventory: inventoryItems,
      ghosts: ghostNames,
    };
    if (session.started) {
      gameInfoMsg.room = getPlayerView(session, playerId);
    }
    await sendToConnection(serviceClient, connectionId, gameInfoMsg);

    // Announce reconnection with descriptive text (not "joined")
    const rName = restoredPlayer.name;
    await sendToGame(serviceClient, gameId, {
      type: 'playerEvent',
      event: 'reconnected',
      playerName: rName,
      text: `${rName}'s ghost stirs... ${rName} has reconnected!`,
    });

    return { body: '', status: 200 };
  }

  // Normal join flow — resolve duplicate names
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
  const ghostNames = session.ghosts
    ? Object.values(session.ghosts).map((g) => g.playerName)
    : [];

  const gameInfoMsg = {
    type: 'gameInfo',
    gameId,
    playerCount,
    players,
    reconnected: false,
    ghosts: ghostNames,
  };
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

  // Cleanup expired ghosts
  session = await cleanupExpiredGhosts(serviceClient, gameId, session);

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

  // Cleanup expired ghosts
  session = await cleanupExpiredGhosts(serviceClient, gameId, session);

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
