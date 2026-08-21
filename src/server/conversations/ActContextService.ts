import 'server-only'

import { logger } from '@/server/observability/logger'
import { captureModelTokenBreakdown } from '@/server/observability/metrics'
import type {
  DocumentContextBundle,
  DocumentContextFileLoader,
} from '@/server/agent/document-context-builder'
import {
  compactMessagesForContext,
  contextSummaryScope,
} from '@/server/chat/context-compaction'
import type { IncomingMention } from '@/server/knowledge/mention-resolver'
import type { UIMessage } from '@/server/ai/sdk'
import { listMemories } from '@/shared/app/app-store'
import { mergeReplyContextIntoMessagesForModel } from '@/shared/chat/reply-context-for-model'
import { sanitizeUiMessagesForModelApi } from '@/shared/chat/sanitize-ui-messages-for-model'
import {
  parseIndexedAttachmentsFromRequest,
  type IndexedAttachmentRef,
} from '@/shared/knowledge/knowledge-agent-types'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import type {
  ActConversationRepository,
  ActMemoryRow,
  ActPersistedMessage,
  ActSkillRow,
} from './ActConversationRepository'
import type { Id } from '../../../convex/_generated/dataModel'

function toUiMessageFromPersisted(message: ActPersistedMessage): UIMessage {
  return {
    id: message._id,
    role: message.role,
    parts: message.parts?.length
      ? message.parts
      : [{ type: 'text' as const, text: message.content ?? '' }],
    ...(message.routedModelId ? { metadata: { routedModelId: message.routedModelId } } : {}),
  }
}

// Token budgets for context components. These keep non-message context
// within explicit limits instead of growing unbounded with skill/memory count.
const MEMORY_CONTEXT_CHAR_BUDGET = 2_000   // ~500 tokens
const SKILL_DIRECTORY_CHAR_BUDGET = 1_500  // ~375 tokens

export function buildMemoryContext(memories: ActMemoryRow[]): string {
  if (memories.length === 0) return ''
  const topMemories = memories
    .sort((a, b) => {
      const impA = a.importance ?? 3
      const impB = b.importance ?? 3
      if (impB !== impA) return impB - impA
      const ageA = a.updatedAt ?? 0
      const ageB = b.updatedAt ?? 0
      return ageB - ageA
    })
    .slice(0, 10)

  // Enforce a character budget by truncating the memory context.
  const lines = topMemories.map((m) => `- ${m.content}`)
  let context = lines.join('\n')
  if (context.length > MEMORY_CONTEXT_CHAR_BUDGET) {
    // Truncate at the budget, trying to end on a complete line.
    const truncated = context.slice(0, MEMORY_CONTEXT_CHAR_BUDGET)
    const lastNewline = truncated.lastIndexOf('\n')
    context = (lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated) + '\n- [additional memories omitted to fit context budget]'
  }
  return '\n\nUser context:\n' + context
}

/**
 * Build a lightweight skill directory (name + description only, no full
 * instructions). The agent can call list_skills to load full instructions
 * on demand when a skill is relevant to the current task.
 */
export function buildSkillDirectoryContext(skills: Array<{ name: string; description: string }>): string {
  if (skills.length === 0) return ''
  let directory = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')
  if (directory.length > SKILL_DIRECTORY_CHAR_BUDGET) {
    const truncated = directory.slice(0, SKILL_DIRECTORY_CHAR_BUDGET)
    const lastNewline = truncated.lastIndexOf('\n')
    directory = (lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated) + '\n- [additional skills omitted to fit context budget]'
  }
  return (
    '\n\nIMPORTANT — User-configured skills are available. Before acting, check whether any skill applies to this task. Call the list_skills tool to load full instructions for a relevant skill.\n<skill-directory>\n' +
    directory +
    '\n</skill-directory>'
  )
}

const emptyDocumentContextBundle: DocumentContextBundle = {
  contextText: '',
  hasContent: false,
  totalChars: 0,
}

