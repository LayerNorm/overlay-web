/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path')

function getWorkspaceLazyModulePath(moduleName, workspaceRoot) {
  const prefix = './node_modules/'
  if (typeof moduleName !== 'string' || !moduleName.startsWith(prefix)) return null

  const packagePath = moduleName.slice(prefix.length)
  const pathSegments = packagePath.split('/')
  if (
    !packagePath ||
    packagePath.includes('\\') ||
    pathSegments.some((segment) => !segment || segment === '.' || segment === '..')
  ) return null

  const nodeModulesRoot = path.resolve(workspaceRoot, 'node_modules')
  const resolvedPath = path.resolve(nodeModulesRoot, packagePath)
  const relativePath = path.relative(nodeModulesRoot, resolvedPath)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    return null
  }
  return resolvedPath
}

function resolveWorkspaceLazyModule(moduleName, workspaceRoot, resolveLocal, resolveWorkspace) {
  const workspaceModulePath = getWorkspaceLazyModulePath(moduleName, workspaceRoot)
  if (!workspaceModulePath) return { matched: false }

  try {
    return { matched: true, resolution: resolveLocal() }
  } catch (localError) {
    try {
      return { matched: true, resolution: resolveWorkspace(workspaceModulePath) }
    } catch {
      throw localError
    }
  }
}

module.exports = { getWorkspaceLazyModulePath, resolveWorkspaceLazyModule }
