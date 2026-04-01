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

# -- Derive resource names ----------------------------------------------
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
function Assert-AzSuccess { param([string]$Message) if ($LASTEXITCODE -ne 0) { throw $Message } }

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
    # -- 0. Resource Group ----------------------------------------------
    Write-Step "Creating resource group '$ResourceGroup' in '$Location'..."
    az group create `
        --name $ResourceGroup `
        --location $Location `
        --only-show-errors | Out-Null
    Assert-AzSuccess "Failed to create resource group '$ResourceGroup'"
    Write-Done "Resource group ready."

    # -- 1. Pre-flight: Check if storage account exists or is available ---
    Write-Step "Checking storage account '$storageName'..."
    $existingAccount = $null
    try {
        $existingAccount = az storage account show --name $storageName --resource-group $ResourceGroup --query "name" --output tsv 2>&1
        if ($LASTEXITCODE -ne 0) { $existingAccount = $null }
    } catch {
        $existingAccount = $null
    }
    if ($existingAccount) {
        Write-Done "Storage account '$storageName' already exists - reusing."
    } else {
        # Storage account doesn't exist - check if name is available
        $nameCheck = az storage account check-name --name $storageName --query "nameAvailable" --output tsv
        Assert-AzSuccess "Failed to check storage account name availability"
        if ($nameCheck -ne "true") {
            $nameReason = az storage account check-name --name $storageName --query "reason" --output tsv 2>$null
            throw "Storage account name '$storageName' is not available (reason: $nameReason). Try a different AppName."
        }
        Write-Done "Storage account name '$storageName' is available."
    }

    # -- 2. Storage Account ---------------------------------------------
    Write-Step "Creating storage account '$storageName'..."
    az storage account create `
        --name $storageName `
        --resource-group $ResourceGroup `
        --location $Location `
        --sku Standard_LRS `
        --kind StorageV2 `
        --only-show-errors | Out-Null
    Assert-AzSuccess "Failed to create storage account '$storageName'"

    # Wait for storage account to be fully provisioned
    Write-Info "Waiting for storage account to be ready..."
    $storageReady = $false
    for ($i = 0; $i -lt 12; $i++) {
        $provState = az storage account show `
            --name $storageName `
            --resource-group $ResourceGroup `
            --query "provisioningState" --output tsv 2>$null
        if ($LASTEXITCODE -eq 0 -and $provState -eq "Succeeded") {
            $storageReady = $true
            break
        }
        Write-Info "Waiting for storage account... (attempt $($i + 1)/12)"
        Start-Sleep -Seconds 10
    }
    if (-not $storageReady) {
        Write-Info "Storage account provisioning state: $provState - proceeding anyway..."
    }
    Write-Done "Storage account created."

    # Set up storage auth via environment variables early - used by all
    # subsequent storage operations. Avoids cmd.exe mangling of keys/connection strings.
    $env:AZURE_STORAGE_ACCOUNT = $storageName
    $keysJson = (az storage account keys list `
        --account-name $storageName `
        --resource-group $ResourceGroup `
        --output json)
    Assert-AzSuccess "Failed to get storage account key"
    $env:AZURE_STORAGE_KEY = ($keysJson | ConvertFrom-Json)[0].value

    # -- 3. Enable Static Website ---------------------------------------
    Write-Step "Enabling static website hosting..."
    $staticEnabled = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        az storage blob service-properties update `
            --static-website `
            --index-document index.html `
            --404-document index.html `
            --only-show-errors | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $staticEnabled = $true
            break
        }
        if ($attempt -lt 3) {
            Write-Info "Static website enable attempt $attempt failed, retrying in 10 seconds..."
            Start-Sleep -Seconds 10
        }
    }
    if (-not $staticEnabled) {
        throw "Failed to enable static website hosting after 3 attempts"
    }
    Write-Done "Static website enabled."

    # Get storage connection string and static website URL
    $storageConnStr = az storage account show-connection-string `
        --name $storageName `
        --resource-group $ResourceGroup `
        --query connectionString --output tsv
    Assert-AzSuccess "Failed to get storage connection string"
    if ([string]::IsNullOrWhiteSpace($storageConnStr)) {
        throw "Storage connection string is empty. Storage account '$storageName' may not be ready."
    }

    $staticWebUrl = az storage account show `
        --name $storageName `
        --resource-group $ResourceGroup `
        --query "primaryEndpoints.web" --output tsv
    Assert-AzSuccess "Failed to get static website URL"
    if ([string]::IsNullOrWhiteSpace($staticWebUrl)) {
        throw "Static website URL is empty. Static website hosting may not be enabled."
    }
    $staticWebUrl = $staticWebUrl.TrimEnd('/')

    # -- 4. Web PubSub --------------------------------------------------
    Write-Step "Creating Web PubSub '$webPubSubName' (Free tier)..."
    az webpubsub create `
        --name $webPubSubName `
        --resource-group $ResourceGroup `
        --location $Location `
        --sku Free_F1 `
        --only-show-errors | Out-Null
    Assert-AzSuccess "Failed to create Web PubSub '$webPubSubName'"
    Write-Done "Web PubSub created (Free tier: 20 connections, 20K msgs/day)."

    # Get Web PubSub connection string
    $wpsConnStr = az webpubsub key show `
        --name $webPubSubName `
        --resource-group $ResourceGroup `
        --query primaryConnectionString --output tsv
    Assert-AzSuccess "Failed to get Web PubSub connection string"
    if ([string]::IsNullOrWhiteSpace($wpsConnStr)) {
        throw "Web PubSub connection string is empty."
    }

    # -- 5. Function App ------------------------------------------------
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
    Assert-AzSuccess "Failed to create Function App '$functionAppName'"

    # Wait for Function App to be fully provisioned (Linux Consumption can
    # return from 'create' before the deployment endpoint is ready)
    Write-Info "Waiting for Function App to be fully provisioned..."
    $provisionReady = $false
    for ($i = 0; $i -lt 12; $i++) {
        $state = az functionapp show `
            --name $functionAppName `
            --resource-group $ResourceGroup `
            --query "state" --output tsv 2>$null
        if ($LASTEXITCODE -eq 0 -and $state -eq "Running") {
            $provisionReady = $true
            break
        }
        Write-Info "Waiting for Function App... (attempt $($i + 1)/12)"
        Start-Sleep -Seconds 10
    }
    if (-not $provisionReady) {
        Write-Info "Function App not yet in 'Running' state (state=$state), proceeding anyway..."
    }
    Write-Done "Function App created (Consumption plan)."

    # -- 6. Configure App Settings --------------------------------------
    # Uses ARM REST API with a file-based body to avoid cmd.exe mangling.
    # On Windows, `az` is `az.cmd` — all arguments pass through cmd.exe which
    # interprets semicolons as command separators, breaking connection strings.
    # Writing settings to a JSON file and using `az rest --body @file` bypasses
    # cmd.exe argument parsing entirely.
    Write-Step "Configuring app settings..."

    $newSettings = @{
        "WebPubSubConnectionString"         = $wpsConnStr
        "WebPubSubHubName"                  = $hubName
        "AzureTableStorageConnectionString" = $storageConnStr
        "FUNCTIONS_WORKER_RUNTIME"          = "node"
        "WEBSITE_NODE_DEFAULT_VERSION"      = "~20"
        "WEBSITE_RUN_FROM_PACKAGE"          = "1"
        "SCM_DO_BUILD_DURING_DEPLOYMENT"    = "false"
        "AzureWebJobsFeatureFlags"          = "EnableWorkerIndexing"
    }

    $subId = (az account show --query id --output tsv)
    Assert-AzSuccess "Failed to get subscription ID"

    # Retrieve existing app settings to merge (preserves system settings like
    # AzureWebJobsStorage, FUNCTIONS_EXTENSION_VERSION set by az functionapp create)
    $armBase = "https://management.azure.com/subscriptions/$subId/resourceGroups/$ResourceGroup/providers/Microsoft.Web/sites/$functionAppName"
    $existingRaw = (az rest --method POST `
        --url "$armBase/config/appsettings/list?api-version=2022-03-01" `
        --only-show-errors)
    Assert-AzSuccess "Failed to read existing app settings"

    $merged = @{}
    $existingProps = ($existingRaw -join "`n" | ConvertFrom-Json).properties
    if ($existingProps) {
        $existingProps.PSObject.Properties | ForEach-Object { $merged[$_.Name] = $_.Value }
    }
    foreach ($key in $newSettings.Keys) {
        $merged[$key] = $newSettings[$key]
    }

    # Write to temp file — az reads it directly, no cmd.exe parsing.
    # Use WriteAllText to avoid UTF-8 BOM (Windows PowerShell 5.x adds BOM
    # with Set-Content -Encoding UTF8, which breaks az rest JSON parsing).
    $settingsFile = Join-Path $PSScriptRoot "_appsettings.json"
    $settingsJson = @{ properties = $merged } | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($settingsFile, $settingsJson, [System.Text.UTF8Encoding]::new($false))

    $restResult = az rest --method PUT `
        --url "$armBase/config/appsettings?api-version=2022-03-01" `
        --body "@$settingsFile" `
        --only-show-errors 2>&1
    $restExitCode = $LASTEXITCODE

    Remove-Item $settingsFile -Force -ErrorAction SilentlyContinue

    if ($restExitCode -ne 0) {
        Write-Info "ARM REST API for app settings failed (exit code $restExitCode)."
        Write-Info "Response: $($restResult -join ' ')"
        Write-Info "Falling back to individual az commands..."

        # Fall back to setting each non-connection-string setting individually
        $safeSettings = @(
            "AzureWebJobsFeatureFlags=EnableWorkerIndexing"
            "FUNCTIONS_WORKER_RUNTIME=node"
            "WEBSITE_NODE_DEFAULT_VERSION=~20"
            "WEBSITE_RUN_FROM_PACKAGE=1"
            "SCM_DO_BUILD_DURING_DEPLOYMENT=false"
            "WebPubSubHubName=$hubName"
        )
        foreach ($setting in $safeSettings) {
            az functionapp config appsettings set `
                --name $functionAppName `
                --resource-group $ResourceGroup `
                --settings $setting `
                --only-show-errors 2>$null | Out-Null
        }

        # Connection strings require temp file approach with az webapp config
        $connSettings = @{
            "WebPubSubConnectionString"         = $wpsConnStr
            "AzureTableStorageConnectionString" = $storageConnStr
        }
        foreach ($key in $connSettings.Keys) {
            $val = $connSettings[$key]
            $connFile = Join-Path $PSScriptRoot "_conn_setting.json"
            $connBody = @{ properties = @{ $key = $val } } | ConvertTo-Json -Depth 5
            [System.IO.File]::WriteAllText($connFile, $connBody, [System.Text.UTF8Encoding]::new($false))
            az rest --method PUT `
                --url "$armBase/config/appsettings?api-version=2022-03-01" `
                --body "@$connFile" `
                --only-show-errors 2>$null | Out-Null
            Remove-Item $connFile -Force -ErrorAction SilentlyContinue
        }
    }

    # Verify critical settings were applied by reading them back
    Write-Info "Verifying app settings..."
    $verifyRaw = (az rest --method POST `
        --url "$armBase/config/appsettings/list?api-version=2022-03-01" `
        --only-show-errors 2>$null)
    $verifyProps = ($verifyRaw -join "`n" | ConvertFrom-Json).properties
    $criticalKeys = @("AzureWebJobsFeatureFlags", "FUNCTIONS_WORKER_RUNTIME", "WebPubSubConnectionString", "AzureTableStorageConnectionString")
    $missing = @()
    foreach ($key in $criticalKeys) {
        $val = $verifyProps.$key
        if ([string]::IsNullOrWhiteSpace($val)) { $missing += $key }
    }
    if ($missing.Count -gt 0) {
        Write-Host "   WARNING: Missing settings after deployment: $($missing -join ', ')" -ForegroundColor Yellow
        # Last resort: set EnableWorkerIndexing directly (no special chars, safe for cmd.exe)
        if ($missing -contains "AzureWebJobsFeatureFlags") {
            Write-Info "Setting EnableWorkerIndexing via direct az command..."
            az functionapp config appsettings set `
                --name $functionAppName `
                --resource-group $ResourceGroup `
                --settings "AzureWebJobsFeatureFlags=EnableWorkerIndexing" `
                --only-show-errors 2>$null | Out-Null
        }
    } else {
        Write-Info "All critical settings verified."
    }
    Write-Done "App settings configured."

    # -- 7. Configure CORS ----------------------------------------------
    Write-Step "Configuring CORS on Function App..."
    # Remove default allowed origins (may fail if not present - that's OK)
    az functionapp cors remove `
        --name $functionAppName `
        --resource-group $ResourceGroup `
        --allowed-origins "https://functions.azure.com" `
        --only-show-errors 2>$null
    # Add the static website URL as allowed origin
    az functionapp cors add `
        --name $functionAppName `
        --resource-group $ResourceGroup `
        --allowed-origins $staticWebUrl `
        --only-show-errors | Out-Null
    Assert-AzSuccess "Failed to add CORS origin '$staticWebUrl'"
    Write-Done "CORS configured for $staticWebUrl."

    # -- 8. Build and Deploy Function App -------------------------------
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
    $deploySuccess = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        az functionapp deployment source config-zip `
            --name $functionAppName `
            --resource-group $ResourceGroup `
            --src $zipPath `
            --only-show-errors | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $deploySuccess = $true
            break
        }
        if ($attempt -lt 3) {
            Write-Info "Deploy attempt $attempt failed, retrying in 15 seconds..."
            Start-Sleep -Seconds 15
        }
    }
    if (-not $deploySuccess) {
        throw "Failed to deploy Function App code after 3 attempts"
    }
    Write-Done "Function App deployed."

    # -- Post-deploy: Verify functions are registered ----------------------
    Write-Step "Verifying function registration..."
    $functionAppUrl = "https://${functionAppName}.azurewebsites.net"

    # Give the runtime time to start and index functions
    Write-Info "Waiting for Function App to start..."
    Start-Sleep -Seconds 20

    # Check if negotiate endpoint responds (should return 400, not 404)
    $negotiateOk = $false
    for ($check = 1; $check -le 6; $check++) {
        try {
            $resp = Invoke-WebRequest -Uri "$functionAppUrl/api/negotiate" -TimeoutSec 15 -ErrorAction Stop
            $negotiateOk = $true
            break
        } catch {
            $statusCode = $_.Exception.Response.StatusCode.value__
            if ($statusCode -and $statusCode -ne 404) {
                # 400 or 500 means the function IS registered (just missing params)
                $negotiateOk = $true
                break
            }
        }
        if ($check -lt 6) {
            Write-Info "Negotiate endpoint not ready (attempt $check/6), waiting..."
            if ($check -eq 3) {
                # Mid-way: try restarting the Function App
                Write-Info "Restarting Function App to pick up configuration..."
                az functionapp restart `
                    --name $functionAppName `
                    --resource-group $ResourceGroup `
                    --only-show-errors 2>$null | Out-Null
            }
            Start-Sleep -Seconds 15
        }
    }
    if ($negotiateOk) {
        Write-Done "Function registration verified - negotiate endpoint is live."
    } else {
        Write-Host "   WARNING: negotiate endpoint returned 404 after deployment." -ForegroundColor Yellow
        Write-Info "The Function App may need a few more minutes to start."
        Write-Info "If the issue persists, check Function App logs in Azure Portal."
    }

    # -- 9. Configure Web PubSub Event Handler --------------------------
    Write-Step "Configuring Web PubSub event handler..."
    Write-Info "Warming up Function App..."

    # Use the warmup we already did above; just wait briefly if needed
    if (-not $negotiateOk) {
        try { Invoke-WebRequest -Uri "$functionAppUrl/api/negotiate" -TimeoutSec 30 -ErrorAction SilentlyContinue | Out-Null } catch { }
        Start-Sleep -Seconds 15
    }

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
    Assert-AzSuccess "Failed to create Web PubSub hub '$hubName'"
    Write-Done "Web PubSub hub '$hubName' configured."

    # -- 10. Upload Client Files ----------------------------------------
    Write-Step "Uploading client files to static website..."

    # Generate config.json with the Function App URL
    $configJson = @{ apiBaseUrl = "https://${functionAppName}.azurewebsites.net" } | ConvertTo-Json
    $configPath = Join-Path $clientDir "config.json"
    Set-Content -Path $configPath -Value $configJson -Encoding UTF8

    # Storage env vars (AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY) already set in step 2
    az storage blob upload-batch `
        --source $clientDir `
        --destination '$web' `
        --overwrite `
        --only-show-errors | Out-Null
    Assert-AzSuccess "Failed to upload client files to static website"

    # Verify files were actually uploaded (upload-batch can exit 0 with 0 files)
    $blobJson = (az storage blob list `
        --container-name '$web' `
        --output json --only-show-errors)
    Assert-AzSuccess "Failed to verify uploaded files"
    $blobCount = ($blobJson | ConvertFrom-Json).Count
    if ([int]$blobCount -lt 1) {
        throw "Upload verification failed: 0 files found in '`$web' container."
    }
    Write-Info "Verified: $blobCount file(s) in '`$web' container."

    # Clean up generated config.json from source
    Remove-Item $configPath -Force -ErrorAction SilentlyContinue
    Write-Done "Client files uploaded."

    # -- 11. Clean Up ---------------------------------------------------
    if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

    # -- 12. Output Summary ---------------------------------------------
    $wpsHostName = az webpubsub show `
        --name $webPubSubName `
        --resource-group $ResourceGroup `
        --query "hostName" --output tsv
    Assert-AzSuccess "Failed to get Web PubSub hostname"
    if ([string]::IsNullOrWhiteSpace($wpsHostName)) {
        throw "Web PubSub hostname is empty."
    }

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

    # Clean up storage env vars
    $env:AZURE_STORAGE_ACCOUNT = $null
    $env:AZURE_STORAGE_KEY = $null

} catch {
    Write-Host "`nDeployment failed: $_" -ForegroundColor Red

    # Clean up storage env vars
    $env:AZURE_STORAGE_ACCOUNT = $null
    $env:AZURE_STORAGE_KEY = $null

    # Clean up staging and temp files on failure
    if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    $settingsCleanup = Join-Path $PSScriptRoot "_appsettings.json"
    if (Test-Path $settingsCleanup) { Remove-Item $settingsCleanup -Force -ErrorAction SilentlyContinue }
    $connCleanup = Join-Path $PSScriptRoot "_conn_setting.json"
    if (Test-Path $connCleanup) { Remove-Item $connCleanup -Force -ErrorAction SilentlyContinue }

    # Clean up generated config.json if it exists
    $configCleanup = Join-Path $clientDir "config.json"
    if (Test-Path $configCleanup) { Remove-Item $configCleanup -Force -ErrorAction SilentlyContinue }

    exit 1
}
