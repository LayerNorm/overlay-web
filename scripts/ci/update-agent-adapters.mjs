import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const HOST = 'packages/overlay-agent-host/package.json'
const PROTOCOL = 'packages/overlay-agent-bridge-protocol/package.json'
const MANIFESTS = 'packages/overlay-agent-host/src/adapter-manifests.ts'
const IMAGE = 'infra/agent-image/versions.json'
const LOCK = 'package-lock.json'
export const ADAPTER_UPDATE_FILES = [HOST, PROTOCOL, MANIFESTS, IMAGE, LOCK,
  'packages/overlay-agent-host/src/adapter-manifests.test.ts',
  'packages/overlay-agent-host/src/image-check.ts',
  'packages/overlay-agent-host/src/runtime.ts',
  'packages/overlay-agent-host/src/enrollment.ts',
  'packages/overlay-agent-host/src/cli.ts',
  'src/server/agents/agent-enrollment-command.ts',
  'src/features/settings/components/AgentEnvironmentSettings.tsx',
  'internal/develop/bring-your-own-agents.md', 'CHANGELOG.md']
const json = value => `${JSON.stringify(value, null, 2)}\n`
function semver(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) throw Error(`Invalid stable version: ${value}`)
  return value.split('.').map(Number)
}
function compare(left, right) {
  const a = semver(left), b = semver(right)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

/** Plan every lockstep change before writing any file; registry downgrades fail closed. */
export function planAdapterUpdate(files, latest) {
  const image = JSON.parse(files[IMAGE])
  const specs = [
    ['claude-agent-acp', 'CLAUDE_AGENT_ACP_PACKAGE_VERSION'],
    ['codex-acp', 'CODEX_ACP_PACKAGE_VERSION'],
  ]
  const changes = specs.filter(([name]) => {
    const difference = compare(latest[name], image.packages[`@agentclientprotocol/${name}`])
    if (difference < 0) throw Error(`Registry version would downgrade ${name}`)
    return difference > 0
  })
  if (!changes.length) return null
  const host = JSON.parse(files[HOST]), protocol = JSON.parse(files[PROTOCOL]), lock = JSON.parse(files[LOCK])
  if (host.version !== protocol.version) throw Error('Host and protocol releases must already be lockstep')
  const oldVersion = host.version
  const [major, minor, patch] = semver(oldVersion)
  const version = `${major}.${minor}.${patch + 1}`
  const output = { ...files }
  for (const [name, constant] of changes) {
    const old = image.packages[`@agentclientprotocol/${name}`], next = latest[name]
    const pattern = new RegExp(`${constant} = '${old.replaceAll('.', '\\.')}'`)
    if (!pattern.test(output[MANIFESTS])) throw Error(`Host/image pin mismatch: ${name}`)
    output[MANIFESTS] = output[MANIFESTS].replace(pattern, `${constant} = '${next}'`)
    for (const path of ['packages/overlay-agent-host/src/adapter-manifests.test.ts', 'internal/develop/bring-your-own-agents.md']) {
      output[path] = output[path].replaceAll(`@agentclientprotocol/${name}@${old}`, `@agentclientprotocol/${name}@${next}`)
    }
    image.packages[`@agentclientprotocol/${name}`] = next
  }
  image.imageVersion += 1
  output['packages/overlay-agent-host/src/image-check.ts'] = output['packages/overlay-agent-host/src/image-check.ts']
    .replace(/max: \d+/, `max: ${image.imageVersion}`)
  host.version = protocol.version = version
  host.dependencies['@layernorm/overlay-agent-bridge-protocol'] = version
  for (const path of [HOST, PROTOCOL]) lock.packages[path.replace('/package.json', '')].version = version
  lock.packages['packages/overlay-agent-host'].dependencies['@layernorm/overlay-agent-bridge-protocol'] = version
  for (const path of ['packages/overlay-agent-host/src/runtime.ts', 'packages/overlay-agent-host/src/enrollment.ts', 'packages/overlay-agent-host/src/cli.ts', 'src/server/agents/agent-enrollment-command.ts', 'src/features/settings/components/AgentEnvironmentSettings.tsx']) {
    output[path] = output[path].replaceAll(oldVersion, version)
  }
  output[HOST] = json(host); output[PROTOCOL] = json(protocol); output[IMAGE] = json(image); output[LOCK] = json(lock)
  output['CHANGELOG.md'] = output['CHANGELOG.md'].replace('## Unreleased\n',
    `## Unreleased\n\n- Update connected-agent adapters to Claude ACP ${latest['claude-agent-acp']} and Codex ACP ${latest['codex-acp']}; prepare host/protocol ${version} and image v${image.imageVersion}.\n`)
  return { files: output, version, branch: `codex/agent-adapters-${latest['claude-agent-acp']}-${latest['codex-acp']}` }
}

async function main() {
  const latest = Object.fromEntries(await Promise.all(['claude-agent-acp', 'codex-acp'].map(async name => {
    const response = await fetch(`https://registry.npmjs.org/@agentclientprotocol%2F${name}/latest`, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw Error(`Registry returned ${response.status} for ${name}`)
    return [name, (await response.json()).version]
  })))
  const files = Object.fromEntries(await Promise.all(ADAPTER_UPDATE_FILES.map(async path => [path, await readFile(path, 'utf8')])))
  const plan = planAdapterUpdate(files, latest)
  if (plan) for (const [path, contents] of Object.entries(plan.files)) if (contents !== files[path]) await writeFile(path, contents)
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${Boolean(plan)}\nbranch=${plan?.branch ?? ''}\nversion=${plan?.version ?? ''}\n`)
  console.log(plan ? `Prepared ${plan.branch} (${plan.version}); conformance checks are required before opening a PR.` : 'Adapter pins are current.')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
