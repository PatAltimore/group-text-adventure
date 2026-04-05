// validate-world.js — Universal world JSON validator.
// Works in both browser (ES module) and Node.js.

const VALID_DIRECTIONS = new Set(['north', 'south', 'east', 'west']);
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };

/**
 * Validate a world JSON object for correctness.
 * @param {object} worldData - Raw world definition.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateWorld(worldData) {
  const errors = [];
  const warnings = [];

  if (!worldData || typeof worldData !== 'object') {
    errors.push('World data must be a non-null object.');
    return { valid: false, errors, warnings };
  }

  // 1. name is required and must be a non-empty string
  if (!worldData.name || typeof worldData.name !== 'string' || worldData.name.trim() === '') {
    errors.push('\"name\" is required and must be a non-empty string.');
  }

  const rooms = worldData.rooms || {};
  const items = worldData.items || {};
  const puzzles = worldData.puzzles || {};
  const roomIds = new Set(Object.keys(rooms));
  const itemIds = new Set(Object.keys(items));

  // 3. rooms must have at least 1 room
  if (roomIds.size === 0) {
    errors.push('\"rooms\" must contain at least 1 room.');
  }

  // 2. startRoom is required and must reference an existing room
  if (!worldData.startRoom || typeof worldData.startRoom !== 'string') {
    errors.push('\"startRoom\" is required and must be a string.');
  } else if (!roomIds.has(worldData.startRoom)) {
    errors.push(`\"startRoom\" references non-existent room \"${worldData.startRoom}\".`);
  }

  // Track inbound connections for orphan detection
  const inboundConnections = new Set();
  // Track items placed in rooms
  const placedItems = new Set();

  // 4-7. Validate each room
  for (const [roomId, room] of Object.entries(rooms)) {
    if (!room || typeof room !== 'object') {
      errors.push(`Room \"${roomId}\" must be an object.`);
      continue;
    }

    // 4. Each room must have name (string), description (string), exits (object)
    if (!room.name || typeof room.name !== 'string') {
      errors.push(`Room \"${roomId}\": \"name\" is required and must be a string.`);
    }
    if (!room.description || typeof room.description !== 'string') {
      errors.push(`Room \"${roomId}\": \"description\" is required and must be a string.`);
    }
    if (!room.exits || typeof room.exits !== 'object') {
      errors.push(`Room \"${roomId}\": \"exits\" is required and must be an object.`);
      continue;
    }

    for (const [direction, targetRoom] of Object.entries(room.exits)) {
      // 6. Each exit direction must be one of: north, south, east, west
      if (!VALID_DIRECTIONS.has(direction)) {
        errors.push(`Room \"${roomId}\": exit direction \"${direction}\" is invalid. Must be north, south, east, or west.`);
      }

      // 5. Each exit must reference an existing room
      if (!roomIds.has(targetRoom)) {
        errors.push(`Room \"${roomId}\": exit \"${direction}\" references non-existent room \"${targetRoom}\".`);
      } else {
        inboundConnections.add(targetRoom);
      }
    }

    // 7. Bidirectional exit check (warning)
    for (const [direction, targetRoom] of Object.entries(room.exits)) {
      if (!VALID_DIRECTIONS.has(direction) || !roomIds.has(targetRoom)) continue;
      const opposite = OPPOSITE[direction];
      const target = rooms[targetRoom];
      if (target && target.exits && !target.exits[opposite]) {
        // Check if this exit is opened by a puzzle (puzzle-gated exits are intentionally one-way until solved)
        const isPuzzleGated = Object.values(puzzles).some(
          p => p.action && p.action.type === 'openExit' &&
               p.action.direction === opposite && p.action.targetRoom === roomId &&
               p.room === targetRoom
        );
        if (!isPuzzleGated) {
          warnings.push(`Room \"${targetRoom}\" has no \"${opposite}\" exit back to \"${roomId}\". Exit connections are typically bidirectional.`);
        }
      }
    }

    // 8. Items referenced in rooms must exist in the items section
    if (Array.isArray(room.items)) {
      for (const itemRef of room.items) {
        if (!itemIds.has(itemRef)) {
          errors.push(`Room \"${roomId}\": references non-existent item \"${itemRef}\".`);
        } else {
          placedItems.add(itemRef);
        }
      }
    }

    // 8b. Validate hazards — must be objects with { description, probability, deathText }
    if (Array.isArray(room.hazards)) {
      for (let i = 0; i < room.hazards.length; i++) {
        const hazard = room.hazards[i];
        if (typeof hazard === 'string') {
          warnings.push(`Room \"${roomId}\": hazard[${i}] is a plain string. Consider using object format { description, probability, deathText }.`);
        } else if (hazard && typeof hazard === 'object') {
          if (!hazard.description || typeof hazard.description !== 'string') {
            errors.push(`Room \"${roomId}\": hazard[${i}].description is required and must be a string.`);
          }
          if (typeof hazard.probability !== 'number') {
            errors.push(`Room \"${roomId}\": hazard[${i}].probability is required and must be a number.`);
          } else if (hazard.probability < 0 || hazard.probability > 1) {
            errors.push(`Room \"${roomId}\": hazard[${i}].probability must be between 0 and 1.`);
          }
          if (typeof hazard.deathText !== 'string') {
            errors.push(`Room \"${roomId}\": hazard[${i}].deathText is required and must be a string.`);
          }
        } else {
          errors.push(`Room \"${roomId}\": hazard[${i}] must be a string or an object with { description, probability, deathText }.`);
        }
      }
    }

    // Warning: rooms with no items and no hazards (empty rooms)
    const hasItems = Array.isArray(room.items) && room.items.length > 0;
    const hasHazards = Array.isArray(room.hazards) && room.hazards.length > 0;
    if (!hasItems && !hasHazards) {
      warnings.push(`Room \"${roomId}\" has no items and no hazards (empty room).`);
    }

    // Validate hazard entries
    if (Array.isArray(room.hazards)) {
      for (let i = 0; i < room.hazards.length; i++) {
        const hazard = room.hazards[i];
        if (typeof hazard === 'string') {
          // Old format — valid (normalized by loadWorld)
          continue;
        }
        if (typeof hazard === 'object' && hazard !== null) {
          if (typeof hazard.description !== 'string' || !hazard.description.trim()) {
            errors.push(`Room \"${roomId}\": hazard[${i}] must have a non-empty \"description\" string.`);
          }
          if (typeof hazard.probability !== 'number' || hazard.probability < 0 || hazard.probability > 1) {
            errors.push(`Room \"${roomId}\": hazard[${i}] \"probability\" must be a number between 0 and 1.`);
          }
          if (typeof hazard.deathText !== 'string') {
            errors.push(`Room \"${roomId}\": hazard[${i}] must have a \"deathText\" string.`);
          }
        } else {
          errors.push(`Room \"${roomId}\": hazard[${i}] must be a string or a hazard object.`);
        }
      }
    }
  }

  // 9. Each item must have name (string) and description (string); roomText is optional
  for (const [itemId, item] of Object.entries(items)) {
    if (!item || typeof item !== 'object') {
      errors.push(`Item \"${itemId}\" must be an object.`);
      continue;
    }
    if (!item.name || typeof item.name !== 'string') {
      errors.push(`Item \"${itemId}\": \"name\" is required and must be a string.`);
    }
    if (!item.description || typeof item.description !== 'string') {
      errors.push(`Item \"${itemId}\": \"description\" is required and must be a string.`);
    }
    if (item.roomText !== undefined && typeof item.roomText !== 'string') {
      errors.push(`Item \"${itemId}\": \"roomText\" must be a string when provided.`);
    }
  }

  // 10-12. Validate puzzles
  for (const [puzzleId, puzzle] of Object.entries(puzzles)) {
    if (!puzzle || typeof puzzle !== 'object') {
      errors.push(`Puzzle \"${puzzleId}\" must be an object.`);
      continue;
    }

    // 10. Puzzle room must reference an existing room
    if (puzzle.room && !roomIds.has(puzzle.room)) {
      errors.push(`Puzzle \"${puzzleId}\": \"room\" references non-existent room \"${puzzle.room}\".`);
    }

    // 11. Puzzle requiredItem must reference an existing item
    if (puzzle.requiredItem && !itemIds.has(puzzle.requiredItem)) {
      errors.push(`Puzzle \"${puzzleId}\": \"requiredItem\" references non-existent item \"${puzzle.requiredItem}\".`);
    }

    // 12. Puzzle action room references must reference existing rooms
    if (puzzle.action) {
      if (puzzle.action.targetRoom && !roomIds.has(puzzle.action.targetRoom)) {
        errors.push(`Puzzle \"${puzzleId}\": action \"targetRoom\" references non-existent room \"${puzzle.action.targetRoom}\".`);
      }
      if (puzzle.action.room && !roomIds.has(puzzle.action.room)) {
        errors.push(`Puzzle \"${puzzleId}\": action \"room\" references non-existent room \"${puzzle.action.room}\".`);
      }
      // Track puzzle target rooms as inbound connections
      if (puzzle.action.type === 'openExit' && puzzle.action.targetRoom && roomIds.has(puzzle.action.targetRoom)) {
        inboundConnections.add(puzzle.action.targetRoom);
      }
    }
  }

  // 13. Orphan rooms — rooms with no exits connecting to/from them (warning)
  // A room is orphan if nothing connects TO it (no inbound) and it's not startRoom
  for (const roomId of roomIds) {
    if (roomId === worldData.startRoom) continue;
    if (!inboundConnections.has(roomId)) {
      warnings.push(`Room \"${roomId}\" is an orphan — no exits or puzzles connect to it.`);
    }
  }

  // Warning: Items defined but never placed in any room
  // Also consider items referenced by puzzle addItem actions as "placed"
  for (const puzzle of Object.values(puzzles)) {
    if (puzzle.action && puzzle.action.type === 'addItem' && puzzle.action.itemId) {
      placedItems.add(puzzle.action.itemId);
    }
    if (puzzle.requiredItem) {
      placedItems.add(puzzle.requiredItem);
    }
  }
  for (const itemId of itemIds) {
    if (!placedItems.has(itemId)) {
      warnings.push(`Item \"${itemId}\" is defined but never placed in any room or referenced by puzzles.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
