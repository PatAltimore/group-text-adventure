<#
.SYNOPSIS
    Deploys the Group Text Adventure game to Azure.
.DESCRIPTION
    Provisions all Azure resources and deploys the application.
    Safe to run multiple times (idempotent).
.PARAMETER AppName
    Base name for Azure resources (3-12 alphanumeric chars, starts with letter).
.PARAMETER Location
    Azure region. Default: eastus
.PARAMETER ResourceGroup
    Resource group name. Default: rg-text-adventure
.EXAMPLE
    .\deploy.ps1 -AppName mygame -Location eastus
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-zA-Z][a-zA-Z0-9]{2,11}$')]
    [string]$AppName,

    [string]$Location = "eastus",

    [string]$ResourceGroup = "rg-text-adventure"
)

$ErrorActionPreference = 'Stop'

# ── Derive resource names ──────────────────────────────────────────────
$appNameLower = $AppName.ToLower()
$storageName = "${appNameLower}store" -replace '[^a-z0-9]', ''
if ($storageName.Length -gt 24) { $storageName = $storageName.Substring(0, 24) }
$functionAppName = "${appNameLower}-func"
$webPubSubName = "${appNameLower}-wps"
$hubName = "gameHub"

$projectRoot = Split-Path $PSScriptRoot -Parent
$apiDir = Join-Path $projectRoot "api"
$clientDir = Join-Path $projectRoot "client"
$worldDir = Join-Path $projectRoot "world"
$stageDir = Join-Path $PSScriptRoot "_stage"
$zipPath = Join-Path $PSScriptRoot "api.zip"

