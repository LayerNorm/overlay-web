import type { BuiltInUserOwnedAcpAdapterId } from '@overlay/workspace-contracts'

export const OVERLAY_AGENT_HOST_PACKAGE_VERSION = '0.3.2'
export const OVERLAY_AGENT_HOST_PACKAGE_SPEC = `@layernorm/overlay-agent-host@${OVERLAY_AGENT_HOST_PACKAGE_VERSION}`
export const OVERLAY_AGENT_HOST_NODE_SPEC = 'node@24'

export function buildAgentHostEnrollmentCommand(input: {
  code: string
  origin: string
  adapterId?: BuiltInUserOwnedAcpAdapterId
}) {
  if (!/^[A-Za-z0-9_-]+$/.test(input.code)) {
    throw new Error('Agent Host enrollment code contains unsupported characters')
  }
  const origin = new URL(input.origin)
  if (origin.protocol !== 'https:' || origin.origin !== input.origin) {
    throw new Error('Agent Host enrollment origin must be an HTTPS origin')
  }
  return `npx --yes --package ${OVERLAY_AGENT_HOST_NODE_SPEC} --package ${OVERLAY_AGENT_HOST_PACKAGE_SPEC} overlay-agent-host connect ${input.code} --server ${origin.origin}${input.adapterId ? ` --adapter ${input.adapterId}` : ''} --run`
}
