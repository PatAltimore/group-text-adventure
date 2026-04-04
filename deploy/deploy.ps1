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

# Suppress Azure CLI's Python cryptography warning (32-bit Python on 64-bit Windows).
$env:PYTHONWARNINGS = 'ignore'

# Shadow the 'az' command so stderr warnings don't become terminating errors.
# With $ErrorActionPreference = 'Stop', any stderr output from native commands
# triggers a terminating error in PowerShell. The Azure CLI emits a harmless
# Python cryptography UserWarning to stderr that kills the script.
# This wrapper suppresses stderr (real failures are caught via $LASTEXITCODE
# and Assert-AzSuccess) while passing stdout through unchanged.
$script:azExe = (Get-Command az -CommandType Application -ErrorAction SilentlyContinue |
                 Select-Object -First 1).Source
if (-not $script:azExe) { throw "Azure CLI (az) not found in PATH." }
function script:az {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    & $script:azExe @args 2>$null
    $ErrorActionPreference = $prevEAP
}

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
    $storageKey = $env:AZURE_STORAGE_KEY
    $staticEnabled = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        az storage blob service-properties update `
            --account-name $storageName `
            --account-key $storageKey `
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
    # Verify the enable actually worked by reading back the status
    $verifySwJson = (az storage blob service-properties show `
        --account-name $storageName `
        --account-key $storageKey `
        --query "staticWebsite" --output json --only-show-errors)
    if ($LASTEXITCODE -eq 0 -and $verifySwJson) {
        $verifySw = $verifySwJson | ConvertFrom-Json
        if ($verifySw.enabled -ne $true) {
            throw "Static website hosting enable succeeded (exit code 0) but status shows disabled. This is an Azure CLI bug."
        }
        Write-Done "Static website enabled and verified (index=$($verifySw.indexDocument))."
    } else {
        Write-Done "Static website enabled (could not verify status)."
    }

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
        --only-show-errors 2>$null | Out-Null
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
        Write-Info "Function App not yet in 'Running' state (state=$state), starting it..."
        az functionapp start --name $functionAppName --resource-group $ResourceGroup --only-show-errors 2>$null | Out-Null
        Start-Sleep -Seconds 5
    }
    Write-Done "Function App created (Consumption plan)."

    # -- 6. Configure App Settings --------------------------------------
    # Uses ARM REST API with a file-based body to avoid cmd.exe mangling.
    # On Windows, `az` is `az.cmd` — all arguments pass through cmd.exe which
    # interprets semicolons as command separators, breaking connection strings.
    # Writing settings to a JSON file and using `az rest --body @file` bypasses
    # cmd.exe argument parsing entirely.
    Write-Step "Configuring app settings..."

    # Include ALL critical settings — don't rely on merge preserving them.
    # The ARM PUT replaces all settings; if the read-merge misses a value
    # (e.g., propagation delay after az functionapp create), it gets dropped.
    $storageConnStrForFunc = az storage account show-connection-string `
        --name $storageName `
        --resource-group $ResourceGroup `
        --output json --only-show-errors
    $storageConnStrForFunc = ($storageConnStrForFunc | ConvertFrom-Json).connectionString

    $newSettings = @{
        "WebPubSubConnectionString"         = $wpsConnStr
        "WebPubSubHubName"                  = $hubName
        "AzureTableStorageConnectionString" = $storageConnStr
        "AzureWebJobsStorage"              = $storageConnStrForFunc
        "FUNCTIONS_EXTENSION_VERSION"       = "~4"
        "FUNCTIONS_WORKER_RUNTIME"          = "node"
        "WEBSITE_NODE_DEFAULT_VERSION"      = "~20"
        "SCM_DO_BUILD_DURING_DEPLOYMENT"    = "false"
        "AzureWebJobsFeatureFlags"          = "EnableWorkerIndexing"
    }

    $subId = (az account show --query id --output tsv)
    Assert-AzSuccess "Failed to get subscription ID"

    # Retrieve existing app settings to merge (preserves any additional system
    # settings not in our list; critical settings are now self-contained above)
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

        # Connection strings require file-based approach. Build a merged settings
        # body by re-reading current settings (which now include the safe settings
        # set above) and adding the connection strings.
        Write-Info "Setting connection strings via ARM REST API..."
        $fbExistingRaw = (az rest --method POST `
            --url "$armBase/config/appsettings/list?api-version=2022-03-01" `
            --only-show-errors 2>$null)
        $fbMerged = @{}
        $fbExistingProps = ($fbExistingRaw -join "`n" | ConvertFrom-Json).properties
        if ($fbExistingProps) {
            $fbExistingProps.PSObject.Properties | ForEach-Object { $fbMerged[$_.Name] = $_.Value }
        }
        $fbMerged["WebPubSubConnectionString"] = $wpsConnStr
        $fbMerged["AzureTableStorageConnectionString"] = $storageConnStr

        $connFile = Join-Path $PSScriptRoot "_conn_setting.json"
        $connBody = @{ properties = $fbMerged } | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText($connFile, $connBody, [System.Text.UTF8Encoding]::new($false))
        az rest --method PUT `
            --url "$armBase/config/appsettings?api-version=2022-03-01" `
            --body "@$connFile" `
            --only-show-errors 2>$null | Out-Null
        Remove-Item $connFile -Force -ErrorAction SilentlyContinue
    }

    # Verify critical settings were applied by reading them back
    Write-Info "Verifying app settings..."
    $verifyRaw = (az rest --method POST `
        --url "$armBase/config/appsettings/list?api-version=2022-03-01" `
        --only-show-errors 2>$null)
    $verifyProps = ($verifyRaw -join "`n" | ConvertFrom-Json).properties
    $criticalKeys = @("AzureWebJobsFeatureFlags", "FUNCTIONS_EXTENSION_VERSION", "FUNCTIONS_WORKER_RUNTIME", "WebPubSubConnectionString", "AzureTableStorageConnectionString", "AzureWebJobsStorage")
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

    # Restart to pick up EnableWorkerIndexing before code deployment
    Write-Info "Restarting Function App to apply settings..."
    az functionapp restart --name $functionAppName --resource-group $ResourceGroup --only-show-errors 2>$null | Out-Null
    Start-Sleep -Seconds 10

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

    # Clean previous staging (use cmd /c rd for long paths in node_modules)
    if (Test-Path $stageDir) { cmd /c "rd /s /q `"$stageDir`"" 2>$null }
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
        $npmOutput = npm install --omit=dev 2>&1
        if ($LASTEXITCODE -ne 0) {
            Pop-Location
            throw "npm install failed (exit code $LASTEXITCODE):`n$($npmOutput -join "`n")"
        }
    } finally {
        Pop-Location
    }

    # Verify staging directory before packaging
    $requiredFiles = @(
        (Join-Path $stageDir "package.json"),
        (Join-Path $stageDir "host.json"),
        (Join-Path (Join-Path $stageDir "src") "index.js"),
        (Join-Path (Join-Path (Join-Path $stageDir "src") "functions") "negotiate.js"),
        (Join-Path (Join-Path (Join-Path $stageDir "src") "functions") "gameHub.js"),
        (Join-Path (Join-Path (Join-Path $stageDir "src") "functions") "health.js"),
        (Join-Path (Join-Path (Join-Path (Join-Path $stageDir "node_modules") "@azure") "functions") "package.json")
    )
    foreach ($f in $requiredFiles) {
        if (-not (Test-Path $f)) {
            throw "Staging verification failed: missing required file '$f'"
        }
    }
    Write-Info "Staging directory verified (all required files present)."

    # Create deployment zip using .NET ZipFile (handles long paths that Compress-Archive cannot)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($stageDir, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    $zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
    Write-Done "Package created ($zipSize MB)."

    Write-Step "Deploying Function App code..."
    $deploySuccess = $false
    # config-zip uploads the zip to blob storage then may delete the local file.
    # Copy it so retries have a file to work with.
    $zipBackup = "${zipPath}.bak"
    Copy-Item $zipPath $zipBackup -Force
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        if (-not (Test-Path $zipPath)) {
            Copy-Item $zipBackup $zipPath -Force
        }
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
    Remove-Item $zipBackup -Force -ErrorAction SilentlyContinue
    if (-not $deploySuccess) {
        throw "Failed to deploy Function App code after 3 attempts"
    }
    Write-Done "Function App deployed."

    # Re-verify all critical settings after zip deploy (zip deploy can reset settings)
    Write-Info "Verifying app settings after deployment..."
    $postDeployRaw = (az rest --method POST `
        --url "$armBase/config/appsettings/list?api-version=2022-03-01" `
        --only-show-errors 2>$null)
    $postDeployProps = ($postDeployRaw -join "`n" | ConvertFrom-Json).properties

    $reapplyNeeded = $false
    $criticalPostDeploy = @{
        "AzureWebJobsFeatureFlags"  = "EnableWorkerIndexing"
        "FUNCTIONS_WORKER_RUNTIME"  = "node"
        "FUNCTIONS_EXTENSION_VERSION" = "~4"
    }
    # Note: WEBSITE_RUN_FROM_PACKAGE is NOT in this list because config-zip
    # on Linux Consumption correctly sets it to a blob SAS URL. Overriding
    # to '1' breaks the runtime (it looks for a nonexistent local path).
    foreach ($key in $criticalPostDeploy.Keys) {
        $actual = $postDeployProps.$key
        $expected = $criticalPostDeploy[$key]
        if ($actual -ne $expected) {
            Write-Info "Post-deploy setting drift: $key='$actual' (expected '$expected')"
            $reapplyNeeded = $true
        }
    }
    if ($reapplyNeeded) {
        Write-Info "Re-applying critical settings after deployment..."
        foreach ($key in $criticalPostDeploy.Keys) {
            $postDeployProps | Add-Member -MemberType NoteProperty -Name $key -Value $criticalPostDeploy[$key] -Force
        }
        $postSettingsFile = Join-Path $PSScriptRoot "_post_deploy_settings.json"
        $postSettingsJson = @{ properties = $postDeployProps } | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText($postSettingsFile, $postSettingsJson, [System.Text.UTF8Encoding]::new($false))
        az rest --method PUT `
            --url "$armBase/config/appsettings?api-version=2022-03-01" `
            --body "@$postSettingsFile" `
            --only-show-errors 2>$null | Out-Null
        Remove-Item $postSettingsFile -Force -ErrorAction SilentlyContinue
        Write-Done "Critical settings re-applied."
    } else {
        Write-Info "All critical settings intact after deployment."
    }

    # Full stop + start (more thorough than restart for clearing cached state)
    Write-Info "Stopping Function App..."
    az functionapp stop --name $functionAppName --resource-group $ResourceGroup --only-show-errors 2>$null | Out-Null
    Start-Sleep -Seconds 5
    Write-Info "Starting Function App..."
    az functionapp start --name $functionAppName --resource-group $ResourceGroup --only-show-errors 2>$null | Out-Null
    Start-Sleep -Seconds 15

    # -- Post-deploy: Verify endpoints via health check ----------------------
    Write-Step "Verifying function endpoints after deployment..."
    $functionAppUrl = "https://${functionAppName}.azurewebsites.net"

    # -- Health endpoint check (primary) --
    Write-Info "Polling /api/health endpoint (up to 10 attempts, 15s apart)..."
    $healthOk = $false
    $healthBody = $null
    for ($check = 1; $check -le 10; $check++) {
        try {
            $hResp = Invoke-WebRequest -Uri "$functionAppUrl/api/health" -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
            if ($hResp.StatusCode -eq 200) {
                $healthOk = $true
                $healthBody = $hResp.Content | ConvertFrom-Json
                break
            }
        } catch {
            $hStatus = $null
            try { $hStatus = $_.Exception.Response.StatusCode.value__ } catch { }
            if ($hStatus -and $hStatus -ne 404) {
                # Non-404 means the function runtime loaded but something else is wrong
                Write-Info "Health endpoint returned HTTP $hStatus (attempt $check/10)"
            }
        }
        if ($check -lt 10) {
            Write-Info "Health endpoint not ready (attempt $check/10), waiting 15s..."
            if ($check -eq 5) {
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

    if ($healthOk -and $healthBody) {
        Write-Done "Health endpoint is live!"
        Write-Host "   Status:    $($healthBody.status)" -ForegroundColor Green
        Write-Host "   Runtime:   $($healthBody.runtime)" -ForegroundColor Green
        Write-Host "   Timestamp: $($healthBody.timestamp)" -ForegroundColor Green
        Write-Host "   Functions: $($healthBody.functionsLoaded -join ', ')" -ForegroundColor Green

        # Check settings configuration
        $settings = $healthBody.settings
        if ($settings) {
            if (-not $settings.webPubSubConfigured) {
                Write-Host "   WARNING: WebPubSubConnectionString is NOT configured!" -ForegroundColor Red
            }
            if (-not $settings.tableStorageConfigured) {
                Write-Host "   WARNING: AzureTableStorageConnectionString is NOT configured!" -ForegroundColor Red
            }
            $wif = $settings.workerIndexing
            if ($wif -ne "EnableWorkerIndexing") {
                Write-Host "   WARNING: AzureWebJobsFeatureFlags = '$wif' (expected 'EnableWorkerIndexing')" -ForegroundColor Red
            } else {
                Write-Host "   Settings: All configured correctly" -ForegroundColor Green
            }
        }
    } else {
        Write-Host ""
        Write-Host "   ============================================================" -ForegroundColor Red
        Write-Host "   HEALTH ENDPOINT NOT REACHABLE AFTER 10 ATTEMPTS" -ForegroundColor Red
        Write-Host "   ============================================================" -ForegroundColor Red
        Write-Host ""
        Write-Host "   The Azure Functions runtime did not respond at:" -ForegroundColor Red
        Write-Host "   $functionAppUrl/api/health" -ForegroundColor Red
        Write-Host ""
        Write-Host "   This means the runtime failed to discover/load functions." -ForegroundColor Yellow
        Write-Host "   Common causes:" -ForegroundColor Yellow
        Write-Host "   - Node.js worker crashed on startup (missing modules, ESM issues)" -ForegroundColor Yellow
        Write-Host "   - AzureWebJobsFeatureFlags not set to EnableWorkerIndexing" -ForegroundColor Yellow
        Write-Host "   - Zip package structure issues" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "   Diagnostic steps:" -ForegroundColor Yellow
        Write-Host "   1. Azure Portal -> Function App -> Functions blade -> do functions appear?" -ForegroundColor Yellow
        Write-Host "   2. Azure Portal -> Function App -> Configuration -> verify AzureWebJobsFeatureFlags = EnableWorkerIndexing" -ForegroundColor Yellow
        Write-Host "   3. Azure Portal -> Function App -> Log stream -> look for startup errors" -ForegroundColor Yellow
        Write-Host ""
    }

    # -- Negotiate endpoint check (secondary) --
    Write-Info "Checking negotiate endpoint..."
    $negotiateOk = $false
    try {
        $nResp = Invoke-WebRequest -Uri "$functionAppUrl/api/negotiate" -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
        $negotiateOk = $true
    } catch {
        $nStatus = $null
        try { $nStatus = $_.Exception.Response.StatusCode.value__ } catch { }
        if ($nStatus -and $nStatus -ne 404) {
            # 400 = function loaded (missing gameId param), 500 = function loaded (config issue)
            $negotiateOk = $true
            if ($nStatus -eq 400) {
                Write-Done "Negotiate endpoint is live (returned 400 Missing gameId — expected without params)."
            } else {
                Write-Info "Negotiate endpoint returned HTTP $nStatus (function is loaded but may have config issues)."
            }
        }
    }
    if (-not $negotiateOk) {
        Write-Host "   WARNING: Negotiate endpoint returned 404 — function not discovered by runtime." -ForegroundColor Red
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

    # Defensive: re-enable static website hosting immediately before upload.
    # Intermediate operations (Function App create, zip deploy, etc.) can
    # reset storage account properties. Re-enabling is idempotent and free.
    Write-Info "Re-enabling static website hosting (defensive)..."
    $uploadKey = $env:AZURE_STORAGE_KEY
    az storage blob service-properties update `
        --account-name $storageName `
        --account-key $uploadKey `
        --static-website `
        --index-document index.html `
        --404-document index.html `
        --only-show-errors | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Info "WARNING: Static website re-enable returned exit code $LASTEXITCODE"
    }

    # Generate config.json with the Function App URL
    $configJson = @{ apiBaseUrl = "https://${functionAppName}.azurewebsites.net" } | ConvertTo-Json
    $configPath = Join-Path $clientDir "config.json"
    Set-Content -Path $configPath -Value $configJson -Encoding UTF8

    # Upload files — pass --account-name and --account-key explicitly.
    # Env vars alone can be unreliable through az.cmd on some Windows CLI versions.
    az storage blob upload-batch `
        --source $clientDir `
        --destination '$web' `
        --account-name $storageName `
        --account-key $uploadKey `
        --overwrite `
        --only-show-errors
    Assert-AzSuccess "Failed to upload client files to static website"

    # Verify files were actually uploaded (upload-batch can exit 0 with 0 files)
    $blobJson = (az storage blob list `
        --container-name '$web' `
        --account-name $storageName `
        --account-key $uploadKey `
        --output json --only-show-errors)
    Assert-AzSuccess "Failed to verify uploaded files"
    $blobList = ($blobJson | ConvertFrom-Json)
    $blobCount = $blobList.Count
    if ([int]$blobCount -lt 1) {
        throw "Upload verification failed: 0 files found in '`$web' container."
    }

    # Verify index.html specifically exists (this is what the static website serves)
    $indexBlob = $blobList | Where-Object { $_.name -eq "index.html" }
    if (-not $indexBlob) {
        $blobNames = ($blobList | ForEach-Object { $_.name }) -join ", "
        throw "index.html not found in '`$web' container. Found: $blobNames"
    }
    Write-Info "Verified: $blobCount file(s) in '`$web' container (index.html confirmed)."

    # Verify static website hosting is still enabled after all operations
    $swPropsJson = (az storage blob service-properties show `
        --account-name $storageName `
        --account-key $uploadKey `
        --query "staticWebsite" --output json --only-show-errors)
    if ($LASTEXITCODE -eq 0 -and $swPropsJson) {
        $swProps = $swPropsJson | ConvertFrom-Json
        if ($swProps.enabled -ne $true) {
            Write-Host "   WARNING: Static website hosting is DISABLED after upload! Re-enabling..." -ForegroundColor Red
            az storage blob service-properties update `
                --account-name $storageName `
                --account-key $uploadKey `
                --static-website `
                --index-document index.html `
                --404-document index.html `
                --only-show-errors | Out-Null
            Assert-AzSuccess "Failed to re-enable static website hosting"
            Write-Done "Static website hosting re-enabled."
        } else {
            Write-Info "Static website hosting verified: enabled, index=$($swProps.indexDocument)"
        }
    }

    # Clean up generated config.json from source
    Remove-Item $configPath -Force -ErrorAction SilentlyContinue
    Write-Done "Client files uploaded."

    # -- 11. Clean Up ---------------------------------------------------
    if (Test-Path $stageDir) { cmd /c "rd /s /q `"$stageDir`"" 2>$null }
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

    # -- 12a. Health Check: Static Website --------------------------------
    Write-Info "Checking static website accessibility..."
    $siteOk = $false
    for ($hc = 1; $hc -le 3; $hc++) {
        try {
            $healthResp = Invoke-WebRequest -Uri "$staticWebUrl/" -TimeoutSec 15 -UseBasicParsing -ErrorAction Stop
            Write-Done "Static website is live (HTTP $($healthResp.StatusCode))."
            $siteOk = $true
            break
        } catch {
            $hcStatus = $_.Exception.Response.StatusCode.value__
            if ($hcStatus -eq 404) {
                Write-Info "Static website returned 404 (attempt $hc/3), waiting 10s..."
                if ($hc -lt 3) { Start-Sleep -Seconds 10 }
            } else {
                Write-Info "Static website returned HTTP $hcStatus (attempt $hc/3)"
                if ($hcStatus -and $hcStatus -ne 404) { $siteOk = $true; break }
                if ($hc -lt 3) { Start-Sleep -Seconds 10 }
            }
        }
    }
    if (-not $siteOk) {
        Write-Host ""
        Write-Host "   ============================================================" -ForegroundColor Red
        Write-Host "   STATIC WEBSITE STILL RETURNING 404" -ForegroundColor Red
        Write-Host "   ============================================================" -ForegroundColor Red
        Write-Host "   URL: $staticWebUrl" -ForegroundColor Red
        Write-Host ""
        Write-Host "   Diagnostics:" -ForegroundColor Yellow
        # Check static website status
        $diagSwJson = (az storage blob service-properties show `
            --account-name $storageName `
            --account-key $uploadKey `
            --query "staticWebsite" --output json --only-show-errors 2>$null)
        if ($diagSwJson) {
            Write-Host "   Static website config: $diagSwJson" -ForegroundColor Yellow
        }
        # List blob names
        $diagBlobs = (az storage blob list `
            --container-name '$web' `
            --account-name $storageName `
            --account-key $uploadKey `
            --query "[].name" --output json --only-show-errors 2>$null)
        if ($diagBlobs) {
            Write-Host "   Blobs in `$web: $diagBlobs" -ForegroundColor Yellow
        }
        Write-Host ""
        Write-Host "   Next steps:" -ForegroundColor Yellow
        Write-Host "   1. Wait 1-2 minutes and try the URL in a browser" -ForegroundColor Yellow
        Write-Host "   2. Run: az storage blob service-properties show --account-name $storageName --query staticWebsite" -ForegroundColor Yellow
        Write-Host "   3. Run: az storage blob list --container-name '`$web' --account-name $storageName --query '[].name'" -ForegroundColor Yellow
        Write-Host ""
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

    # Clean up staging and temp files on failure (use cmd /c rd for long paths)
    if (Test-Path $stageDir) { cmd /c "rd /s /q `"$stageDir`"" 2>$null }
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    $settingsCleanup = Join-Path $PSScriptRoot "_appsettings.json"
    if (Test-Path $settingsCleanup) { Remove-Item $settingsCleanup -Force -ErrorAction SilentlyContinue }
    $connCleanup = Join-Path $PSScriptRoot "_conn_setting.json"
    if (Test-Path $connCleanup) { Remove-Item $connCleanup -Force -ErrorAction SilentlyContinue }
    $postDeployCleanup = Join-Path $PSScriptRoot "_post_deploy_settings.json"
    if (Test-Path $postDeployCleanup) { Remove-Item $postDeployCleanup -Force -ErrorAction SilentlyContinue }

    # Clean up generated config.json if it exists
    $configCleanup = Join-Path $clientDir "config.json"
    if (Test-Path $configCleanup) { Remove-Item $configCleanup -Force -ErrorAction SilentlyContinue }

    exit 1
}
