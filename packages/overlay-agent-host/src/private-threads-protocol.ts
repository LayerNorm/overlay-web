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

/** Providers called with the person's own API key. */
export const privateModelProviders = ['anthropic', 'openai', 'google', 'openrouter'] as const
export type PrivateModelProvider = (typeof privateModelProviders)[number]
/** Plans the person signed in to on this computer, called through Overlay Desktop's local CLIProxyAPI. */
export const privatePlanProviders = ['claude', 'chatgpt'] as const
export type PrivatePlanProvider = (typeof privatePlanProviders)[number]
/** Every way a private thread can call a model: a key, a plan, or Overlay's metered models (`overlay`). */
export type PrivateModelSource = PrivateModelProvider | PrivatePlanProvider | 'overlay'

/** Model sources this host can run; Overlay Desktop reads them from the `ready` message. */
export const PRIVATE_MODEL_SOURCES = ['key', 'plan', 'overlay'] as const

const id = z.string().trim().min(1).max(200)
const owner = z.object({ userId: id, workspaceId: id }).strict()
const folder = z.string().trim().min(1).max(4096).refine(isAbsolute, 'Folders must be absolute paths.')
const modelId = z.string().trim().min(1).max(200)
/** The desktop's own CLIProxyAPI: loopback only, with the secret it made at launch. */
const planProxy = z.object({
  url: z.string().url().max(200).refine(value => /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(value), 'The plan proxy must be on this computer.'),
  key: z.string().min(16).max(512),
}).strict()
const overlayOrigin = (message: string) => z.string().url().max(2_048)
  .refine(value => /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(value), message)
/**
 * How this turn calls its model. Secrets are read by Overlay Desktop for this run only and never stored by the host:
 * a key from the Keychain, the local plan proxy's secret, or a short-lived token for Overlay's metered relay.
 */
const turnModel = z.union([
  z.object({ provider: z.enum(privateModelProviders), modelId, apiKey: z.string().min(1).max(4_096) }).strict(),
  z.object({ provider: z.enum(privatePlanProviders), modelId, proxy: planProxy }).strict(),
  z.object({
    provider: z.literal('overlay'),
    /** An Overlay catalog id, for example `anthropic/claude-sonnet-4.6`. */
    modelId,
    relay: z.object({ url: overlayOrigin('Overlay models need https.'), token: z.string().min(1).max(4_096) }).strict(),
  }).strict(),
])
export type PrivateTurnModel = z.output<typeof turnModel>

/**
 * An MCP server that runs on this computer (stdio). Overlay Desktop keeps the list and reads the environment values
 * from the Keychain for each turn; the host holds them in memory only while the server runs.
 */
export const localMcpServerSchema = z.object({
  id,
  name: z.string().trim().min(1).max(100),
  command: z.string().trim().min(1).max(4_096),
  args: z.array(z.string().max(4_096)).max(100),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(200), z.string().max(32_768))
    .refine(value => Object.keys(value).length <= 100, 'Too many environment values.'),
  cwd: folder.optional(),
}).strict()
export type LocalMcpServer = z.output<typeof localMcpServerSchema>

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
    model: turnModel,
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
      url: overlayOrigin('Overlay tools need https.'),
      token: z.string().min(1).max(4_096),
    }).strict().optional(),
    /** MCP servers on this computer whose tools join this turn, when the agent's grant includes MCP servers. */
    localMcp: z.array(localMcpServerSchema).max(20).optional(),
  }).strict(),
  z.object({ method: z.literal('stop'), owner, threadId: id }).strict(),
  z.object({
    method: z.literal('update'), owner, threadId: id,
    title: z.string().trim().min(1).max(200).optional(),
    /** Only before the first message; null works in the person's work folder. */
    folder: folder.nullable().optional(),
  }).strict(),
  z.object({ method: z.literal('delete'), owner, threadId: id }).strict(),
  /** Checks a key, or a signed-in plan through the local proxy, and lists the chat models it can use. */
  z.object({
    method: z.literal('models'),
    provider: z.enum([...privateModelProviders, ...privatePlanProviders]),
    apiKey: z.string().min(1).max(4_096).optional(),
    proxy: planProxy.optional(),
  }).strict().superRefine((value, context) => {
    const plan = (privatePlanProviders as readonly string[]).includes(value.provider)
    if (plan ? !value.proxy || value.apiKey : !value.apiKey || value.proxy) {
      context.addIssue({ code: 'custom', message: plan ? 'A plan is listed through the local proxy.' : 'A key is needed.' })
    }
  }),
  /** Starts a local MCP server (or reuses it) and lists its tools, so Settings can show that it works. */
  z.object({ method: z.literal('mcpCheck'), server: localMcpServerSchema }).strict(),
  /** Stops a local MCP server that was removed or changed. */
  z.object({ method: z.literal('mcpStop'), serverId: id }).strict(),
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
  mcpCheck: { tools: { name: string; description: string }[] }
  mcpStop: { stopped: boolean }
}

export type PrivateTurnState = 'running' | 'finished' | 'stopped' | 'error'
export type PrivateEvent =
  | { kind: 'chunk'; threadId: string; turnId: string; chunk: UIMessageChunk }
  | { kind: 'turn'; threadId: string; turnId: string; state: PrivateTurnState; error?: string }
  | { kind: 'threads'; owner: PrivateThreadOwner }

export type PrivateIpcInbound = { type: 'request'; id: number; request: PrivateRequest }
export type PrivateIpcOutbound =
  | { type: 'ready'; protocolVersion: typeof PRIVATE_THREADS_PROTOCOL_VERSION; modelSources: typeof PRIVATE_MODEL_SOURCES; features?: string[] }
  | { type: 'response'; id: number; ok: true; result: unknown }
  | { type: 'response'; id: number; ok: false; error: string }
  | { type: 'event'; event: PrivateEvent }
