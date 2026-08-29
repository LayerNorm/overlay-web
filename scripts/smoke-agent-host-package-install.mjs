import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const smokeDirectory = mkdtempSync(join(tmpdir(), 'overlay-agent-host-release-'))
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const hostPackage = JSON.parse(readFileSync(join(repositoryRoot, 'packages/overlay-agent-host/package.json'), 'utf8'))
const protocolPackage = JSON.parse(readFileSync(join(repositoryRoot, 'packages/overlay-agent-bridge-protocol/package.json'), 'utf8'))

try {
  execFileSync(npmCommand, [
    'pack', '--workspace=@overlay/agent-bridge-protocol', '--pack-destination', smokeDirectory,
  ], { cwd: repositoryRoot, stdio: 'pipe' })
  execFileSync(npmCommand, [
    'pack', '--workspace=@overlay/agent-host', '--pack-destination', smokeDirectory,
  ], { cwd: repositoryRoot, stdio: 'pipe' })
  writeFileSync(join(smokeDirectory, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  execFileSync(npmCommand, [
    'install', '--ignore-scripts', '--no-audit', '--no-fund',
    '--min-release-age=0',
    `./overlay-agent-bridge-protocol-${protocolPackage.version}.tgz`,
    `./overlay-agent-host-${hostPackage.version}.tgz`,
  ], { cwd: smokeDirectory, stdio: 'pipe' })

  execFileSync(process.execPath, [
    '--input-type=module',
    '--eval',
    "const protocol = await import('@overlay/agent-bridge-protocol'); const host = await import('@overlay/agent-host'); if (!protocol.filesystemGrantSchema || !host.AgentHostRuntime) process.exit(2)",
  ], { cwd: smokeDirectory, stdio: 'pipe' })

  const cliPath = join(
    smokeDirectory,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'overlay-agent-host.cmd' : 'overlay-agent-host',
  )
  const cli = spawnSync(cliPath, [], { cwd: smokeDirectory, encoding: 'utf8' })
  assert.equal(cli.status, 2, `Agent Host CLI returned unexpected status: ${cli.stderr}`)
  assert.match(cli.stderr, /Usage:/, 'Agent Host CLI did not boot from the installed tarball')
  console.log(`Clean package install and runtime import passed on ${process.version}.`)
} finally {
  rmSync(smokeDirectory, { recursive: true, force: true })
}
