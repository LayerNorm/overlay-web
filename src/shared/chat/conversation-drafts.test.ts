import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearDraft,
  clearWorkspaceDrafts,
  draftKey,
  readDraft,
  writeDraft,
} from './conversation-drafts'

type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  key(index: number): string | null
  readonly length: number
}

function installStorage(storage: StorageLike | (() => never) | null) {
  const globalWindow = globalThis as { window?: unknown }
  if (storage === null) {
    globalWindow.window = {}
    return
  }
  if (typeof storage === 'function') {
    globalWindow.window = Object.defineProperty({}, 'localStorage', {
      get: storage,
      configurable: true,
    })
    return
  }
  globalWindow.window = { localStorage: storage }
}

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value) },
    removeItem: (key) => { map.delete(key) },
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
}

test('drafts are scoped by workspace, conversation, and thread', () => {
  assert.equal(
    draftKey({ workspaceId: 'w1', conversationId: 'c1' }),
    'overlay.draft.v1:w1:c1:root',
  )
  assert.notEqual(
    draftKey({ workspaceId: 'w1', conversationId: 'c1', threadRootMessageId: 'm1' }),
    draftKey({ workspaceId: 'w1', conversationId: 'c1' }),
  )
  assert.notEqual(
    draftKey({ workspaceId: 'w2', conversationId: 'c1' }),
    draftKey({ workspaceId: 'w1', conversationId: 'c1' }),
  )
})

test('a draft round-trips and is removed when emptied', () => {
  installStorage(memoryStorage())
  const scope = { workspaceId: 'w1', conversationId: 'c1' }
  writeDraft(scope, 'half-written thought')
  assert.equal(readDraft(scope), 'half-written thought')
  clearDraft(scope)
  assert.equal(readDraft(scope), '')
  writeDraft(scope, '   ')
  assert.equal(readDraft(scope), '')
})

test('revoked workspace drafts are dropped without touching other workspaces', () => {
  const storage = memoryStorage()
  installStorage(storage)
  writeDraft({ workspaceId: 'w1', conversationId: 'c1' }, 'one')
  writeDraft({ workspaceId: 'w1', conversationId: 'c2' }, 'two')
  writeDraft({ workspaceId: 'w2', conversationId: 'c3' }, 'keep')
  clearWorkspaceDrafts('w1')
  assert.equal(readDraft({ workspaceId: 'w1', conversationId: 'c1' }), '')
  assert.equal(readDraft({ workspaceId: 'w1', conversationId: 'c2' }), '')
  assert.equal(readDraft({ workspaceId: 'w2', conversationId: 'c3' }), 'keep')
})

test('private browsing cannot crash the composer', () => {
  installStorage(() => { throw new DOMException('denied', 'SecurityError') })
  const scope = { workspaceId: 'w1', conversationId: 'c1' }
  assert.equal(readDraft(scope), '')
  assert.doesNotThrow(() => writeDraft(scope, 'text'))
  assert.doesNotThrow(() => clearWorkspaceDrafts('w1'))
})

test('a full or failing storage loses the draft instead of throwing', () => {
  installStorage({
    ...memoryStorage(),
    setItem: () => { throw new DOMException('quota', 'QuotaExceededError') },
  })
  assert.doesNotThrow(() => writeDraft({ workspaceId: 'w1', conversationId: 'c1' }, 'text'))
})

test('server rendering has no storage and stays silent', () => {
  const globalWindow = globalThis as { window?: unknown }
  delete globalWindow.window
  assert.equal(readDraft({ conversationId: 'c1' }), '')
  assert.doesNotThrow(() => writeDraft({ conversationId: 'c1' }, 'text'))
})
