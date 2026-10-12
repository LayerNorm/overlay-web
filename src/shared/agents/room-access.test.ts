import assert from 'node:assert/strict'
import test from 'node:test'
import { isSharedRoom, roomContextAccess } from './room-access'

test('a chat between one person and an agent is not shared', () => {
  assert.equal(isSharedRoom({ conversationType: 'dm', humanParticipants: 1 }), false)
})

test('more than one person makes any room shared', () => {
  assert.equal(isSharedRoom({ conversationType: 'dm', humanParticipants: 2 }), true)
  assert.equal(isSharedRoom({ conversationType: 'channel', channelVisibility: 'private', humanParticipants: 2 }), true)
})

test('a public channel is shared even with one person in it, and a private one with one person is not', () => {
  assert.equal(isSharedRoom({ conversationType: 'channel', channelVisibility: 'public', humanParticipants: 1 }), true)
  assert.equal(isSharedRoom({ conversationType: 'channel', humanParticipants: 1 }), true)
  assert.equal(isSharedRoom({ conversationType: 'channel', channelVisibility: 'private', humanParticipants: 1 }), false)
})

test('a shared room loads none of the summoner’s private material; an unshared one loads all of it', () => {
  assert.deepEqual(roomContextAccess(true), { personalMemory: false, personalRetrieval: false, personalSkills: false })
  assert.deepEqual(roomContextAccess(false), { personalMemory: true, personalRetrieval: true, personalSkills: true })
})
