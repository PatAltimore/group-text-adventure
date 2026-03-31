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

/**
 * Save serialized game session state (room states, puzzle states, player states).
 * @param {string} gameId
 * @param {object} sessionState - The full game session object from game-engine.
 */
export async function saveGameState(gameId, sessionState) {
  const client = getTableClient('GameState');
  // Table Storage has a 64KB property limit; chunk if needed
  const stateJson = JSON.stringify(sessionState);
  await client.upsertEntity({
    partitionKey: gameId,
    rowKey: 'state',
    stateJson,
    updatedAt: new Date().toISOString(),
  });
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
