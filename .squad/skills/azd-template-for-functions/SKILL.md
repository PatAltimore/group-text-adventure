---
name: "azd-template-for-functions"
description: "How to create an azd template for Azure Functions + Storage static website + Web PubSub"
domain: "infrastructure, deployment"
confidence: "high"
source: "earned — built and validated for group-text-adventure project"
---

## Context

When a project uses Azure Functions (Linux Consumption) + Azure Storage static website + Azure Web PubSub and needs an Azure Developer CLI (`azd`) template.

## Patterns

1. **Subscription-scoped main.bicep + resource module:** `main.bicep` at `targetScope = 'subscription'` creates the resource group, then calls a `resources.bicep` module scoped to that RG. This is standard azd convention.

2. **Static website hosting is data-plane only.** Bicep cannot enable it. Use a `postdeploy` hook in `azure.yaml` that calls `az storage blob service-properties update --static-website`.

3. **Web PubSub event handler requires Function App system key.** This is a chicken-and-egg problem — the key is only available after the Function App is deployed and running. Handle in `postdeploy` hook with retry polling for `webpubsub_extension` system key.

4. **Prepackage hook for bundling extra directories.** If the Function App needs files outside its source directory (e.g., `world/`), use a `prepackage` hook to copy them in before azd packages the code.

5. **Client config generation at deploy time.** Generate `config.json` with the Function App URL in `postdeploy`, upload to `$web` container, then clean up the generated file from source.

6. **Resource naming with uniqueString.** Use `uniqueString(subscription().subscriptionId, environmentName, location)` for globally unique, deterministic resource names.

7. **All app settings in Bicep.** Connection strings can reference `listKeys()` and `listKeys().primaryConnectionString` directly in the `appSettings` array.

## Examples

- `infra/main.bicep` — subscription-scoped orchestrator
- `infra/resources.bicep` — Storage, Web PubSub, Function App with all app settings
- `azure.yaml` — hooks for prepackage (world/ copy + npm install) and postdeploy (static site, WPS handler, config, CORS)

## Anti-Patterns

- **Don't try to enable static website in Bicep** — it's a data-plane operation, not ARM.
- **Don't hardcode Web PubSub event handler URL in Bicep** — system key isn't available until after deployment.
- **Don't set WEBSITE_RUN_FROM_PACKAGE=1 on Linux Consumption** — config-zip sets it to a blob SAS URL; overriding to `1` causes 503.
- **Don't use `Compress-Archive`** for deployment zips — it can't handle long node_modules paths. Use `ZipFile::CreateFromDirectory` or let azd handle packaging.
