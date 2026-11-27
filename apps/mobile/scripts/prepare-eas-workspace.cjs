/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

// The mobile app lives in the Overlay monorepo at apps/mobile. It imports shared
// packages, src/shared and convex/_generated from the repository root, so the root
// workspace must be installed before EAS installs and bundles the app.
const AGENT_WORKSPACES = ['@layernorm/overlay-agent-bridge-protocol', '@layernorm/overlay-agent-host']

function repositoryRoot(appRoot) {
  return path.resolve(appRoot, '../..')
}

function prepareWorkspace(appRoot = path.resolve(__dirname, '..'), run = execFileSync) {
  const root = repositoryRoot(appRoot)
  for (const required of ['packages/overlay-app-core', 'convex/_generated/api.d.ts', 'package-lock.json']) {
    if (!fs.existsSync(path.join(root, required)))
      throw new Error(`Mobile must build inside the Overlay monorepo; missing ${required}`)
  }
  if (fs.existsSync(path.join(root, 'node_modules/.package-lock.json'))) return false
  run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit' })
  for (const workspace of AGENT_WORKSPACES)
    run('npm', ['run', 'build', '--workspace', workspace], { cwd: root, stdio: 'inherit' })
  return true
}

if (require.main === module) prepareWorkspace()
module.exports = { prepareWorkspace, repositoryRoot, AGENT_WORKSPACES }
