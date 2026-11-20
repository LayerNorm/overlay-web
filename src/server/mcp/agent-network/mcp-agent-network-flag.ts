import 'server-only'

/**
 * Kill switch for outside agents joining workspaces over MCP. On unless `OVERLAY_MCP_AGENT_NETWORK_DISABLED` is set:
 * then no connection is offered `join_workspace`, joined agents fall back to acting as their owner, and nothing is
 * delivered to an inbox.
 */
export function isMcpAgentNetworkEnabled(): boolean {
  const value = (process.env.OVERLAY_MCP_AGENT_NETWORK_DISABLED ?? '').trim().toLowerCase()
  return !(value === '1' || value === 'true' || value === 'yes')
}
