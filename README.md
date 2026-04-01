# 🏰 Group Text Adventure

**A real-time multiplayer text adventure game built on Azure.**

Gather 1–20 players, explore a shared world, solve puzzles, and collaborate to find the ultimate treasure. Using voice commands (or text), navigate dungeons, manage inventory, and communicate with teammates in real time via WebSocket.

---

## Features

- **1–20 Multiplayer** — Host and join games via URL or QR code
- **Real-Time Sync** — All actions broadcast instantly via Web PubSub
- **Explore & Interact** — Navigate rooms, examine items, collect treasures
- **Collaborative Puzzles** — Solve challenges that require teamwork and item trading
- **Inventory & Items** — Pick up, drop, use, and give items to other players
- **Direct Communication** — Say messages to players in the same room
- **Room Awareness** — See who's nearby and what's in each room

---

## How to Play

### Supported Commands

| Command | Syntax | Example |
|---------|--------|---------|
| **Go** | `go <direction>` or shortcut `<n/s/e/w>` | `go north` or `n` |
| **Look** | `look` or `look <item>` | `look` or `look torch` |
| **Take** | `take <item>` | `take torch` |
| **Drop** | `drop <item>` | `drop torch` |
| **Inventory** | `inventory` or `i` | `i` |
| **Use** | `use <item>` | `use key` |
| **Give** | `give <item> to <player>` | `give key to Alice` |
| **Say** | `say <message>` | `say Help me with the puzzle!` |
| **Help** | `help` | `help` |

### Quick Start

1. **Host a Game** — Enter your name and click "Host New Game"
2. **Share the Link** — Invite friends via URL or QR code
3. **Start When Ready** — Once everyone joins, click "Start Game"
4. **Explore Together** — Use commands to move, interact, and solve puzzles
5. **Collaborate** — Trade items, solve challenges, reach the treasure

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
┌──────────────────────────┐      ┌─────────────────┐
│   Azure Web PubSub        │─────▶│  Azure Functions │
│   (Real-time messaging)   │      │  (Game logic)    │
└──────────────────────────┘      └────────┬────────┘
                                           │
                                           ▼
                                  ┌─────────────────┐
                                  │  Azure Table     │
                                  │  Storage         │
                                  │  (Game state)    │
                                  └─────────────────┘
```

**Data Flow:**

1. Player opens static website (hosted on Azure Storage)
2. Client calls `/api/negotiate` to get a Web PubSub connection token
3. Client connects to Web PubSub via WebSocket
4. Commands flow through Web PubSub → Azure Functions (game engine) → Table Storage
5. Game state is broadcast back to all connected players in real time

---

## The World: The Forgotten Castle

The default world, **"The Forgotten Castle,"** is an immersive adventure with:

- **10 Rooms** — From the castle entrance to the hidden throne room and secret garden
- **9 Items** — Torches, keys, shields, the legendary Dragon Crown, and more
- **4 Puzzles** — Lock the dungeon, unlock the armory and throne room, discover the secret garden

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

Tests use Jest with ESM support. Test files are in `tests/`.

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
.\deploy\deploy.ps1 -AppName mygame -Location eastus
```

**Linux/macOS (Bash):**
```bash
chmod +x deploy/deploy.sh
./deploy/deploy.sh --app-name mygame --location eastus
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `AppName` / `--app-name` | Yes | — | Base name for resources (3–12 alphanumeric, starts with letter) |
| `Location` / `--location` | No | `eastus` | Azure region |
| `ResourceGroup` / `--resource-group` | No | `rg-text-adventure` | Resource group name |

### What Gets Created

| Resource | SKU | Cost |
|----------|-----|------|
| **Storage Account** (Table Storage + Static Website hosting) | Standard_LRS | ~$0.01/month |
| **Azure Web PubSub** | Free_F1 | Free (20 connections, 20K msgs/day) |
| **Azure Function App** | Consumption | Free (1M executions/month) |

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
│   └── package.json            # API dependencies
├── world/                      # Game world definitions
│   └── default-world.json      # "The Forgotten Castle"
├── tests/                      # Test suite (Jest)
├── deploy/                     # Azure deployment scripts
│   ├── deploy.ps1              # PowerShell deployment (Windows)
│   ├── deploy.sh               # Bash deployment (Linux/macOS)
│   └── README.md               # Detailed deployment guide
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
