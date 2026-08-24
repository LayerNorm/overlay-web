import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { filesystemGrantSchema } from '@overlay/agent-bridge-protocol'

export const agentHostConfigSchema = z.object({
  environmentId: z.string().min(1),
  workspaceId: z.string().min(1),
  controlPlaneUrl: z.string().url(),
  credentialEnv: z.string().min(1).default('OVERLAY_AGENT_HOST_CREDENTIAL'),
  stateDirectory: z.string().min(1),
  filesystem: filesystemGrantSchema,
  adapters: z.array(z.object({
    id: z.string().min(1), displayName: z.string().min(1), protocol: z.enum(['fake', 'acp']),
    command: z.string().min(1).optional(), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional(),
  }).strict()).min(1),
}).strict()
type AgentHostFileConfig = z.infer<typeof agentHostConfigSchema>
export type AgentHostConfig = AgentHostFileConfig & { credential?: string }

export async function loadAgentHostConfig(path: string): Promise<AgentHostConfig> {
  const config = agentHostConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  const credential = process.env[config.credentialEnv]?.trim()
  return { ...config, ...(credential ? { credential } : {}) }
}
