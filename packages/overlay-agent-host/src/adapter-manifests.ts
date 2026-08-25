export const ACP_ADAPTER_MANIFESTS = {
  codex: {
    id: 'codex',
    displayName: 'Codex',
    protocol: 'acp' as const,
    command: 'npx',
    args: ['-y', '@agentclientprotocol/codex-acp'],
  },
  'claude-code': {
    id: 'claude-code',
    displayName: 'Claude Code',
    protocol: 'acp' as const,
    command: 'npx',
    args: ['-y', '@agentclientprotocol/claude-agent-acp'],
  },
} as const

export type AcpAdapterManifestId = keyof typeof ACP_ADAPTER_MANIFESTS

export function resolveAcpAdapterManifest(id: string) {
  return ACP_ADAPTER_MANIFESTS[id as AcpAdapterManifestId]
}
