import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v3'
import type { Id } from '../../../../../convex/_generated/dataModel'
import type { NotebookAgentStreamEvent } from '@overlay/app-core'
import { normalizeNotebookTitle } from '@overlay/app-core'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'
import { assertUserCanUseByokModel } from '@/server/ai/model-runtime'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { getInternalApiBaseUrl } from '@/server/web/app-url'
import { resolveMentionsContext } from '@/server/knowledge/mention-resolver'
import { buildNotebookAgentInstructions } from '@/server/agent/notebook-agent-prompts'
import { NoteService } from '@/server/notes'
import { ConvexNoteRepository } from '@/server/notes/ConvexNoteRepository'
import { noteMarkdownToEditorText, toCanonicalNoteMarkdown } from '@overlay/app-core/note-markdown'
import { ensureActConversationId } from '@/server/conversations/ensure-act-conversation'
import {
  actConversationRepository,
  actEntitlementService,
  actMessagePersistenceService,
  agentRunService,
} from '@/server/conversations/http'
import { ConvexHarnessRepository } from '@/server/harness/ConvexHarnessRepository'
import { readPublicTranscriptStep } from '@/server/harness/public-transcript'
import {
  PersonalHarnessAdmissionConflict,
  PersonalHarnessStartPending,
  personalHarnessAuthentication,
  startPersonalHarness,
} from '@/server/harness/personal-admission'
import { isApiKeyChatWriteAllowed } from '@/server/harness/personal-access'
import { logger } from '@/server/observability/logger'
import { describeNotebookTools } from '@/server/notebook/notebook-agent-tools'
import {
  parseNotebookCursor,
  projectNotebookTerminal,
  projectNotebookTranscriptStep,
} from '@/server/notebook/notebook-agent-stream'
import { matchesNotebookRunIdentity, notebookRequestDigest } from '@/server/notebook/notebook-agent-identity'
import { summarizeErrorForLog } from '@/shared/security/safe-log'

export const maxDuration = 120

const MAX_NOTE_CHARS = 400_000
const NOTEBOOK_TRANSCRIPT_FETCH_TIMEOUT_MS = 60_000
const MentionSchema = z.object({
  type: z.string().max(100),
  id: z.string().max(256),
  name: z.string().max(200),
  fileIds: z.array(z.string().max(256)).max(100).optional(),
})

const BodySchema = z.object({
  noteId: z.string().min(1).max(256),
  turnId: z.string().min(1).max(256),
  runId: z.string().max(256).optional(),
  cursor: z.string().max(256).optional(),
  noteContent: z.string().max(MAX_NOTE_CHARS),
  noteTitle: z.string().max(200),
  message: z.string().min(1).max(32_000),
  modelId: z.string().max(200).optional(),
  mode: z.enum(['ask', 'write']).optional(),
  mentions: z.array(MentionSchema).max(100).optional(),
})

function conversationClientId(input: { userId: string; workspaceId: string; noteId: string }): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([input.userId, input.workspaceId, input.noteId]))
    .digest('hex')
    .slice(0, 32)
  return `notebook-agent-${digest}`
}

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

