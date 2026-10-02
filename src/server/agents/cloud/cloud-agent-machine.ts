import 'server-only'

import type { ComputerSize } from '@overlay/workspace-contracts'
import type { SandboxCreateRequest } from '@overlay/sandbox-runtime'

/**
 * Fixed layout of an Overlay Cloud agent machine. The image
 * (`infra/agent-image/provision.sh`) installs the Agent Host, acpx, and the
 * pinned ACP adapters under /opt/overlay; everything an agent writes lives
 * under the user's home on the persistent disk.
 */
export const CLOUD_AGENT_HOME = '/home/user'
export const CLOUD_AGENT_WORKSPACE = `${CLOUD_AGENT_HOME}/workspace`
export const CLOUD_AGENT_STATE_DIR = `${CLOUD_AGENT_HOME}/.overlay/agent-host`
export const CLOUD_AGENT_CONFIG_PATH = `${CLOUD_AGENT_STATE_DIR}/config.json`
export const CLOUD_AGENT_LOG_PATH = `${CLOUD_AGENT_HOME}/.overlay/agent-host.log`

/** Agents offered on Overlay Cloud at launch (Overlay adapter ids). */
export const CLOUD_AGENT_ADAPTER_IDS = ['claude-code', 'codex'] as const
export type CloudAgentAdapterId = (typeof CLOUD_AGENT_ADAPTER_IDS)[number]

export function isCloudAgentAdapterId(value: unknown): value is CloudAgentAdapterId {
  return typeof value === 'string' && (CLOUD_AGENT_ADAPTER_IDS as readonly string[]).includes(value)
}

/** The published image (a Boat named snapshot), from server config only. */
export function cloudAgentImageFromEnv(env: Record<string, string | undefined> = process.env): string {
  return env.OVERLAY_CLOUD_AGENT_IMAGE?.trim() || 'overlay-agent-v2'
}

export const CLOUD_AGENT_RESOURCES: Record<ComputerSize, SandboxCreateRequest['resources']> = {
  small: { vcpus: 2, memoryGiB: 4, diskGiB: 40 },
  default: { vcpus: 4, memoryGiB: 8, diskGiB: 40 },
  large: { vcpus: 8, memoryGiB: 16, diskGiB: 40 },
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Starts a detached host process that outlives the provider's command call. */
function detached(command: string): string {
  return `mkdir -p ${shellQuote(CLOUD_AGENT_WORKSPACE)} ${shellQuote(CLOUD_AGENT_STATE_DIR)} && `
    + `nohup ${command} >> ${shellQuote(CLOUD_AGENT_LOG_PATH)} 2>&1 < /dev/null &`
}

/** First boot: redeem the one-time enrollment code and keep running. */
export function cloudAgentConnectCommand(args: {
  enrollmentCode: string
  serverUrl: string
  name: string
  adapterId: CloudAgentAdapterId
}): string {
  return detached([
    'overlay-agent-host connect', shellQuote(args.enrollmentCode),
    '--server', shellQuote(args.serverUrl),
    '--kind overlay_cloud --engine acpx',
    '--adapter', shellQuote(args.adapterId),
    '--name', shellQuote(args.name),
    '--state-dir', shellQuote(CLOUD_AGENT_STATE_DIR),
    '--run',
  ].join(' '))
}

/**
 * Stops any running host. Sent as its own command: the bracket keeps pkill from
 * matching this shell, and nothing else on the line names the host.
 */
export function cloudAgentStopHostCommand(): string {
  return `pkill -f '[o]verlay-agent-host (run|connect)' || true`
}

/** After a resume the host process is gone (the machine stopped). Restart it from saved state. */
export function cloudAgentRunCommand(): string {
  return detached(`overlay-agent-host run --config ${shellQuote(CLOUD_AGENT_CONFIG_PATH)}`)
}
