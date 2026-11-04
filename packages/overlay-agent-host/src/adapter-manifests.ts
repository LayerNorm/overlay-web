export const CODEX_ACP_PACKAGE_VERSION = '2.2.2'
export const CLAUDE_AGENT_ACP_PACKAGE_VERSION = '0.93.0'

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
} as const

export type AcpAdapterManifestId = keyof typeof ACP_ADAPTER_MANIFESTS

export function resolveAcpAdapterManifest(id: string) {
  return ACP_ADAPTER_MANIFESTS[id as AcpAdapterManifestId]
}

/** Use the exact BYOM ACP release rather than acpx's older implicit range. */
export function pinnedAcpxLaunch(agent: string): string[] | undefined {
  const spec = agent === 'claude' ? { name: 'claude-agent-acp', version: CLAUDE_AGENT_ACP_PACKAGE_VERSION }
    : agent === 'codex' ? { name: 'codex-acp', version: CODEX_ACP_PACKAGE_VERSION } : undefined
  if (!spec) return undefined
  return ['npx', '-y', `@agentclientprotocol/${spec.name}@${spec.version}`]
}
