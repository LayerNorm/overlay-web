/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

// The mobile app lives in the Overlay monorepo at apps/mobile and is one of its Bun
// workspaces. EAS installs the whole workspace from the root bun.lock; the app also
// imports src/shared and convex/_generated from the root, and src/shared needs the
// built agent bridge protocol, so those packages are built after the install.
const AGENT_WORKSPACES = ['@layernorm/overlay-agent-bridge-protocol', '@layernorm/overlay-agent-host']

function repositoryRoot(appRoot) {
  return path.resolve(appRoot, '../..')
}

function assertMonorepo(appRoot = path.resolve(__dirname, '..')) {
  const root = repositoryRoot(appRoot)
  for (const required of ['packages/overlay-app-core', 'convex/_generated/api.d.ts', 'bun.lock']) {
    if (!fs.existsSync(path.join(root, required)))
      throw new Error(`Mobile must build inside the Overlay monorepo; missing ${required}`)
  }
  return root
}

function buildWorkspacePackages(appRoot = path.resolve(__dirname, '..'), run = execFileSync) {
  const root = assertMonorepo(appRoot)
  for (const workspace of AGENT_WORKSPACES)
    run('bun', ['run', '--filter', workspace, 'build'], { cwd: root, stdio: 'inherit' })
}

if (require.main === module) {
  if (process.argv.includes('--build')) buildWorkspacePackages()
  else assertMonorepo()
}
module.exports = { assertMonorepo, buildWorkspacePackages, repositoryRoot, AGENT_WORKSPACES }
