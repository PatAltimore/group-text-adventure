// worlds.js — HTTP endpoint to list available adventure worlds.

import { app } from '@azure/functions';
import { readFile, readdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/**
 * Resolve candidate directories where world JSON files may live.
 * Same pattern as gameHub.js: deployed path and local dev path.
 */
function getWorldDirectories() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return [
    join(__dirname, '..', '..', 'world'),
    join(__dirname, '..', '..', '..', 'world'),
  ];
}

/**
 * Scan for world JSON files and return their id, name, and description.
 */
async function listWorlds() {
  const candidates = getWorldDirectories();

  for (const worldDir of candidates) {
    try {
      const files = await readdir(worldDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      const worlds = [];
      for (const file of jsonFiles) {
        try {
          const raw = await readFile(join(worldDir, file), 'utf-8');
          const data = JSON.parse(raw);
          worlds.push({
            id: file.replace(/\.json$/, ''),
            name: data.name || file,
            description: data.description || '',
            synopsis: data.synopsis || '',
          });
        } catch {
          // Skip malformed files
          continue;
        }
      }

      return worlds;
    } catch {
      // Directory not found — try next candidate
      continue;
    }
  }

  return [];
}

app.http('worlds', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'worlds',
  handler: async (request, context) => {
    try {
      const worlds = await listWorlds();
      context.log(`[worlds] Found ${worlds.length} world(s)`);
      return { jsonBody: worlds };
    } catch (err) {
      context.error('[worlds] Failed to list worlds:', err);
      return { status: 500, jsonBody: { error: 'Failed to list worlds' } };
    }
  },
});
