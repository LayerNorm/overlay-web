import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { canUseEnvironmentDesktop } from './environment-desktop-access'

test('a personal agent’s machine is its creator’s alone, even against an owner or admin', () => {
  // The directory shows a personal agent only to its creator, so everyone else sees none of the bound agents.
  assert.equal(canUseEnvironmentDesktop({ role: 'member', boundAgents: 1, visibleBoundAgents: 1 }), true)
  assert.equal(canUseEnvironmentDesktop({ role: 'owner', boundAgents: 1, visibleBoundAgents: 0 }), false)
  assert.equal(canUseEnvironmentDesktop({ role: 'admin', boundAgents: 1, visibleBoundAgents: 0 }), false)
})

test('a workspace agent’s machine is open to the workspace’s members, not to guests', () => {
  assert.equal(canUseEnvironmentDesktop({ role: 'member', boundAgents: 1, visibleBoundAgents: 1 }), true)
  assert.equal(canUseEnvironmentDesktop({ role: 'admin', boundAgents: 1, visibleBoundAgents: 1 }), true)
  assert.equal(canUseEnvironmentDesktop({ role: 'guest', boundAgents: 1, visibleBoundAgents: 1 }), false)
})

test('a machine that is not an agent’s falls back to workspace managers', () => {
  assert.equal(canUseEnvironmentDesktop({ role: 'admin', boundAgents: 0, visibleBoundAgents: 0 }), true)
  assert.equal(canUseEnvironmentDesktop({ role: 'member', boundAgents: 0, visibleBoundAgents: 0 }), false)
})