export type ActTurnContext = {
  autoRetrieval: string
  conversationProjectId?: string
  docContextBundle: DocumentContextBundle
  enabledSkills: ActSkillRow[]
  hasPreloadedDocContext: boolean
  indexedAttachmentList: IndexedAttachmentRef[]
  memoryContext: string
  mentionsContext: string
  projectInstructions: string
  projectSettings?: Record<string, unknown>
  skillsContext: string
  sourceCitationMap: Record<string, { kind: 'file' | 'memory'; sourceId: string }>
}

type AutoRetrievalBuilder = (args: {
  billing: {
    actorUserId: string
    idempotencyKey: string
    operationId: string
    programmaticSubjectId?: string
    requestFingerprint: string
  }
  userMessage: string
  userId: string
  accessToken?: string
  projectId?: string
  includeMemories?: boolean
  workspaceId?: string
}) => Promise<{
  extension: string
  citations: Record<string, { kind: 'file' | 'memory'; sourceId: string }>
}>

export class ActContextService {
  constructor(private readonly deps: {
    repository: ActConversationRepository
    buildAutoRetrievalBundle?: AutoRetrievalBuilder
    loadDocumentFile?: DocumentContextFileLoader
  }) {}

  async buildMessagesForModel(params: {
    conversationId?: Id<'conversations'>
    historyBaseModelId?: string
    latestTurnId?: string
    latestUserMessage?: UIMessage
    requestMessages: UIMessage[]
    targetModelId?: string
    userId: string
  }): Promise<UIMessage[]> {
    if (!params.conversationId) return params.requestMessages

    // Load only the unsummarized tail instead of the full conversation history.
    // If a context summary exists for this model scope, we use its
    // summarizedThroughCreatedAt as the cursor and load only messages at or
    // after that point. The summary itself is injected later in
    // prepareExistingMessagesForModel via compactMessagesForContext.
    const summaryScope = contextSummaryScope({
      targetModelId: params.targetModelId ?? '',
      historyBaseModelId: params.historyBaseModelId,
    })
    let sinceCreatedAt: number | undefined
    try {
      const summary = await this.deps.repository.getContextSummary({
        conversationId: params.conversationId,
        userId: params.userId,
        scope: summaryScope,
      })
      if (summary?.summarizedThroughCreatedAt && Number.isFinite(summary.summarizedThroughCreatedAt)) {
        sinceCreatedAt = summary.summarizedThroughCreatedAt
      }
    } catch (_error) {
      // If summary loading fails, fall back to loading full history.
    }

    const persisted = sinceCreatedAt !== undefined
      ? await this.deps.repository.getMessagesSince({
          conversationId: params.conversationId,
          userId: params.userId,
          sinceCreatedAt,
          compactToolPayloads: true,
        })
      : await this.deps.repository.getMessages({
          conversationId: params.conversationId,
          userId: params.userId,
        })

    const historyRows = params.latestTurnId
      ? persisted.filter((message) => message.turnId !== params.latestTurnId)
      : persisted
    const threadModelId = params.historyBaseModelId?.trim() || params.targetModelId?.trim()
    const history = threadModelId
      ? historyRows
          .filter((message) => message.role === 'user' || message.modelId === threadModelId)
          .map(toUiMessageFromPersisted)
      : historyRows.map(toUiMessageFromPersisted)
    const latest = params.latestUserMessage
    if (!latest) return history.length > 0 ? history : params.requestMessages

    const latestAlreadyPersisted = history.some((message) => message.id === latest.id)
    return latestAlreadyPersisted ? history : [...history, latest]
  }

