// health.js — Simple health check endpoint for post-deploy verification.

import { app } from '@azure/functions';

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async () => {
    return {
      jsonBody: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        runtime: process.version,
        functionsLoaded: ['negotiate', 'gameHub', 'health'],
        settings: {
          webPubSubConfigured: !!process.env.WebPubSubConnectionString,
          tableStorageConfigured: !!process.env.AzureTableStorageConnectionString,
          workerIndexing: process.env.AzureWebJobsFeatureFlags,
        },
      },
    };
  },
});
