import type { UIMessage, UIMessageChunk } from 'ai'
import { isAbsolute } from 'node:path'
import { z } from 'zod'

/**
 * The private-thread service speaks this protocol with Overlay Desktop over the
 * Node.js IPC channel of `overlay-agent-host private`. Nothing here goes to the network:
 * the only outbound calls are to the model provider the person chose.
 */
export const PRIVATE_THREADS_PROTOCOL_VERSION = 1 as const

export type PrivateUIMessage = UIMessage
export type PrivateThreadOwner = { userId: string; workspaceId: string }
export type PrivateThread = PrivateThreadOwner & {
  id: string
  agentId: string
  title: string
  folder: string | null
  /** `provider/model`, for example `anthropic/claude-sonnet-4-5`. */
  model: string | null
  createdAt: number
  updatedAt: number
}

export const privateModelProviders = ['anthropic', 'openai', 'google', 'openrouter'] as const
export type PrivateModelProvider = (typeof privateModelProviders)[number]

const id = z.string().trim().min(1).max(200)
const owner = z.object({ userId: id, workspaceId: id }).strict()
const folder = z.string().trim().min(1).max(4096).refine(isAbsolute, 'Folders must be absolute paths.')

export const privateRequestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('list'), owner }).strict(),
  z.object({ method: z.literal('get'), owner, threadId: id }).strict(),
  z.object({
    method: z.literal('create'),
    owner,
    threadId: id,
    agentId: id,
    title: z.string().trim().min(1).max(200),
    folder: folder.nullable(),
    model: z.string().trim().min(1).max(200).nullable(),
  }).strict(),
  z.object({
    method: z.literal('send'),
    owner,
    threadId: id,
    turnId: id,
    /** The whole transcript as the page holds it, ending with the new user message or approval answers. */
    messages: z.array(z.custom<PrivateUIMessage>(value => Boolean(value && typeof value === 'object'))).min(1).max(2_000),
    model: z.object({
      provider: z.enum(privateModelProviders),
      modelId: z.string().trim().min(1).max(200),
      /** Read from the Keychain by Overlay Desktop for this run; never stored by the host. */
      apiKey: z.string().min(1).max(4_096),
    }).strict(),
    agent: z.object({
      name: z.string().trim().min(1).max(200),
      instructions: z.string().max(50_000).optional(),
    }).strict(),
    /** The folders this run may use: the thread's folder, or the person's work folder. */
    roots: z.array(folder).min(1).max(20),
    approvalMode: z.enum(['ask', 'auto']).default('ask'),
    /**
     * The agent's Overlay tools for this turn: Overlay's MCP server and a short-lived token Overlay Desktop got for
     * this person, workspace and agent. Absent when the desktop could not get one; the turn then has only this
     * computer's tools.
     */
    overlay: z.object({
      url: z.string().url().max(2_048).refine(value => /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(value), 'Overlay tools need https.'),
      token: z.string().min(1).max(4_096),
    }).strict().optional(),
  }).strict(),
  z.object({ method: z.literal('stop'), owner, threadId: id }).strict(),
  z.object({
    method: z.literal('update'), owner, threadId: id,
    title: z.string().trim().min(1).max(200).optional(),
    /** Only before the first message; null works in the person's work folder. */
    folder: folder.nullable().optional(),
  }).strict(),
  z.object({ method: z.literal('delete'), owner, threadId: id }).strict(),
  /** Checks a key and lists the chat models it can use. */
  z.object({ method: z.literal('models'), provider: z.enum(privateModelProviders), apiKey: z.string().min(1).max(4_096) }).strict(),
])
export type PrivateRequest = z.input<typeof privateRequestSchema>
export type ParsedPrivateRequest = z.output<typeof privateRequestSchema>

export type PrivateResults = {
  list: { threads: PrivateThread[]; running: string[] }
  get: { thread: PrivateThread; messages: PrivateUIMessage[]; running: boolean }
  create: { thread: PrivateThread }
  send: { turnId: string }
  stop: { stopped: boolean }
  update: { thread: PrivateThread }
  delete: { deleted: boolean }
  models: { models: { id: string; name: string }[] }
}

export type PrivateTurnState = 'running' | 'finished' | 'stopped' | 'error'
export type PrivateEvent =
  | { kind: 'chunk'; threadId: string; turnId: string; chunk: UIMessageChunk }
  | { kind: 'turn'; threadId: string; turnId: string; state: PrivateTurnState; error?: string }
  | { kind: 'threads'; owner: PrivateThreadOwner }

export type PrivateIpcInbound = { type: 'request'; id: number; request: PrivateRequest }
export type PrivateIpcOutbound =
  | { type: 'ready'; protocolVersion: typeof PRIVATE_THREADS_PROTOCOL_VERSION }
  | { type: 'response'; id: number; ok: true; result: unknown }
  | { type: 'response'; id: number; ok: false; error: string }
  | { type: 'event'; event: PrivateEvent }
