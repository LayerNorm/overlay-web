export const CODEX_ACP_PACKAGE_VERSION = '1.7.0'
export const CLAUDE_AGENT_ACP_PACKAGE_VERSION = '0.70.0'
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
