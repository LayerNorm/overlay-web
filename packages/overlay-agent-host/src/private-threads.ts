import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import {
  ToolLoopAgent,
  createAgentUIStream,
  isStepCount,
  readUIMessageStream,
  type LanguageModel,
  type ToolSet,
  type UIMessageChunk,
} from 'ai'
import { LocalToolExecutor } from './local-tools.js'
import { listProviderModels } from './private-threads-models.js'
import {
  contextWindowFor,
  createContextCompaction,
  instructionsWithSummary,
  messagesAfterSummary,
  summaryBoundary,
} from './private-threads-context.js'
import { connectOverlayTools, withOverlayTools, type OverlayToolsConnection } from './private-threads-overlay-tools.js'
import { LocalMcpServers, type LocalMcpTurn } from './private-threads-local-mcp.js'
import { privateComputerTools, SCREENSHOT_NOT_KEPT } from './private-threads-tools.js'
import { PrivateThreadStore } from './private-threads-store.js'
import {
  privateRequestSchema,
  type ParsedPrivateRequest,
  type PrivateEvent,
  type PrivateModelProvider,
  type PrivateRequest,
  type PrivateResults,
  type PrivateUIMessage,
} from './private-threads-protocol.js'

const MAX_STEPS = 60
const DEFAULT_TITLE = 'New thread'

type SendRequest = Extract<ParsedPrivateRequest, { method: 'send' }>
type Run = { turnId: string; controller: AbortController; done: Promise<void> }

export type PrivateThreadServiceOptions = {
  store: PrivateThreadStore
  /** Holds terminal sessions and the browser profile of private runs. */
  stateDirectory: string
  emit: (event: PrivateEvent) => void
  /** Tests replace the model; production builds it from the person's key. */
  createModel?: (provider: PrivateModelProvider, modelId: string, apiKey: string) => LanguageModel
  listModels?: typeof listProviderModels
  /** Tests replace the connection to Overlay's MCP server. */
  connectOverlayTools?: typeof connectOverlayTools
  /** Tests shrink the context window to exercise compaction. */
  contextWindow?: number
  /** MCP servers on this computer; tests pass one with a fixture server or a fake connection. */
  localMcp?: LocalMcpServers
  log?: (message: string) => void
}

/**
 * Runs private threads: one ToolLoopAgent per turn, in this process, with this
 * computer's tools. The transcript is saved after every step, so quitting keeps
 * everything up to the last finished step.
 */
export class PrivateThreadService {
  private readonly runs = new Map<string, Run>()
  private readonly localMcp: LocalMcpServers

  constructor(private readonly options: PrivateThreadServiceOptions) {
    this.localMcp = options.localMcp ?? new LocalMcpServers({ log: options.log })
  }

  async handle<M extends PrivateRequest['method']>(input: PrivateRequest & { method: M }): Promise<PrivateResults[M]> {
    const request = privateRequestSchema.parse(input)
    return await this.dispatch(request) as PrivateResults[M]
  }

  private async dispatch(request: ParsedPrivateRequest): Promise<PrivateResults[keyof PrivateResults]> {
    const { store } = this.options
    switch (request.method) {
      case 'list':
        return { threads: store.list(request.owner), running: [...this.runs.keys()] }
      case 'get': {
        const thread = store.get(request.owner, request.threadId)
        if (!thread) throw new Error('This private thread is not on this computer.')
        return { thread, messages: store.messages(thread.id), running: this.runs.has(thread.id) }
      }
      case 'create': {
        if (store.get(request.owner, request.threadId)) throw new Error('A thread with this id already exists.')
        const now = Date.now()
        const thread = store.create({
          ...request.owner, id: request.threadId, agentId: request.agentId, title: request.title,
          folder: request.folder, model: request.model, createdAt: now, updatedAt: now,
        })
        this.options.emit({ kind: 'threads', owner: request.owner })
        return { thread }
      }
      case 'send':
        return this.send(request)
      case 'stop': {
        const run = this.runs.get(request.threadId)
        if (!run || !store.get(request.owner, request.threadId)) return { stopped: false }
        run.controller.abort()
        await run.done
        return { stopped: true }
      }
      case 'update': {
        if (request.folder !== undefined && store.messages(request.threadId).length > 0) {
          throw new Error('The folder is fixed once the thread has a message.')
        }
        const thread = store.update(request.owner, request.threadId, {
          ...(request.title ? { title: request.title } : {}),
          ...(request.folder !== undefined ? { folder: request.folder } : {}),
        })
        if (!thread) throw new Error('This private thread is not on this computer.')
        this.options.emit({ kind: 'threads', owner: request.owner })
        return { thread }
      }
      case 'delete': {
        const run = this.runs.get(request.threadId)
        if (run) { run.controller.abort(); await run.done }
        const deleted = store.delete(request.owner, request.threadId)
        if (deleted) this.options.emit({ kind: 'threads', owner: request.owner })
        return { deleted }
      }
      case 'models':
        return { models: await (this.options.listModels ?? listProviderModels)(request.provider, request.apiKey) }
      case 'mcpCheck':
        return await this.localMcp.check(request.server)
      case 'mcpStop':
        return { stopped: await this.localMcp.stop(request.serverId) }
    }
  }