  async loadTurnContext(args: {
    accessToken?: string
    billingProgrammaticSubjectId?: string
    billingUserId: string
    conversationId?: Id<'conversations'>
    indexedAttachments: unknown
    indexedFileNames?: string[]
    latestUserText?: string
    externalContextEnabled?: boolean
    memoryEnabled?: boolean
    mentions?: IncomingMention[]
    mentionedKnowledgeBaseIds?: string[]
    requestIdempotencyKey: string
    requestFingerprint: string
    serverSecret: string
    userId: string
    workspaceId?: string
  }): Promise<ActTurnContext> {
    const memoryEnabled = args.memoryEnabled !== false
    const externalContextEnabled = args.externalContextEnabled !== false
    const memoriesTask: Promise<ActMemoryRow[]> = memoryEnabled ? (async () => {
      try {
        const memories = await this.deps.repository.listMemories({
          userId: args.userId,
          workspaceId: args.workspaceId,
        })
        return memories || listMemories(args.userId)
      } catch (_error) {
        return []
      }
    })() : Promise.resolve([])

    const skillsTask: Promise<ActSkillRow[]> = (async () => {
      try {
        // Load the skill directory (name + description only, no full instructions).
        // This keeps the skill context within a small token budget. The agent
        // can load full instructions on demand via the list_skills tool.
        const directory = await this.deps.repository.listSkillDirectory({ userId: args.userId })
        const enabledDirectory = directory.filter((s) => s.enabled !== false)
        // Return as ActSkillRow-shaped objects with empty instructions so the
        // rest of the pipeline (mentionsContext, etc.) still works.
        return enabledDirectory.map((s) => ({
          _id: s._id as Id<'skills'>,
          name: s.name,
          description: s.description,
          instructions: '', // Not loaded — use list_skills tool on demand
          enabled: s.enabled,
          userId: args.userId,
          createdAt: 0,
          updatedAt: 0,
        }))
      } catch (_error) {
        // Fall back to full skill list if directory query fails.
        try {
          const allSkills = await this.deps.repository.listSkills({ userId: args.userId })
          return allSkills.filter((s) => s.enabled !== false && s.instructions?.trim())
        } catch (_error2) {
          return []
        }
      }
    })()

    const conversationTask: Promise<{ projectId?: string } | null> = (async () => {
      if (!args.conversationId) return null
      try {
        return await this.deps.repository.getConversation({
          conversationId: args.conversationId,
          userId: args.userId,
        })
      } catch (_error) {
        return null
      }
    })()

    const [effectiveMemories, enabledSkills, conv] = await Promise.all([
      memoriesTask,
      skillsTask,
      conversationTask,
    ])

    const mentionsContextTask = externalContextEnabled
      ? (async () => {
          const { resolveMentionsContext } = await import('@/server/knowledge/mention-resolver')
          return await resolveMentionsContext(args.mentions, {
            userId: args.userId,
            serverSecret: args.serverSecret,
            enabledSkills,
          })
        })()
      : Promise.resolve('')

    const conversationProjectId = conv?.projectId
    const projectTask: Promise<string> = (async () => {
      if (!conversationProjectId) return ''
      try {
        const project = await this.deps.repository.getProject({
          projectId: conversationProjectId as Id<'projects'>,
          userId: args.userId,
        })
        return project?.instructions?.trim() || ''
      } catch (_error) {
        return ''
      }
    })()

    const autoRetrievalTask: Promise<{
      extension: string
      citations: Record<string, { kind: 'file' | 'memory'; sourceId: string }>
    }> = (async () => {
      try {
        const buildAutoRetrievalBundle = this.deps.buildAutoRetrievalBundle ?? (async (
          params: Parameters<AutoRetrievalBuilder>[0],
        ) => {
          const knowledge = await import('@/server/knowledge/ask-knowledge-context')
          return await knowledge.buildAutoRetrievalBundle(params)
        })
        const bundle = await buildAutoRetrievalBundle({
          billing: {
            actorUserId: args.billingUserId,
            idempotencyKey: args.requestIdempotencyKey,
            operationId: 'conversation.act.auto-retrieval',
            ...(args.billingProgrammaticSubjectId
              ? { programmaticSubjectId: args.billingProgrammaticSubjectId }
              : {}),
            requestFingerprint: args.requestFingerprint,
          },
          userMessage: args.latestUserText ?? '',
          userId: args.userId,
          ...(args.accessToken ? { accessToken: args.accessToken } : {}),
          projectId: conversationProjectId,
          includeMemories: memoryEnabled,
          ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
        })
        return { extension: bundle.extension, citations: bundle.citations }
      } catch (_error) {
        return { extension: '', citations: {} }
      }
    })()

    const indexedAttachmentList = parseIndexedAttachmentsFromRequest({
      indexedAttachments: args.indexedAttachments,
      indexedFileNames: args.indexedFileNames,
    })

    const docContextTask =
      this.deps.loadDocumentFile && indexedAttachmentList.length > 0
        ? (async () => {
            const { buildDocumentContextBundle } = await import('@/server/agent/document-context-builder')
            return await buildDocumentContextBundle({
              attachments: indexedAttachmentList,
              userId: args.userId,
              accessToken: args.accessToken,
              loadFile: this.deps.loadDocumentFile!,
              userQuery: args.latestUserText ?? undefined,
            })
          })()
        : Promise.resolve(emptyDocumentContextBundle)

    const [projectInstructions, autoRetrievalBundle, mentionsContext, docContextBundle] =
      await Promise.all([
        projectTask,
        autoRetrievalTask,
        mentionsContextTask,
        docContextTask,
      ])

    return {
      autoRetrieval: autoRetrievalBundle.extension,
      conversationProjectId,
      docContextBundle,
      enabledSkills,
      hasPreloadedDocContext: docContextBundle.hasContent && docContextBundle.totalChars > 0,
      indexedAttachmentList,
      memoryContext: memoryEnabled ? buildMemoryContext(effectiveMemories) : '',
      mentionsContext,
      projectInstructions,
      // Use the lightweight skill directory (name + description only) instead
      // of injecting full instructions for every skill into every turn.
      // The agent loads full instructions on demand via the list_skills tool.
      skillsContext: buildSkillDirectoryContext(
        enabledSkills.map((s) => ({ name: s.name, description: s.description ?? '' })),
      ),
      sourceCitationMap: autoRetrievalBundle.citations,
    }
  }

