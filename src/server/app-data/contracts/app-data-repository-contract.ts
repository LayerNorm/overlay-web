import 'server-only'

import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { randomUUID } from 'node:crypto'
import type { AppSettings } from '@/shared/app/app-contracts'
import { AccountDeletionService } from '@/server/account'
import type { AccountDeletionResult } from '@/server/account/AccountDeletionService'
import type { AccountDataDeletionRepository } from '@/server/account/AccountDataDeletionRepository'
import type { AppDataProvider } from '@/server/app-data/capabilities'
import type { OverlayServerContext } from '@/server/bootstrap'
import type { ActConversationRepository } from '@/server/conversations/ActConversationRepository'
import type { ActUsagePolicy } from '@/server/conversations/ActUsagePolicy'
import type { FileRepository } from '@/server/files/FileRepository'
import type { NoteRepository } from '@/server/notes'
import type { ProjectRepository } from '@/server/projects'
import { UserService, type UserAuthProvider } from '@/server/users'
import type { UserRepository } from '@/server/users/types'
import type { DaytonaWorkspaceRepository } from '@/server/ai/sandbox/DaytonaWorkspaceRepository'
import { hashTextContent } from '@/server/storage/text-content-hash'
import type { MemoryRepository } from '@/server/memory'
import type { ChatSuggestionRepository } from '@/server/chat-suggestions/ChatSuggestionRepository'

export interface AppDataRepositoryContractBackend {
  accountDeletionRepository?: AccountDataDeletionRepository
  authProvider: UserAuthProvider
  chatSuggestions: ChatSuggestionRepository
  conversations: ActConversationRepository
  daytonaWorkspaces: DaytonaWorkspaceRepository
  deleteAccount?: (userId: string) => Promise<AccountDeletionResult>
  files: FileRepository
  memories: MemoryRepository
  name: string
  notes: NoteRepository
  provider: AppDataProvider
  projects: ProjectRepository
  usagePolicy: ActUsagePolicy
  users: UserRepository
}

