// ============================================================================
// Group Text Adventure — Resource Definitions
// ============================================================================
// All resources are provisioned at minimal cost:
//   - Storage Account: Standard_LRS, StorageV2 (static website + table storage)
//   - Web PubSub: Free_F1 (20 connections, 20K messages/day)
//   - Function App: Linux Consumption plan (pay-per-execution)
// ============================================================================

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

param location string
param tags object
param storageAccountName string
param functionAppName string
param appServicePlanName string
param webPubSubName string
param hubName string

// ---------------------------------------------------------------------------
// Storage Account
// ---------------------------------------------------------------------------
// Serves three purposes:
//   1. Static website hosting for the game client ($web container)
//   2. Azure Table Storage for game state persistence
//   3. Backend storage for the Function App (AzureWebJobsStorage)
// Note: Static website enablement is a data-plane operation done in postdeploy hook.

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: true  // Required for static website hosting
    supportsHttpsTrafficOnly: true
  }
}

// ---------------------------------------------------------------------------
// Azure Web PubSub
// ---------------------------------------------------------------------------
// Provides real-time WebSocket communication for the multiplayer game.
// Free tier: 20 concurrent connections, 20,000 messages/day.
// Hub event handler is configured in postdeploy hook (requires Function App system key).

resource webPubSub 'Microsoft.SignalRService/WebPubSub@2023-06-01-preview' = {
  name: webPubSubName
  location: location
  tags: tags
  sku: {
    name: 'Free_F1'
    tier: 'Free'
    capacity: 1
  }
  properties: {}
}

// ---------------------------------------------------------------------------
// App Service Plan (Linux Consumption / Serverless)
// ---------------------------------------------------------------------------
// Y1 = Consumption plan. Linux is required for Node.js 20 on Functions v4.

resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: appServicePlanName
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true  // required for Linux
  }
}

// ---------------------------------------------------------------------------
// Function App
// ---------------------------------------------------------------------------
// Hosts the game engine API: negotiate, gameHub (Web PubSub), health endpoint.
// Node.js 20, Azure Functions v4, ESM modules.
//
// CORS is set to the storage account's static website URL so the browser client
// can call the API. The static website URL follows the pattern:
//   https://<storageAccountName>.z13.web.core.windows.net
// However, the exact zone depends on the region, so we use a wildcard-friendly
// approach: CORS is also updated in the postdeploy hook with the actual URL.

resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: functionAppName
  location: location
  tags: union(tags, {
    // azd uses this tag to identify the Function App as the 'api' service
    'azd-service-name': 'api'
  })
  kind: 'functionapp,linux'
  properties: {
    serverFarmId: appServicePlan.id
    reserved: true  // Linux
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Node|20'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        // --- Connection strings (references to provisioned resources) ---
        {
          name: 'WebPubSubConnectionString'
          value: webPubSub.listKeys().primaryConnectionString
        }
        {
          name: 'WebPubSubHubName'
          value: hubName
        }
        {
          name: 'AzureTableStorageConnectionString'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
        }
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
        }
        // --- Azure Functions runtime configuration ---
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
        // EnableWorkerIndexing is required for Azure Functions v4 Node.js
        // to discover functions registered via app.http() / app.generic()
        {
          name: 'AzureWebJobsFeatureFlags'
          value: 'EnableWorkerIndexing'
        }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output storageAccountName string = storageAccount.name
output functionAppName string = functionApp.name
output webPubSubName string = webPubSub.name
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
output staticWebsiteUrl string = storageAccount.properties.primaryEndpoints.web