  async prepareModelContext(args: {
    accessToken?: string
    conversationId?: Id<'conversations'>
    historyBaseModelId?: string
    latestTurnId?: string
    latestUserMessage?: UIMessage
    replyContextForModel?: string
    requestMessages: UIMessage[]
    targetModelId: string
    userId: string
  }): Promise<UIMessage[]> {
    const messagesForModel = await this.buildMessagesForModel({
      requestMessages: args.requestMessages,
      latestUserMessage: args.latestUserMessage,
      latestTurnId: args.latestTurnId,
      conversationId: args.conversationId,
      userId: args.userId,
      targetModelId: args.targetModelId,
      historyBaseModelId: args.historyBaseModelId,
    })
    return await this.prepareExistingMessagesForModel({
      accessToken: args.accessToken,
      conversationId: args.conversationId,
      historyBaseModelId: args.historyBaseModelId,
      messages: messagesForModel,
      replyContextForModel: args.replyContextForModel,
      targetModelId: args.targetModelId,
      userId: args.userId,
    })
  }

  async prepareExistingMessagesForModel(args: {
    accessToken?: string
    conversationId?: Id<'conversations'>
    generateSummaryText?: (args: {
      prompt: string
      targetSummaryTokens: number
    }) => Promise<string>
    historyBaseModelId?: string
    messages: UIMessage[]
    replyContextForModel?: string
    targetModelId: string
    userId: string
  }): Promise<UIMessage[]> {
    let messagesForModel = args.messages
    messagesForModel = mergeReplyContextIntoMessagesForModel(messagesForModel, args.replyContextForModel)
    messagesForModel = sanitizeUiMessagesForModelApi(messagesForModel)

    const summaryScope = contextSummaryScope({
      targetModelId: args.targetModelId,
      historyBaseModelId: args.historyBaseModelId,
    })
    const previousContextSummary = args.conversationId
      ? await this.deps.repository.getContextSummary({
          conversationId: args.conversationId,
          userId: args.userId,
          scope: summaryScope,
        }).catch((error) => {
          logger.warn('[conversations/act] Failed to load context summary', {
            conversationId: args.conversationId,
            scope: summaryScope,
            error: summarizeErrorForLog(error),
          })
          return null
        })
      : null

    const compaction = await compactMessagesForContext({
      messages: messagesForModel,
      targetModelId: args.targetModelId,
      accessToken: args.accessToken,
      previousSummary: previousContextSummary,
      ...(args.generateSummaryText ? { generateSummaryText: args.generateSummaryText } : {}),
    })
    messagesForModel = compaction.messages

    if (compaction.didCompact || compaction.usedFallbackTrim) {
      logger.info('[conversations/act] context-compaction', {
        targetModelId: args.targetModelId,
        scope: summaryScope,
        contextWindow: compaction.contextWindow,
        originalEstimatedTokens: compaction.originalEstimatedTokens,
        finalEstimatedTokens: compaction.finalEstimatedTokens,
        triggerTokens: compaction.triggerTokens,
        targetTokens: compaction.targetTokens,
        ratioBefore: Number((compaction.originalEstimatedTokens / compaction.contextWindow).toFixed(4)),
        ratioAfter: Number((compaction.finalEstimatedTokens / compaction.contextWindow).toFixed(4)),
        didCompact: compaction.didCompact,
        usedFallbackTrim: compaction.usedFallbackTrim,
      })
    }

    if (args.conversationId && compaction.summaryToPersist) {
      const summary = compaction.summaryToPersist
      await this.deps.repository.upsertContextSummary({
        conversationId: args.conversationId,
        userId: args.userId,
        scope: summaryScope,
        summary: summary.summary,
        ...(summary.summarizedThroughMessageId
          ? { summarizedThroughMessageId: summary.summarizedThroughMessageId }
          : {}),
        ...(summary.summarizedThroughCreatedAt
          ? { summarizedThroughCreatedAt: summary.summarizedThroughCreatedAt }
          : {}),
        sourceMessageCount: summary.sourceMessageCount,
        sourceEstimatedTokens: summary.sourceEstimatedTokens,
        summaryEstimatedTokens: summary.summaryEstimatedTokens,
        contextWindow: summary.contextWindow,
        targetModelId: summary.targetModelId,
        summarizerModelId: summary.summarizerModelId,
      }).catch((error) => {
        logger.warn('[conversations/act] Failed to persist context summary', {
          conversationId: args.conversationId,
          scope: summaryScope,
          error: summarizeErrorForLog(error),
        })
      })
    }

    return messagesForModel
  }

