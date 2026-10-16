export const maxDuration = 300

/** Per-run drive bearer tokens are independent of app sessions and workspace-header selection. */
export async function POST(request: Request) {
  const [{ handleAgentDriveRequest }, { agentDriveHttpDependencies }, { withAgentHostRouteTelemetry }] = await Promise.all([
    import('@/server/agents/agent-drive-http'), import('@/server/agents/agent-drive-http-dependencies'),
    import('@/server/app-api/v1/agent-environments/host-route-telemetry'),
  ])
  return withAgentHostRouteTelemetry('drive.read', request, () => handleAgentDriveRequest(request, agentDriveHttpDependencies))
}
