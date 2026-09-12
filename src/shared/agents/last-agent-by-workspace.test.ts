import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearAgentOpened,
  getAgentOpenedAt,
  getLastOpenedAgentId,
  pickAgentToOpen,
  rememberAgentOpened,
  sortAgentsByRecency,
} from './last-agent-by-workspace'

const store = new Map<string, string>()

test.beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value)
        },
        removeItem: (key: string) => {
          store.delete(key)
        },
      },
    },
  })
})

test('remembers the most recently opened agent per workspace', () => {
  rememberAgentOpened('ws-a', 'agent-1', 1000)
  rememberAgentOpened('ws-a', 'agent-2', 2000)
  rememberAgentOpened('ws-b', 'agent-9', 3000)

  assert.equal(getLastOpenedAgentId('ws-a'), 'agent-2')
  assert.equal(getLastOpenedAgentId('ws-b'), 'agent-9')
  assert.equal(getLastOpenedAgentId('ws-unknown'), null)
})

test('reopening an agent makes it most recent again', () => {
  rememberAgentOpened('ws-a', 'agent-1', 1000)
  rememberAgentOpened('ws-a', 'agent-2', 2000)
  rememberAgentOpened('ws-a', 'agent-1', 3000)

  assert.equal(getLastOpenedAgentId('ws-a'), 'agent-1')
})

test('sorts used agents by recency, then unused agents alphabetically', () => {
  const agents = [
    { id: 'c', name: 'Codex' },
    { id: 'h', name: 'Hermes' },
    { id: 'o', name: 'Overlay' },
  ]
  rememberAgentOpened('ws-a', 'o', 1000)
  rememberAgentOpened('ws-a', 'c', 2000)

  assert.deepEqual(
    sortAgentsByRecency(agents, getAgentOpenedAt('ws-a')).map((agent) => agent.id),
    ['c', 'o', 'h'],
  )
})

test('falls back to alphabetical order with no recorded use', () => {
  const agents = [
    { id: 'h', name: 'Hermes' },
    { id: 'o', name: 'Overlay' },
    { id: 'c', name: 'Codex' },
  ]
  assert.deepEqual(
    sortAgentsByRecency(agents, getAgentOpenedAt('ws-a')).map((agent) => agent.id),
    ['c', 'h', 'o'],
  )
})

test('clears a remembered agent when archived', () => {
  rememberAgentOpened('ws-a', 'agent-1', 1000)
  rememberAgentOpened('ws-a', 'agent-2', 2000)
  clearAgentOpened('ws-a', 'agent-1')

  assert.equal(getLastOpenedAgentId('ws-a'), 'agent-2')
  assert.deepEqual(getAgentOpenedAt('ws-a'), { 'agent-2': 2000 })
})

test('ignores invalid stored values instead of crashing', () => {
  store.set('overlay:last-agent-by-workspace', JSON.stringify({ 'ws-a': { ok: 123, bad: 'nope' } }))
  assert.deepEqual(getAgentOpenedAt('ws-a'), { ok: 123 })
  assert.equal(getLastOpenedAgentId('ws-a'), 'ok')
})

test('picks the requested agent, else the most recent, else the roster head', () => {
  const agents = [
    { id: 'c', name: 'Codex' },
    { id: 'h', name: 'Hermes' },
    { id: 'o', name: 'Overlay' },
  ]
  assert.equal(pickAgentToOpen([], 'ws-a', null), undefined)
  assert.equal(pickAgentToOpen(agents, 'ws-a', null)?.id, 'c')
  assert.equal(pickAgentToOpen(agents, 'ws-a', 'h')?.id, 'h')
  assert.equal(pickAgentToOpen(agents, 'ws-a', 'gone')?.id, 'c')
  rememberAgentOpened('ws-a', 'o', 1000)
  rememberAgentOpened('ws-a', 'h', 2000)
  assert.equal(pickAgentToOpen(agents, 'ws-a', null)?.id, 'h')
  assert.equal(pickAgentToOpen(agents, 'ws-a', 'c')?.id, 'c')
})