  /**
   * Estimate the token breakdown for a model turn and emit it to the metrics
   * pipeline.  Called after the model call completes with the actual provider
   * token counts and the context that was assembled for the turn.
   */
  emitTokenBreakdown(args: {
    runId: string
    modelId: string
    userId: string
    context: ActTurnContext
    messagesForModel: UIMessage[]
    totalInputTokens: number
    totalOutputTokens: number
    providerCostMicros?: number
  }): void {
    // Rough estimate: ~4 characters per token for English text.
    const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

    const historyTokens = args.messagesForModel.reduce(
      (sum, msg) => sum + estimateTokens(
        msg.parts?.map((p) => ('text' in p ? p.text ?? '' : '')).join(' ') ?? '',
      ),
      0,
    )
    const memoryTokens = estimateTokens(args.context.memoryContext)
    const skillTokens = estimateTokens(args.context.skillsContext)
    const toolTokens = 0 // Tool definitions are injected by the agent runtime, not the context service.
    const attachmentTokens = args.context.docContextBundle.totalChars > 0
      ? estimateTokens(args.context.docContextBundle.contextText)
      : estimateTokens(args.context.autoRetrieval)
    const systemTokens = estimateTokens(args.context.projectInstructions + args.context.mentionsContext)

    captureModelTokenBreakdown({
      runId: args.runId,
      modelId: args.modelId,
      userId: args.userId,
      historyTokens,
      memoryTokens,
      skillTokens,
      toolTokens,
      attachmentTokens,
      systemTokens,
      totalInputTokens: args.totalInputTokens,
      totalOutputTokens: args.totalOutputTokens,
      providerCostMicros: args.providerCostMicros,
    })
  }
}
