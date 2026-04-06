// gameHub.js — Web PubSub event handler for the game hub.
// Handles connect, message, and disconnect events for players.

import { app, trigger } from '@azure/functions';
import { WebPubSubServiceClient } from '@azure/web-pubsub';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { randomUUID } from 'crypto';
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
  findGhostByPlayerId,
  reconnectPlayer,
  killPlayer,
  respawnPlayer,
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
      context.log(`[MSG] request.data type=${typeof request.data}, constructor=${request.data?.constructor?.name}, isBuffer=${Buffer.isBuffer(request.data)}`);
      if (typeof request.data === 'string') {
        data = JSON.parse(request.data);
      } else if (Buffer.isBuffer(request.data) || request.data instanceof ArrayBuffer) {
        data = JSON.parse(request.data.toString());
      } else {
        data = request.data;
      }
      context.log(`[MSG] parsed data type=${data.type} keys=${Object.keys(data).join(',')}`);
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

    if (messageType === 'setDeathTimeout') {
      return await handleSetDeathTimeout(serviceClient, connectionId, data, context);
    }

    if (messageType === 'setHazardMultiplier') {
      return await handleSetHazardMultiplier(serviceClient, connectionId, data, context);
    }

    if (messageType === 'revive') {
      return await handleRevive(serviceClient, connectionId, data, context);
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
  const playerId = connectionId; // session.players key = connection ID

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

  // Reconnection: use playerId as PRIMARY matching key, rejoin flag as gate
  const isRejoin = data.rejoin === true;
  const clientPlayerId = data.playerId || null;

  // Diagnostic logging for reconnection debugging
  context.log(`[JOIN] playerName="${playerName}" gameId="${gameId}" rejoin=${data.rejoin} (type=${typeof data.rejoin}) clientPlayerId=${clientPlayerId} isRejoin=${isRejoin}`);
  context.log(`[JOIN] raw data keys: ${Object.keys(data).join(', ')}`);
  context.log(`[JOIN] ghosts: ${session.ghosts ? JSON.stringify(Object.keys(session.ghosts)) : 'none'}`);
  if (session.ghosts) {
    for (const [gname, ghost] of Object.entries(session.ghosts)) {
      context.log(`[JOIN] ghost "${gname}" playerId=${ghost.playerId}`);
    }
  }
  context.log(`[JOIN] active players: ${JSON.stringify(Object.entries(session.players).map(([id, p]) => ({ id: id.substring(0, 8), name: p.name, playerId: p.playerId })))}`);

  let ghostMatch = null;
  let activeMatch = null;

  if (isRejoin && clientPlayerId) {
    // Match ghost by unique playerId (not name)
    ghostMatch = findGhostByPlayerId(session, clientPlayerId);
    context.log(`[JOIN] ghostMatch: ${ghostMatch ? ghostMatch.ghostName : 'null'}`);

    // Active player takeover by playerId (race condition: new join before old disconnect)
    if (!ghostMatch) {
      const entry = Object.entries(session.players).find(
        ([id, p]) => p.playerId === clientPlayerId && id !== playerId
      );
      if (entry) {
        activeMatch = { oldPlayerId: entry[0], oldPlayer: entry[1] };
      }
      context.log(`[JOIN] activeMatch: ${activeMatch ? activeMatch.oldPlayer.name : 'null'}`);
    }
  } else {
    context.log(`[JOIN] Skipping ghost search: isRejoin=${isRejoin} clientPlayerId=${clientPlayerId}`);
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
        playerId: oldPlayer.playerId,
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
      playerId: restoredPlayer.playerId,
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
  context.log(`[JOIN] No ghost/active match — new player. rejoin=${isRejoin} clientPlayerId=${clientPlayerId}`);
  const resolved = resolvePlayerName(session, playerName);
  const finalName = resolved.name;

  // Generate a unique playerId for this new player
  const uniquePlayerId = randomUUID();

  // Add player and attach the persistent playerId
  session = addPlayer(session, playerId, finalName);
  session.players[playerId].connectionId = connectionId;
  session.players[playerId].playerId = uniquePlayerId;

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

  // Send game info — include playerId so the client can persist it
  const playerCount = Object.keys(session.players).length;
  const players = Object.values(session.players).map((p) => p.name);
  const ghostNames = session.ghosts
    ? Object.values(session.ghosts).map((g) => g.playerName)
    : [];

  const gameInfoMsg = {
    type: 'gameInfo',
    gameId,
    playerId: uniquePlayerId,
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
  try {
    context.log(`[START] connectionId=${connectionId}`);

    const found = await findPlayerByConnectionId(connectionId);
    if (!found) {
      await sendToConnection(serviceClient, connectionId, {
        type: 'error',
        text: 'You need to join a game first.',
      });
      return { body: '', status: 200 };
    }

    const { gameId, playerId } = found;
    context.log(`[START] gameId=${gameId} playerId=${playerId}`);

    let session = await loadGameState(gameId);
    if (!session) {
      await sendToConnection(serviceClient, connectionId, {
        type: 'error',
        text: 'Game session not found.',
      });
      return { body: '', status: 200 };
    }

    // Only the host can start the game
    context.log(`[START] hostPlayerId=${session.hostPlayerId} match=${session.hostPlayerId === playerId}`);
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

    // Apply death timeout if provided by host
    if (data.deathTimeout) {
      const timeout = Math.max(15, Math.min(60, parseInt(data.deathTimeout) || 30));
      session.deathTimeout = timeout;
    }

    // Apply hazard multiplier if provided by host
    if (data.hazardMultiplier) {
      const valid = [0.5, 1, 2];
      const mult = parseFloat(data.hazardMultiplier);
      session.hazardMultiplier = valid.includes(mult) ? mult : 1;
    }

    await saveGameState(gameId, session);

    // Send personalized gameStart to each player via direct connection.
    // Uses sendToConnection (like gameInfo) instead of group broadcast —
    // more reliable and gives each player their own room view with correct
    // "other players" list and ghosts.
    const playerEntries = Object.entries(session.players);
    context.log(`[START] sending gameStart to ${playerEntries.length} player(s)`);
    for (const [pid, player] of playerEntries) {
      if (player.connectionId) {
        const view = getPlayerView(session, pid);
        if (view) {
          await sendToConnection(serviceClient, player.connectionId, {
            type: 'gameStart',
            room: view,
            deathTimeout: session.deathTimeout || 30,
            hazardMultiplier: session.hazardMultiplier || 1,
          });
        }
      }
    }

    context.log(`[START] game started successfully`);
    return { body: '', status: 200 };
  } catch (err) {
    context.error(`[START] Error starting game: ${err.message}`, err.stack);
    // Notify the host so the error is visible (not silently swallowed)
    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: `Failed to start game: ${err.message}`,
    }).catch(() => {});
    return { body: '', status: 500 };
  }
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

  // Check if the player died
  const hasDeath = result.responses.some(r => r.message.type === 'death');

  // Persist updated state
  await saveGameState(gameId, session);

  // Update player record (if player is still alive)
  const player = session.players[playerId];
  if (player) {
    await savePlayer(gameId, playerId, {
      playerName: player.name,
      currentRoom: player.room,
      inventory: player.inventory,
      connectionId,
    });
  } else if (!hasDeath) {
    // Player removed for non-death reason — clean up
    await deletePlayer(gameId, playerId);
  }
  // On death, keep the player record so revive can find the game

  // Route responses — use captured connectionId for dead player's messages
  for (const resp of result.responses) {
    if (resp.playerId === 'all') {
      await sendToGame(serviceClient, gameId, resp.message);
    } else if (resp.playerId === playerId) {
      await sendToConnection(serviceClient, connectionId, resp.message);
    } else {
      const targetPlayer = session.players[resp.playerId];
      if (targetPlayer && targetPlayer.connectionId) {
        await sendToConnection(serviceClient, targetPlayer.connectionId, resp.message);
      }
    }
  }

  return { body: '', status: 200 };
}