function Write-Step { param([string]$msg) Write-Host "`n=> $msg" -ForegroundColor Cyan }
function Write-Done { param([string]$msg) Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-Info { param([string]$msg) Write-Host "   .. $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Magenta
Write-Host " Group Text Adventure - Azure Deployment" -ForegroundColor Magenta
Write-Host "=======================================================" -ForegroundColor Magenta
Write-Host ""
Write-Host " Resource Group:  $ResourceGroup"
Write-Host " Storage Account: $storageName"
Write-Host " Function App:    $functionAppName"
Write-Host " Web PubSub:      $webPubSubName"
Write-Host " Location:        $Location"
Write-Host ""

try {
    # ── 1. Resource Group ──────────────────────────────────────────────
    Write-Step "Creating resource group '$ResourceGroup' in '$Location'..."
    az group create `
        --name $ResourceGroup `
        --location $Location `
        --only-show-errors | Out-Null
    Write-Done "Resource group ready."

    # ── 2. Storage Account ─────────────────────────────────────────────
    Write-Step "Creating storage account '$storageName'..."
    az storage account create `
        --name $storageName `
        --resource-group $ResourceGroup `
        --location $Location `
        --sku Standard_LRS `
        --kind StorageV2 `
        --only-show-errors | Out-Null
    Write-Done "Storage account created."

    # ── 3. Enable Static Website ───────────────────────────────────────
    Write-Step "Enabling static website hosting..."
    az storage blob service-properties update `
        --account-name $storageName `
        --static-website `
        --index-document index.html `
        --404-document index.html `
        --only-show-errors | Out-Null
    Write-Done "Static website enabled."

    # Get storage connection string and static website URL
    $storageConnStr = az storage account show-connection-string `
        --name $storageName `
        --resource-group $ResourceGroup `
        --query connectionString -o tsv

    $staticWebUrl = az storage account show `
        --name $storageName `
        --resource-group $ResourceGroup `
        --query "primaryEndpoints.web" -o tsv
    $staticWebUrl = $staticWebUrl.TrimEnd('/')

    # ── 4. Web PubSub ──────────────────────────────────────────────────
    Write-Step "Creating Web PubSub '$webPubSubName' (Free tier)..."
    az webpubsub create `
        --name $webPubSubName `
        --resource-group $ResourceGroup `
        --location $Location `
        --sku Free_F1 `
        --only-show-errors | Out-Null
    Write-Done "Web PubSub created (Free tier: 20 connections, 20K msgs/day)."

    # Get Web PubSub connection string
    $wpsConnStr = az webpubsub key show `
        --name $webPubSubName `
        --resource-group $ResourceGroup `
        --query primaryConnectionString -o tsv

    # ── 5. Function App ────────────────────────────────────────────────
    Write-Step "Creating Function App '$functionAppName' (Consumption plan)..."
    az functionapp create `
        --name $functionAppName `
        --resource-group $ResourceGroup `
        --storage-account $storageName `
        --consumption-plan-location $Location `
        --runtime node `
        --runtime-version 20 `
        --functions-version 4 `
        --os-type Linux `
        --only-show-errors | Out-Null
    Write-Done "Function App created (Consumption plan)."

    # ── 6. Configure App Settings ──────────────────────────────────────
    Write-Step "Configuring app settings..."
    az functionapp config appsettings set `
        --name $functionAppName `
        --resource-group $ResourceGroup `
        --settings `
            "WebPubSubConnectionString=$wpsConnStr" `
            "WebPubSubHubName=$hubName" `
            "AzureTableStorageConnectionString=$storageConnStr" `
            "FUNCTIONS_WORKER_RUNTIME=node" `
            "WEBSITE_NODE_DEFAULT_VERSION=~20" `
        --only-show-errors | Out-Null
    Write-Done "App settings configured."

    # ── 7. Configure CORS ──────────────────────────────────────────────
    Write-Step "Configuring CORS on Function App..."
    # Remove default allowed origins, then add the static website URL
    az functionapp cors remove `
        --name $functionAppName `
        --resource-group $ResourceGroup `
        --allowed-origins "https://functions.azure.com" `
        --only-show-errors 2>$null
    az functionapp cors add `
        --name $functionAppName `
        --resource-group $ResourceGroup `
        --allowed-origins $staticWebUrl `
        --only-show-errors 2>$null
    Write-Done "CORS configured for $staticWebUrl."

    # ── 8. Build and Deploy Function App ───────────────────────────────
    Write-Step "Building and packaging Function App..."

    # Clean previous staging
    if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

    New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

    # Copy API files (exclude node_modules, local.settings.json, package-lock.json is included)
    $excludeItems = @("node_modules", "local.settings.json")
    Get-ChildItem $apiDir -Exclude $excludeItems | ForEach-Object {
        Copy-Item $_.FullName -Destination $stageDir -Recurse -Force
    }

    # Copy world files into staging so deployed functions can find them
    Copy-Item $worldDir -Destination (Join-Path $stageDir "world") -Recurse -Force

    # Install production dependencies
    Write-Info "Installing production dependencies..."
    Push-Location $stageDir
    try {
        npm install --omit=dev --quiet 2>&1 | Out-Null
    } finally {
        Pop-Location
    }

    # Create deployment zip
    Compress-Archive -Path "$stageDir\*" -DestinationPath $zipPath -Force
    $zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
    Write-Done "Package created ($zipSize MB)."

    Write-Step "Deploying Function App code..."
    az functionapp deployment source config-zip `
        --name $functionAppName `
        --resource-group $ResourceGroup `
        --src $zipPath `
        --only-show-errors | Out-Null
    Write-Done "Function App deployed."

    # ── 9. Configure Web PubSub Event Handler ──────────────────────────
    Write-Step "Configuring Web PubSub event handler..."
    Write-Info "Warming up Function App (this may take up to 2 minutes)..."

    # Trigger a cold start by hitting the negotiate endpoint
    $functionAppUrl = "https://${functionAppName}.azurewebsites.net"
    try { Invoke-WebRequest -Uri "$functionAppUrl/api/negotiate" -TimeoutSec 30 -ErrorAction SilentlyContinue | Out-Null } catch { }
    Start-Sleep -Seconds 15

    # Retrieve the system key for Web PubSub extension
    $systemKey = $null
    $maxRetries = 12
    for ($i = 0; $i -lt $maxRetries; $i++) {
        try {
            $keysJson = az functionapp keys list `
                --name $functionAppName `
                --resource-group $ResourceGroup `
                --only-show-errors 2>$null
            $keys = $keysJson | ConvertFrom-Json
            $systemKey = $keys.systemKeys.webpubsub_extension
            if ($systemKey -and $systemKey -ne "None" -and $systemKey.Length -gt 0) { break }
        } catch { }
        Write-Info "Waiting for system key... (attempt $($i + 1)/$maxRetries)"
        Start-Sleep -Seconds 10
    }

    if (-not $systemKey -or $systemKey -eq "None") {
        Write-Info "System key not available yet, using master key as fallback..."
        $systemKey = $keys.masterKey
    }

    if (-not $systemKey) {
        throw "Could not retrieve any function key. Please check the Function App deployment."
    }

    $eventHandlerUrl = "https://${functionAppName}.azurewebsites.net/runtime/webhooks/webpubsub?code=${systemKey}"

    az webpubsub hub delete `
        --hub-name $hubName `
        --name $webPubSubName `
        --resource-group $ResourceGroup `
        --only-show-errors 2>$null

    az webpubsub hub create `
        --hub-name $hubName `
        --name $webPubSubName `
        --resource-group $ResourceGroup `
        --event-handler url-template="$eventHandlerUrl" user-event-pattern="*" system-event="connect" system-event="disconnected" `
        --only-show-errors | Out-Null
    Write-Done "Web PubSub hub '$hubName' configured."

    # ── 10. Upload Client Files ────────────────────────────────────────
    Write-Step "Uploading client files to static website..."

    # Generate config.json with the Function App URL
    $configJson = @{ apiBaseUrl = "https://${functionAppName}.azurewebsites.net" } | ConvertTo-Json
    $configPath = Join-Path $clientDir "config.json"
    Set-Content -Path $configPath -Value $configJson -Encoding UTF8

    az storage blob upload-batch `
        --source $clientDir `
        --destination '$web' `
        --account-name $storageName `
        --overwrite `
        --only-show-errors | Out-Null

    # Clean up generated config.json from source
    Remove-Item $configPath -Force -ErrorAction SilentlyContinue
    Write-Done "Client files uploaded."

    # ── 11. Clean Up ───────────────────────────────────────────────────
    if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

    # ── 12. Output Summary ─────────────────────────────────────────────
    $wpsHostName = az webpubsub show `
        --name $webPubSubName `
        --resource-group $ResourceGroup `
        --query "hostName" -o tsv

    Write-Host ""
    Write-Host "=======================================================" -ForegroundColor Green
    Write-Host " Deployment Complete!" -ForegroundColor Green
    Write-Host "=======================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host " Game URL:       $staticWebUrl" -ForegroundColor White
    Write-Host " Function App:   https://${functionAppName}.azurewebsites.net" -ForegroundColor White
    Write-Host " Web PubSub:     wss://${wpsHostName}" -ForegroundColor White
    Write-Host ""
    Write-Host " Game is live! Share this URL to play:" -ForegroundColor Yellow
    Write-Host "    $staticWebUrl" -ForegroundColor Yellow
    Write-Host ""
    Write-Host " To tear down all resources:" -ForegroundColor Gray
    Write-Host "    az group delete --name $ResourceGroup --yes" -ForegroundColor Gray
    Write-Host ""

} catch {
    Write-Host "`nDeployment failed: $_" -ForegroundColor Red

    # Clean up staging on failure
    if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

    # Clean up generated config.json if it exists
    $configCleanup = Join-Path $clientDir "config.json"
    if (Test-Path $configCleanup) { Remove-Item $configCleanup -Force -ErrorAction SilentlyContinue }

    exit 1
}
