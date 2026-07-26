import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCommonActBody,
  buildMediaPromptForModel,
  buildSubmittedComposerSnapshot,
  buildTextTurnPayload,
  getSendValidationError,
  PENDING_FIRST_CHAT_ID,
} from './chat-send-body-builders'

test('builds a stable submitted composer snapshot', () => {
  const snapshot = buildSubmittedComposerSnapshot({
    askModelSelectionMode: 'multiple',
    selectedModels: [
      'moonshotai/kimi-k2.6',
      'z-ai/glm-5.1',
      'qwen/qwen3.6-plus',
      'deepseek/deepseek-v4-flash',
      'minimax/minimax-m2.7',
    ],
    selectedActModel: 'moonshotai/kimi-k2.6',
    activeChatTitle: 'Title',
    selectedImageModels: ['image-a'],
    selectedVideoModels: ['video-a'],
    attachedImages: [{ dataUrl: 'data:image/png;base64,a', mimeType: 'image/png', name: 'a.png' }],
    pendingChatDocuments: [{ clientId: 'doc-1', name: 'a.pdf', fileIds: ['file-1'], status: 'ready' }],
    mentions: [],
    isTemporaryChat: true,
    mode: 'automate',
    selectedToolIds: ['web_search'],
    memoryEnabled: true,
    text: 'hello',
  })

  assert.equal(snapshot.requestMode, 'chat')
  assert.equal(snapshot.hasReadyDocs, true)
  assert.deepEqual(snapshot.textModelsForTurn, [
    'moonshotai/kimi-k2.6',
    'z-ai/glm-5.1',
    'qwen/qwen3.6-plus',
    'deepseek/deepseek-v4-flash',
  ])
  assert.deepEqual(snapshot.selectedToolIdsSnapshot, ['web_search'])
})

test('validates blocked send inputs by status and modality', () => {
  const base = {
    text: '',
    attachedImagesSnapshot: [],
    pendingChatDocumentsSnapshot: [],
    hasReadyDocs: false,
  }

  assert.equal(getSendValidationError(base, null), 'empty')
  assert.equal(getSendValidationError(base, 'image'), 'empty')
  assert.equal(getSendValidationError({ ...base, text: 'draw' }, 'image'), null)
  assert.equal(getSendValidationError({ ...base, hasReadyDocs: true }, null), null)
  assert.equal(
    getSendValidationError({
      ...base,
      pendingChatDocumentsSnapshot: [{ clientId: 'doc', name: 'doc.pdf', fileIds: [], status: 'uploading' }],
    }, null),
    'uploading-documents',
  )
  assert.equal(
    getSendValidationError({
      ...base,
      pendingChatDocumentsSnapshot: [{ clientId: 'doc', name: 'doc.pdf', fileIds: [], status: 'error' }],
    }, null),
    'failed-documents',
  )
})

test('builds text payload with indexed documents, mentions, reply metadata, and files', () => {
  const payload = buildTextTurnPayload({
    text: 'summarize this',
    attachedImages: [{ dataUrl: 'data:image/png;base64,a', mimeType: 'image/png', name: 'chart.png' }],
    pendingChatDocuments: [
      { clientId: 'ready', name: 'report.pdf', fileIds: ['file-a'], status: 'ready' },
      { clientId: 'uploading', name: 'later.pdf', fileIds: [], status: 'uploading' },
    ],
    mentions: [{
      type: 'file',
      id: 'mention-file',
      name: 'Mentioned file',
      meta: { fileIds: ['mentioned-file'] },
    }],
    replyContext: {
      snippet: 'prior answer',
      bodyForModel: 'prior full answer',
      replyToTurnId: 'turn-1',
    },
    turnId: 'turn-2',
  })

  assert.deepEqual(payload.indexedFileNames, ['report.pdf'])
  assert.deepEqual(payload.indexedAttachments, [{ name: 'report.pdf', fileIds: ['file-a'] }])
  assert.equal(payload.partsForModel.length, 2)
  assert.equal(payload.userMeta.replyToTurnId, 'turn-1')
  assert.equal(payload.userMeta.mentions?.[0]?.fileIds?.[0], 'mentioned-file')
  assert.equal(payload.userUIMessage.id, 'turn-2')
})

test('builds pending-first and normal act bodies without null conversation ids', () => {
  const pendingBody = buildCommonActBody({
    chatId: PENDING_FIRST_CHAT_ID,
    pendingConversationClientId: 'client-1',
    temporaryChatSnapshot: false,
    embedProjectId: 'project-1',
    knowledgeBaseId: 'knowledge-1',
    textModelsForTurn: ['model-a'],
    turnId: 'turn-1',
    requestMode: 'automate',
    automationIdParam: 'automation-1',
    indexedFileNames: ['report.pdf'],
    indexedAttachments: [{ name: 'report.pdf', fileIds: ['file-a'] }],
    replyContext: { snippet: 's', bodyForModel: 'body', replyToTurnId: 'turn-0' },
    userMeta: { mentions: [{ type: 'file', id: 'file-a', name: 'Report' }] },
    textHistoryBaseModelId: 'history-model',
    selectedToolIdsSnapshot: ['web_search'],
    memoryEnabledSnapshot: true,
  })

  const pendingRecord = pendingBody as Record<string, unknown>
  assert.equal(pendingRecord.conversationClientId, 'client-1')
  assert.equal(pendingRecord.projectId, 'project-1')
  assert.equal(pendingRecord.knowledgeBaseId, 'knowledge-1')
  assert.equal(pendingRecord.conversationId, undefined)
  assert.equal(pendingRecord.automationId, 'automation-1')
  assert.deepEqual(pendingRecord.askModelIds, ['model-a'])

  const normalBody = buildCommonActBody({
    chatId: 'chat-1',
    pendingConversationClientId: null,
    temporaryChatSnapshot: false,
    embedProjectId: null,
    knowledgeBaseId: undefined,
    textModelsForTurn: ['model-a'],
    turnId: 'turn-1',
    requestMode: 'chat',
    automationIdParam: null,
    indexedFileNames: [],
    indexedAttachments: [],
    replyContext: null,
    userMeta: {},
    selectedToolIdsSnapshot: [],
    memoryEnabledSnapshot: false,
  })
  const normalRecord = normalBody as Record<string, unknown>
  assert.equal(normalRecord.conversationId, 'chat-1')
  assert.equal(normalRecord.conversationClientId, undefined)

  const mentionedKnowledgeBody = buildCommonActBody({
    chatId: 'chat-2',
    pendingConversationClientId: null,
    temporaryChatSnapshot: false,
    embedProjectId: null,
    knowledgeBaseId: undefined,
    textModelsForTurn: ['model-a'],
    turnId: 'turn-2',
    requestMode: 'chat',
    automationIdParam: null,
    indexedFileNames: [],
    indexedAttachments: [],
    replyContext: null,
    userMeta: {
      mentions: [{ type: 'knowledge', id: 'knowledge-mentioned', name: 'Policy library' }],
    },
    selectedToolIdsSnapshot: [],
    memoryEnabledSnapshot: false,
  })
  assert.equal(
    (mentionedKnowledgeBody as Record<string, unknown>).knowledgeBaseId,
    'knowledge-mentioned',
  )
})

test('builds media prompt with reply context only when user text exists', () => {
  const reply = { snippet: 's', bodyForModel: 'prior body', replyToTurnId: 'turn-1' }
  assert.match(buildMediaPromptForModel(reply, 'continue'), /prior body/)
  assert.equal(buildMediaPromptForModel(reply, ''), '')
})
