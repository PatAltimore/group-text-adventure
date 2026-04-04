// ============================================================================
// Group Text Adventure — Azure Infrastructure (azd template)
// ============================================================================
// Provisions: Storage Account, Web PubSub (Free), Function App (Linux Consumption)
// Matches the architecture in deploy/deploy.ps1 but uses Infrastructure-as-Code.
//
// Note: Static website hosting and Web PubSub event handler configuration are
// data-plane operations handled by azure.yaml postdeploy hooks.
// ============================================================================

targetScope = 'subscription'

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

@minLength(1)
@maxLength(64)
@description('Name of the azd environment (used for resource group and resource naming)')
param environmentName string

@minLength(1)
@description('Azure region for all resources')
param location string

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

// Unique token derived from subscription + environment for globally unique names
var resourceToken = toLower(uniqueString(subscription().subscriptionId, environmentName, location))

// Resource names following azd conventions with abbreviations
var resourceGroupName = 'rg-${environmentName}'
var storageAccountName = 'st${resourceToken}'  // max 24 chars, lowercase alphanumeric only
var functionAppName = 'func-${resourceToken}'
var appServicePlanName = 'plan-${resourceToken}'
var webPubSubName = 'wps-${resourceToken}'
var hubName = 'gameHub'

// Tags applied to all resources for azd tracking
var tags = {
  'azd-env-name': environmentName
}

// ---------------------------------------------------------------------------
// Resource Group
// ---------------------------------------------------------------------------

resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

// ---------------------------------------------------------------------------
// Module: All resources deployed into the resource group
// ---------------------------------------------------------------------------

module resources 'resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    location: location
    tags: tags
    storageAccountName: storageAccountName
    functionAppName: functionAppName
    appServicePlanName: appServicePlanName
    webPubSubName: webPubSubName
    hubName: hubName
  }
}

// ---------------------------------------------------------------------------
// Outputs — consumed by azd and postdeploy hooks
// ---------------------------------------------------------------------------

output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_FUNCTION_APP_NAME string = resources.outputs.functionAppName
output AZURE_STORAGE_ACCOUNT_NAME string = resources.outputs.storageAccountName
output AZURE_WEB_PUBSUB_NAME string = resources.outputs.webPubSubName
output AZURE_FUNCTION_APP_URL string = resources.outputs.functionAppUrl
output AZURE_STATIC_WEBSITE_URL string = resources.outputs.staticWebsiteUrl
// The API service URI is required by azd to know where to deploy the function app
output SERVICE_API_URI string = resources.outputs.functionAppUrl