// ── Handler: Set Death Timeout ────────────────────────────────────────

async function handleSetDeathTimeout(serviceClient, connectionId, data, context) {
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

  if (session.hostPlayerId !== playerId) {
    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: 'Only the host can set the death timeout.',
    });
    return { body: '', status: 200 };
  }

  if (session.started) {
    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: 'Cannot change death timeout after the game has started.',
    });
    return { body: '', status: 200 };
  }

  const timeout = Math.min(60, Math.max(15, Number(data.timeout) || 30));
  session.deathTimeout = timeout;
  await saveGameState(gameId, session);

  await sendToConnection(serviceClient, connectionId, {
    type: 'message',
    text: `Death timeout set to ${timeout} seconds.`,
  });

  return { body: '', status: 200 };
}

// ── Handler: Set Hazard Multiplier ──────────────────────────────────────

async function handleSetHazardMultiplier(serviceClient, connectionId, data, context) {
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

  if (session.hostPlayerId !== playerId) {
    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: 'Only the host can set the hazard danger level.',
    });
    return { body: '', status: 200 };
  }

  if (session.started) {
    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: 'Cannot change hazard danger level after the game has started.',
    });
    return { body: '', status: 200 };
  }

  const valid = [0.5, 1, 2];
  const multiplier = parseFloat(data.multiplier);
  
  if (!valid.includes(multiplier)) {
    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: 'Invalid hazard multiplier. Use 0.5 (Low), 1 (Medium), or 2 (High).',
    });
    return { body: '', status: 200 };
  }

  session.hazardMultiplier = multiplier;
  await saveGameState(gameId, session);

  const levelText = multiplier === 0.5 ? 'Low' : multiplier === 2 ? 'High' : 'Medium';
  await sendToConnection(serviceClient, connectionId, {
    type: 'message',
    text: `Hazard danger set to ${levelText}.`,
  });

  return { body: '', status: 200 };
}

