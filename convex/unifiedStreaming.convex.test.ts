import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { readActivePublicStreams } from './lib/publicStreamRead'

const modules = import.meta.glob('./**/*.ts')
const query = (name: string) => makeFunctionReference<'query'>(name)
const mutation = (name: string) => makeFunctionReference<'mutation'>(`harness/runs:${name}`)
const secret = 'unified-streaming-test-secret'
beforeEach(() => vi.stubEnv('INTERNAL_API_SECRET', secret))
afterEach(() => vi.unstubAllEnvs())

async function seedWritableStream(
  convex: ReturnType<typeof convexTest>,
  runId = 'personal:stream-run',
  conversationScope?: 'personal' | 'workspace',
) {
  const now = Date.now()
  const workspaceId = `personal:${runId}:workspace`
  await convex.run(async ctx => {
    await ctx.db.insert('workspaces', {
      workspaceId, kind: 'personal', name: 'Personal', slug: workspaceId, status: 'active',
      personalOwnerUserId: 'owner', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', {
      workspaceId, principalId: `${workspaceId}:principal`, userId: 'owner', type: 'human',
      displayName: 'Owner', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      workspaceId, membershipId: `${workspaceId}:membership`, principalId: `${workspaceId}:principal`,
      role: 'owner', status: 'active', joinedAt: now, updatedAt: now,
    })
  })
  const conversationId = await convex.run(ctx => ctx.db.insert('conversations', {
    userId: 'owner', title: 'Stream test', lastModified: now, createdAt: now, updatedAt: now,
    lastMode: 'act', askModelIds: ['fixture/model'], actModelId: 'fixture/model',
    workspaceId, conversationType: 'personal', ...(conversationScope ? { scope: conversationScope } : {}),
  }))
  const messageIds = await convex.run(async ctx => {
    const base = {
      conversationId, userId: 'owner', turnId: 'turn', mode: 'act' as const,
      contentType: 'text' as const, createdAt: now, updatedAt: now,
    }
    const userMessageId = await ctx.db.insert('conversationMessages', {
      ...base, role: 'user', content: 'Request', status: 'completed',
    })
    const assistantMessageId = await ctx.db.insert('conversationMessages', {
      ...base, role: 'assistant', content: '', status: 'generating',
    })
    const deliveryId = await ctx.db.insert('conversationAgentRuns', {
      conversationId, turnId: 'turn', userId: 'owner', userMessageId, assistantMessageId,
      mode: 'chat', runner: 'workflow', executionEngine: 'overlay_harness', status: 'queued',
      createdAt: now, updatedAt: now,
    })
    return { assistantMessageId, deliveryId }
  })
  const admission = {
    runId, goal: 'Answer the request.', constraints: [],
    policy: {
      actorUserId: 'owner', allowedToolIds: [], requiresPlan: false, deadlineAt: now + 60_000,
      maxCostMicros: 1_000, maxParallelChildren: 1, maxDepth: 1, publicStreamVersion: 1 as const,
      workspaceId,
    },
    source: { conversationId }, deliveryAgentRunId: messageIds.deliveryId,
    serverSecret: secret,
  }
  const admitted = await convex.mutation(mutation('admit'), admission) as { revision: number }
  const workflowRunId = `workflow:${runId}`
  const apply = async (operationId: string, expectedRevision: number, operation: Record<string, unknown>) =>
    await convex.mutation(mutation('apply'), {
      actorUserId: 'owner', runId, workflowRunId, executionGeneration: 0,
      operationId, expectedRevision, operation, serverSecret: secret,
    }) as { snapshot: { revision: number } }
  let result = await apply('claim', admitted.revision, {
    type: 'claim_execution', workflowRunId, generation: 0,
  })
  result = await apply('reserve', result.snapshot.revision, {
    type: 'reserve_model', id: 'model:0', maxCostMicros: 1_000,
  })
  result = await apply('dispatch', result.snapshot.revision, {
    type: 'bind_model_dispatch', id: 'model:0', modelId: 'fixture/model', billingReservationId: 'billing',
  })
  await convex.run(async ctx => {
    await ctx.db.patch(messageIds.deliveryId, { workflowRunId, status: 'running' })
  })
  return {
    actorUserId: 'owner',
    workspaceId,
    assistantMessageId: messageIds.assistantMessageId,
    conversationId,
    deliveryId: messageIds.deliveryId,
    runId,
    workflowRunId,
    serverSecret: secret,
    revision: result.snapshot.revision,
  }
}

