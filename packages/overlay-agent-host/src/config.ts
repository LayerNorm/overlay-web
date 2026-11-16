import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod/v3'
import { filesystemGrantSchema } from '@layernorm/overlay-agent-bridge-protocol'
import { loadStoredConnection } from './connection.js'

/**
 * Restart configuration written at enrollment. The host serves only Overlay's
 * local tools; it runs no third-party agent harness.
 */
export const agentHostConfigSchema = z.object({
  hostingAuthFile: z.string().min(1).optional(),
  environmentId: z.string().min(1),
  workspaceId: z.string().min(1),
  controlPlaneUrl: z.string().url(),
  credentialEnv: z.string().min(1).default('OVERLAY_AGENT_HOST_CREDENTIAL'),
  stateDirectory: z.string().min(1),
  filesystem: filesystemGrantSchema,
  localTools: z.literal(true),
}).strict()

export type AgentHostConfig = z.infer<typeof agentHostConfigSchema> & { credential?: string }

export const RETIRED_HARNESS_CONFIG_MESSAGE =
  'This host was set up to run a third-party agent, which Overlay no longer supports. Connect it again from Overlay (Settings → Desktop → This computer, or a new connection command).'

export async function loadAgentHostConfig(path: string): Promise<AgentHostConfig> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  if (raw.localTools !== true) throw new Error(RETIRED_HARNESS_CONFIG_MESSAGE)
  // Configurations written by 0.5.0 previews may carry an empty adapter list and lifecycle flag; neither applies.
  const { adapters, durableLifecycle: _durableLifecycle, ...rest } = raw
  void _durableLifecycle
  if (Array.isArray(adapters) && adapters.length > 0) throw new Error(RETIRED_HARNESS_CONFIG_MESSAGE)
  const parsed = agentHostConfigSchema.parse(rest)
  const stored = await loadStoredConnection(parsed.stateDirectory)
  if (stored && (stored.environmentId !== parsed.environmentId || stored.workspaceId !== parsed.workspaceId)) {
    throw new Error('stored connection scope does not match the host configuration')
  }
  const credential = process.env[parsed.credentialEnv]?.trim() ?? stored?.token
  return { ...parsed, ...(credential ? { credential } : {}) }
}

export async function saveAgentHostConfig(path: string, config: Omit<AgentHostConfig, 'credential'>): Promise<void> {
  const parsed = agentHostConfigSchema.parse(config)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
  await chmod(path, 0o600)
}