  private send(request: SendRequest): PrivateResults['send'] {
    const { store } = this.options
    const thread = store.get(request.owner, request.threadId)
    if (!thread) throw new Error('This private thread is not on this computer.')
    if (this.runs.has(thread.id)) throw new Error('This thread is already running. Stop it first.')
    const messages = withoutScreenshotImages(request.messages as PrivateUIMessage[], { keepLast: true })
    store.saveMessages(thread.id, messages)
    const model = `${request.model.provider}/${request.model.modelId}`
    const title = thread.title === DEFAULT_TITLE ? titleFrom(messages) : null
    if (title || thread.model !== model) {
      store.update(request.owner, thread.id, { model, ...(title ? { title } : {}) })
      this.options.emit({ kind: 'threads', owner: request.owner })
    }

    const controller = new AbortController()
    const run: Run = { turnId: request.turnId, controller, done: Promise.resolve() }
    this.runs.set(thread.id, run)
    run.done = this.execute(request, messages, controller.signal).finally(() => {
      if (this.runs.get(thread.id) === run) this.runs.delete(thread.id)
    })
    return { turnId: request.turnId }
  }

  private async execute(request: SendRequest, messages: PrivateUIMessage[], signal: AbortSignal): Promise<void> {
    const { emit } = this.options
    const { threadId, turnId } = request
    emit({ kind: 'turn', threadId, turnId, state: 'running' })
    const executor = new LocalToolExecutor({
      stateDirectory: this.options.stateDirectory,
      grant: () => ({ mode: 'selected_roots', roots: request.roots }),
    })
    let failure: string | undefined
    let overlay: OverlayToolsConnection | null = null
    let localMcp: LocalMcpTurn | null = null
    try {
      ;[overlay, localMcp] = await Promise.all([
        (this.options.connectOverlayTools ?? connectOverlayTools)(request.overlay, {
          signal,
          onUnavailable: (reason) => this.options.log?.(`Overlay tools unavailable for this turn: ${publicError(reason)}`),
        }),
        request.localMcp?.length ? this.localMcp.open(request.localMcp, { signal, approvalMode: request.approvalMode }) : null,
      ])
      const model = (this.options.createModel ?? createModel)(request.model.provider, request.model.modelId, request.model.apiKey)
      const instructions = instructionsFor(request, overlay, localMcp)
      const tools = withLocalMcpTools(withOverlayTools(privateComputerTools({ executor, approvalMode: request.approvalMode, abortSignal: signal }), overlay), localMcp)
      const saved = this.options.store.summary(threadId)
      const agent = new ToolLoopAgent({
        model,
        instructions: instructionsWithSummary(instructions, saved?.summary),
        tools,
        stopWhen: isStepCount(MAX_STEPS),
        prepareStep: createContextCompaction({
          model,
          contextWindow: this.options.contextWindow ?? contextWindowFor(request.model.provider, request.model.modelId),
          instructions,
          tools,
          previousSummary: saved?.summary,
          abortSignal: signal,
          onCompacted: (summary) => this.options.store.saveSummary(threadId, { summary, throughMessageId: summaryBoundary(messages) }),
        }),
      })
      const stream = await createAgentUIStream({
        agent,
        uiMessages: messagesAfterSummary(messages, saved),
        abortSignal: signal,
        originalMessages: messages as never,
        onError: (error) => { failure = publicError(error); return failure },
      })
      const [forPage, forDisk] = toReadable(stream).tee()
      const saving = this.persist(threadId, messages, forDisk)
      const reader = forPage.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        emit({ kind: 'chunk', threadId, turnId, chunk: value })
      }
      await saving
    } catch (error) {
      if (!signal.aborted) failure = publicError(error)
    } finally {
      localMcp?.release()
      await Promise.all([executor.shutdown().catch(() => undefined), overlay?.close()])
    }
    emit({ kind: 'turn', threadId, turnId, state: signal.aborted ? 'stopped' : failure ? 'error' : 'finished', ...(failure ? { error: failure } : {}) })
  }

  /** Saves the transcript at every finished step and once more at the end. */
  private async persist(threadId: string, messages: PrivateUIMessage[], stream: ReadableStream<UIMessageChunk>): Promise<void> {
    const last = messages.at(-1)
    const continuing = last?.role === 'assistant' ? last : undefined
    const base = continuing ? messages.slice(0, -1) : messages
    let latest: PrivateUIMessage | undefined = continuing
    let stepsSinceSave = 0
    const save = () => { if (latest) this.options.store.saveMessages(threadId, [...base, latest]) }
    const [steps, snapshots] = stream.tee()
    const counting = (async () => {
      const reader = steps.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        if (value.type === 'finish-step') stepsSinceSave++
      }
    })()
    for await (const message of readUIMessageStream({ stream: snapshots, ...(continuing ? { message: continuing } : {}) })) {
      latest = message
      if (stepsSinceSave > 0) { stepsSinceSave = 0; save() }
    }
    await counting
    // The turn is over: its screenshots have been seen, and keeping them would resend every image on each turn.
    if (latest) this.options.store.saveMessages(threadId, withoutScreenshotImages([...base, latest], { keepLast: false }))
  }

  /** Stops every run; their transcripts are already saved up to the last step. */
  async shutdown(): Promise<void> {
    for (const run of this.runs.values()) run.controller.abort()
    await Promise.allSettled([...this.runs.values()].map(run => run.done))
    await this.localMcp.shutdown()
  }
}

