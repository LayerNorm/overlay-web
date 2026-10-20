import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const hostPackage = JSON.parse(await readFile(new URL('../../packages/overlay-agent-host/package.json', import.meta.url), 'utf8'))
const protocolPackage = JSON.parse(await readFile(new URL('../../packages/overlay-agent-bridge-protocol/package.json', import.meta.url), 'utf8'))
const enrollmentCommand = await readFile(new URL('../../src/server/agents/agent-enrollment-command.ts', import.meta.url), 'utf8')
const adapterManifests = await readFile(new URL('../../packages/overlay-agent-host/src/adapter-manifests.ts', import.meta.url), 'utf8')
const hostCli = await readFile(new URL('../../packages/overlay-agent-host/src/cli.ts', import.meta.url), 'utf8')
const environmentSettings = await readFile(new URL('../../src/features/settings/components/AgentEnvironmentSettings.tsx', import.meta.url), 'utf8')

assert.equal(hostPackage.name, '@layernorm/overlay-agent-host', 'host must publish under the product-qualified package name')
assert.equal(protocolPackage.name, '@layernorm/overlay-agent-bridge-protocol', 'protocol must publish under the product-qualified package name')
assert.equal(hostPackage.version, protocolPackage.version, 'host and protocol versions must be released together')
assert.equal(protocolPackage.main, './dist/index.js', 'protocol runtime must publish compiled JavaScript')
assert.equal(protocolPackage.types, './dist/index.d.ts', 'protocol package must publish declarations')
assert.equal(hostPackage.main, './dist/index.js', 'host library runtime must publish compiled JavaScript')
assert.equal(hostPackage.types, './dist/index.d.ts', 'host package must publish declarations')
assert.equal(
  hostPackage.dependencies['@layernorm/overlay-agent-bridge-protocol'],
  protocolPackage.version,
  'host must depend on the exact protocol release',
)
assert.match(
  enrollmentCommand,
  new RegExp(`OVERLAY_AGENT_HOST_PACKAGE_VERSION = '${hostPackage.version.replaceAll('.', '\\.')}'`),
  'the application enrollment command must pin the released host version',
)
assert.match(
  hostCli,
  new RegExp(`PACKAGE_SPEC = '@layernorm/overlay-agent-host@${hostPackage.version.replaceAll('.', '\\.')}'`),
  'the host CLI restart/service commands must pin the released host version',
)
assert.match(
  environmentSettings,
  new RegExp(`HOST_PACKAGE_SPEC = '@layernorm/overlay-agent-host@${hostPackage.version.replaceAll('.', '\\.')}'`),
  'the environment settings recovery command must pin the released host version',
)
for (const path of ['runtime.ts', 'enrollment.ts']) {
  const source = await readFile(new URL(`../../packages/overlay-agent-host/src/${path}`, import.meta.url), 'utf8')
  assert.ok(source.includes(`hostVersion: '${hostPackage.version}'`), `${path} must advertise the released host version`)
}
const image = JSON.parse(await readFile(new URL('../../infra/agent-image/versions.json', import.meta.url), 'utf8'))
for (const [constant, name] of [['CODEX_ACP_PACKAGE_VERSION', 'codex-acp'], ['CLAUDE_AGENT_ACP_PACKAGE_VERSION', 'claude-agent-acp']]) {
  const version = image.packages[`@agentclientprotocol/${name}`]
  assert.match(version, /^\d+\.\d+\.\d+$/)
  assert.match(adapterManifests, new RegExp(`${constant} = '${version.replaceAll('.', '\\.')}'`), 'host and image adapter pins must match')
}
console.log(`Agent Host release ${hostPackage.version} is internally pinned and consistent.`)
