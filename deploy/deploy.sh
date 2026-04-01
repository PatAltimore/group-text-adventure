#!/usr/bin/env bash
#
# deploy.sh — Deploys the Group Text Adventure game to Azure.
# Usage: ./deploy.sh --app-name mygame [--location eastus] [--resource-group rg-text-adventure]
#

set -euo pipefail

# ── Defaults ───────────────────────────────────────────────────────────
APP_NAME=""
LOCATION="eastus"
RESOURCE_GROUP="rg-text-adventure"
HUB_NAME="gameHub"

# ── Parse Arguments ────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case $1 in
        --app-name)    APP_NAME="$2"; shift 2 ;;
        --location)    LOCATION="$2"; shift 2 ;;
        --resource-group) RESOURCE_GROUP="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 --app-name <name> [--location <region>] [--resource-group <name>]"
            echo ""
            echo "  --app-name        Base name for Azure resources (required, 3-12 alphanumeric)"
            echo "  --location        Azure region (default: eastus)"
            echo "  --resource-group  Resource group name (default: rg-text-adventure)"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [[ -z "$APP_NAME" ]]; then
    echo "Error: --app-name is required"
    echo "Usage: $0 --app-name <name> [--location <region>] [--resource-group <name>]"
    exit 1
fi

# Validate app name
if ! [[ "$APP_NAME" =~ ^[a-zA-Z][a-zA-Z0-9]{2,11}$ ]]; then
    echo "Error: --app-name must be 3-12 alphanumeric characters, starting with a letter"
    exit 1
fi

# ── Derive resource names ──────────────────────────────────────────────
APP_NAME_LOWER=$(echo "$APP_NAME" | tr '[:upper:]' '[:lower:]')
STORAGE_NAME="${APP_NAME_LOWER}store"
STORAGE_NAME=$(echo "$STORAGE_NAME" | tr -cd 'a-z0-9')
STORAGE_NAME="${STORAGE_NAME:0:24}"
FUNCTION_APP_NAME="${APP_NAME_LOWER}-func"
WPS_NAME="${APP_NAME_LOWER}-wps"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
API_DIR="$PROJECT_ROOT/api"
CLIENT_DIR="$PROJECT_ROOT/client"
WORLD_DIR="$PROJECT_ROOT/world"
STAGE_DIR="$SCRIPT_DIR/_stage"
ZIP_PATH="$SCRIPT_DIR/api.zip"

# ── Helper Functions ───────────────────────────────────────────────────
step()  { echo -e "\n\033[36m=> $1\033[0m"; }
done_() { echo -e "   \033[32mOK: $1\033[0m"; }
info()  { echo -e "   \033[33m.. $1\033[0m"; }

cleanup() {
    rm -rf "$STAGE_DIR" "$ZIP_PATH"
    rm -f "$CLIENT_DIR/config.json"
}
trap cleanup EXIT

echo ""
echo "======================================================="
echo " Group Text Adventure - Azure Deployment"
echo "======================================================="
echo ""
echo " Resource Group:  $RESOURCE_GROUP"
echo " Storage Account: $STORAGE_NAME"
echo " Function App:    $FUNCTION_APP_NAME"
echo " Web PubSub:      $WPS_NAME"
echo " Location:        $LOCATION"
echo ""

# ── 0. Resource Group ──────────────────────────────────────────────────
step "Creating resource group '$RESOURCE_GROUP' in '$LOCATION'..."
az group create \
    --name "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --only-show-errors > /dev/null
done_ "Resource group ready."

# ── 1. Pre-flight: Check if storage account exists or is available ───
step "Checking storage account '$STORAGE_NAME'..."
EXISTING_ACCOUNT=$(az storage account show --name "$STORAGE_NAME" --resource-group "$RESOURCE_GROUP" --query "name" -o tsv 2>/dev/null || echo "")
if [[ -n "$EXISTING_ACCOUNT" ]]; then
    done_ "Storage account '$STORAGE_NAME' already exists — reusing."
else
    # Storage account doesn't exist — check if name is available
    NAME_CHECK=$(az storage account check-name --name "$STORAGE_NAME" --query "nameAvailable" -o tsv)
    if [[ "$NAME_CHECK" != "true" ]]; then
        NAME_REASON=$(az storage account check-name --name "$STORAGE_NAME" --query "reason" -o tsv 2>/dev/null || echo "unknown")
        echo "Error: Storage account name '$STORAGE_NAME' is not available (reason: $NAME_REASON). Try a different --app-name."
        exit 1
    fi
    done_ "Storage account name '$STORAGE_NAME' is available."
