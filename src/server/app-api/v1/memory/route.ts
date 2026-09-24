import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getBillingProgrammaticSubjectId, getTrustedAutomationBillingSubjectId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { MemoryServiceError, type MemoryActor, type MemoryRecord, type MemorySource, type MemoryType } from '@/server/memory'
import { DEDUP_MIN_VEC_SCORE } from '@/shared/knowledge/memory-extraction-shared'
import { memoriesToClientListRows } from '@/shared/knowledge/memory-display-segments'
import { agentIdFromMemoryOwnerId, agentMemoryOwnerId, isAgentMemoryOwnerId } from '@/shared/agents/agent-memory'

/**
 * Resolves who owns the memory this request writes.
 *
 * A memory is normally owned by the authenticated user. An agent turn instead
 * passes the agent's memory owner id so the agent accumulates its own memory
 * rather than writing into the memory of whoever happened to summon it. The id
 * is never trusted as given: it only resolves if it names a live agent in the
 * caller's active workspace, which is also what keeps the row inside a
 * workspace the caller can already see.
 */
async function resolveMemoryOwner(
  context: AppApiRouteContext,
  memoryOwnerId: string | undefined,
): Promise<{ actor?: MemoryActor; userId: string }> {
  const requested = memoryOwnerId?.trim()
  if (!requested || requested === context.auth.userId) return { userId: context.auth.userId }
  const agentId = agentIdFromMemoryOwnerId(requested)
  if (!agentId) throw new MemoryServiceError('Unsupported memory owner', 400)
  const agents = await getOverlayServerContext().workspaceAgentService.list({
    actorUserId: context.auth.userId,
    workspaceId: context.workspace.workspace.id,
  })
  const agent = agents.agents.find((item) => item.id === agentId && !item.archivedAt)
  if (!agent) throw new MemoryServiceError('Unknown agent memory owner', 400)
  return { actor: 'agent', userId: agentMemoryOwnerId(agent.id) }
}

/**
 * The agent owner of a memory, when the memory belongs to an agent.
 *
 * Only searches within the caller's workspace, so this cannot be used to probe
 * for memory ids outside it — an unknown id simply resolves to no owner and the
 * delete falls back to the caller's own memories.
 */
