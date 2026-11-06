targetScope = 'subscription'

param location string = 'centralindia'
param groupName string = 'unijar-demo-rg'
param deployApplication bool = false
param imageDigest string = ''
param sourceCommit string = ''
@secure()
param rpcUrl string = ''
param corsOrigins string = ''

resource group 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: groupName
  location: location
  tags: { project: 'UniJar', purpose: 'controlled-hackathon-demo' }
}

module foundation 'foundation.bicep' = {
  name: 'unijar-foundation'
  scope: group
  params: { location: location }
}

module application 'application.bicep' = if (deployApplication) {
  name: 'unijar-api'
  scope: group
  params: {
    location: location
    registryName: foundation.outputs.registryName
    environmentName: foundation.outputs.environmentName
    identityName: foundation.outputs.identityName
    imageDigest: imageDigest
    sourceCommit: sourceCommit
    rpcUrl: rpcUrl
    corsOrigins: corsOrigins
  }
}

output registryName string = foundation.outputs.registryName
output groupName string = group.name
output fqdn string = deployApplication ? application!.outputs.fqdn : ''
