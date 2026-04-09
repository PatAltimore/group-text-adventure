// table-storage.js — Azure Table Storage data access layer.
// Provides persistence for game sessions, players, and game state.

import { TableClient, TableServiceClient } from '@azure/data-tables';

const CONNECTION_STRING =
  process.env.AzureTableStorageConnectionString || 'UseDevelopmentStorage=true';

let tableClients = {};

function getTableClient(tableName) {
  if (!tableClients[tableName]) {
    tableClients[tableName] = TableClient.fromConnectionString(CONNECTION_STRING, tableName);
  }
  return tableClients[tableName];
}

/**
 * Ensure all required tables exist.
 */
export async function initTables() {
  const tableNames = ['GameSessions', 'Players', 'GameState'];
  const serviceClient = TableServiceClient.fromConnectionString(CONNECTION_STRING);
  for (const name of tableNames) {
    try {
      await serviceClient.createTable(name);
    } catch (err) {
      // 409 = table already exists, which is fine
      if (err.statusCode !== 409) throw err;
    }
  }
}

// ── Game Sessions ─────────────────────────────────────────────────────

/**
 * Save a game session record.
 * @param {string} gameId
 * @param {object} data - { worldName, createdAt, hostConnectionId }
 */
export async function saveGameSession(gameId, data) {
  const client = getTableClient('GameSessions');
  await client.upsertEntity({
    partitionKey: 'game',
    rowKey: gameId,
    worldName: data.worldName || '',
    createdAt: data.createdAt || new Date().toISOString(),
    hostConnectionId: data.hostConnectionId || '',
  });
}

/**
 * Get a game session record.
 * @param {string} gameId
 * @returns {object|null}
 */
