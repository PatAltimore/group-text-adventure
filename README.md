# 🏰 Group Text Adventure

**A real-time multiplayer text adventure game.**

Gather 1–20 players, explore a shared world, solve puzzles, and collaborate to find the ultimate treasure. Navigate dungeons, manage inventory, and communicate with teammates in real time.

🎮 **[Play the Live Demo](https://textgtagame.z5.web.core.windows.net)** — Try it now!

---

## About the Game

Group Text Adventure is a browser-based multiplayer game where players explore rooms, collect items, solve puzzles, and work together to reach the goal. The host creates a game session and shares a link; everyone joins instantly with no install required.

**Key features:**

- **1–20 Multiplayer** — Host and join games via URL or QR code
- **Multiple Worlds** — Choose from 6 pre-built adventures or create your own
- **Customizable Lobby** — Host adjusts Respawn Timer, Hazard Danger, Say Scope, and Puzzle Hints
- **Hazard System** — Rooms can contain hazards; defeated players respawn after a timer
- **Ghost System** — Dead or disconnected players become ghosts; their items drop to the floor
- **Puzzle Rooms** — 🧩 Emoji marks puzzle rooms; solve them with the right items
- **Goal System** — Completing all goals triggers a victory screen for everyone
- **Map Command** — ASCII map shows visited rooms and nearby unexplored areas
- **World Editor** — Build custom worlds visually at `<game-url>/editor.html`

---

## How to Play

### Quick Start

1. **Host a Game** — Enter your name and select a world
2. **Configure Lobby** — Adjust settings (optional)
3. **Create Game** — Click "Host New Game"
4. **Share the Link** — Invite friends via the Share button or QR code
5. **Start When Ready** — Click "Start Game" once everyone joins
6. **Explore Together** — Use commands to move, interact, solve puzzles, and avoid hazards

### Commands

| Command | Syntax | Example |
|---------|--------|---------|
| **Go** | `go <direction>` or `n/s/e/w` | `go north` or `n` |
| **Look** | `look` or `look <item>` | `look torch` |
| **Examine** | `examine <item>` | `examine torch` |
| **Get** | `get <item>` or `get items` or `g` | `get torch` |
| **Drop** | `drop <item>` | `drop torch` |
| **Inventory** | `inventory` or `i` | `i` |
| **Use** | `use <item>` | `use key` |
| **Give** | `give <item> to <player>` | `give key to Alice` |
| **Say** | `say <message>` | `say Help me!` |
| **Map** | `map` | `map` |
| **Help** | `help` | `help` |

All item commands support **partial name matching** — `get torch` matches "wooden torch" or "silver torch". If multiple items match, the game asks you to be more specific.

---

## Worlds

Choose from six pre-built adventures, or create your own by adding a JSON file to the `world/` directory.

| World | Theme | File |
|-------|-------|------|
| 🏰 The Forgotten Castle | Medieval fantasy castle | `default-world.json` |
| 🕰️ The Clockmaker's Mansion | Victorian steampunk escape room | `escape-room.json` |
| 🚀 Space Station | Sci-fi survival | `space-adventure.json` |
| 🔺 The Lost Pyramid | Ancient Egyptian expedition | `egyptian-pyramid.json` |
| 👻 Blackwood Manor | Haunted mansion mystery | `mystery-house.json` |
| 👽 Paranormal Mysteries | Cryptids, aliens, and UFOs | `paranormal-mysteries.json` |

---

## Configuring the World JSON

Worlds are defined as JSON files in the `world/` directory. No code changes are needed — just add or edit a `.json` file.

### Top-Level Structure

```json
{
  "name": "World Name",
  "description": "Brief description shown on the world selection screen",
  "startRoom": "entrance"
}
```

### Rooms

```json
"rooms": {
  "entrance": {
    "name": "Castle Entrance",
    "description": "You stand before a massive iron gate.",
    "exits": {
      "north": "courtyard",
      "east": "guardhouse"
    },
    "items": ["torch", "key"],
    "hazards": [
      {
        "description": "A loose flagstone gives way!",
        "probability": 0.2,
        "deathText": "You fall into a pit."
      }
    ]
  }
}
```

- **exits** — Maps direction names (`north`, `south`, `east`, `west`, `up`, `down`) to room IDs
- **items** — List of item IDs starting in this room
- **hazards** — Optional. `probability` is a 0–1 chance of triggering on entry; `deathText` is shown on death

### Items

```json
"items": {
  "torch": {
    "name": "Wooden Torch",
    "description": "A flickering torch that lights the way.",
    "roomText": "A torch is mounted on the wall.",
    "pickupText": "You grab the torch.",
    "portable": true
  },
  "gate": {
    "name": "Iron Gate",
    "description": "A heavy locked gate.",
    "portable": false
  }
}
```

- **roomText** — Text shown when the item is in the room (optional; defaults to item name)
- **portable** — Set to `false` for fixed scenery items that cannot be picked up

### Puzzles

```json
"puzzles": {
  "openGate": {
    "room": "entrance",
    "requiredItem": "key",
    "solvedText": "The gate swings open!",
    "isGoal": true,
    "hint": "You need something to unlock the gate.",
    "action": {
      "type": "openExit",
      "direction": "north",
      "targetRoom": "courtyard"
    }
  }
}
```

- **room** — The room ID where this puzzle can be solved
- **requiredItem** — Item ID the player must `use` to solve the puzzle
- **isGoal** — When `true`, completing this puzzle counts toward the group victory condition
- **hint** — Shown when puzzle hints are enabled in lobby settings
- **action.type** — Currently supports `openExit` (unlocks a new direction) and `removeItem` (removes an item from a room)

### Full Example

```json
{
  "name": "The Forgotten Castle",
  "description": "A medieval castle with hidden secrets.",
  "startRoom": "entrance",
  "rooms": {
    "entrance": {
      "name": "Castle Entrance",
      "description": "A cold stone passage leads inside.",
      "exits": { "north": "great-hall" },
      "items": ["torch"]
    },
    "great-hall": {
      "name": "Great Hall",
      "description": "A vast hall with a locked door to the north.",
      "exits": { "south": "entrance" },
      "items": ["key"]
    }
  },
  "items": {
    "torch": {
      "name": "Torch",
      "description": "A burning torch.",
      "portable": true
    },
    "key": {
      "name": "Old Key",
      "description": "A rusted iron key.",
      "pickupText": "You pocket the key.",
      "portable": true
    }
  },
  "puzzles": {
    "unlockDoor": {
      "room": "great-hall",
      "requiredItem": "key",
      "solvedText": "The door unlocks with a click.",
      "isGoal": true,
      "action": {
        "type": "openExit",
        "direction": "north",
        "targetRoom": "treasure-room"
      }
    }
  }
}
```

---

## License

MIT License © 2026 Pat Altimore. See [LICENSE](LICENSE) for details.
