param location string
param registryName string
param environmentName string
param identityName string
@minLength(71)
param imageDigest string
@minLength(40)
param sourceCommit string
@secure()
param rpcUrl string
param corsOrigins string = ''

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' existing = { name: registryName }
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = { name: identityName }
resource environment 'Microsoft.App/managedEnvironments@2025-01-01' existing = { name: environmentName }
resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: 'unijar-api'
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 8080, transport: 'http', allowInsecure: false }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
      secrets: [{ name: 'sepolia-rpc', value: rpcUrl }]
    }
    template: {
      revisionSuffix: '${take(sourceCommit, 8)}-${substring(imageDigest, 7, 8)}'
      containers: [{
        name: 'api'
        image: '${registry.properties.loginServer}/unijar@${imageDigest}'
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [
          { name: 'RPC_URL', secretRef: 'sepolia-rpc' }
          { name: 'EXPECTED_CHAIN_ID', value: '11155111' }
          { name: 'CORS_ORIGINS', value: corsOrigins }
        ]
        probes: [
          { type: 'Startup', httpGet: { path: '/healthz', port: 8080 }, initialDelaySeconds: 1, periodSeconds: 5, timeoutSeconds: 2, failureThreshold: 60 }
          { type: 'Liveness', httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 30, timeoutSeconds: 2, failureThreshold: 3 }
          { type: 'Readiness', httpGet: { path: '/readyz', port: 8080 }, initialDelaySeconds: 5, periodSeconds: 10, timeoutSeconds: 10, failureThreshold: 3 }
        ]
      }]
      scale: { minReplicas: 0, maxReplicas: 1, rules: [{ name: 'http', http: { metadata: { concurrentRequests: '10' } } }] }
    }
  }
}
output fqdn string = app.properties.configuration.ingress.fqdn
