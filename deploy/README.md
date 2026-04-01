# Deployment Guide

Deploy the Group Text Adventure game to Azure with a single command.

## Prerequisites

- **Azure CLI** v2.50+ — [Install](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli)
- **Azure subscription** — [Free account](https://azure.microsoft.com/free/)
- **Node.js** 18+ — for building the API package
- **Logged in** — run `az login` before deploying

## Quick Start

### PowerShell (Windows)

```powershell
.\deploy\deploy.ps1 -AppName mygame -Location eastus
```

### Bash (Linux/macOS)

```bash
chmod +x deploy/deploy.sh
./deploy/deploy.sh --app-name mygame --location eastus
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `AppName` / `--app-name` | Yes | — | Base name for resources (3-12 alphanumeric, starts with letter) |
| `Location` / `--location` | No | `eastus` | Azure region |
| `ResourceGroup` / `--resource-group` | No | `rg-text-adventure` | Resource group name |

## What Gets Created

| Resource | SKU/Tier | Estimated Cost |
|----------|----------|----------------|
| **Resource Group** | — | Free |
| **Storage Account** (Table Storage + Static Website) | Standard_LRS | ~$0.01/month |
| **Azure Web PubSub** | Free_F1 | Free (20 connections, 20K msgs/day) |
| **Azure Function App** | Consumption (Linux) | Free (1M executions/month included) |

**Total estimated cost: ~$0/month** for a game prototype with low traffic.

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser    │────▶│  Static Website   │     │  Azure Table    │
│   (Client)   │     │  (Storage Acct)   │     │  Storage        │
└──────┬───────┘     └──────────────────┘     └────────▲────────┘
       │                                                │
       │  negotiate (HTTP)                              │
       ├────────────────────▶┌──────────────────┐       │
       │                     │  Azure Functions  │───────┘
       │  WebSocket          │  (Game Logic)     │
       └────────────────────▶┌──────────────────┐
                             │  Azure Web PubSub │
                             │  (Realtime)       │
                             └──────────────────┘
```

1. Player opens the static website URL
2. Client fetches `config.json` to discover the Function App URL
3. Client calls the `negotiate` endpoint to get a WebSocket token
4. Client connects to Web PubSub via WebSocket
5. Game commands flow through Web PubSub → Azure Functions → Table Storage

## After Deployment

The script outputs three URLs:

- **Game URL** — share this with players (static website)
- **Function App URL** — backend API (players don't need this directly)
- **Web PubSub URL** — WebSocket endpoint (handled automatically)

## Tear Down

Delete all resources in one command:

```bash
az group delete --name rg-text-adventure --yes
```

This removes everything — the resource group and all resources inside it.

## Re-deploying

The scripts are idempotent — safe to run again to update the deployment:

```powershell
# Update code without re-creating resources
.\deploy\deploy.ps1 -AppName mygame
```

Existing resources will be updated in place.

## Troubleshooting

### "Storage account name already taken"

Storage account names are globally unique. Try a different `AppName`.

### "Web PubSub Free tier limit"

Only one Free-tier Web PubSub is allowed per Azure subscription. Either delete the existing one or use a different subscription.

### "Function App not responding"

Consumption plan functions cold-start after inactivity. The first request may take 10-30 seconds. Subsequent requests are fast.

### "CORS errors in browser console"

The deploy script configures CORS automatically. If you see CORS errors:

```bash
az functionapp cors add \
    --name <your-func-app> \
    --resource-group rg-text-adventure \
    --allowed-origins <your-static-website-url>
```

### "WebSocket connection fails"

Check that the Web PubSub event handler is configured:

```bash
az webpubsub hub show \
    --hub-name gameHub \
    --name <your-wps-name> \
    --resource-group rg-text-adventure
```

The `urlTemplate` should point to your Function App's Web PubSub webhook endpoint.

### "System key not found" during deployment

The Web PubSub extension key is created on first Function App cold start. The script retries automatically, but if it fails:

1. Wait 2 minutes for the Function App to fully initialize
2. Run the deploy script again — it will pick up the existing key

## Local Development

For local development, the client falls back to relative paths (`/api/negotiate`) when no `config.json` is found. Use Azure Functions Core Tools locally:

```bash
cd api
func start
```

Then serve the client files with any static file server pointing at the `client/` directory.
