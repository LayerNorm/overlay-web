import { existsSync, readFileSync } from 'node:fs'

export const CODEX_ACP_PACKAGE_VERSION = '2.2.2'
export const CLAUDE_AGENT_ACP_PACKAGE_VERSION = '0.93.0'
export const HERMES_AGENT_MINIMUM_VERSION = '0.20.6'

export const ACP_ADAPTER_MANIFESTS = {
  codex: {
    id: 'codex',
    displayName: 'Codex',
    protocol: 'acp' as const,
    command: 'npx',
    args: ['-y', `@agentclientprotocol/codex-acp@${CODEX_ACP_PACKAGE_VERSION}`],
  },
  'claude-code': {
    id: 'claude-code',
    displayName: 'Claude Code',
    protocol: 'acp' as const,
    command: 'npx',
    args: ['-y', `@agentclientprotocol/claude-agent-acp@${CLAUDE_AGENT_ACP_PACKAGE_VERSION}`],
  },
  hermes: {
    id: 'hermes',
    displayName: 'Hermes',
    protocol: 'acp' as const,
    command: 'hermes',
    args: ['acp'],
  },
} as const

export type AcpAdapterManifestId = keyof typeof ACP_ADAPTER_MANIFESTS

export function resolveAcpAdapterManifest(id: string) {
  return ACP_ADAPTER_MANIFESTS[id as AcpAdapterManifestId]
}

/** Use the image's exact installed pin, otherwise npm's exact pin; never acpx's older range. */
export function pinnedAcpxLaunch(agent: string): string[] | undefined {
  const spec = agent === 'claude' ? { name: 'claude-agent-acp', version: CLAUDE_AGENT_ACP_PACKAGE_VERSION }
    : agent === 'codex' ? { name: 'codex-acp', version: CODEX_ACP_PACKAGE_VERSION } : undefined
  if (!spec) return undefined
  const root = '/opt/overlay/node_modules'
  const binary = `${root}/.bin/${spec.name}`
  try {
    const installed: unknown = JSON.parse(readFileSync(`${root}/@agentclientprotocol/${spec.name}/package.json`, 'utf8'))
    if (typeof installed === 'object' && installed !== null && 'version' in installed && installed.version === spec.version && existsSync(binary)) return [binary]
  } catch { /* Local installs download the exact configured version. */ }
  return ['npx', '-y', `@agentclientprotocol/${spec.name}@${spec.version}`]
}
