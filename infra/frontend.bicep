param location string = resourceGroup().location
param registryName string
param environmentName string = 'unijar-env'
param identityName string = 'unijar-pull'
param imageDigest string
param sourceCommit string
param apiUrl string

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' existing = { name: registryName }
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = { name: identityName }
resource environment 'Microsoft.App/managedEnvironments@2026-07-01' existing = { name: environmentName }
resource frontend 'Microsoft.App/containerApps@2025-01-01' = {
  name: 'unijar-web'
  location: location
  tags: { project: 'UniJar', component: 'frontend' }
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 8080, transport: 'http', allowInsecure: false }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
    }
    template: {
      revisionSuffix: 'w-${take(sourceCommit, 8)}-${substring(imageDigest, 7, 8)}'
      containers: [{
        name: 'web'
        image: '${registry.properties.loginServer}/unijar-web@${imageDigest}'
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [{ name: 'SOURCE_COMMIT', value: sourceCommit }, { name: 'API_URL', value: apiUrl }]
        probes: [
          { type: 'Startup', httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 5, timeoutSeconds: 2, failureThreshold: 30 }
          { type: 'Readiness', httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 10, timeoutSeconds: 2, failureThreshold: 3 }
          { type: 'Liveness', httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 30, timeoutSeconds: 2, failureThreshold: 3 }
        ]
      }]
      scale: { minReplicas: 0, maxReplicas: 1, rules: [{ name: 'http', http: { metadata: { concurrentRequests: '20' } } }] }
    }
  }
}
output url string = 'https://${frontend.properties.configuration.ingress.fqdn}'