export function createModel(provider: PrivateModelProvider, modelId: string, apiKey: string): LanguageModel {
  switch (provider) {
    case 'anthropic': return createAnthropic({ apiKey })(modelId)
    case 'openai': return createOpenAI({ apiKey })(modelId)
    case 'google': return createGoogleGenerativeAI({ apiKey })(modelId)
    case 'openrouter': return createOpenRouter({ apiKey })(modelId)
  }
}

/** Local MCP tools are named `server__tool`, so they never take the name of a computer or Overlay tool. */
function withLocalMcpTools(tools: ToolSet, localMcp: LocalMcpTurn | null): ToolSet {
  if (!localMcp) return tools
  const merged: ToolSet = { ...tools }
  for (const [name, definition] of Object.entries(localMcp.tools)) if (!(name in merged)) merged[name] = definition
  return merged
}

function instructionsFor(request: SendRequest, overlay: OverlayToolsConnection | null, localMcp: LocalMcpTurn | null): string {
  const os = platform() === 'darwin' ? 'macOS' : platform() === 'win32' ? 'Windows' : 'Linux'
  return [
    `You are ${request.agent.name}, an agent in Overlay.`,
    request.agent.instructions?.trim() ?? '',
    [
      'This thread is private: it runs on the person\'s own computer and is not saved to Overlay\'s cloud.',
      `You work on this ${os} computer with the computer tools, in these folders: ${request.roots.join(', ')}.`,
      `The person's home folder is ${homedir()}. Use absolute paths.`,
      `Today is ${new Date().toDateString()}.`,
      'Work step by step, check your results, and finish with a short summary of what you did.',
    ].join('\n'),
    overlay && Object.keys(overlay.tools).length > 0 ? overlay.instructions : '',
    localMcp?.instructions ?? '',
  ].filter(Boolean).join('\n\n')
}

/**
 * Drops screenshot images from finished turns; the tool row keeps its size and the model is told to take a new one.
 * `keepLast` keeps the images of a turn that is continuing (an approval answered mid-turn).
 */
export function withoutScreenshotImages(messages: PrivateUIMessage[], options: { keepLast: boolean }): PrivateUIMessage[] {
  return messages.map((message, index) => {
    if (message.role !== 'assistant' || (options.keepLast && index === messages.length - 1)) return message
    let changed = false
    const parts = message.parts.map((part) => {
      const output = (part as { type: string; output?: unknown }).output
      if (part.type !== 'tool-computer_screenshot' || !output || typeof output !== 'object' || !('imageBase64' in output)) return part
      changed = true
      const { imageBase64: _image, ...rest } = output as Record<string, unknown>
      void _image
      return { ...part, output: { ...rest, message: SCREENSHOT_NOT_KEPT } }
    })
    return changed ? { ...message, parts } as PrivateUIMessage : message
  })
}

function titleFrom(messages: PrivateUIMessage[]): string | null {
  const text = messages.find(message => message.role === 'user')?.parts
    .map(part => part.type === 'text' ? part.text : '').join(' ').replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text
}

/** Provider errors can echo request details; keep the message and drop anything that looks like a key. */
function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/(sk|key|pk|AIza)[-_A-Za-z0-9]{12,}/g, '[redacted]').replace(/ovmcu_[a-z]_[-_.A-Za-z0-9]+/g, '[redacted]').slice(0, 1_000) || 'The model call failed.'
}

function toReadable<T>(iterable: AsyncIterable<T>): ReadableStream<T> {
  const iterator = iterable[Symbol.asyncIterator]()
  return new ReadableStream<T>({
    async pull(controller) {
      const { done, value } = await iterator.next()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    async cancel() { await iterator.return?.() },
  })
}

export function privateThreadsDatabasePath(stateDirectory: string): string {
  return join(stateDirectory, 'private-threads.sqlite')
}
