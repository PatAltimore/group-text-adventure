import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock @azure/functions before importing gameHub (prevents handler registration)
jest.unstable_mockModule('@azure/functions', () => ({
  app: { generic: jest.fn() },
  trigger: { generic: jest.fn() },
}), { virtual: true });

// Mock @azure/web-pubsub
jest.unstable_mockModule('@azure/web-pubsub', () => ({
  WebPubSubServiceClient: jest.fn(),
}), { virtual: true });

// Mock table-storage
const mockLoadGameState = jest.fn();
const mockSaveGameState = jest.fn();
const mockSaveGameSession = jest.fn();
const mockSavePlayer = jest.fn();
const mockDeletePlayer = jest.fn();
jest.unstable_mockModule('../api/src/table-storage.js', () => ({
  initTables: jest.fn(),
  saveGameSession: mockSaveGameSession,
  getGameSession: jest.fn(),
  savePlayer: mockSavePlayer,
  deletePlayer: mockDeletePlayer,
  findPlayerByConnectionId: jest.fn(),
  saveGameState: mockSaveGameState,
  loadGameState: mockLoadGameState,
}));

// Mock fs/promises for getWorld
jest.unstable_mockModule('fs/promises', () => ({
  readFile: jest.fn(),
}));

const { readFile } = await import('fs/promises');
const { handleJoin } = await import('../api/src/functions/gameHub.js');
const testWorldData = (await import('./test-world.json', { assert: { type: 'json' } })).default;

// Helpers
function mockServiceClient() {
  return {
    sendToConnection: jest.fn(),
    addConnectionToGroup: jest.fn(),
    sendToGroup: jest.fn(),
  };
}

function mockContext() {
  return {
    connectionId: 'conn-123',
    log: jest.fn(),
    warn: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════
// Game Not Found — non-host joining a deleted/expired game
// ════════════════════════════════════════════════════════════════════════

describe('handleJoin — game not found', () => {
  test('non-host joining non-existent game gets gameNotFound response', async () => {
    mockLoadGameState.mockResolvedValue(null);

    const sc = mockServiceClient();
    const ctx = mockContext();

    const result = await handleJoin(sc, 'conn-123', {
      playerName: 'Alice',
      gameId: 'EXPIRED1',
      // no worldId — this is a joiner, not a host
    }, ctx);

    // Should have sent a gameNotFound message to the connection
    expect(sc.sendToConnection).toHaveBeenCalledTimes(1);
    const [connId, message, options] = sc.sendToConnection.mock.calls[0];
    expect(connId).toBe('conn-123');
    expect(message.type).toBe('gameNotFound');
    expect(message.gameId).toBe('EXPIRED1');
    expect(message.text).toMatch(/no longer exists/i);

    // Should return the standard HTTP response
    expect(result).toEqual({ body: '', status: 200 });

    // Should NOT have created a game session
    expect(mockSaveGameSession).not.toHaveBeenCalled();
    expect(mockSaveGameState).not.toHaveBeenCalled();
  });

  test('host creating a new game with worldId still auto-creates', async () => {
    mockLoadGameState.mockResolvedValue(null);
    mockSaveGameSession.mockResolvedValue(undefined);
    mockSaveGameState.mockResolvedValue(undefined);
    mockSavePlayer.mockResolvedValue(undefined);
    readFile.mockResolvedValue(JSON.stringify(testWorldData));

    const sc = mockServiceClient();
    const ctx = mockContext();

    const result = await handleJoin(sc, 'conn-host', {
      playerName: 'HostPlayer',
      gameId: 'NEW-GAME',
      worldId: 'test-world',
    }, ctx);

    // Should NOT have sent gameNotFound
    const sentMessages = sc.sendToConnection.mock.calls.map(c => c[1]);
    const notFoundMessages = sentMessages.filter(m => m.type === 'gameNotFound');
    expect(notFoundMessages).toHaveLength(0);

    // Should have created the game session
    expect(mockSaveGameSession).toHaveBeenCalledWith(
      'NEW-GAME',
      expect.objectContaining({ worldId: 'test-world' }),
    );

    // Should have saved game state (player was added)
    expect(mockSaveGameState).toHaveBeenCalled();

    // Should return the standard HTTP response
    expect(result).toEqual({ body: '', status: 200 });
  });
});
