import {createHash} from 'node:crypto'
import {z} from 'zod'
import type {AgentHostCommand} from '@layernorm/overlay-agent-bridge-protocol'

/** Pin the command while allowing its delivery-only MCP token to rotate. No command or credential is persisted here. */
export function nativePreparationFingerprint(command: Extract<AgentHostCommand, {type: 'start'}>): string {
  if (!command.payload.restore || !command.execution) throw Error('Native preparation requires a restoration execution')
  const metadata = {...command.payload.metadata}
  if (metadata.overlayMcp !== undefined) metadata.overlayMcp = {
    ...z.object({url: z.string(), token: z.string()}).passthrough().parse(metadata.overlayMcp), token: '[delivery-token]',
  }
  const execution = {attemptId: command.execution.attemptId, generation: command.execution.generation}
  return createHash('sha256').update(JSON.stringify(canonical({...command, execution, payload: {...command.payload, metadata}}))).digest('hex')
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, canonical(item)]))
  return value
}
