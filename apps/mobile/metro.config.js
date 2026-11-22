/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')
const { resolveWorkspaceLazyModule } = require('./scripts/resolve-shared-markdown-lazy-module.cjs')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

const watchFolders = [workspaceRoot]
// Standalone EAS builds mount these directories from a sibling web checkout.
const workspaceLinks = new Map()
for (const entry of ['src', 'convex', 'packages', 'config', 'services']) {
  const location = path.join(workspaceRoot, entry)
  if (fs.existsSync(location) && fs.lstatSync(location).isSymbolicLink()) {
    workspaceLinks.set(entry, fs.realpathSync(location))
  }
}
watchFolders.push(...workspaceLinks.values())
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

const defaultResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'katex/dist/katex.min.css') {
    const katexStylesheet = path.resolve(projectRoot, 'assets/shared-markdown-katex.generated.css')
    if (!fs.existsSync(katexStylesheet)) {
      throw new Error('Run npm run build:shared-markdown-css before bundling the shared Markdown DOM renderer.')
    }
    return context.resolveRequest(context, katexStylesheet, platform)
  }
  if (workspaceLinks.size > 0) {
    const candidate = moduleName.startsWith('@/shared/')
      ? path.join(workspaceRoot, 'src', moduleName.slice(2))
      : moduleName.startsWith('.')
        ? path.resolve(path.dirname(context.originModulePath), moduleName)
        : moduleName
    if (path.isAbsolute(candidate)) {
      const [entry, ...rest] = path.relative(workspaceRoot, candidate).split(path.sep)
      const realPath = workspaceLinks.get(entry)
      if (realPath) return context.resolveRequest(context, path.join(realPath, ...rest), platform)
    }
  }
  const resolveNormally = () => defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform)
  if (platform === 'web') {
    const lazyModule = resolveWorkspaceLazyModule(
      moduleName,
      workspaceRoot,
      resolveNormally,
      (workspacePath) => context.resolveRequest(context, workspacePath, platform),
    )
    if (lazyModule.matched) return lazyModule.resolution
  }
  const isReactModule =
    moduleName === 'react' ||
    moduleName.startsWith('react/') ||
    moduleName === 'react-dom' ||
    moduleName.startsWith('react-dom/')
  if (platform === 'web' && isReactModule) {
    return context.resolveRequest(context, path.resolve(workspaceRoot, 'node_modules', moduleName), platform)
  }
  return resolveNormally()
}

module.exports = config
