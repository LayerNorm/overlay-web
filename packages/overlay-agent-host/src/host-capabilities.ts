import {OVERLAY_AGENT_PROTOCOL_VERSION, type AdapterCapability, type FilesystemGrant, type HostCapabilities} from '@layernorm/overlay-agent-bridge-protocol'
import {platform, release} from 'node:os'
import { ControlPlaneRequestError, type AgentControlPlaneClient } from './transport.js'

/** Negotiate optional extensions without breaking hosts connected to strict older servers. */
export async function updateHostCapabilities(client: AgentControlPlaneClient, capabilities: HostCapabilities): Promise<void> {
  const send = async (value: HostCapabilities) => {
    try { await client.updateCapabilities?.(value) }
    catch (error) {
      if (!(error instanceof ControlPlaneRequestError) || error.status !== 400 || !value.drive) throw error
      const { drive: _drive, ...legacy } = value
      void _drive
      await client.updateCapabilities?.(legacy)
    }
  }
  try { await send(capabilities) }
  catch (error) {
    if (!(error instanceof ControlPlaneRequestError) || error.status !== 400) throw error
    const { mcp: _mcp, ...withoutMcp } = capabilities
    void _mcp
    try { await send(withoutMcp) }
    catch (legacyError) {
      if (!(legacyError instanceof ControlPlaneRequestError) || legacyError.status !== 400) throw legacyError
      const withoutOptions = { ...withoutMcp, adapters: capabilities.adapters.map(capability => {
        const { options: _options, ...legacy } = capability
        void _options
        return legacy
      }) }
      if (capabilities.adapters.some(capability => capability.options)) {
        try { await send(withoutOptions); return }
        catch (retryError) { if (!(retryError instanceof ControlPlaneRequestError) || retryError.status !== 400) throw retryError }
      }
      const { streaming: _streaming, ...legacy } = withoutOptions
      void _streaming
      await send(legacy)
    }
  }
}


export function buildHostCapabilities(adapters: AdapterCapability[], options: {
  durableLifecycle: boolean; drive: boolean; filesystem: FilesystemGrant; maxConcurrentRuns: number
}): HostCapabilities {
  return {
    protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
    ...(options.durableLifecycle ? {remoteLifecycleVersion: 2} : {}),
    streaming: {textDeltas: true, heartbeats: true}, mcp: {approvalBridge: true},
    ...(options.drive ? {drive: {version: 1}} : {}),
    hostVersion: '0.4.2', platform: `${platform()} ${release()}`,
    adapters: adapters.map(capability => {
      if (options.durableLifecycle) return capability
      const {recovery, ...legacy} = capability
      void recovery
      return legacy
    }),
    filesystem: options.filesystem, maxConcurrentRuns: Math.max(1, options.maxConcurrentRuns),
  }
}