async function findAgentMemoryOwnerId(
  context: AppApiRouteContext,
  memoryId: string,
): Promise<string | undefined> {
  try {
    const rows = await getOverlayServerContext().memoryService.list({
      scope: 'workspace',
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    const owner = rows.find((row) => row._id === memoryId)?.userId
    return isAgentMemoryOwnerId(owner) ? owner : undefined
  } catch (error) {
    logger.warn('[Memory API] agent memory owner lookup failed', { error })
    return undefined
  }
}

function readBooleanParam(value: string | null): boolean | undefined {
  if (value == null) return undefined
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return undefined
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const server = getOverlayServerContext()
    const service = server.memoryService
    const memoryId = request.nextUrl.searchParams.get('memoryId')
    const raw = readBooleanParam(request.nextUrl.searchParams.get('raw')) === true
    const includeDeleted = readBooleanParam(request.nextUrl.searchParams.get('includeDeleted'))
    if (memoryId) {
      const memory = await service.get({
        includeDeleted: raw,
        memoryId,
        userId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
      })
      if (!memory) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(memory)
    }

    const members = (await server.workspaceService.listMembers({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })).filter(({ principal }) => principal.type === 'human' && principal.userId)
    const requestedMemberPrincipalId = request.nextUrl.searchParams.get('memberPrincipalId')?.trim()
    const requestedMember = requestedMemberPrincipalId
      ? members.find(({ principal }) => principal.id === requestedMemberPrincipalId)
      : undefined
    if (requestedMemberPrincipalId && !requestedMember?.principal.userId) {
      return NextResponse.json({ error: 'Workspace member not found' }, { status: 400 })
    }
    const updatedSinceValue = Number(request.nextUrl.searchParams.get('updatedSince'))
    const rows = await service.list({
      conversationId: request.nextUrl.searchParams.get('conversationId') ?? undefined,
      creatorUserId: requestedMember?.principal.userId,
      includeDeleted,
      noteId: request.nextUrl.searchParams.get('noteId') ?? undefined,
      scope: 'workspace',
      updatedSince: Number.isFinite(updatedSinceValue) && updatedSinceValue > 0 ? updatedSinceValue : undefined,
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    // Agent-owned memories are attributed to the agent. Without this they read
    // as written by a "Former member", since no workspace member owns them.
    const agentDirectory = await server.workspaceAgentService.list({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    }).catch((_error) => ({ agents: [] as Array<{ id: string; name: string; principalId: string }> }))
    const attributionsByUserId = new Map<string, { email?: string; name: string; principalId?: string }>([
      ...members.map(({ principal }) => [
        principal.userId!,
        {
          email: principal.email,
          name: principal.displayName,
          principalId: principal.id,
        },
      ] as const),
      ...agentDirectory.agents.map((agent) => [
        agentMemoryOwnerId(agent.id),
        { name: agent.name, principalId: agent.principalId },
      ] as const),
    ])
    return NextResponse.json(raw ? rows : memoriesToClientListRows(rows, {
      attributionsByUserId,
      viewerUserId: context.auth.userId,
    }))
  } catch (error) {
    return memoryErrorResponse('GET', error)
  }
}

type MemoryBody = {
  actor?: MemoryActor
  clientId?: string
  content?: string
  conversationId?: string
  importance?: number
  /** Set by agent turns so the memory belongs to the agent, not the summoner. */
  memoryOwnerId?: string
  memoryId?: string
  messageId?: string
  noteId?: string
  source?: MemorySource | string
  tags?: string[]
  turnId?: string
  type?: MemoryType
}

/**
 * Semantic-duplicate check for tool writes (save_memory / save_memory_batch,
 * which POST with source 'chat'). Vector-searches the owner's memory chunks;
 * a hit in this workspace means the fact is already remembered — return the
 * existing row instead of inserting a near-duplicate.
 */
async function findSemanticDuplicate(
  context: AppApiRouteContext,
  ownerUserId: string,
  content: string,
): Promise<MemoryRecord | null> {
  try {
    const result = await getOverlayServerContext().knowledgeSearchService.hybridSearch({
      accessToken: context.auth.accessToken,
      billing: {
        actorUserId: context.auth.userId,
        idempotencyKey: context.requestIdempotencyKey ?? `memory-dedupe:${context.requestFingerprint}`,
        operationId: 'memory.write-dedupe',
        programmaticSubjectId: getBillingProgrammaticSubjectId(context, getTrustedAutomationBillingSubjectId(context)),
        requestFingerprint: context.requestFingerprint,
      },
      query: content,
      sourceKind: 'memory',
      userId: ownerUserId,
      // No workspaceId — the search stays scoped to the owner's rows; the
      // workspace match is verified on the returned row below.
      kVec: 3,
      kLex: 1,
      m: 3,
      minVecScore: DEDUP_MIN_VEC_SCORE,
    })
    // Only a vector-scored hit counts as a duplicate — a lexical-only chunk
    // shares words without stating the same fact.
    const chunk = result.chunks?.find((c) => (c.vecScore ?? 0) >= DEDUP_MIN_VEC_SCORE)
    if (!chunk?.sourceId) return null
    return await getOverlayServerContext().memoryService.get({
      memoryId: chunk.sourceId,
      userId: ownerUserId,
      workspaceId: context.workspace.workspace.id,
    })
  } catch (error) {
    logger.warn('[Memory API] semantic dedupe check failed; proceeding to save', { error })
    return null
  }
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json() as MemoryBody
    const { memoryOwnerId: _memoryOwnerId, ...memoryBody } = body
    const owner = await resolveMemoryOwner(context, body.memoryOwnerId)
    if ((memoryBody.source ?? 'chat') === 'chat' && memoryBody.content?.trim()) {
      const existing = await findSemanticDuplicate(context, owner.userId, memoryBody.content)
      if (existing) {
        await getOverlayServerContext().memoryService.touch({
          memoryId: existing._id,
          userId: owner.userId,
          workspaceId: context.workspace.workspace.id,
        }).catch((_error) => {
          // Freshness bump is best-effort — the dedupe response already stands.
        })
        return NextResponse.json({
          count: 1,
          deduplicated: true,
          id: existing._id,
          ids: [existing._id],
          memory: existing,
        })
      }
    }
    const result = await getOverlayServerContext().memoryService.create({
      ...memoryBody,
      actor: owner.actor ?? memoryBody.actor,
      content: memoryBody.content ?? '',
      userId: owner.userId,
      workspaceId: context.workspace.workspace.id,
    })
    return NextResponse.json({ id: result.ids[0], ...result })
  } catch (error) {
    return memoryErrorResponse('POST', error)
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json() as MemoryBody
    if (!body.memoryId?.trim()) return NextResponse.json({ error: 'memoryId and content required' }, { status: 400 })
    const { memoryOwnerId: _memoryOwnerId, ...memoryBody } = body
    const owner = await resolveMemoryOwner(context, body.memoryOwnerId)
    const memory = await getOverlayServerContext().memoryService.update({
      ...memoryBody,
      actor: owner.actor ?? memoryBody.actor,
      content: memoryBody.content ?? '',
      memoryId: body.memoryId.trim(),
      source: memoryBody.source as MemorySource | undefined,
      userId: owner.userId,
      workspaceId: context.workspace.workspace.id,
    })
    return NextResponse.json({ memory, success: true })
  } catch (error) {
    return memoryErrorResponse('PATCH', error)
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    let body: MemoryBody = {}
    try {
      body = await request.json() as MemoryBody
    } catch (_error) {
      // Browser sends query params only.
    }
    const memoryId = body.memoryId ?? request.nextUrl.searchParams.get('memoryId') ?? undefined
    if (!memoryId) return NextResponse.json({ error: 'memoryId required' }, { status: 400 })
    const owner = await resolveMemoryOwner(
      context,
      // The sidebar deletes by id alone, so an agent-owned row arrives with no
      // owner attached. Resolve it from the workspace rather than making every
      // caller know who owns what.
      body.memoryOwnerId ?? await findAgentMemoryOwnerId(context, memoryId),
    )
    const result = await getOverlayServerContext().memoryService.remove({
      memoryId,
      userId: owner.userId,
      workspaceId: context.workspace.workspace.id,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return memoryErrorResponse('DELETE', error)
  }
}

function memoryErrorResponse(method: string, error: unknown) {
  logger.error(`[Memory API] ${method} error:`, error)
  if (error instanceof MemoryServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  return NextResponse.json({ error: 'Memory operation failed' }, { status: 500 })
}
