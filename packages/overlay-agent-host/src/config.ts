import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { filesystemGrantSchema } from '@overlay/agent-bridge-protocol'
import { loadStoredConnection } from './connection'
import { ACP_ADAPTER_MANIFESTS, resolveAcpAdapterManifest } from './adapter-manifests'

export const agentHostConfigSchema = z.object({
  environmentId: z.string().min(1),
  workspaceId: z.string().min(1),
  controlPlaneUrl: z.string().url(),
  credentialEnv: z.string().min(1).default('OVERLAY_AGENT_HOST_CREDENTIAL'),
  stateDirectory: z.string().min(1),
  filesystem: filesystemGrantSchema,
  adapters: z.array(z.union([
    z.object({ manifest: z.enum(Object.keys(ACP_ADAPTER_MANIFESTS) as [keyof typeof ACP_ADAPTER_MANIFESTS, ...(keyof typeof ACP_ADAPTER_MANIFESTS)[]]), env: z.record(z.string(), z.string()).optional() }).strict(),
    z.object({
      id: z.string().min(1), displayName: z.string().min(1), protocol: z.enum(['fake', 'acp']),
      command: z.string().min(1).optional(), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional(),
    }).strict(),
  ])).min(1),
}).strict()
type AgentHostFileConfig = z.infer<typeof agentHostConfigSchema>
export type AgentHostConfig = Omit<AgentHostFileConfig, 'adapters'> & {
  adapters: Array<{ id: string; displayName: string; protocol: 'fake' | 'acp'; command?: string; args?: string[]; env?: Record<string, string> }>
  credential?: string
}

export async function loadAgentHostConfig(path: string): Promise<AgentHostConfig> {
  const parsed = agentHostConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  const config: AgentHostConfig = {
    ...parsed,
    adapters: parsed.adapters.map((adapter) => {
      if (!('manifest' in adapter)) return adapter
      const manifest = resolveAcpAdapterManifest(adapter.manifest)
      if (!manifest) throw new Error(`unknown ACP adapter manifest: ${adapter.manifest}`)
      return { ...manifest, args: [...manifest.args], ...('env' in adapter && adapter.env ? { env: adapter.env } : {}) }
    }),
  }
  const stored = await loadStoredConnection(config.stateDirectory)
  if (stored && (stored.environmentId !== config.environmentId || stored.workspaceId !== config.workspaceId)) {
    throw new Error('stored connection scope does not match the host configuration')
  }
  const credential = process.env[config.credentialEnv]?.trim() ?? stored?.token
  return { ...config, ...(credential ? { credential } : {}) }
}