fi

# ── 2. Storage Account ─────────────────────────────────────────────────
step "Creating storage account '$STORAGE_NAME'..."
az storage account create \
    --name "$STORAGE_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --only-show-errors > /dev/null
done_ "Storage account created."

# ── 3. Enable Static Website ───────────────────────────────────────────
step "Enabling static website hosting..."
az storage blob service-properties update \
    --account-name "$STORAGE_NAME" \
    --static-website \
    --index-document index.html \
    --404-document index.html \
    --only-show-errors > /dev/null
done_ "Static website enabled."

# Get storage connection string and static website URL
STORAGE_CONN_STR=$(az storage account show-connection-string \
    --name "$STORAGE_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query connectionString -o tsv)
if [[ -z "$STORAGE_CONN_STR" ]]; then
    echo "Error: Storage connection string is empty. Storage account '$STORAGE_NAME' may not be ready."
    exit 1
fi

STATIC_WEB_URL=$(az storage account show \
    --name "$STORAGE_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "primaryEndpoints.web" -o tsv)
if [[ -z "$STATIC_WEB_URL" ]]; then
    echo "Error: Static website URL is empty. Static website hosting may not be enabled."
    exit 1
fi
STATIC_WEB_URL="${STATIC_WEB_URL%/}"

# ── 4. Web PubSub ──────────────────────────────────────────────────────
step "Creating Web PubSub '$WPS_NAME' (Free tier)..."
az webpubsub create \
    --name "$WPS_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --sku Free_F1 \
    --only-show-errors > /dev/null
done_ "Web PubSub created (Free tier: 20 connections, 20K msgs/day)."

WPS_CONN_STR=$(az webpubsub key show \
    --name "$WPS_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query primaryConnectionString -o tsv)
if [[ -z "$WPS_CONN_STR" ]]; then
    echo "Error: Web PubSub connection string is empty."
    exit 1
fi

# ── 5. Function App ────────────────────────────────────────────────────
step "Creating Function App '$FUNCTION_APP_NAME' (Consumption plan)..."
az functionapp create \
    --name "$FUNCTION_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --storage-account "$STORAGE_NAME" \
    --consumption-plan-location "$LOCATION" \
    --runtime node \
    --runtime-version 20 \
    --functions-version 4 \
    --os-type Linux \
    --only-show-errors > /dev/null
done_ "Function App created (Consumption plan)."

# ── 6. App Settings ────────────────────────────────────────────────────
step "Configuring app settings..."
az functionapp config appsettings set \
    --name "$FUNCTION_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --settings \
        "WebPubSubConnectionString=$WPS_CONN_STR" \
        "WebPubSubHubName=$HUB_NAME" \
        "AzureTableStorageConnectionString=$STORAGE_CONN_STR" \
        "FUNCTIONS_WORKER_RUNTIME=node" \
        "WEBSITE_NODE_DEFAULT_VERSION=~20" \
        "WEBSITE_RUN_FROM_PACKAGE=1" \
        "SCM_DO_BUILD_DURING_DEPLOYMENT=false" \
    --only-show-errors > /dev/null
done_ "App settings configured."

# ── 7. CORS ────────────────────────────────────────────────────────────
step "Configuring CORS on Function App..."
az functionapp cors remove \
    --name "$FUNCTION_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --allowed-origins "https://functions.azure.com" \
    --only-show-errors 2>/dev/null || true
az functionapp cors add \
    --name "$FUNCTION_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --allowed-origins "$STATIC_WEB_URL" \
    --only-show-errors > /dev/null
done_ "CORS configured for $STATIC_WEB_URL."

# ── 8. Build and Deploy Function App ───────────────────────────────────
step "Building and packaging Function App..."

rm -rf "$STAGE_DIR" "$ZIP_PATH"
mkdir -p "$STAGE_DIR"

# Copy API files (exclude node_modules and local.settings.json)
rsync -a --exclude='node_modules' --exclude='local.settings.json' "$API_DIR/" "$STAGE_DIR/"

# Copy world files into staging for deployed path resolution
cp -r "$WORLD_DIR" "$STAGE_DIR/world"

# Install production dependencies
info "Installing production dependencies..."
(cd "$STAGE_DIR" && npm install --omit=dev --quiet 2>&1 | tail -1)

# Create deployment zip
(cd "$STAGE_DIR" && zip -qr "$ZIP_PATH" .)
ZIP_SIZE=$(du -h "$ZIP_PATH" | cut -f1)
done_ "Package created ($ZIP_SIZE)."

step "Deploying Function App code..."
az functionapp deployment source config-zip \
    --name "$FUNCTION_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --src "$ZIP_PATH" \
    --only-show-errors > /dev/null
done_ "Function App deployed."

# ── 9. Configure Web PubSub Event Handler ──────────────────────────────
step "Configuring Web PubSub event handler..."
info "Warming up Function App (this may take up to 2 minutes)..."

FUNCTION_APP_URL="https://${FUNCTION_APP_NAME}.azurewebsites.net"
curl -s -o /dev/null -w '' "$FUNCTION_APP_URL/api/negotiate" --max-time 30 || true
sleep 15

SYSTEM_KEY=""
MAX_RETRIES=12
for i in $(seq 1 $MAX_RETRIES); do
    KEYS_JSON=$(az functionapp keys list \
        --name "$FUNCTION_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --only-show-errors 2>/dev/null || echo "{}")
    SYSTEM_KEY=$(echo "$KEYS_JSON" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    k = d.get('systemKeys', {}).get('webpubsub_extension', '')
    print(k if k else '')
except: print('')
" 2>/dev/null || echo "")
    if [[ -n "$SYSTEM_KEY" ]]; then break; fi
    info "Waiting for system key... (attempt $i/$MAX_RETRIES)"
    sleep 10
done

if [[ -z "$SYSTEM_KEY" ]]; then
    info "System key not available, using master key as fallback..."
    SYSTEM_KEY=$(echo "$KEYS_JSON" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('masterKey', ''))
except: print('')
" 2>/dev/null || echo "")
fi

if [[ -z "$SYSTEM_KEY" ]]; then
    echo "Error: Could not retrieve any function key."
    exit 1
fi

EVENT_HANDLER_URL="https://${FUNCTION_APP_NAME}.azurewebsites.net/runtime/webhooks/webpubsub?code=${SYSTEM_KEY}"

az webpubsub hub delete \
    --hub-name "$HUB_NAME" \
    --name "$WPS_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --only-show-errors 2>/dev/null || true

az webpubsub hub create \
    --hub-name "$HUB_NAME" \
    --name "$WPS_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --event-handler url-template="$EVENT_HANDLER_URL" user-event-pattern="*" system-event="connect" system-event="disconnected" \
    --only-show-errors > /dev/null
done_ "Web PubSub hub '$HUB_NAME' configured."

# ── 10. Upload Client Files ────────────────────────────────────────────
step "Uploading client files to static website..."

cat > "$CLIENT_DIR/config.json" << EOF
{
  "apiBaseUrl": "https://${FUNCTION_APP_NAME}.azurewebsites.net"
}
EOF

az storage blob upload-batch \
    --source "$CLIENT_DIR" \
    --destination '$web' \
    --account-name "$STORAGE_NAME" \
    --overwrite \
    --only-show-errors > /dev/null

rm -f "$CLIENT_DIR/config.json"
done_ "Client files uploaded."

# ── 11. Clean Up ───────────────────────────────────────────────────────
rm -rf "$STAGE_DIR" "$ZIP_PATH"

# ── 12. Output Summary ────────────────────────────────────────────────
WPS_HOSTNAME=$(az webpubsub show \
    --name "$WPS_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "hostName" -o tsv)
if [[ -z "$WPS_HOSTNAME" ]]; then
    echo "Error: Web PubSub hostname is empty."
    exit 1
fi

echo ""
echo "======================================================="
echo " Deployment Complete!"
echo "======================================================="
echo ""
echo " Game URL:       $STATIC_WEB_URL"
echo " Function App:   https://${FUNCTION_APP_NAME}.azurewebsites.net"
echo " Web PubSub:     wss://${WPS_HOSTNAME}"
echo ""
echo " Game is live! Share this URL to play:"
echo "    $STATIC_WEB_URL"
echo ""
echo " To tear down all resources:"
echo "    az group delete --name $RESOURCE_GROUP --yes"
echo ""
