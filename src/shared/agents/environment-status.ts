/** How long after its last heartbeat an environment still counts as online. */
export const AGENT_ENVIRONMENT_ONLINE_WINDOW_MS = 45_000

/** An environment reported online is shown offline once its heartbeat is older than the online window. */
export function effectiveAgentEnvironmentStatus<Status extends string>(
  environment: { status: Status; lastSeenAt?: number | null },
  now: number,
): Status | 'offline' {
  if (environment.status !== 'online') return environment.status
  return (environment.lastSeenAt ?? 0) >= now - AGENT_ENVIRONMENT_ONLINE_WINDOW_MS ? environment.status : 'offline'
}
