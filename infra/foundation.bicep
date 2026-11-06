param location string
var suffix = uniqueString(subscription().subscriptionId, resourceGroup().id)

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: 'unijar${suffix}'
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    policies: { azureADAuthenticationAsArmPolicy: { status: 'enabled' } }
  }
}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'unijar-pull'
  location: location
}
resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, 'AcrPull')
  scope: registry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}
resource logs 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: 'unijar-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: json('0.1') }
  }
}
resource environment 'Microsoft.App/managedEnvironments@2026-07-01' = {
  name: 'unijar-env'
  location: location
  properties: {
    environmentMode: 'WorkloadProfiles'
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey }
    }
  }
}
output registryName string = registry.name
output identityName string = identity.name
output environmentName string = environment.name
