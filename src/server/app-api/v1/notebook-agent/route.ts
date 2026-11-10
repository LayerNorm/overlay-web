import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v3'
import type { Id } from '../../../../../convex/_generated/dataModel'
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
import { ActConversationServiceError } from '@/server/conversations/ActEntitlementService'
import {
  actConversationRepository,
  actEntitlementService,
  actMessagePersistenceService,
  agentRunService,
} from '@/server/conversations/http'
import { ConvexHarnessRepository } from '@/server/harness/ConvexHarnessRepository'
import {
  PersonalHarnessAdmissionConflict,
  PersonalHarnessStartPending,
  personalHarnessAuthentication,
  startPersonalHarness,
} from '@/server/harness/personal-admission'
import { isApiKeyChatWriteAllowed } from '@/server/harness/personal-access'
import { logger } from '@/server/observability/logger'
import { describeNotebookTools } from '@/server/notebook/notebook-agent-tools'
import { matchesNotebookRunIdentity, notebookRequestDigest } from '@/server/notebook/notebook-agent-identity'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import { createNotebookStream } from './stream'

export const maxDuration = 120

const MAX_NOTE_CHARS = 400_000
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

function assertNotebookIdentity(input: Parameters<typeof matchesNotebookRunIdentity>[0]): void {
  if (!matchesNotebookRunIdentity(input)) {
    throw new PersonalHarnessAdmissionConflict('Notebook run identity does not match this request.')
  }
}

type NotebookRequestBody = z.infer<typeof BodySchema>
type NotebookServerContext = ReturnType<typeof getOverlayServerContext>
type NotebookAgentRun = NonNullable<Awaited<ReturnType<typeof actConversationRepository.getLatestAgentRun>>>
type NotebookHarnessState = Awaited<ReturnType<ConvexHarnessRepository['get']>>
type NotebookConversationId = Awaited<ReturnType<typeof ensureActConversationId>>
type NotebookAuthorizationSubject = Awaited<
  ReturnType<NotebookServerContext['authorizationService']['resolveSubject']>
>
type NotebookNoteSnapshot = { title?: string | null; content?: string | null }
type NotebookRouteAccess = {
  userId: string
  workspaceId: string
  principalId: string
  server: NotebookServerContext
}
type NotebookRouteStep<T> =
  | { ok: true; value: T }
  | { ok: false; response: NextResponse }

function notebookRouteValue<T>(value: T): NotebookRouteStep<T> {
  return { ok: true, value }
}

function notebookRouteResponse(response: NextResponse): NotebookRouteStep<never> {
  return { ok: false, response }
}

async function resolveNotebookRequestAccess(
  context: AppApiRouteContext,
): Promise<NotebookRouteStep<NotebookRouteAccess>> {
  const { auth } = context
  if (!['session', 'access-token', 'api-key'].includes(auth.authType)) {
    return notebookRouteResponse(jsonError('Unauthorized.', 401))
  }
  if (auth.authType === 'api-key' && !auth.apiKeyId) {
    return notebookRouteResponse(jsonError('Unauthorized.', 401))
  }

  const userId = auth.userId
  const workspaceId = context.workspace.workspace.id
  const principalId = context.workspace.principal.id
  const server = getOverlayServerContext()
  if (auth.authType === 'api-key'
    && !(await isApiKeyChatWriteAllowed(userId, auth.apiKeyId!, server))) {
    return notebookRouteResponse(jsonError('Unauthorized.', 401))
  }
  return notebookRouteValue({ userId, workspaceId, principalId, server })
}

