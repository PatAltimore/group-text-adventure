# 🏰 Group Text Adventure

**A real-time multiplayer text adventure game built on Azure.**

Gather 1–20 players, explore a shared world, solve puzzles, and collaborate to find the ultimate treasure. Using voice commands (or text), navigate dungeons, manage inventory, and communicate with teammates in real time via WebSocket.

🎮 **[Play the Live Demo](https://textgtagame.z5.web.core.windows.net)** — Try it now!

---

## Features

- **1–20 Multiplayer** — Host and join games via URL or QR code; use Web Share API or clipboard to invite
- **Multiple Worlds** — Choose from 6 pre-built adventures (Forgotten Castle, Clockmaker's Mansion, Space Station, The Lost Pyramid, Blackwood Manor, Paranormal Mysteries) or create your own
- **Customizable Lobby Settings** — Host can adjust Respawn Timer (15–60s), Hazard Danger (Low/Medium/High), Say Scope (Room Only/Global), and Puzzle Hints (Enabled/Disabled)
- **Real-Time Sync** — All actions broadcast instantly via Web PubSub
- **Hazard System** — Rooms can contain hazards with variable death probability; defeated players respawn after timer expires
- **Ghost System** — Dead or disconnected players become ghosts; items drop to room floor immediately; others can pick them up with the "get" command
- **Auto-Reconnection** — Refresh your browser and rejoin seamlessly with your progress
- **Puzzle Rooms** — 🧩 Emoji prefix marks puzzle rooms; optional hints show required items
- **Goal System** — Puzzles marked as goals trigger ASCII art celebrations when solved and broadcast to all players. When all goals are completed, a victory screen celebrates the entire group's success. Goal progress is displayed in the room view.
- **Map Command** — Navigate with an ASCII map showing visited rooms up to 2 rooms away. Current room marked with [*], unvisited rooms shown as [?].
- **Displaced Items** — Items not in their original room display distinctly as "dropped items"
- **Explore & Interact** — Navigate rooms, examine items, collect treasures
- **Collaborative Puzzles** — Solve challenges that require teamwork and item trading
- **Inventory & Items** — Pick up, drop, use, and give items to other players
- **Direct Communication** — Say messages to players in the same room (or globally, per lobby settings)
- **Room Awareness** — See who's nearby and what's in each room
- **Share Link & QR Code** — Share button copies the join URL instantly. QR Code button displays a scannable QR code for easy mobile joining. QR code always visible on host screen.
- **Host New Game Button** — Easily start a fresh game from the game header without navigating away.
- **Improved Help Command** — Help text now features clear sections and enhanced readability for easier command discovery.
- **World Editor** — Create and edit custom worlds visually with the built-in editor. Visit `<game-url>/editor.html` (e.g., https://textgtagame.z5.web.core.windows.net/editor.html) to design your own worlds interactively

---

## How to Play

### Supported Commands

| Command | Syntax | Example |
|---------|--------|---------|
| **Go** | `go <direction>` or shortcut `<n/s/e/w>` | `go north` or `n` |
| **Look** | `look` or `look <item>` | `look` or `look torch` |
| **Examine** | `examine <item>` | `examine torch` |
| **Get** | `get <item>` or `get items` or `g` | `get torch` or `get items` or `g` |
| **Drop** | `drop <item>` | `drop torch` |
| **Inventory** | `inventory` or `i` | `i` |
| **Use** | `use <item>` | `use key` |
| **Give** | `give <item> to <player>` | `give key to Alice` |
| **Say** | `say <message>` | `say Help me with the puzzle!` |
| **Map** | `map` | `map` |
| **Help** | `help` | `help` |

### Partial Name Matching

All item commands support **partial/fuzzy name matching**, so you don't need to type the full item name:
- ✅ `look book` matches "red book" or "old book"
- ✅ `get torch` matches "wooden torch" or "silver torch"
- ✅ `examine statue` matches "golden statue"
- ✅ `drop key` matches "brass key"
- ✅ `use lock` matches "silver lock" or "iron lock"
- ✅ `give ring to Alice` matches "golden ring"

**Disambiguation:** If multiple items match (e.g., "old book" and "red book" both match "book"), the game will ask you to be more specific. Simply add another word to distinguish them.

### Quick Start

1. **Host a Game** — Enter your name and select a world
2. **Configure Lobby** — Adjust Respawn Timer, Hazard Danger, Say Scope, and Puzzle Hints (optional)
3. **Create Game** — Click "Host New Game"
4. **Share the Link** — Click the Share button to invite friends via Web Share API or clipboard
5. **Start When Ready** — Once everyone joins, click "Start Game"
6. **Explore Together** — Use commands to move, interact, solve puzzles, and avoid hazards
7. **Collaborate** — Trade items, solve challenges, reach the treasure; dead players respawn after the timer

---

## Architecture

The game runs on Azure serverless infrastructure:

```
┌──────────────────┐
│   Web Browser    │
│  (Vanilla JS)    │
└────────┬─────────┘
         │ WebSocket
         ▼
┌──────────────────────────┐       ┌─────────────────┐
│   Azure Web PubSub       │─────> │  Azure Functions│
│   (Real-time messaging)  │       │  (Game logic)   │
└──────────────────────────┘       └────────┬────────┘
                                            │
                                            ▼
                                  ┌─────────────────┐
                                  │  Azure Table    │
                                  │  Storage        │
                                  │  (Game state)   │
                                  └─────────────────┘
```

**Data Flow:**

1. Player opens static website (hosted on Azure Storage)
2. Client calls `/api/negotiate` to get a Web PubSub connection token
3. Client connects to Web PubSub via WebSocket
4. Commands flow through Web PubSub → Azure Functions (game engine) → Table Storage
5. Game state is broadcast back to all connected players in real time

**Key API Endpoints:**

- `/api/negotiate` — Web PubSub connection setup
- `/api/gameHub` — Core game logic handler
- `/api/worlds` — List available world definitions
- `/api/health` — Service health check

---

## The Worlds

Choose from six pre-built adventures, each with unique themes, puzzles, and challenges:

### 🏰 The Forgotten Castle
- **Theme:** Medieval fantasy castle exploration
- **Highlights:** 9 items, 4 puzzles, hidden throne room, secret garden
- **File:** `default-world.json`

### 🕰️ The Clockmaker's Mansion
- **Theme:** Victorian steampunk escape room
- **Highlights:** Time-based puzzles, intricate mechanisms, mysterious artifacts
- **File:** `escape-room.json`

### 🚀 Space Station
- **Theme:** Sci-fi space station survival
- **Highlights:** Technical challenges, alien artifacts, zero-gravity navigation
- **File:** `space-adventure.json`

### 🔺 The Lost Pyramid
- **Theme:** Ancient Egyptian expedition and treasure hunt
- **Highlights:** Hieroglyphic puzzles, hidden chambers, ancient traps
- **File:** `pyramid-world.json`

### 👻 Blackwood Manor
- **Theme:** Spooky haunted mansion mystery
- **Highlights:** Supernatural encounters, hidden secrets, eerie atmosphere
- **File:** `mystery-house.json`

### 👽 Paranormal Mysteries
- **Theme:** Cryptids, aliens, UFOs, and unexplained phenomena
- **Highlights:** Bermuda Triangle, Stonehenge, extraterrestrial encounters, cryptid investigations
- **File:** `paranormal-world.json`

### World Format

Worlds are defined as JSON files in `world/` with the following structure:

```json
{
  "name": "World Name",
  "description": "World description",
  "startRoom": "entrance",
  "rooms": {
    "roomId": {
      "name": "Room Name",
      "description": "Long description",
      "exits": { "north": "targetRoom", "south": "otherRoom" },
      "items": ["itemId1", "itemId2"],
      "hazards": ["Description of hazard"]
    }
  },
  "items": {
    "itemId": {
      "name": "Item Name",
      "description": "Item description",
      "pickupText": "Message when picked up",
      "portable": true
    }
  },
  "puzzles": {
    "puzzleId": {
      "room": "roomId",
      "requiredItem": "itemId",
      "solvedText": "Success message",
      "action": {
        "type": "openExit",
        "direction": "north",
        "targetRoom": "newRoom"
      }
    }
  }
}
```

**You can create new worlds** by editing the JSON structure — no code changes needed. Place your world file in `world/` and deploy.

---

## Local Development

### Prerequisites

- **Node.js** 18+
- **Azure Functions Core Tools** (for running the API locally)

### Running Tests

```bash
npm test
```

Tests use Jest with ESM support. Currently **274 tests passing** across 4 test suites. Test files are in `tests/`.

### Client

The client is vanilla **HTML, CSS, and JavaScript** with no build step. Just open `client/index.html` in a browser or serve it locally:

```bash
cd client
python -m http.server 8000
# or: npx http-server
```

Then navigate to `http://localhost:8000`.

### API (Azure Functions)

To run the game engine locally:

```bash
cd api
npm install
func start
```

The API will start on `http://localhost:7071`. The client defaults to this URL when no `config.json` is found.

---

## Deploy to Azure

### Quick Deploy

**Windows (PowerShell):**
```powershell
pwsh -NoProfile -File .\deploy\deploy.ps1 -AppName mygame -Location westus2
```

**Linux/macOS (Bash):**
```bash
chmod +x deploy/deploy.sh
./deploy/deploy.sh --app-name mygame --location westus2
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `AppName` / `--app-name` | Yes | — | Base name for resources (3–12 alphanumeric, starts with letter) |
| `Location` / `--location` | No | `westus2` | Azure region |
| `ResourceGroup` / `--resource-group` | No | `rg-text-adventure` | Resource group name |

### What Gets Created

| Resource | Name | Purpose | Cost |
|----------|------|---------|------|
| **Storage Account** | `{AppName}game` | Table Storage + Static Website | ~$0.01/month |
| **Azure Web PubSub** | `{AppName}-wps` | Real-time messaging (Free tier: 20 connections, 20K msgs/day) | Free |
| **Azure Function App** | `{AppName}-func` | Game engine (Consumption: 1M executions/month free) | Free |

**Estimated total: ~$0/month** for a prototype with light traffic.

### After Deployment

The script outputs three URLs:

- **Game URL** — Share this with players (the static website)
- **Function App URL** — Backend (players don't need this)
- **Web PubSub URL** — WebSocket endpoint (auto-handled by client)

### Tear Down

Delete all resources:

```bash
az group delete --name rg-text-adventure --yes
```

### Re-deploy

The deployment scripts are **idempotent**. Run them again to update code without recreating resources:

```powershell
.\deploy\deploy.ps1 -AppName mygame
```

For detailed troubleshooting, see **[deploy/README.md](deploy/README.md)**.

---

## Project Structure

```
group-text-adventure/
├── client/                     # Frontend (vanilla HTML/CSS/JS)
│   ├── index.html              # Game UI (landing, lobby, game screen)
│   ├── app.js                  # Client logic, WebSocket handling
│   └── style.css               # Styling
├── api/                        # Azure Functions backend
│   ├── src/
│   │   ├── game-engine.js      # Core game logic (pure functions)
│   │   ├── command-parser.js   # Command parsing
│   │   └── functions/          # Azure Function handlers
│   │       ├── gameHub.js      # Main game logic handler
│   │       ├── negotiate.js    # Web PubSub connection setup
│   │       ├── health.js       # Health check endpoint
│   │       └── worlds.js       # World list API
│   └── package.json            # API dependencies
├── world/                      # Game world definitions
│   ├── default-world.json      # "The Forgotten Castle"
│   ├── escape-room.json        # "The Clockmaker's Mansion"
│   └── space-adventure.json    # "The Derelict Station"
├── tests/                      # Test suite (Jest)
├── deploy/                     # Azure deployment scripts
│   ├── deploy.ps1              # PowerShell deployment (Windows)
│   ├── deploy.sh               # Bash deployment (Linux/macOS)
│   └── README.md               # Detailed deployment guide
├── infra/                      # Azure infrastructure as code
├── .github/                    # GitHub workflows
├── .squad/                     # AI team configuration
├── azure.yaml                  # Azure Developer CLI config
├── package.json                # Root scripts
├── LICENSE                     # MIT License
└── README.md                   # This file
```

---

## Tech Stack

- **Frontend:** Vanilla JavaScript, HTML5, CSS3 (no frameworks)
- **Backend:** Azure Functions (Node.js 18+)
- **Real-Time:** Azure Web PubSub (WebSocket)
- **Persistence:** Azure Table Storage
- **Hosting:** Azure Static Website (Storage Account)
- **Testing:** Jest (ESM-compatible)
- **Game Logic:** Pure, side-effect-free functions for easy testing and portability

---

## License

MIT License © 2026 Pat Altimore. See [LICENSE](LICENSE) for details.

---

## Contributing

Found a bug or have a feature idea? Open an issue or submit a pull request!

---

**Ready to play?** Start with `npm test` to verify everything works, then host your first game with the deployment scripts. 🏰