function isTerminal(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function assertNotebookIdentity(input: Parameters<typeof matchesNotebookRunIdentity>[0]): void {
  if (!matchesNotebookRunIdentity(input)) {
    throw new PersonalHarnessAdmissionConflict('Notebook run identity does not match this request.')
  }
}

function createNotebookStream(input: {
  runId: string
  conversationId: string
  turnId: string
  actorUserId: string
  cursor?: string
  signal: AbortSignal
  repository: ConvexHarnessRepository
}): Response {
  const encoder = new TextEncoder()
  let stopped = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: NotebookAgentStreamEvent) => {
        if (!stopped) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }
      emit({
        type: 'accepted',
        runId: input.runId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        ...(input.cursor ? { cursor: input.cursor } : {}),
      })
      const cursor = parseNotebookCursor(input.cursor)
      let afterSequence = cursor ? cursor.sequence - 1 : -1
      let afterCursor = cursor ?? undefined

      void (async () => {
        try {
          while (!stopped && !input.signal.aborted) {
            const state = await input.repository.readPublicStreamState({
              actorUserId: input.actorUserId,
              runId: input.runId,
              afterSequence,
            })
            if (!state) throw new Error('Notebook stream is unavailable.')
            for (const step of state.transcriptSteps) {
              const { persistence } = await readPublicTranscriptStep(
                step,
                AbortSignal.any([input.signal, AbortSignal.timeout(NOTEBOOK_TRANSCRIPT_FETCH_TIMEOUT_MS)]),
              )
              const events = projectNotebookTranscriptStep({
                runId: input.runId,
                step: { ...step, persistence },
                afterCursor,
              })
              for (const event of events) emit(event)
              afterSequence = step.sequence
              afterCursor = undefined
            }
            if (state.nextSequence !== null) {
              afterSequence = Math.max(afterSequence, state.nextSequence)
              continue
            }
            if (isTerminal(state.status)) {
              for (const event of projectNotebookTerminal({ runId: input.runId, status: state.status })) emit(event)
              controller.close()
              return
            }
            await new Promise(resolve => setTimeout(resolve, 150))
          }
          if (!stopped) controller.close()
        } catch (_error) {
          if (!stopped && !input.signal.aborted) {
            controller.close()
          }
        }
      })()
      input.signal.addEventListener('abort', () => {
        stopped = true
        try { controller.close() } catch (_error) { /* stream already closed */ }
      }, { once: true })
    },
    cancel() {
      stopped = true
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) return jsonError('Invalid Notebook request.', 400)
    const body = parsed.data
    const { auth } = context
    if (!['session', 'access-token', 'api-key'].includes(auth.authType)) return jsonError('Unauthorized.', 401)
    if (auth.authType === 'api-key' && !auth.apiKeyId) return jsonError('Unauthorized.', 401)

    const userId = auth.userId
    const workspaceId = context.workspace.workspace.id
    const principalId = context.workspace.principal.id
    const server = getOverlayServerContext()
    if (auth.authType === 'api-key'
      && !(await isApiKeyChatWriteAllowed(userId, auth.apiKeyId!, server))) {
      return jsonError('Unauthorized.', 401)
    }
    const [note, noteEditGrant, modelUseGrant, conversationEditGrant] = await Promise.all([
      new NoteService({ noteRepository: new ConvexNoteRepository() }).getNote({
        noteId: body.noteId, userId, workspaceId,
      }),
      server.authorizationService.checkCapability({ capability: 'notes.edit', userId }),
      server.authorizationService.checkCapability({ capability: 'models.use', userId }),
      server.authorizationService.checkCapability({ capability: 'conversations.edit', userId }),
    ])
    if (!note) return jsonError('Notebook not found or not accessible in this workspace.', 404)
    const subject = await server.authorizationService.resolveSubject(userId)
    const noteOwnerUserId = await server.authorizationService.getResourceOwner({
      resourceId: body.noteId,
      resourceType: 'note',
    })
    const noteResourceEdit = noteOwnerUserId
      ? await server.authorizationService.checkResolvedResourceAccess({
        action: 'edit',
        capability: 'notes.edit',
        ownerUserId: noteOwnerUserId,
        resourceId: body.noteId,
        resourceType: 'note',
        subject,
      })
      : { allowed: false }
    if (!noteEditGrant.allowed || !noteResourceEdit.allowed || !modelUseGrant.allowed
      || !conversationEditGrant.allowed) {
      return jsonError('You are not authorized to use the Notebook agent.', 403)
    }
    const noteMarkdownSnapshot = toCanonicalNoteMarkdown(note.content ?? '')
    if (noteMarkdownSnapshot.length > MAX_NOTE_CHARS) {
      return jsonError('The note is too large for an agent turn.', 413)
    }
    const noteContentSnapshot = noteMarkdownToEditorText(noteMarkdownSnapshot)
    if (noteContentSnapshot.length > MAX_NOTE_CHARS) {
      return jsonError('The note is too large for an agent turn.', 413)
    }

    const modelId = body.modelId?.trim() || DEFAULT_MODEL_ID
    const gate = await actEntitlementService.gateModelAccess({ effectiveModelId: modelId, userId, workspaceId })
    if (isByokModelId(modelId)) await assertUserCanUseByokModel(modelId, userId, workspaceId)
    else if (!(await resolveAuthorizedModelIds({ entitlements: gate.runtimeEntitlements })).chat.has(modelId)) {
      return jsonError('The selected model is not allowed by server policy.', 403)
    }
    const requestDigest = notebookRequestDigest({
      noteId: body.noteId,
      turnId: body.turnId,
      noteMarkdown: body.noteContent,
      noteTitle: body.noteTitle,
      message: body.message,
      modelId,
      mentions: body.mentions,
    })
    const [memoryGrant, toolsUseGrant] = await Promise.all([
      server.authorizationService.checkCapability({ capability: 'memory.use', userId }),
      server.authorizationService.checkCapability({ capability: 'tools.use', userId }),
    ])
    const searchKnowledge = toolsUseGrant.allowed
      && (await server.authorizationService.checkResolvedCatalogResourceAccess({
        capability: 'tools.use',
        resourceId: 'search_knowledge',
        resourceType: 'tool',
        subject,
      })).allowed
    const memoryEnabled = memoryGrant.allowed

    const conversationId = await ensureActConversationId({
      userId,
      repository: actConversationRepository,
      conversationClientId: conversationClientId({ userId, workspaceId, noteId: body.noteId }),
      scope: 'personal',
      workspaceId,
      entitlements: gate.runtimeEntitlements,
      title: `Notebook: ${normalizeNotebookTitle(note.title ?? '')}`,
      askModelIds: [modelId],
      actModelId: modelId,
    })
    const conversation = await actConversationRepository.getConversationById({ conversationId, userId })
    if (!conversation || conversation.userId !== userId || conversation.workspaceId !== workspaceId
      || conversation.conversationType && conversation.conversationType !== 'personal') {
      return jsonError('Notebook conversation access is no longer valid.', 403)
    }

    const repository = new ConvexHarnessRepository()
    let agentRun = (await actConversationRepository.getLatestAgentRun({ conversationId, turnId: body.turnId, userId })) ?? null
    const expectedHarnessRunId = agentRun ? `personal:${agentRun.id}` : null
    if (agentRun?.harnessRunId && agentRun.harnessRunId !== expectedHarnessRunId) {
      return jsonError('Notebook run is not accessible.', 403)
    }
    let state = expectedHarnessRunId
      ? await repository.get({ actorUserId: userId, runId: expectedHarnessRunId })
      : null
    if (agentRun?.harnessRunId && !state) return jsonError('Notebook run is not accessible.', 403)
    if (body.runId && (!state || body.runId !== state.runId)) return jsonError('Notebook run identity is invalid.', 409)
    if (state) {
      if (!agentRun) return jsonError('Notebook run is not accessible.', 403)
      assertNotebookIdentity({
        state, userId, workspaceId, noteId: body.noteId, turnId: body.turnId,
        conversationId: String(conversationId), agentRun, requestDigest, runId: body.runId,
      })
    } else {
      if (toCanonicalNoteMarkdown(body.noteContent) !== noteMarkdownSnapshot
        || normalizeNotebookTitle(body.noteTitle) !== normalizeNotebookTitle(note.title ?? '')) {
        return jsonError('The note changed before the agent turn started. Save or reload the note, then retry.', 409)
      }
      const frozenContent = noteContentSnapshot
      const prompt = `Note content:\n\n${frozenContent || '(empty note)'}\n\n---\n\nUser request: ${body.message}`
      const existingUserMessage = (await actConversationRepository.getRecentMessages({
        conversationId,
        userId,
        limit: 100,
      })).find(message => message.role === 'user' && message.turnId === body.turnId)
      if (existingUserMessage && existingUserMessage.content !== prompt) {
        return jsonError('This Notebook turn was already started with different content. Start a new turn.', 409)
      }
      const userMessageId = agentRun?.userMessageId ?? existingUserMessage?._id
        ?? await actMessagePersistenceService.persistUserMessage({
          conversationId,
          latestUserContent: prompt,
          latestUserText: prompt,
          modelId,
          skip: false,
          skipMemoryExtraction: true,
          turnId: body.turnId,
          userId,
          mode: 'act',
        })
      if (!userMessageId) return jsonError('Notebook request could not be persisted.', 500)
      agentRun = agentRun ?? (await agentRunService.startPersonalWorkflow({
        conversationId,
        modelId,
        turnId: body.turnId,
        userId,
        userMessageId: userMessageId as Id<'conversationMessages'>,
      })) ?? null
      if (!agentRun) return jsonError('Notebook run could not be created.', 500)
      const mentionsContext = await resolveMentionsContext(body.mentions, { userId, serverSecret: getInternalApiSecret() })
      const allowedToolIds = [
        ...(searchKnowledge ? ['search_knowledge'] : []),
        'read_note', 'propose_edit', 'finish',
      ]
      const definitions = await describeNotebookTools(searchKnowledge)
      const toolingContext = {
        baseUrl: getInternalApiBaseUrl(request),
        conversationId: String(conversationId),
        effectiveModelId: modelId,
        entitlements: gate.runtimeEntitlements,
        latestUserText: body.message,
        memoryEnabled,
        paid: gate.paid,
        requestFingerprint: context.requestFingerprint,
        requestedToolIds: allowedToolIds,
        turnId: body.turnId,
        userId,
        workspaceId,
        accountAllowedToolIds: allowedToolIds,
        notebook: {
          kind: 'notebook' as const,
          noteId: body.noteId,
          title: note.title || 'Untitled',
          content: frozenContent,
          requestDigest,
        },
      }
      const workflow = {
        access: {
          actorUserId: userId,
          runId: `personal:${agentRun.id}`,
          conversationId: String(conversationId),
          agentRunId: agentRun.id,
          workspaceId,
          principalId,
          authentication: personalHarnessAuthentication(auth),
        },
        context: toolingContext,
        definitions,
        instructions: buildNotebookAgentInstructions({
          availableToolIds: allowedToolIds,
          mentionsContext,
          memoryEnabled,
        }),
        messages: [{ role: 'user' as const, content: prompt }],
        delivery: { emitWebhook: false },
      }
      if (request.signal.aborted) return jsonError('Notebook request was cancelled before admission.', 499)
      await startPersonalHarness({ workflow, agentRun, paid: gate.paid, goal: body.message })
      state = await repository.get({ actorUserId: userId, runId: `personal:${agentRun.id}` })
      if (!state) return jsonError('Notebook run admission is pending; reconnect with the same turn ID.', 503)
      assertNotebookIdentity({
        state, userId, workspaceId, noteId: body.noteId, turnId: body.turnId,
        conversationId: String(conversationId), agentRun, requestDigest, runId: body.runId,
      })
    }
    if (!state) return jsonError('Notebook run is unavailable.', 404)
    return createNotebookStream({
      runId: state.runId,
      conversationId: String(conversationId),
      turnId: body.turnId,
      actorUserId: userId,
      cursor: body.cursor,
      signal: request.signal,
      repository,
    })
  } catch (error) {
    if (error instanceof PersonalHarnessAdmissionConflict) return jsonError(error.message, 409)
    if (error instanceof PersonalHarnessStartPending) return jsonError(error.message, 503)
    logger.error('[notebook-agent]', summarizeErrorForLog(error))
    return jsonError('Notebook agent could not start.', 500)
  }
}