export async function runAppDataRepositoryContractSuite(
  t: TestContext,
  backend: AppDataRepositoryContractBackend,
): Promise<void> {
  const userId = `contract_user_${randomUUID()}`
  const email = `${userId}@example.com`
  const userService = new UserService({
    authProvider: backend.authProvider,
    repository: backend.users,
  })
  let accountDeleted = false
  const foreignUserId = `contract_foreign_${randomUUID()}`
  let foreignUserCreated = false

  try {
    await t.test(`${backend.name}: users upsert identity and initialize defaults`, async () => {
      const first = await userService.upsertFromSession({
        user: {
          id: userId,
          email: email.toUpperCase(),
          firstName: 'Contract',
          lastName: 'User',
          emailVerified: true,
        },
      })
      assert.equal(first.success, true)
      assert.equal(first.userId, userId)

      const second = await userService.upsertFromSession({
        user: {
          id: userId,
          email,
          firstName: 'Contract',
          lastName: 'User',
          emailVerified: true,
        },
      })
      assert.equal(second.success, true)
      assert.equal(second.userId, userId)
      assert.equal(second.isNewUser, false)

      const settings = await backend.conversations.getAppSettings({ userId })
      assertDefaultSettings(settings)
    })

    await t.test(`${backend.name}: daily chat suggestions persist by normalized user identity`, async () => {
      assert.equal(await backend.chatSuggestions.getByUserId(userId), null)
      assert.equal(await backend.chatSuggestions.setForUser({
        day: '2026-07-11',
        prompts: ['One', 'Two', 'Three', 'Four'],
        userId,
      }), true)
      assert.deepEqual(await backend.chatSuggestions.getByUserId(userId), {
        day: '2026-07-11',
        prompts: ['One', 'Two', 'Three', 'Four'],
      })
    })

    await t.test(`${backend.name}: project hierarchy and linked resources enforce ownership`, async () => {
      const foreignUserService = new UserService({
        authProvider: backend.authProvider,
        repository: backend.users,
      })
      const foreignUser = await foreignUserService.upsertFromSession({
        user: {
          id: foreignUserId,
          email: `${foreignUserId}@example.com`,
          firstName: 'Foreign',
          lastName: 'User',
          emailVerified: true,
        },
      })
      assert.equal(foreignUser.success, true)
      foreignUserCreated = true

      const root = await backend.projects.createProject({
        clientId: `project_root_${randomUUID()}`,
        instructions: 'Root instructions',
        name: 'Root project',
        userId,
      })
      const retriedRoot = await backend.projects.createProject({
        clientId: root.clientId,
        instructions: 'Changed retry instructions',
        name: 'Changed retry name',
        parentId: 'stale_retry_parent',
        userId,
      })
      assert.equal(retriedRoot._id, root._id)
      assert.equal(retriedRoot.name, 'Root project')
      assert.equal(retriedRoot.instructions, 'Root instructions')

      const child = await backend.projects.createProject({
        name: 'Child project',
        parentId: root._id,
        userId,
      })
      const grandchild = await backend.projects.createProject({
        name: 'Grandchild project',
        parentId: child._id,
        userId,
      })
      assert.equal((await backend.projects.getProject({
        projectId: child._id,
        userId,
      }))?.parentId, root._id)
      assert.equal(await backend.projects.getProject({
        projectId: root._id,
        userId: foreignUserId,
      }), null)
      await assert.rejects(backend.projects.createProject({
        name: 'Unauthorized child',
        parentId: root._id,
        userId: foreignUserId,
      }))
      await assert.rejects(backend.projects.updateProject({
        parentId: grandchild._id,
        projectId: root._id,
        userId,
      }))

      const conversationId = await backend.conversations.createConversation({
        actModelId: 'openrouter/free',
        askModelIds: ['openrouter/free'],
        lastMode: 'act',
        projectId: child._id,
        title: 'Project conversation',
        userId,
      })
      const note = await backend.notes.createNote({
        content: 'Project note',
        projectId: child._id,
        title: 'Project note',
        userId,
      })
      const fileId = await backend.files.createFile({
        content: 'Project file',
        kind: 'upload',
        name: 'project.txt',
        projectId: child._id,
        type: 'file',
        userId,
      })
      assert.ok(fileId)
      assert.equal((await backend.conversations.listConversationsByProject({
        projectId: child._id,
        userId,
      })).some((conversation) => conversation._id === conversationId), true)
      assert.equal((await backend.notes.listNotes({
        projectId: child._id,
        userId,
      })).some((row) => row._id === note.id), true)
      assert.equal((await backend.files.listFiles({
        projectId: child._id,
        userId,
      }) as Array<{ _id?: string }>).some((row) => row._id === fileId), true)

      const foreignProject = await backend.projects.createProject({
        name: 'Foreign project',
        userId: foreignUserId,
      })
      await assert.rejects(backend.conversations.createConversation({
        actModelId: 'openrouter/free',
        askModelIds: ['openrouter/free'],
        projectId: foreignProject._id,
        title: 'Unauthorized conversation',
        userId,
      }))
      await assert.rejects(backend.notes.createNote({
        content: '',
        projectId: foreignProject._id,
        title: 'Unauthorized note',
        userId,
      }))
      await assert.rejects(backend.files.createFile({
        content: '',
        kind: 'upload',
        name: 'unauthorized.txt',
        projectId: foreignProject._id,
        type: 'file',
        userId,
      }))

      const deletion = await backend.projects.deleteProjectTree({
        projectId: root._id,
        userId,
      })
      assert.ok(deletion)
      assert.deepEqual(new Set(deletion.deletedIds), new Set([
        root._id,
        child._id,
        grandchild._id,
      ]))
      assert.equal(await backend.projects.getProject({ projectId: child._id, userId }), null)
      const deletedProjects = (await backend.projects.listProjects({
        includeDeleted: true,
        userId,
      })).filter((project) => deletion.deletedIds.includes(project._id))
      assert.equal(deletedProjects.length, 3)
      assert.equal(deletedProjects.every((project) => Boolean(project.deletedAt)), true)
      assert.equal((await backend.conversations.listConversationsByProject({
        projectId: child._id,
        userId,
      })).length, 0)
      assert.equal((await backend.conversations.listConversationsByProject({
        includeDeleted: true,
        projectId: child._id,
        userId,
      })).some((conversation) => conversation._id === conversationId), true)
      assert.equal((await backend.notes.listNotes({
        projectId: child._id,
        userId,
      })).length, 0)
      assert.equal((await backend.notes.listNotes({
        includeDeleted: true,
        projectId: child._id,
        userId,
      })).some((row) => row._id === note.id), true)
      assert.equal((await backend.files.listFiles({
        projectId: child._id,
        userId,
      }) as unknown[]).length, 0)
      assert.equal((await backend.files.listFiles({
        includeDeleted: true,
        projectId: child._id,
        userId,
      }) as Array<{ _id?: string }>).some((row) => row._id === fileId), true)
    })

    await t.test(`${backend.name}: conversations, messages, and deltas preserve chat behavior`, async () => {
      const eventCursor = await backend.conversations.getConversationEventCursor({ userId })
      const clientId = `conversation_${randomUUID()}`
      const conversationId = await backend.conversations.createConversation({
        userId,
        clientId,
        title: 'Contract conversation',
        askModelIds: ['openrouter/free'],
        actModelId: 'openrouter/free',
        lastMode: 'act',
      })
      const repeatedConversationId = await backend.conversations.createConversation({
        userId,
        clientId,
        title: 'Contract conversation duplicate call',
        askModelIds: ['openrouter/free'],
        actModelId: 'openrouter/free',
        lastMode: 'act',
      })
      assert.equal(repeatedConversationId, conversationId)

      await backend.conversations.addMessage({
        conversationId,
        userId,
        turnId: 'turn_1',
        role: 'user',
        mode: 'act',
        content: 'hello contract',
        contentType: 'text',
        parts: [{ type: 'text', text: 'hello contract' }],
        modelId: 'openrouter/free',
        skipMemoryExtraction: true,
      })

      const assistantMessageId = await backend.conversations.startGeneratingMessage({
        conversationId,
        userId,
        turnId: 'turn_1',
        mode: 'act',
        modelId: 'openrouter/free',
      })
      assert.ok(assistantMessageId)
      await backend.conversations.appendGeneratingMessageDelta({
        messageId: assistantMessageId,
        textDelta: 'hello',
        newParts: [{ type: 'text', text: 'hello' }],
      })
      await backend.conversations.finalizeGeneratingMessage({
        messageId: assistantMessageId,
        content: 'hello back',
        parts: [{ type: 'text', text: 'hello back' }],
        tokens: { input: 1, output: 2 },
        routedModelId: 'openrouter/free',
      })

      const messages = await backend.conversations.getConversationMessages({
        conversationId,
        userId,
      })
      assert.equal(messages.length, 2)
      assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant'])
      assert.equal(messages[0]?.content, 'hello contract')
      assert.equal(messages[1]?.content, 'hello back')
      assert.equal(messages[1]?.status, 'completed')

      const publicShare = await backend.conversations.setShare({
        conversationId,
        userId,
        visibility: 'public',
      })
      assert.equal(publicShare?.visibility, 'public')
      assert.equal(typeof publicShare?.token, 'string')
      const shared = await backend.conversations.getPublicConversationByToken({
        token: publicShare!.token!,
      })
      assert.equal(shared?._id, conversationId)
      assert.equal(shared?.messages.length, 2)
      const privateShare = await backend.conversations.setShare({
        conversationId,
        userId,
        visibility: 'private',
      })
      assert.deepEqual(privateShare, { visibility: 'private', token: null })
      assert.equal(await backend.conversations.getPublicConversationByToken({
        token: publicShare!.token!,
      }), null)

      const interruptedMessageId = await backend.conversations.startGeneratingMessage({
        conversationId,
        userId,
        turnId: 'turn_interrupted',
        mode: 'act',
        modelId: 'openrouter/free',
      })
      assert.ok(interruptedMessageId)
      await backend.conversations.appendGeneratingMessageDelta({
        messageId: interruptedMessageId,
        textDelta: 'partial response',
      })
      const stopped = await backend.conversations.stopGeneratingMessages({
        conversationId,
        messageId: interruptedMessageId,
        userId,
      })
      assert.equal(stopped.stoppedCount, 1)
      await backend.conversations.finalizeGeneratingMessage({
        messageId: interruptedMessageId,
        content: 'late completion must not overwrite stop',
        parts: [{ type: 'text', text: 'late completion must not overwrite stop' }],
        tokens: { input: 1, output: 1 },
      })
      const afterStop = await backend.conversations.getConversationMessages({
        conversationId,
        userId,
      })
      const interrupted = afterStop.find((message) => message._id === interruptedMessageId)
      assert.equal(interrupted?.status, 'completed')
      assert.match(interrupted?.content ?? '', /Interrupted by user/)

      await backend.conversations.addMessage({
        conversationId,
        userId,
        turnId: 'turn_delete',
        role: 'user',
        mode: 'act',
        content: 'delete this turn',
        contentType: 'text',
        modelId: 'openrouter/free',
      })
      const deletedTurn = await backend.conversations.deleteTurn({
        conversationId,
        turnId: 'turn_delete',
        userId,
      })
      assert.equal(deletedTurn.deletedMessages, 1)
      assert.equal((await backend.conversations.getConversationMessages({
        conversationId,
        userId,
      })).some((message) => message.turnId === 'turn_delete'), false)

      if (backend.provider === 'postgres') {
        const events = await backend.conversations.listConversationEvents({
          afterSequence: eventCursor,
          limit: 200,
          userId,
        })
        assert.equal(events.length > 0, true)
        assert.deepEqual(
          events.map((event) => event.sequence),
          [...events.map((event) => event.sequence)].sort((a, b) => a - b),
        )
        assert.equal(events.some((event) => event.type === 'message.delta'), true)
        assert.equal(events.some((event) => event.type === 'message.stopped'), true)
        assert.equal(events.some((event) => event.type === 'conversation.shared'), true)
        assert.equal(events.some((event) => event.type === 'message.deleted'), true)

        const liveCursor = await backend.conversations.getConversationEventCursor({ userId })
        const waitingForEvents = backend.conversations.waitForConversationEvents({
          afterSequence: liveCursor,
          limit: 20,
          timeoutMs: 2_000,
          userId,
        })
        await backend.conversations.updateConversation({
          conversationId,
          userId,
          title: 'Realtime contract update',
        })
        const notifiedEvents = await waitingForEvents
        assert.equal(notifiedEvents.some((event) => (
          event.conversationId === conversationId && event.type === 'conversation.updated'
        )), true)
      }

      await backend.conversations.updateConversation({
        conversationId,
        userId,
        title: 'Renamed contract conversation',
        lastMode: 'ask',
        askModelIds: ['openrouter/free'],
      })
      const updated = await backend.conversations.getConversationById({
        conversationId,
        userId,
      })
      assert.equal(updated?.title, 'Renamed contract conversation')
      assert.equal(updated?.lastMode, 'ask')

      await backend.conversations.upsertContextSummary({
        conversationId,
        userId,
        scope: 'contract',
        summary: 'contract summary',
        summarizedThroughMessageId: assistantMessageId,
        summarizedThroughCreatedAt: Date.now(),
        sourceMessageCount: 2,
        sourceEstimatedTokens: 5,
        summaryEstimatedTokens: 2,
        contextWindow: 8192,
        targetModelId: 'openrouter/free',
        summarizerModelId: 'openrouter/free',
      })
      const summary = await backend.conversations.getContextSummary({
        conversationId,
        userId,
        scope: 'contract',
      })
      assert.equal(summary?.summary, 'contract summary')

      await backend.conversations.deleteConversation({ conversationId, userId })
      const active = await backend.conversations.listConversations({ userId })
      assert.equal(active.some((conversation) => conversation._id === conversationId), false)
      const withDeleted = await backend.conversations.listConversations({ userId, includeDeleted: true })
      assert.equal(withDeleted.some((conversation) => conversation._id === conversationId), true)
    })

    await t.test(`${backend.name}: notes expose provider-neutral CRUD behavior`, async () => {
      const created = await backend.notes.createNote({
        userId,
        title: 'Contract note',
        content: '<p>note body</p>',
        tags: ['contract'],
        clientId: `note_${randomUUID()}`,
      })
      assert.ok(created.id)
      assert.equal(created.note?.name, 'Contract note')
      assert.equal(created.note?.textContent ?? created.note?.content, '<p>note body</p>')

      const listed = await backend.notes.listNotes({ userId })
      assert.equal(listed.some((note) => note._id === created.id), true)

      const updated = await backend.notes.updateNote({
        noteId: created.id,
        userId,
        title: 'Updated contract note',
        content: '<p>updated note body</p>',
        tags: ['contract', 'updated'],
      })
      assert.equal(updated?.name, 'Updated contract note')
      assert.equal(updated?.textContent ?? updated?.content, '<p>updated note body</p>')

      const deleted = await backend.notes.deleteNote({ noteId: created.id, userId })
      assert.equal(deleted?.noteId, created.id)
      const afterDelete = await backend.notes.getNote({ noteId: created.id, userId })
      assert.equal(afterDelete, null)
    })

    await t.test(`${backend.name}: files preserve duplicate, subtree, upload intent, and share behavior`, async () => {
      const duplicateContent = 'same contract file body'
      const contentHash = hashTextContent(duplicateContent)
      const canonicalId = await backend.files.createFile({
        userId,
        name: 'canonical.txt',
        type: 'file',
        kind: 'upload',
        content: duplicateContent,
        textContent: duplicateContent,
        contentHash,
      })
      assert.ok(canonicalId)
      const duplicateId = await backend.files.createFile({
        userId,
        name: 'duplicate.txt',
        type: 'file',
        kind: 'upload',
        content: duplicateContent,
        textContent: duplicateContent,
        contentHash,
      })
      assert.ok(duplicateId)
      const secondDuplicateId = await backend.files.createFile({
        userId,
        name: 'duplicate-2.txt',
        type: 'file',
        kind: 'upload',
        content: duplicateContent,
        textContent: duplicateContent,
        contentHash,
      })
      assert.ok(secondDuplicateId)

      const duplicate = await backend.files.getFile({ fileId: duplicateId, userId })
      assert.equal(duplicate?.duplicateOfFileId, canonicalId)

      const publicShare = await backend.files.setShare({
        fileId: duplicateId,
        userId,
        visibility: 'public',
      })
      assert.equal(publicShare?.visibility, 'public')
      assert.equal(typeof publicShare?.token, 'string')
      const privateShare = await backend.files.setShare({
        fileId: duplicateId,
        userId,
        visibility: 'private',
      })
      assert.deepEqual(privateShare, { visibility: 'private', token: null })

      await backend.files.removeFile({ fileId: canonicalId, userId })
      const remainingDuplicates = await Promise.all([
        backend.files.getFile({ fileId: duplicateId, userId }),
        backend.files.getFile({ fileId: secondDuplicateId, userId }),
      ])
      const promotedDuplicate = remainingDuplicates.find((file) => !file?.duplicateOfFileId)
      const linkedDuplicate = remainingDuplicates.find((file) => Boolean(file?.duplicateOfFileId))
      assert.ok(promotedDuplicate)
      assert.equal(linkedDuplicate?.duplicateOfFileId, promotedDuplicate._id)

      const folderId = await backend.files.createFile({
        userId,
        name: 'Contract folder',
        type: 'folder',
        kind: 'folder',
      })
      assert.ok(folderId)
      const nestedFolderId = await backend.files.createFile({
        userId,
        name: 'Nested folder',
        type: 'folder',
        kind: 'folder',
        parentId: folderId,
      })
      assert.ok(nestedFolderId)
      await assert.rejects(backend.files.updateFile({
        fileId: folderId,
        parentId: nestedFolderId,
        userId,
      }))
      const childR2Key = `users/${userId}/files/${randomUUID()}/child.txt`
      await backend.files.createUploadIntent({
        userId,
        r2Key: childR2Key,
        declaredSizeBytes: 12,
        mimeType: 'text/plain',
        expiresAt: Date.now() + 60_000,
      })
      const childId = await backend.files.createFileWithStorage({
        userId,
        name: 'child.txt',
        parentId: folderId,
        r2Key: childR2Key,
        sizeBytes: 12,
        mimeType: 'text/plain',
      })
      assert.ok(childId)
      const subtreeKeys = await backend.files.getR2KeysForSubtree({ fileId: folderId, userId })
      assert.equal(subtreeKeys.some((entry) => entry.fileId === childId && entry.r2Key === childR2Key), true)
      await backend.files.removeFile({
        fileId: folderId,
        userId,
        r2CleanupConfirmed: true,
      })
      assert.equal(await backend.files.getFile({ fileId: childId, userId }), null)

      const extractedR2Key = `users/${userId}/files/${randomUUID()}/document.pdf`
      const extractedIds = await backend.files.createExtractedDocument({
        mimeType: 'application/pdf',
        parts: [
          { name: 'document.pdf', content: 'first section', contentHash: hashTextContent('first section') },
          { name: 'document.part-2.pdf', content: 'second section', contentHash: hashTextContent('second section') },
        ],
        r2Key: extractedR2Key,
        sourceSizeBytes: 128,
        userId,
      })
      assert.equal(extractedIds.length, 2)
      const extractedFirst = await backend.files.getFile({ fileId: extractedIds[0]!, userId })
      assert.equal(extractedFirst?.r2Key, extractedR2Key)
      assert.equal(extractedFirst?.textContent ?? extractedFirst?.content, 'first section')

      const intentR2Key = `users/${userId}/files/${randomUUID()}/upload.txt`
      await backend.files.createUploadIntent({
        userId,
        r2Key: intentR2Key,
        declaredSizeBytes: 32,
        mimeType: 'text/plain',
        expiresAt: Date.now() + 60_000,
      })
      await assert.rejects(backend.files.createUploadIntent({
        userId,
        r2Key: intentR2Key,
        declaredSizeBytes: 32,
        mimeType: 'text/plain',
        expiresAt: Date.now() + 60_000,
      }))
      const intent = await backend.files.getUploadIntent({
        userId,
        r2Key: intentR2Key,
        now: Date.now(),
      })
      assert.equal(intent?.declaredSizeBytes, 32)
      assert.equal(intent?.mimeType, 'text/plain')
      assert.ok(intent?._id)
      await backend.files.expireUploadIntent({
        userId,
        intentId: intent._id,
        now: Date.now(),
      })
      assert.equal(await backend.files.getUploadIntent({
        userId,
        r2Key: intentR2Key,
        now: Date.now(),
      }), null)
    })

    await t.test(`${backend.name}: outputs preserve lifecycle, ownership, sharing, and deletion`, async () => {
      const outputId = await backend.files.createFile({
        userId,
        name: 'generated.png',
        type: 'file',
        kind: 'output',
        prompt: 'draw a contract test',
        modelId: 'contract/image',
        outputType: 'image',
        outputSource: 'image_generation',
        outputStatus: 'pending',
        expiresAt: Date.now() + 60_000,
      })
      assert.ok(outputId)
      const outputR2Key = `users/${userId}/outputs/${outputId}/generated.png`
      await backend.files.updateFile({
        fileId: outputId,
        userId,
        r2Key: outputR2Key,
        mimeType: 'image/png',
        sizeBytes: 64,
        outputStatus: 'completed',
        outputCompletedAt: Date.now(),
        outputMetadata: { contract: true },
      })
      const output = await backend.files.getFile({ fileId: outputId, userId })
      assert.equal(output?.kind, 'output')
      assert.equal(output?.outputStatus, 'completed')
      assert.equal(output?.outputSource, 'image_generation')
      assert.equal(output?.r2Key, outputR2Key)
      assert.deepEqual(output?.outputMetadata, { contract: true })
      assert.equal(await backend.files.getFile({ fileId: outputId, userId: foreignUserId }), null)

      const shared = await backend.files.setShare({
        fileId: outputId,
        userId,
        visibility: 'public',
      })
      assert.equal(shared?.visibility, 'public')
      assert.ok(shared?.token)
      await backend.files.removeFile({ fileId: outputId, userId })
      assert.equal(await backend.files.getFile({ fileId: outputId, userId }), null)
    })

    await t.test(`${backend.name}: Daytona workspace checkpoints are provider-neutral`, async () => {
      const now = Date.now()
      const workspace = await backend.daytonaWorkspaces.upsert({
        userId,
        sandboxId: `sandbox_${randomUUID()}`,
        sandboxName: 'contract-sandbox',
        volumeId: `volume_${randomUUID()}`,
        volumeName: 'contract-volume',
        tier: 'pro',
        state: 'stopped',
        resourceProfile: 'pro',
        mountPath: '/home/daytona/workspace',
        lastMeteredAt: now,
      })
      assert.equal(workspace.userId, userId)
      assert.equal(workspace.state, 'stopped')
      assert.equal((await backend.daytonaWorkspaces.getByUserId({ userId }))?.sandboxId, workspace.sandboxId)
      assert.equal(await backend.daytonaWorkspaces.getByUserId({ userId: foreignUserId }), null)
    })

    await t.test(`${backend.name}: usage policy has explicit reservation/accounting behavior`, async () => {
      const entitlements = await backend.usagePolicy.getEntitlements({ userId })
      assert.ok(entitlements)
      const reservation = await backend.usagePolicy.reserveForAttempt({
        entitlements,
        estimatedInputTokens: 100,
        maxOutputTokens: 100,
        modelId: 'openrouter/free',
        operationId: 'contract.free-model',
        paid: false,
        requestFingerprint: `${backend.name}:free-model`,
        userId,
      })
      assert.deepEqual(reservation, { ok: true, reservationId: null })
      const finished = await backend.usagePolicy.recordFinishedUsage({
        forceFreeTierLimits: false,
        inputTokens: 0,
        modelId: 'openrouter/free',
        outputTokens: 0,
        reservationId: null,
        userId,
      })
      assert.deepEqual(finished, { finalized: false, reservationId: null })
    })

    await t.test(`${backend.name}: memories preserve provider-neutral CRUD and user isolation`, async () => {
      const created = await backend.memories.create({
        clientId: `contract-memory-${randomUUID()}`,
        content: 'The contract deployment keeps its knowledge private.',
        source: 'manual',
        tags: ['contract'],
        userId,
      })
      assert.equal((await backend.memories.get({ memoryId: created._id, userId }))?.content, created.content)
      assert.equal(await backend.memories.get({ memoryId: created._id, userId: foreignUserId }), null)
      const updated = await backend.memories.update({
        content: 'The contract deployment keeps its knowledge private and scoped.',
        memoryId: created._id,
        source: 'manual',
        tags: ['contract', 'scope'],
        userId,
      })
      assert.deepEqual(updated?.tags, ['contract', 'scope'])
      assert.equal((await backend.memories.list({ userId })).length >= 1, true)
    })

    await t.test(`${backend.name}: account deletion removes repository-owned data`, async () => {
      const result = await deleteAccount(backend, userId)
      accountDeleted = true
      assert.equal(result.deletedRowCount > 0, true)

      const conversations = await backend.conversations.listConversations({
        userId,
        includeDeleted: true,
      })
      assert.equal(conversations.length, 0)
      assert.equal((await backend.notes.listNotes({ userId, includeDeleted: true })).length, 0)
      assert.equal((await backend.files.listFiles({ userId, includeDeleted: true })).length, 0)
      assert.equal((await backend.memories.list({ userId, includeDeleted: true })).length, 0)

      if (result.verification) {
        assert.equal(result.verification.orphanedRowCount, 0)
        assert.equal(result.verification.remainingRowsByTable.users, 0)
      }
    })
  } finally {
    if (foreignUserCreated) {
      await deleteAccount(backend, foreignUserId).catch((_error) => {})
    }
    if (!accountDeleted) {
      await deleteAccount(backend, userId).catch((_error) => {})
    }
  }
}

async function deleteAccount(
  backend: AppDataRepositoryContractBackend,
  userId: string,
): Promise<AccountDeletionResult> {
  if (backend.deleteAccount) {
    return await backend.deleteAccount(userId)
  }
  if (!backend.accountDeletionRepository) {
    throw new Error(`${backend.name} did not provide an account deletion adapter`)
  }
  return await new AccountDeletionService({
    appDataCapabilities: {
      provider: backend.provider,
    },
    appData: {
      repositories: {
        accountDeletion: backend.accountDeletionRepository,
        providerConnections: {
          listCredentialRefs: async () => [],
        },
      },
    },
    auth: {
      deleteUser: async () => {},
    },
    objectStore: {
      deleteObject: async () => {},
    },
  } as unknown as OverlayServerContext).deleteAccount({ userId })
}

function assertDefaultSettings(settings: AppSettings | null): void {
  assert.ok(settings)
  assert.equal(settings.theme, 'light')
  assert.equal(settings.defaultChatMode, 'act')
  assert.equal(settings.chatStreamingMode, 'token')
  assert.equal(settings.sendWithEnter, true)
}
