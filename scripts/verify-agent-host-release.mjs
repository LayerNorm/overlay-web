import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const hostPackage = JSON.parse(await readFile(new URL('../packages/overlay-agent-host/package.json', import.meta.url), 'utf8'))
const protocolPackage = JSON.parse(await readFile(new URL('../packages/overlay-agent-bridge-protocol/package.json', import.meta.url), 'utf8'))
const enrollmentCommand = await readFile(new URL('../src/server/agents/agent-enrollment-command.ts', import.meta.url), 'utf8')
const adapterManifests = await readFile(new URL('../packages/overlay-agent-host/src/adapter-manifests.ts', import.meta.url), 'utf8')

assert.equal(hostPackage.version, protocolPackage.version, 'host and protocol versions must be released together')
assert.equal(
  hostPackage.dependencies['@overlay/agent-bridge-protocol'],
  protocolPackage.version,
  'host must depend on the exact protocol release',
)
assert.match(
  enrollmentCommand,
  new RegExp(`OVERLAY_AGENT_HOST_PACKAGE_VERSION = '${hostPackage.version.replaceAll('.', '\\.')}'`),
  'the application enrollment command must pin the released host version',
)
assert.match(adapterManifests, /CODEX_ACP_PACKAGE_VERSION = '1\.7\.0'/)
assert.match(adapterManifests, /CLAUDE_AGENT_ACP_PACKAGE_VERSION = '0\.70\.0'/)

console.log(`Agent Host release ${hostPackage.version} is internally pinned and consistent.`)