// ── Handler: Revive ───────────────────────────────────────────────────

async function handleRevive(serviceClient, connectionId, data, context) {
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

  // Find the death ghost for this player by UUID
  const clientPlayerId = data.playerId || null;
  let ghostMatch = null;
  if (clientPlayerId) {
    ghostMatch = findGhostByPlayerId(session, clientPlayerId);
  }

  if (!ghostMatch) {
    await sendToConnection(serviceClient, connectionId, {
      type: 'error',
      text: 'No ghost found to revive.',
    });
    return { body: '', status: 200 };
  }

  const ghostName = ghostMatch.ghostName;
  const reviveRoom = ghostMatch.ghost.room;

  session = respawnPlayer(session, ghostName, playerId);
  session.players[playerId].connectionId = connectionId;

  await saveGameState(gameId, session);
  await savePlayer(gameId, playerId, {
    playerName: session.players[playerId].name,
    currentRoom: session.players[playerId].room,
    inventory: session.players[playerId].inventory,
    connectionId,
  });

  // Send room view to the revived player
  const view = getPlayerView(session, playerId);
  await sendToConnection(serviceClient, connectionId, {
    type: 'revived',
    room: view,
  });

  // Notify others in the room
  const playerName = session.players[playerId].name;
  for (const [, activePlayer] of Object.entries(session.players)) {
    if (activePlayer.connectionId && activePlayer.connectionId !== connectionId && activePlayer.room === reviveRoom) {
      await sendToConnection(serviceClient, activePlayer.connectionId, {
        type: 'playerEvent',
        event: 'revived',
        playerName,
        text: `${playerName} has returned from the dead!`,
      });
    }
  }

  return { body: '', status: 200 };
}