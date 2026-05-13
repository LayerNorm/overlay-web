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
if (watchFolders.length > 0) {
  config.watchFolders = watchFolders
}

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  '@overlay/app-core': overlayAppCore,
}

module.exports = config