export async function getGameSession(gameId) {
  const client = getTableClient('GameSessions');
  try {
    return await client.getEntity('game', gameId);
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

/**
 * Delete a game session record.
 * @param {string} gameId
 */
export async function deleteGameSession(gameId) {
  const client = getTableClient('GameSessions');
  try {
    await client.deleteEntity('game', gameId);
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
}

// ── Players ───────────────────────────────────────────────────────────

/**
 * Save a player record.
 * @param {string} gameId
 * @param {string} playerId
 * @param {object} data - { playerName, currentRoom, inventory, connectionId }
 */
export async function savePlayer(gameId, playerId, data) {
  const client = getTableClient('Players');
  await client.upsertEntity({
    partitionKey: gameId,
    rowKey: playerId,
    playerName: data.playerName || '',
    currentRoom: data.currentRoom || '',
    inventory: JSON.stringify(data.inventory || []),
    connectionId: data.connectionId || '',
  });
}

/**
 * Get a player record.
 * @param {string} gameId
 * @param {string} playerId
 * @returns {object|null}
 */
export async function getPlayer(gameId, playerId) {
  const client = getTableClient('Players');
  try {
    const entity = await client.getEntity(gameId, playerId);
    return {
      ...entity,
      inventory: JSON.parse(entity.inventory || '[]'),
    };
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

/**
 * List all players in a game session.
 * @param {string} gameId
 * @returns {Array<object>}
 */
export async function listPlayers(gameId) {
  const client = getTableClient('Players');
  const players = [];
  const iter = client.listEntities({
    queryOptions: { filter: `PartitionKey eq '${gameId}'` },
  });
  for await (const entity of iter) {
    players.push({
      ...entity,
      inventory: JSON.parse(entity.inventory || '[]'),
    });
  }
  return players;
}

/**
 * Delete a player record.
 * @param {string} gameId
 * @param {string} playerId
 */
export async function deletePlayer(gameId, playerId) {
  const client = getTableClient('Players');
  try {
    await client.deleteEntity(gameId, playerId);
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
}

/**
 * Find a player by their WebSocket connection ID across all games.
 * @param {string} connectionId
 * @returns {{ gameId: string, playerId: string, entity: object }|null}
 */
export async function findPlayerByConnectionId(connectionId) {
  const client = getTableClient('Players');
  const iter = client.listEntities({
    queryOptions: { filter: `connectionId eq '${connectionId}'` },
  });
  for await (const entity of iter) {
    return {
      gameId: entity.partitionKey,
      playerId: entity.rowKey,
      entity: { ...entity, inventory: JSON.parse(entity.inventory || '[]') },
    };
  }
  return null;
}

// ── Game State ────────────────────────────────────────────────────────

// Azure Table Storage limits string properties to 32K characters (UTF-16).
// Large game sessions (worlds with many rooms/items) can exceed this.
// We chunk the JSON across numbered properties: stateJson_0, stateJson_1, etc.
const STATE_CHUNK_SIZE = 30000; // chars per chunk, with safety margin

/**
 * Save serialized game session state (room states, puzzle states, player states).
 * @param {string} gameId
 * @param {object} sessionState - The full game session object from game-engine.
 */
export async function saveGameState(gameId, sessionState) {
  const client = getTableClient('GameState');
  const stateJson = JSON.stringify(sessionState);

  const entity = {
    partitionKey: gameId,
    rowKey: 'state',
    updatedAt: new Date().toISOString(),
  };

  if (stateJson.length <= STATE_CHUNK_SIZE) {
    entity.stateJson = stateJson;
    entity.chunkCount = 0;
  } else {
    const chunks = [];
    for (let i = 0; i < stateJson.length; i += STATE_CHUNK_SIZE) {
      chunks.push(stateJson.substring(i, i + STATE_CHUNK_SIZE));
    }
    for (let i = 0; i < chunks.length; i++) {
      entity[`stateJson_${i}`] = chunks[i];
    }
    entity.chunkCount = chunks.length;
  }

  await client.upsertEntity(entity);
}

/**
 * Load serialized game session state.
 * @param {string} gameId
 * @returns {object|null} The game session object, or null if not found.
 */
export async function loadGameState(gameId) {
  const client = getTableClient('GameState');
  try {
    const entity = await client.getEntity(gameId, 'state');

    if (entity.chunkCount && entity.chunkCount > 0) {
      let stateJson = '';
      for (let i = 0; i < entity.chunkCount; i++) {
        stateJson += entity[`stateJson_${i}`] || '';
      }
      return JSON.parse(stateJson);
    }

    return JSON.parse(entity.stateJson);
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

/**
 * Delete game state.
 * @param {string} gameId
 */
export async function deleteGameState(gameId) {
  const client = getTableClient('GameState');
  try {
    await client.deleteEntity(gameId, 'state');
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────

/**
 * Delete game sessions older than the specified number of days, along with
 * their associated Players and GameState entries.
 * @param {number} [maxAgeDays=30]
 * @returns {{ found: number, deleted: number }}
 */
export async function cleanupOldGames(maxAgeDays = 30) {
  const sessionsClient = getTableClient('GameSessions');
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  // Collect old game IDs
  const oldGameIds = [];
  const iter = sessionsClient.listEntities({
    queryOptions: { filter: `PartitionKey eq 'game'` },
  });
  for await (const entity of iter) {
    const createdAt = entity.createdAt ? new Date(entity.createdAt) : null;
    if (createdAt && createdAt < cutoff) {
      oldGameIds.push(entity.rowKey);
    }
  }

  let deleted = 0;
  for (const gameId of oldGameIds) {
    try {
      // Delete all players for this game
      const players = await listPlayers(gameId);
      for (const player of players) {
        await deletePlayer(gameId, player.rowKey);
      }
      // Delete game state
      await deleteGameState(gameId);
      // Delete the session itself
      await deleteGameSession(gameId);
      deleted++;
    } catch (err) {
      // Log but continue — don't let one bad game block the rest
      console.error(`Cleanup: failed to delete game ${gameId}:`, err.message);
    }
  }

  return { found: oldGameIds.length, deleted };
}
