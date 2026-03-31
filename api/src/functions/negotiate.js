// negotiate.js — HTTP trigger that returns a Web PubSub client access URL.
// The client calls this endpoint to get a WebSocket URL for a specific game.

import { app } from '@azure/functions';
import { WebPubSubServiceClient } from '@azure/web-pubsub';

const connectionString = process.env.WebPubSubConnectionString;
const hubName = process.env.WebPubSubHubName || 'gameHub';

app.http('negotiate', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'negotiate',
  handler: async (request, context) => {
    const gameId = request.query.get('gameId');

    if (!gameId) {
      return {
        status: 400,
        jsonBody: { error: 'Missing required query parameter: gameId' },
      };
    }

    if (!connectionString) {
      context.error('WebPubSubConnectionString is not configured.');
      return {
        status: 500,
        jsonBody: { error: 'Server misconfigured: Web PubSub connection string not set.' },
      };
    }

    try {
      const serviceClient = new WebPubSubServiceClient(connectionString, hubName);
      const token = await serviceClient.getClientAccessToken({
        groups: [gameId],
        roles: [`webpubsub.sendToGroup.${gameId}`, `webpubsub.joinLeaveGroup.${gameId}`],
      });

      return {
        jsonBody: {
          url: token.url,
          gameId,
        },
      };
    } catch (err) {
      context.error('Failed to generate Web PubSub token:', err);
      return {
        status: 500,
        jsonBody: { error: 'Failed to generate connection token.' },
      };
    }
  },
});
