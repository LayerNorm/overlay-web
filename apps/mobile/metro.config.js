/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

// Only add watchFolders when directories exist (local dev, not EAS cloud)
const watchFolders = []
if (fs.existsSync(workspaceRoot)) {
  watchFolders.push(workspaceRoot)
}
const overlayAppCore = path.resolve(workspaceRoot, 'packages/overlay-app-core')
if (fs.existsSync(overlayAppCore)) {
  watchFolders.push(overlayAppCore)
}
const overlayApiClient = path.resolve(workspaceRoot, 'packages/overlay-api-client')
if (fs.existsSync(overlayApiClient)) {
  watchFolders.push(overlayApiClient)
}
const overlayChatCore = path.resolve(workspaceRoot, 'packages/overlay-chat-core')
if (fs.existsSync(overlayChatCore)) {
  watchFolders.push(overlayChatCore)
}
const overlayWorkspaceContracts = path.resolve(
  workspaceRoot,
  'packages/overlay-workspace-contracts',
)
if (fs.existsSync(overlayWorkspaceContracts)) {
  watchFolders.push(overlayWorkspaceContracts)
}
if (watchFolders.length > 0) {
  config.watchFolders = watchFolders
}

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  '@overlay/api-client': overlayApiClient,
  '@overlay/app-core': overlayAppCore,
  '@overlay/chat-core': overlayChatCore,
  '@overlay/workspace-contracts': overlayWorkspaceContracts,
}

module.exports = config
