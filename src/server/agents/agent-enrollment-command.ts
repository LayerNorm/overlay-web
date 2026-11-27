export const OVERLAY_AGENT_HOST_PACKAGE_VERSION = '0.7.0'
export const OVERLAY_AGENT_HOST_PACKAGE_SPEC = `@layernorm/overlay-agent-host@${OVERLAY_AGENT_HOST_PACKAGE_VERSION}`
export const OVERLAY_AGENT_HOST_NODE_SPEC = 'node@24'

/** The one-copy command that connects a machine so Overlay's agents can use it (local tools only). */
export function buildAgentHostEnrollmentCommand(input: { code: string; origin: string }) {
  if (!/^[A-Za-z0-9_-]+$/.test(input.code)) {
    throw new Error('Agent Host enrollment code contains unsupported characters')
  }
  const origin = new URL(input.origin)
  if (origin.protocol !== 'https:' || origin.origin !== input.origin) {
    throw new Error('Agent Host enrollment origin must be an HTTPS origin')
  }
  return `npx --yes --package ${OVERLAY_AGENT_HOST_NODE_SPEC} --package ${OVERLAY_AGENT_HOST_PACKAGE_SPEC} overlay-agent-host connect ${input.code} --server ${origin.origin} --local-tools --run`
}
