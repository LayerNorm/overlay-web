import assert from 'node:assert/strict'
import test from 'node:test'
import { startPendingRoomNavigation } from './pending-room-navigation'
import { beginNavigationIntent } from '@/shared/app/navigation-intent'

const href = '/w/team/workspace/chat?view=dms&select=recent'
const rooms = [{ _id: 'first', title: 'First', lastModified: 2 }, { _id: 'remembered', title: 'Second', lastModified: 1 }]
const flush = () => new Promise(resolve => setImmediate(resolve))

test('newer navigation intent suppresses a result even before the URL changes', async () => {
  let finish!: () => void
  startPendingRoomNavigation({ href, storedConversationId: null,
    findRooms: () => new Promise(resolve => { finish = () => resolve(rooms) }),
    currentHref: () => href, replace: () => assert.fail('redirect over newer intent'), onError: () => assert.fail('stale error') })
  beginNavigationIntent('/app/work')
  finish()
  await flush()
})

test('destination restores an authorized recent room with replace, preserving scope and unrelated query/hash', async () => {
  const start = `${href}&filter=unread#message`
  const destinations: string[] = []
  startPendingRoomNavigation({ href: start, storedConversationId: 'remembered',
    findRooms: async () => rooms, currentHref: () => start,
    replace: next => destinations.push(next), onError: () => assert.fail('unexpected failure') })
  await flush()
  assert.deepEqual(destinations, ['/w/team/workspace/chat?view=dms&filter=unread&id=remembered#message'])
})

test('reselecting the same pending destination does not strand its resolver', async () => {
  const destinations: string[] = []
  let finish!: () => void
  startPendingRoomNavigation({ href, storedConversationId: null,
    findRooms: () => new Promise(resolve => { finish = () => resolve(rooms) }),
    currentHref: () => href, replace: next => destinations.push(next), onError: () => assert.fail('unexpected error') })
  beginNavigationIntent('/app/work')
  beginNavigationIntent(href)
  finish()
  await flush()
  assert.deepEqual(destinations, ['/w/team/workspace/chat?view=dms&id=first'])
})

test('late success or failure cannot redirect or notify after navigation or unmount', async () => {
  for (const reject of [false, true]) {
    for (const cancel of [false, true]) {
      let finish!: () => void
      let current = href
      const stop = startPendingRoomNavigation({ href, storedConversationId: 'remembered',
        findRooms: () => new Promise((resolve, fail) => { finish = () => reject ? fail(new Error('failure')) : resolve(rooms) }),
        currentHref: () => current, replace: () => assert.fail('stale redirect'), onError: () => assert.fail('stale notification') })
      if (cancel) stop()
      else current = '/w/other/workspace/chat?view=channels&select=recent'
      finish()
      await flush()
    }
  }
})

test('missing stored room falls back to the live list; failed reads never reuse an unvalidated ID', async () => {
  const destinations: string[] = []
  let errors = 0
  for (const result of [rooms, [], null]) {
    startPendingRoomNavigation({ href, storedConversationId: 'deleted', findRooms: async () => result,
      currentHref: () => href, replace: next => destinations.push(next), onError: () => { errors++ } })
    await flush()
  }
  assert.deepEqual(destinations, [
    '/w/team/workspace/chat?view=dms&id=first', '/w/team/workspace/chat?view=dms', '/w/team/workspace/chat?view=dms',
  ])
  assert.equal(errors, 1)
})
