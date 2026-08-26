import type { OverlayManagedAcpAdapterId } from '@overlay/sandbox-runtime'

export function buildAgentHostEnrollmentCommand(input: {
  code: string
  origin: string
  adapterId?: OverlayManagedAcpAdapterId
}) {
  return `npx @overlay/agent-host connect ${input.code} --server ${input.origin}${input.adapterId ? ` --adapter ${input.adapterId}` : ''} --run`
}
