export type SurfaceRoutingCandidate = { agentRole?: string }

export type SurfaceRoutingResult<T extends SurfaceRoutingCandidate> =
  | { kind: 'agent'; candidate: T; text: string }
  | { kind: 'none' }

export function routeSurfaceMessage<T extends SurfaceRoutingCandidate>(args: {
  candidates: readonly T[]
  text: string
}): SurfaceRoutingResult<T> {
  const chiefs = args.candidates.filter(candidate => candidate.agentRole === 'workspace_chief')
  if (chiefs.length !== 1) return { kind: 'none' }
  return { kind: 'agent', candidate: chiefs[0], text: args.text.trim() }
}