function appendArgs(stream: Awaited<ReturnType<typeof seedWritableStream>>, sequence: number, text: string) {
  return {
    actorUserId: stream.actorUserId, runId: stream.runId, workflowRunId: stream.workflowRunId,
    executionGeneration: 0, receiptId: 'model:0', modelId: 'fixture/model', sequence, text,
    serverSecret: stream.serverSecret,
  }
}

test('authorized personal, automation, and room readers see sequenced snapshots; revocation fails closed', async () => {
  const convex = convexTest(schema, modules)
  const ids = await convex.run(async ctx => {
    const now = 1
    await ctx.db.insert('authorizationRoles', {
      roleId: 'member', name: 'Member', capabilities: ['conversations.read'],
      isSystem: true, createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('authorizationUserRoles', { roleId: 'member', userId: 'owner', createdAt: now })
    await ctx.db.insert('workspaces', {
      workspaceId: 'ws', kind: 'organization', name: 'Test', slug: 'test', status: 'active',
      createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', {
      workspaceId: 'ws', principalId: 'p-owner', userId: 'owner', type: 'human',
      displayName: 'Owner', createdAt: now, updatedAt: now,
    })
    const membershipId = await ctx.db.insert('workspaceMemberships', {
      workspaceId: 'ws', principalId: 'p-owner', membershipId: 'm-owner', role: 'owner',
      status: 'active', joinedAt: now, updatedAt: now,
    })
    const conversation = (fields: Record<string, unknown>) => ctx.db.insert('conversations', {
      userId: 'owner', workspaceId: 'ws', title: 'Test', lastModified: now, createdAt: now,
      lastMode: 'act', askModelIds: ['model'], actModelId: 'model', ...fields,
    } as never)
    const personal = await conversation({})
    const automation = await conversation({ isAutomation: true })
    const room = await conversation({ conversationType: 'channel', scope: 'workspace' })
    const addStream = async (conversationId: typeof personal, runId: string, mode: 'chat' | 'room') => {
      const userMessageId = await ctx.db.insert('conversationMessages', {
        conversationId, userId: 'owner', turnId: runId, role: 'user', mode: 'act',
        content: 'Request', contentType: 'text', status: 'completed', createdAt: now, updatedAt: now,
      })
      const assistantMessageId = await ctx.db.insert('conversationMessages', {
        conversationId, userId: 'owner', turnId: runId, role: 'assistant', mode: 'act',
        content: '', contentType: 'text', status: 'generating', createdAt: now, updatedAt: now,
        ...(mode === 'room' ? { authorKind: 'agent' as const, authorPrincipalId: 'p-owner' } : {}),
      })
      const workflowRunId = `workflow:${runId}`
      const deliveryId = await ctx.db.insert('conversationAgentRuns', {
        conversationId, turnId: runId, userId: 'owner', userMessageId, assistantMessageId,
        mode, runner: 'workflow', executionEngine: 'overlay_harness', status: 'running',
        harnessRunId: runId, workflowRunId,
        ...(mode === 'room' ? { agentPrincipalId: 'p-owner' } : {}),
        createdAt: now, updatedAt: now,
      })
      await ctx.db.insert('harnessRuns', {
        runId, actorUserId: 'owner', rootRunId: runId, deliveryAgentRunId: deliveryId,
        activeDescendantCount: 0, sourceJson: JSON.stringify({ conversationId }),
        admissionJson: '{}',
        metadataJson: JSON.stringify({
          runId, rootRunId: runId, status: 'running', workflowRunId, executionGeneration: 2,
          policy: { actorUserId: 'owner', workspaceId: 'ws', publicStreamVersion: 1 },
          modelReservation: { id: 'model:0', dispatch: { modelId: 'model' } },
        }),
        createdAt: now, updatedAt: now,
      })
      await ctx.db.insert('harnessPublicStreams', {
        runId, workflowRunId, executionGeneration: 2, receiptId: 'model:0',
        invocation: 0, conversationId, assistantMessageId, nextSequence: 2, lastSequence: 1,
        lastText: 'Live answer', nextSegmentIndex: 1, visibleCharacters: 11, truncated: false,
        active: true, updatedAt: now,
      })
      await ctx.db.insert('harnessPublicStreamSegments', {
        runId, workflowRunId, executionGeneration: 2, receiptId: 'model:0',
        segmentIndex: 0, firstSequence: 0, lastSequence: 1, text: 'Live answer',
        createdAt: now, updatedAt: now,
      })
      return assistantMessageId
    }
    const personalMessage = await addStream(personal, 'personal:run', 'chat')
    const automationMessage = await addStream(automation, 'automation:run', 'chat')
    const roomMessage = await addStream(room, 'workspace:run', 'room')
    await ctx.db.insert('conversationParticipants', {
      conversationId: room, workspaceId: 'ws', principalId: 'p-owner', principalType: 'human',
      role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now,
    })
    return { personal, automation, room, personalMessage, automationMessage, roomMessage, membershipId }
  })
  const owner = convex.withIdentity({ subject: 'owner' })
  const personalStreams = query('chat/personal:activePublicStreams')
  const roomStreams = query('collaboration/rooms:activePublicStreams')

  await expect(owner.query(personalStreams, {
    workspaceId: 'ws', conversationId: ids.personal, messageIds: [ids.personalMessage],
  })).resolves.toMatchObject([{ text: 'Live answer', executionGeneration: 2, sequence: 1 }])
  await expect(owner.query(personalStreams, {
    workspaceId: 'ws', conversationId: ids.automation, messageIds: [ids.automationMessage],
  })).resolves.toMatchObject([{ text: 'Live answer' }])
  await expect(owner.query(roomStreams, {
    workspaceId: 'ws', conversationId: ids.room, messageIds: [ids.roomMessage],
  })).resolves.toMatchObject([{ text: 'Live answer' }])

  const outsider = convex.withIdentity({ subject: 'outsider' })
  await expect(outsider.query(personalStreams, {
    workspaceId: 'ws', conversationId: ids.personal, messageIds: [ids.personalMessage],
  })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await convex.run(async ctx => {
    await ctx.db.patch(ids.membershipId, { status: 'suspended' })
  })
  await expect(owner.query(personalStreams, {
    workspaceId: 'ws', conversationId: ids.personal, messageIds: [ids.personalMessage],
  })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await expect(owner.query(roomStreams, {
    workspaceId: 'ws', conversationId: ids.room, messageIds: [ids.roomMessage],
  })).resolves.toEqual([])
})

test('append mutations enforce UTF-8 segments, UTF-16 cap, retries, gaps, and canonical settlement', async () => {
  const convex = convexTest(schema, modules)
  const stream = await seedWritableStream(convex)
  const append = mutation('appendPublicStream')
  await expect(convex.mutation(append, appendArgs(stream, 0, 'a'.repeat(8_190))))
    .resolves.toMatchObject({ accepted: true, duplicate: false })
  await expect(convex.mutation(append, appendArgs(stream, 1, '😀z')))
    .resolves.toMatchObject({ accepted: true, duplicate: false })
  await expect(convex.mutation(append, appendArgs(stream, 1, '😀z')))
    .resolves.toMatchObject({ accepted: true, duplicate: true })
  await expect(convex.mutation(append, appendArgs(stream, 1, 'different')))
    .rejects.toThrow('HARNESS_PUBLIC_STREAM_SEQUENCE_CONFLICT')
  await expect(convex.mutation(append, appendArgs(stream, 3, 'gap')))
    .rejects.toThrow('HARNESS_PUBLIC_STREAM_SEQUENCE_GAP')
  for (let sequence = 2; sequence <= 19; sequence++) {
    await convex.mutation(append, appendArgs(stream, sequence, 'a'.repeat(8_192)))
  }
  const finalText = `${'a'.repeat(4_351)}😀`
  await expect(convex.mutation(append, appendArgs(stream, 20, finalText)))
    .resolves.toMatchObject({ accepted: true, truncated: true })
  await expect(convex.mutation(append, { ...appendArgs(stream, 21, 'stale generation'), executionGeneration: 1 }))
    .rejects.toThrow('HARNESS_PUBLIC_STREAM_EXECUTION_NOT_OWNED')
  await expect(convex.mutation(append, appendArgs(stream, 22, 'gap')))
    .rejects.toThrow('HARNESS_PUBLIC_STREAM_SEQUENCE_GAP')

  const rows = await convex.run(async ctx => ({
    segments: await ctx.db.query('harnessPublicStreamSegments')
      .withIndex('by_runId_receiptId_segmentIndex', q => q.eq('runId', stream.runId).eq('receiptId', 'model:0'))
      .order('asc').collect(),
    active: await ctx.db.query('harnessPublicStreams').withIndex('by_runId', q => q.eq('runId', stream.runId)).unique(),
  }))
  expect(rows.segments.map(row => row.segmentIndex)).toEqual(rows.segments.map((_, index) => index))
  expect(rows.segments.every(row => new TextEncoder().encode(row.text).byteLength <= 8_192)).toBe(true)
  expect(rows.segments.map(row => row.text).join('').length).toBe(160_000)
  expect(rows.segments.map(row => row.text).join('').includes('\uFFFD')).toBe(false)
  expect(rows.active?.visibleCharacters).toBe(160_000)
  expect(rows.active?.truncated).toBe(true)

  const settled = await convex.mutation(mutation('apply'), {
    actorUserId: stream.actorUserId, runId: stream.runId, workflowRunId: stream.workflowRunId,
    executionGeneration: 0, operationId: 'receipt', expectedRevision: stream.revision,
    operation: { type: 'record_receipt', receipt: {
      id: 'model:0', modelId: 'fixture/model', provider: 'fixture', inputTokens: 1, outputTokens: 1,
      reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: 32_000,
      costMicros: 1, costSource: 'provider',
    } },
    serverSecret: secret,
  }) as { snapshot: { revision: number } }
  await convex.mutation(mutation('writeTranscriptStep'), {
    actorUserId: stream.actorUserId, runId: stream.runId, workflowRunId: stream.workflowRunId,
    receiptId: 'model:0', stepNumber: 0,
    persistence: { content: 'Canonical text differs.', parts: [] },
    serverSecret: secret,
  })
  const message = await convex.run(ctx => ctx.db.get(stream.assistantMessageId))
  expect(message?.publicStreamCheckpoint).toEqual({
    runId: stream.runId, executionGeneration: 0, receiptId: 'model:0', invocation: 0,
  })
  expect(message?.content).toBe('Canonical text differs.')
  expect(await convex.run(ctx => ctx.db.query('harnessPublicStreams')
    .withIndex('by_runId', q => q.eq('runId', stream.runId)).unique())).toBeNull()
  const read = await convex.query(query('harness/runs:readPublicStreamState'), {
    actorUserId: stream.actorUserId, runId: stream.runId, afterSequence: -1, serverSecret: secret,
  })
  expect(read).toMatchObject({
    snapshot: null,
    transcriptSteps: [{ sequence: 0, receiptId: 'model:0', persistence: { content: 'Canonical text differs.' } }],
  })
  expect(settled.snapshot.revision).toBeGreaterThan(stream.revision)
  await expect(convex.mutation(append, appendArgs(stream, 21, 'after checkpoint')))
    .rejects.toThrow('HARNESS_PUBLIC_STREAM_EXECUTION_NOT_OWNED')

  const unprojected = await seedWritableStream(convex, 'personal:unprojected')
  await convex.mutation(append, appendArgs(unprojected, 0, 'Still live'))
  await convex.run(ctx => ctx.db.patch(unprojected.assistantMessageId, { content: 'Prior live base' }))
  await convex.mutation(mutation('apply'), {
    actorUserId: unprojected.actorUserId, runId: unprojected.runId, workflowRunId: unprojected.workflowRunId,
    executionGeneration: 0, operationId: 'receipt', expectedRevision: unprojected.revision,
    operation: { type: 'record_receipt', receipt: {
      id: 'model:0', modelId: 'fixture/model', provider: 'fixture', inputTokens: 1, outputTokens: 1,
      reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: 32_000,
      costMicros: 1, costSource: 'provider',
    } },
    serverSecret: secret,
  })
  await convex.run(ctx => ctx.db.patch(unprojected.assistantMessageId, { nativeRunId: stream.deliveryId as never }))
  await convex.mutation(mutation('writeTranscriptStep'), {
    actorUserId: unprojected.actorUserId, runId: unprojected.runId, workflowRunId: unprojected.workflowRunId,
    receiptId: 'model:0', stepNumber: 0,
    persistence: { content: 'Must not project.', parts: [] },
    serverSecret: secret,
  })
  const skipped = await convex.run(async ctx => ({
    message: await ctx.db.get(unprojected.assistantMessageId),
    active: await ctx.db.query('harnessPublicStreams').withIndex('by_runId', q => q.eq('runId', unprojected.runId)).unique(),
  }))
  expect(skipped.message?.content).toBe('Prior live base')
  expect(skipped.message?.publicStreamCheckpoint).toBeUndefined()
  expect(skipped.active).not.toBeNull()
})

test('append mutations reject changed owners, revoked conversations, and wrong delivery bindings', async () => {
  const append = mutation('appendPublicStream')
  const ownerChanged = convexTest(schema, modules)
  const ownerStream = await seedWritableStream(ownerChanged, 'personal:owner-changed')
  await ownerChanged.run(async ctx => {
    const run = await ctx.db.query('harnessRuns')
      .withIndex('by_runId', q => q.eq('runId', ownerStream.runId)).unique()
    if (run) await ctx.db.patch(run._id, { actorUserId: 'other' })
  })
  await expect(ownerChanged.mutation(append, appendArgs(ownerStream, 0, 'x')))
    .rejects.toThrow('HARNESS_PUBLIC_STREAM_ACCESS_DENIED')

  const revoked = convexTest(schema, modules)
  const revokedStream = await seedWritableStream(revoked, 'personal:revoked')
  await revoked.run(ctx => ctx.db.patch(revokedStream.conversationId, { deletedAt: Date.now() }))
  await expect(revoked.mutation(append, appendArgs(revokedStream, 0, 'x'))).rejects.toThrow()

  const wrongDelivery = convexTest(schema, modules)
  const deliveryStream = await seedWritableStream(wrongDelivery, 'personal:wrong-delivery')
  await wrongDelivery.run(ctx => ctx.db.patch(deliveryStream.deliveryId, { workflowRunId: 'stale-workflow' }))
  await expect(wrongDelivery.mutation(append, appendArgs(deliveryStream, 0, 'x')))
    .rejects.toThrow('HARNESS_PUBLIC_STREAM_DELIVERY_DENIED')
})

test('personal failure and cancellation retain active text and retire stream rows', async () => {
  const append = mutation('appendPublicStream')
  const failed = convexTest(schema, modules)
  const failureStream = await seedWritableStream(failed, 'personal:failure')
  await failed.mutation(append, appendArgs(failureStream, 0, 'Failure partial'))
  await failed.mutation(makeFunctionReference<'mutation'>('chat/conversations:failAgentRun'), {
    error: { code: 'test_failure', message: 'The run failed.', retryable: false },
    errorText: 'The run failed.', runId: failureStream.deliveryId,
    expectedWorkflowRunId: failureStream.workflowRunId, serverSecret: secret, userId: 'owner',
  })
  const failedMessage = await failed.run(ctx => ctx.db.get(failureStream.assistantMessageId))
  expect(failedMessage?.content).toContain('Failure partial')
  expect(failedMessage?.parts?.some(part => part.type === 'text' && part.text === 'Failure partial')).toBe(true)
  expect(await failed.run(ctx => ctx.db.query('harnessPublicStreams')
    .withIndex('by_runId', q => q.eq('runId', failureStream.runId)).unique())).toBeNull()

  vi.useFakeTimers()
  const cancelled = convexTest(schema, modules)
  const cancelStream = await seedWritableStream(cancelled, 'personal:cancelled')
  await cancelled.mutation(append, appendArgs(cancelStream, 0, 'Stop partial'))
  await cancelled.mutation(makeFunctionReference<'mutation'>('chat/conversations:cancelAgentRuns'), {
    conversationId: cancelStream.conversationId, messageId: cancelStream.assistantMessageId,
    serverSecret: secret, userId: 'owner',
  })
  // The cancel itself leaves the stream rows alone, so it never races the executor's
  // writes, and it makes the executor's next write stale.
  expect(await cancelled.run(ctx => ctx.db.query('harnessPublicStreams')
    .withIndex('by_runId', q => q.eq('runId', cancelStream.runId)).unique())).not.toBeNull()
  await expect(cancelled.mutation(append, appendArgs(cancelStream, 1, ' never shown')))
    .rejects.toThrow('HARNESS_PUBLIC_STREAM_EXECUTION_NOT_OWNED')
  await cancelled.finishAllScheduledFunctions(vi.runAllTimers)
  vi.useRealTimers()
  const cancelledMessage = await cancelled.run(ctx => ctx.db.get(cancelStream.assistantMessageId))
  expect(cancelledMessage?.content).not.toContain('never shown')
  expect(cancelledMessage?.content).toMatch(/Stop partial[\s\S]*interrupted/i)
  expect(cancelledMessage?.content).toContain('Stop partial')
  expect(cancelledMessage?.status).toBe('completed')
  expect(await cancelled.run(ctx => ctx.db.query('harnessPublicStreams')
    .withIndex('by_runId', q => q.eq('runId', cancelStream.runId)).unique())).toBeNull()

})

test('a workspace-scope chat settles its steps into a checkpoint, so live and settled text never show together', async () => {
  const convex = convexTest(schema, modules)
  const stream = await seedWritableStream(convex, 'personal:workspace-scope', 'workspace')
  await convex.mutation(mutation('appendPublicStream'), appendArgs(stream, 0, 'Before the tool.'))
  await convex.mutation(mutation('apply'), {
    actorUserId: stream.actorUserId, runId: stream.runId, workflowRunId: stream.workflowRunId,
    executionGeneration: 0, operationId: 'receipt', expectedRevision: stream.revision,
    operation: { type: 'record_receipt', receipt: {
      id: 'model:0', modelId: 'fixture/model', provider: 'fixture', inputTokens: 1, outputTokens: 1,
      reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: 32_000,
      costMicros: 1, costSource: 'provider',
    } },
    serverSecret: secret,
  })
  await convex.mutation(mutation('writeTranscriptStep'), {
    actorUserId: stream.actorUserId, runId: stream.runId, workflowRunId: stream.workflowRunId,
    receiptId: 'model:0', stepNumber: 0,
    persistence: { content: 'Before the tool.', parts: [] },
    serverSecret: secret,
  })
  const settled = await convex.run(async ctx => ({
    message: await ctx.db.get(stream.assistantMessageId),
    active: await ctx.db.query('harnessPublicStreams').withIndex('by_runId', q => q.eq('runId', stream.runId)).unique(),
  }))
  expect(settled.message?.content).toBe('Before the tool.')
  expect(settled.message?.publicStreamCheckpoint).toEqual({
    runId: stream.runId, executionGeneration: 0, receiptId: 'model:0', invocation: 0,
  })
  expect(settled.message?.nativeProgressSequence).toBe(0)
  expect(settled.active).toBeNull()
})

async function settleStep(
  convex: ReturnType<typeof convexTest>,
  stream: Awaited<ReturnType<typeof seedWritableStream>>,
  sequence: number,
  revision: number,
  persistence: { content: string; parts: Array<Record<string, unknown>>; outputLimitReached?: true },
) {
  const apply = async (operationId: string, expectedRevision: number, operation: Record<string, unknown>) =>
    await convex.mutation(mutation('apply'), {
      actorUserId: stream.actorUserId, runId: stream.runId, workflowRunId: stream.workflowRunId,
      executionGeneration: 0, operationId, expectedRevision, operation, serverSecret: secret,
    }) as { snapshot: { revision: number } }
  const result = await apply(`receipt:${sequence}`, revision, { type: 'record_receipt', receipt: {
    id: `model:${sequence}`, modelId: 'fixture/model', provider: 'fixture', inputTokens: 1,
    outputTokens: persistence.outputLimitReached ? 8_000 : 1,
    reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: 32_000,
    costMicros: 1, costSource: 'provider',
  } })
  await convex.mutation(mutation('writeTranscriptStep'), {
    actorUserId: stream.actorUserId, runId: stream.runId, workflowRunId: stream.workflowRunId,
    receiptId: `model:${sequence}`, stepNumber: 0, persistence, serverSecret: secret,
  })
  return { apply, revision: result.snapshot.revision }
}

test('a call cut off at its output cap continues the same Markdown list, live and saved', async () => {
  const convex = convexTest(schema, modules)
  const stream = await seedWritableStream(convex, 'personal:output-cap')
  const cut = '22. The Thames Barrier.\n23'
  const continued = '. The Tagus estuary barrier.\n24. The Maeslantkering.'
  const settled = await settleStep(convex, stream, 0, stream.revision, {
    content: cut, parts: [{ type: 'text', text: cut }], outputLimitReached: true,
  })
  let revision = (await settled.apply('reserve:1', settled.revision, {
    type: 'reserve_model', id: 'model:1', maxCostMicros: 100,
  })).snapshot.revision
  revision = (await settled.apply('dispatch:1', revision, {
    type: 'bind_model_dispatch', id: 'model:1', modelId: 'fixture/model', billingReservationId: 'billing',
  })).snapshot.revision
  await convex.mutation(mutation('appendPublicStream'), { ...appendArgs(stream, 0, continued), receiptId: 'model:1' })
  const live = await convex.run(ctx => readActivePublicStreams(ctx, stream.conversationId, [stream.assistantMessageId]))
  expect(live).toMatchObject([{ receiptId: 'model:1', text: continued, continuesPrevious: true }])

  await settleStep(convex, stream, 1, revision, { content: continued, parts: [{ type: 'text', text: continued }] })
  const message = await convex.run(ctx => ctx.db.get(stream.assistantMessageId))
  expect(message?.content).toBe(`${cut}${continued}`)
  expect(message?.parts?.filter(part => part.type === 'text').map(part => (part as { text: string }).text))
    .toEqual([`${cut}${continued}`])
})

test('separate calls keep a blank line between their text, and the live reader does not join them', async () => {
  const convex = convexTest(schema, modules)
  const stream = await seedWritableStream(convex, 'personal:separate-calls')
  const settled = await settleStep(convex, stream, 0, stream.revision, {
    content: 'Checking the files.', parts: [{ type: 'text', text: 'Checking the files.' }],
  })
  let revision = (await settled.apply('reserve:1', settled.revision, {
    type: 'reserve_model', id: 'model:1', maxCostMicros: 100,
  })).snapshot.revision
  revision = (await settled.apply('dispatch:1', revision, {
    type: 'bind_model_dispatch', id: 'model:1', modelId: 'fixture/model', billingReservationId: 'billing',
  })).snapshot.revision
  await convex.mutation(mutation('appendPublicStream'), { ...appendArgs(stream, 0, 'Done.'), receiptId: 'model:1' })
  const live = await convex.run(ctx => readActivePublicStreams(ctx, stream.conversationId, [stream.assistantMessageId]))
  expect(live[0]?.continuesPrevious).toBeUndefined()
  await settleStep(convex, stream, 1, revision, { content: 'Done.', parts: [{ type: 'text', text: 'Done.' }] })
  const message = await convex.run(ctx => ctx.db.get(stream.assistantMessageId))
  expect(message?.content).toBe('Checking the files.\n\nDone.')
})
