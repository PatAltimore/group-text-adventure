// cleanup.js — Timer trigger that purges game sessions older than 30 days.

import { app } from '@azure/functions';
import { cleanupOldGames } from '../table-storage.js';

app.timer('cleanup', {
  schedule: '0 0 3 * * *', // 3 AM UTC daily
  handler: async (_timer, context) => {
    context.log('Cleanup: starting daily purge of old game sessions');
    const { found, deleted } = await cleanupOldGames(30);
    context.log(`Cleanup: found ${found} games older than 30 days, deleted ${deleted}`);
  },
});