async function authorizeNotebookNote(
  body: NotebookRequestBody,
  access: NotebookRouteAccess,
): Promise<NotebookRouteStep<{
  note: NotebookNoteSnapshot
  subject: NotebookAuthorizationSubject
  noteMarkdownSnapshot: string
  noteContentSnapshot: string
}>> {
  const [note, noteEditGrant, modelUseGrant, conversationEditGrant] = await Promise.all([
    new NoteService({ noteRepository: new ConvexNoteRepository() }).getNote({
      noteId: body.noteId, userId: access.userId, workspaceId: access.workspaceId,
    }),
    access.server.authorizationService.checkCapability({ capability: 'notes.edit', userId: access.userId }),
    access.server.authorizationService.checkCapability({ capability: 'models.use', userId: access.userId }),
    access.server.authorizationService.checkCapability({ capability: 'conversations.edit', userId: access.userId }),
  ])
  if (!note) return notebookRouteResponse(jsonError('Notebook not found or not accessible in this workspace.', 404))

  const subject = await access.server.authorizationService.resolveSubject(access.userId)
  const noteOwnerUserId = await access.server.authorizationService.getResourceOwner({
    resourceId: body.noteId,
    resourceType: 'note',
  })
  const noteResourceEdit = noteOwnerUserId
    ? await access.server.authorizationService.checkResolvedResourceAccess({
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
    return notebookRouteResponse(jsonError('You are not authorized to use the Notebook agent.', 403))
  }

  const noteMarkdownSnapshot = toCanonicalNoteMarkdown(note.content ?? '')
  if (noteMarkdownSnapshot.length > MAX_NOTE_CHARS) {
    return notebookRouteResponse(jsonError('The note is too large for an agent turn.', 413))
  }
  const noteContentSnapshot = noteMarkdownToEditorText(noteMarkdownSnapshot)
  if (noteContentSnapshot.length > MAX_NOTE_CHARS) {
    return notebookRouteResponse(jsonError('The note is too large for an agent turn.', 413))
  }
  return notebookRouteValue({
    note: { title: note.title, content: note.content },
    subject,
    noteMarkdownSnapshot,
    noteContentSnapshot,
  })
}

async function authorizeNotebookModel(
  body: NotebookRequestBody,
  access: NotebookRouteAccess,
): Promise<NotebookRouteStep<{
  modelId: string
  gate: Awaited<ReturnType<typeof actEntitlementService.gateModelAccess>>
}>> {
  const modelId = body.modelId?.trim() || DEFAULT_MODEL_ID
  const gate = await actEntitlementService.gateModelPolicy({
    effectiveModelId: modelId, userId: access.userId, workspaceId: access.workspaceId,
  })
  if (isByokModelId(modelId)) {
    await assertUserCanUseByokModel(modelId, access.userId, access.workspaceId)
  } else if (!(await resolveAuthorizedModelIds({ entitlements: gate.runtimeEntitlements })).chat.has(modelId)) {
    return notebookRouteResponse(jsonError('The selected model is not allowed by server policy.', 403))
  }
  return notebookRouteValue({ modelId, gate })
}

async function authorizeNotebookTools(
  access: NotebookRouteAccess,
  subject: NotebookAuthorizationSubject,
): Promise<{ searchKnowledge: boolean; memoryEnabled: boolean }> {
  const [memoryGrant, toolsUseGrant] = await Promise.all([
    access.server.authorizationService.checkCapability({ capability: 'memory.use', userId: access.userId }),
    access.server.authorizationService.checkCapability({ capability: 'tools.use', userId: access.userId }),
  ])
  const searchKnowledge = toolsUseGrant.allowed
    && (await access.server.authorizationService.checkResolvedCatalogResourceAccess({
      capability: 'tools.use',
      resourceId: 'search_knowledge',
      resourceType: 'tool',
      subject,
    })).allowed
  return { searchKnowledge, memoryEnabled: memoryGrant.allowed }
}

async function ensureNotebookConversation(input: {
  body: NotebookRequestBody
  access: NotebookRouteAccess
  note: NotebookNoteSnapshot
  modelId: string
  gate: Awaited<ReturnType<typeof actEntitlementService.gateModelAccess>>
}): Promise<NotebookRouteStep<NotebookConversationId>> {
  const conversationId = await ensureActConversationId({
    userId: input.access.userId,
    repository: actConversationRepository,
    conversationClientId: conversationClientId({
      userId: input.access.userId,
      workspaceId: input.access.workspaceId,
      noteId: input.body.noteId,
    }),
    scope: 'personal',
    workspaceId: input.access.workspaceId,
    entitlements: input.gate.runtimeEntitlements,
    title: `Notebook: ${normalizeNotebookTitle(input.note.title ?? '')}`,
    askModelIds: [input.modelId],
    actModelId: input.modelId,
  })
  const conversation = await actConversationRepository.getConversationById({
    conversationId, userId: input.access.userId,
  })
  if (!conversation || conversation.userId !== input.access.userId
    || conversation.workspaceId !== input.access.workspaceId
    || conversation.conversationType && conversation.conversationType !== 'personal') {
    return notebookRouteResponse(jsonError('Notebook conversation access is no longer valid.', 403))
  }
  return notebookRouteValue(conversationId)
}

async function findNotebookRun(input: {
  body: NotebookRequestBody
  access: NotebookRouteAccess
  conversationId: NotebookConversationId
  requestDigest: string
  repository: ConvexHarnessRepository
}): Promise<NotebookRouteStep<{ agentRun: NotebookAgentRun | null; state: NotebookHarnessState }>> {
  const agentRun = (await actConversationRepository.getLatestAgentRun({
    conversationId: input.conversationId,
    turnId: input.body.turnId,
    userId: input.access.userId,
  })) ?? null
  const expectedHarnessRunId = agentRun ? `personal:${agentRun.id}` : null
  if (agentRun?.harnessRunId && agentRun.harnessRunId !== expectedHarnessRunId) {
    return notebookRouteResponse(jsonError('Notebook run is not accessible.', 403))
  }
  const state = expectedHarnessRunId
    ? await input.repository.get({ actorUserId: input.access.userId, runId: expectedHarnessRunId })
    : null
  if (agentRun?.harnessRunId && !state) {
    return notebookRouteResponse(jsonError('Notebook run is not accessible.', 403))
  }
  if (input.body.runId && (!state || input.body.runId !== state.runId)) {
    return notebookRouteResponse(jsonError('Notebook run identity is invalid.', 409))
  }
  if (state) {
    if (!agentRun) return notebookRouteResponse(jsonError('Notebook run is not accessible.', 403))
    assertNotebookIdentity({
      state,
      userId: input.access.userId,
      workspaceId: input.access.workspaceId,
      noteId: input.body.noteId,
      turnId: input.body.turnId,
      conversationId: String(input.conversationId),
      agentRun,
      requestDigest: input.requestDigest,
      runId: input.body.runId,
    })
  }
  return notebookRouteValue({ agentRun, state })
}

async function startNotebookRun(input: {
  request: NextRequest
  context: AppApiRouteContext
  body: NotebookRequestBody
  access: NotebookRouteAccess
  note: NotebookNoteSnapshot
  noteMarkdownSnapshot: string
  noteContentSnapshot: string
  modelId: string
  requestDigest: string
  searchKnowledge: boolean
  memoryEnabled: boolean
  conversationId: NotebookConversationId
  agentRun: NotebookAgentRun | null
  repository: ConvexHarnessRepository
}): Promise<NotebookRouteStep<NonNullable<NotebookHarnessState>>> {
  if (toCanonicalNoteMarkdown(input.body.noteContent) !== input.noteMarkdownSnapshot
    || normalizeNotebookTitle(input.body.noteTitle) !== normalizeNotebookTitle(input.note.title ?? '')) {
    return notebookRouteResponse(jsonError('The note changed before the agent turn started. Save or reload the note, then retry.', 409))
  }
  const gate = await actEntitlementService.gateModelAccess({
    effectiveModelId: input.modelId, userId: input.access.userId, workspaceId: input.access.workspaceId,
  })
  const prompt = `Note content:\n\n${input.noteContentSnapshot || '(empty note)'}\n\n---\n\nUser request: ${input.body.message}`
  const existingUserMessage = (await actConversationRepository.getRecentMessages({
    conversationId: input.conversationId,
    userId: input.access.userId,
    limit: 100,
  })).find(message => message.role === 'user' && message.turnId === input.body.turnId)
  if (existingUserMessage && existingUserMessage.content !== prompt) {
    return notebookRouteResponse(jsonError('This Notebook turn was already started with different content. Start a new turn.', 409))
  }
  const userMessageId = input.agentRun?.userMessageId ?? existingUserMessage?._id
    ?? await actMessagePersistenceService.persistUserMessage({
      conversationId: input.conversationId,
      latestUserContent: prompt,
      latestUserText: prompt,
      modelId: input.modelId,
      skip: false,
      skipMemoryExtraction: true,
      turnId: input.body.turnId,
      userId: input.access.userId,
      mode: 'act',
    })
  if (!userMessageId) return notebookRouteResponse(jsonError('Notebook request could not be persisted.', 500))
  const agentRun = input.agentRun ?? (await agentRunService.startPersonalWorkflow({
    conversationId: input.conversationId,
    modelId: input.modelId,
    turnId: input.body.turnId,
    userId: input.access.userId,
    userMessageId: userMessageId as Id<'conversationMessages'>,
  })) ?? null
  if (!agentRun) return notebookRouteResponse(jsonError('Notebook run could not be created.', 500))

  const mentionsContext = await resolveMentionsContext(input.body.mentions, {
    userId: input.access.userId,
    serverSecret: getInternalApiSecret(),
  })
  const allowedToolIds = [
    ...(input.searchKnowledge ? ['search_knowledge'] : []),
    'read_note', 'propose_edit', 'finish',
  ]
  const definitions = await describeNotebookTools(input.searchKnowledge)
  const toolingContext = {
    baseUrl: getInternalApiBaseUrl(input.request),
    conversationId: String(input.conversationId),
    effectiveModelId: input.modelId,
    entitlements: gate.runtimeEntitlements,
    latestUserText: input.body.message,
    memoryEnabled: input.memoryEnabled,
    paid: gate.paid,
    requestFingerprint: input.context.requestFingerprint,
    requestedToolIds: allowedToolIds,
    turnId: input.body.turnId,
    userId: input.access.userId,
    workspaceId: input.access.workspaceId,
    accountAllowedToolIds: allowedToolIds,
    notebook: {
      kind: 'notebook' as const,
      noteId: input.body.noteId,
      title: input.note.title || 'Untitled',
      content: input.noteContentSnapshot,
      requestDigest: input.requestDigest,
    },
  }
  const workflow = {
    access: {
      actorUserId: input.access.userId,
      runId: `personal:${agentRun.id}`,
      conversationId: String(input.conversationId),
      agentRunId: agentRun.id,
      workspaceId: input.access.workspaceId,
      principalId: input.access.principalId,
      authentication: personalHarnessAuthentication(input.context.auth),
    },
    context: toolingContext,
    definitions,
    instructions: buildNotebookAgentInstructions({
      availableToolIds: allowedToolIds,
      mentionsContext,
      memoryEnabled: input.memoryEnabled,
    }),
    messages: [{ role: 'user' as const, content: prompt }],
    delivery: { emitWebhook: false },
  }
  if (input.request.signal.aborted) {
    return notebookRouteResponse(jsonError('Notebook request was cancelled before admission.', 499))
  }
  await startPersonalHarness({ workflow, agentRun, paid: gate.paid, goal: input.body.message })
  const state = await input.repository.get({ actorUserId: input.access.userId, runId: `personal:${agentRun.id}` })
  if (!state) return notebookRouteResponse(jsonError('Notebook run admission is pending; reconnect with the same turn ID.', 503))
  assertNotebookIdentity({
    state,
    userId: input.access.userId,
    workspaceId: input.access.workspaceId,
    noteId: input.body.noteId,
    turnId: input.body.turnId,
    conversationId: String(input.conversationId),
    agentRun,
    requestDigest: input.requestDigest,
    runId: input.body.runId,
  })
  return notebookRouteValue(state)
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) return jsonError('Invalid Notebook request.', 400)
    const body = parsed.data
    const accessResult = await resolveNotebookRequestAccess(context)
    if (!accessResult.ok) return accessResult.response
    const access = accessResult.value
    const noteResult = await authorizeNotebookNote(body, access)
    if (!noteResult.ok) return noteResult.response
    const { note, subject, noteMarkdownSnapshot, noteContentSnapshot } = noteResult.value
    const modelResult = await authorizeNotebookModel(body, access)
    if (!modelResult.ok) return modelResult.response
    const { modelId, gate } = modelResult.value
    const requestDigest = notebookRequestDigest({
      noteId: body.noteId,
      turnId: body.turnId,
      noteMarkdown: body.noteContent,
      noteTitle: body.noteTitle,
      message: body.message,
      modelId,
      mentions: body.mentions,
    })
    const { searchKnowledge, memoryEnabled } = await authorizeNotebookTools(access, subject)
    const conversationResult = await ensureNotebookConversation({ body, access, note, modelId, gate })
    if (!conversationResult.ok) return conversationResult.response
    const conversationId = conversationResult.value
    const repository = new ConvexHarnessRepository()
    const runResult = await findNotebookRun({ body, access, conversationId, requestDigest, repository })
    if (!runResult.ok) return runResult.response
    let state = runResult.value.state
    if (!state) {
      const startResult = await startNotebookRun({
        request,
        context,
        body,
        access,
        note,
        noteMarkdownSnapshot,
        noteContentSnapshot,
        modelId,
        requestDigest,
        searchKnowledge,
        memoryEnabled,
        conversationId,
        agentRun: runResult.value.agentRun,
        repository,
      })
      if (!startResult.ok) return startResult.response
      state = startResult.value
    }
    if (!state) return jsonError('Notebook run is unavailable.', 404)
    return createNotebookStream({
      runId: state.runId,
      conversationId: String(conversationId),
      turnId: body.turnId,
      actorUserId: access.userId,
      cursor: body.cursor,
      signal: request.signal,
      repository,
    })
  } catch (error) {
    if (error instanceof ActConversationServiceError) return NextResponse.json(error.payload, { status: error.statusCode })
    if (error instanceof PersonalHarnessAdmissionConflict) return jsonError(error.message, 409)
    if (error instanceof PersonalHarnessStartPending) return jsonError(error.message, 503)
    logger.error('[notebook-agent]', summarizeErrorForLog(error))
    return jsonError('Notebook agent could not start.', 500)
  }
}
