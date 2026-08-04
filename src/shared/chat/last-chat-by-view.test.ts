import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearLastChatForView,
  getLastChatForView,
  rememberLastChatForView,
} from './last-chat-by-view'

const store = new Map<string, string>()

test.beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value)
        },
      },
    },
  })
})

test('remembers and restores the last chat per workspace and view', () => {
  rememberLastChatForView('ws-a', 'dms', 'dm_1')
  rememberLastChatForView('ws-a', 'channels', 'ch_1')
  rememberLastChatForView('ws-b', 'dms', 'dm_2')

  assert.equal(getLastChatForView('ws-a', 'dms'), 'dm_1')
  assert.equal(getLastChatForView('ws-a', 'channels'), 'ch_1')
  assert.equal(getLastChatForView('ws-b', 'dms'), 'dm_2')
  assert.equal(getLastChatForView('ws-a', 'all'), null)
})

test('ignores non-restorable views like activity', () => {
  rememberLastChatForView('ws-a', 'activity', 'act_1')
  assert.equal(getLastChatForView('ws-a', 'activity'), null)
})

test('clears a remembered chat when deleted', () => {
  rememberLastChatForView('ws-a', 'all', 'chat_1')
  clearLastChatForView('ws-a', 'all', 'chat_1')
  assert.equal(getLastChatForView('ws-a', 'all'), null)
})
