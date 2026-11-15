import { OVERLAY_AGENT_PROTOCOL_VERSION, type FilesystemGrant, type HostCapabilities, type LocalToolsCapability } from '@layernorm/overlay-agent-bridge-protocol'
import { platform, release } from 'node:os'

export const AGENT_HOST_VERSION = '0.5.0'

/** A host advertises only its local tools; it runs no agent harness. */
export function buildHostCapabilities(options: { filesystem: FilesystemGrant; localTools: LocalToolsCapability }): HostCapabilities {
  return {
    protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
    localTools: options.localTools,
    hostVersion: AGENT_HOST_VERSION,
    platform: `${platform()} ${release()}`,
    filesystem: options.filesystem,
  }
}
