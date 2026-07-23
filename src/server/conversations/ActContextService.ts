import 'server-only'

import { logger } from '@/server/observability/logger'
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
import type { SourceCitationMap } from '@/shared/knowledge/ask-knowledge-types'
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

function buildMemoryContext(memories: ActMemoryRow[]): string {
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

  return '\n\nUser context:\n' + topMemories.map((m) => `- ${m.content}`).join('\n')
}

function buildSkillsContext(skills: ActSkillRow[]): string {
  if (skills.length === 0) return ''
  return (
    '\n\nIMPORTANT — User-configured skills below. Before acting, check whether any skill applies to this task and follow its instructions. You can also call list_skills to search them at runtime.\n<skills>\n' +
    skills.map((s) => `## ${s.name}\n${s.instructions.trim()}`).join('\n\n') +
    '\n</skills>'
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
  skillsContext: string
  sourceCitationMap: SourceCitationMap
}

type AutoRetrievalBuilder = (args: {
  userMessage: string
  userId: string
  accessToken?: string
  projectId?: string
  knowledgeBaseId?: string
  includeMemories?: boolean
}) => Promise<{
  extension: string
  citations: SourceCitationMap
}>

export class ActContextService {
  constructor(private readonly deps: {
    repository: ActConversationRepository
    buildAutoRetrievalBundle?: AutoRetrievalBuilder
    loadDocumentFile?: DocumentContextFileLoader
    resolveKnowledgeBaseId?: (args: {
      conversationId: string
      userId: string
    }) => Promise<string | null>
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

    const persisted = await this.deps.repository.getMessages({
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
    conversationId?: Id<'conversations'>
    indexedAttachments: unknown
    indexedFileNames?: string[]
    latestUserText?: string
    externalContextEnabled?: boolean
    memoryEnabled?: boolean
    mentions?: IncomingMention[]
    serverSecret: string
    userId: string
  }): Promise<ActTurnContext> {
    const memoryEnabled = args.memoryEnabled !== false
    const externalContextEnabled = args.externalContextEnabled !== false
    const memoriesTask: Promise<ActMemoryRow[]> = memoryEnabled ? (async () => {
      try {
        const memories = await this.deps.repository.listMemories({ userId: args.userId })
        return memories || listMemories(args.userId)
      } catch (_error) {
        return []
      }
    })() : Promise.resolve([])

    const skillsTask: Promise<ActSkillRow[]> = (async () => {
      try {
        const allSkills = await this.deps.repository.listSkills({ userId: args.userId })
        return allSkills.filter((s) => s.enabled !== false && s.instructions?.trim())
      } catch (_error) {
        return []
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

    const knowledgeBaseTask = args.conversationId && this.deps.resolveKnowledgeBaseId
      ? this.deps.resolveKnowledgeBaseId({
          conversationId: args.conversationId,
          userId: args.userId,
        }).catch((_error) => null)
      : Promise.resolve(null)

    const [effectiveMemories, enabledSkills, conv, knowledgeBaseId] = await Promise.all([
      memoriesTask,
      skillsTask,
      conversationTask,
      knowledgeBaseTask,
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
      citations: SourceCitationMap
    }> = (async () => {
      try {
        const buildAutoRetrievalBundle = this.deps.buildAutoRetrievalBundle ?? (async (
          params: Parameters<AutoRetrievalBuilder>[0],
        ) => {
          const knowledge = await import('@/server/knowledge/ask-knowledge-context')
          return await knowledge.buildAutoRetrievalBundle(params)
        })
        const bundle = await buildAutoRetrievalBundle({
          userMessage: args.latestUserText ?? '',
          userId: args.userId,
          ...(args.accessToken ? { accessToken: args.accessToken } : {}),
          ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
          projectId: conversationProjectId,
          includeMemories: knowledgeBaseId ? false : memoryEnabled,
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
      skillsContext: buildSkillsContext(enabledSkills),
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
}
