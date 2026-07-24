import { describe, expect, it } from 'vitest'
import { AgentApprovalStore } from './approval-store'

const binding = {
  taskId: 'task_1234567890123456',
  principalId: 'user_123',
  serverDeploymentId: 'deployment_123'
}

describe('AgentApprovalStore', () => {
  it('binds approval to canonical arguments independent of object key order', () => {
    const store = new AgentApprovalStore()
    const request = store.create(
      binding,
      'terminal_run',
      { argv: ['status', '--short'], executable: 'git' },
      { now: 1_000, ttlMs: 30_000 }
    )
    expect(request.display).toEqual({
      argv: ['status', '--short'],
      executable: 'git'
    })
    expect(store.approve(request.id, 2_000)).toBe(true)
    expect(
      store.consume(
        request.id,
        binding,
        'terminal_run',
        { executable: 'git', argv: ['status', '--short'] },
        3_000
      )
    ).toBe(true)
  })

  it('rejects argument, task, principal, deployment, and tool substitution', () => {
    for (const mutation of [
      {
        context: binding,
        tool: 'terminal_run',
        args: { executable: 'git', argv: ['push'] }
      },
      {
        context: { ...binding, taskId: 'task_9999999999999999' },
        tool: 'terminal_run',
        args: { executable: 'git', argv: ['status'] }
      },
      {
        context: { ...binding, principalId: 'user_attacker' },
        tool: 'terminal_run',
        args: { executable: 'git', argv: ['status'] }
      },
      {
        context: { ...binding, serverDeploymentId: 'other' },
        tool: 'terminal_run',
        args: { executable: 'git', argv: ['status'] }
      },
      {
        context: binding,
        tool: 'script_run',
        args: { executable: 'git', argv: ['status'] }
      }
    ]) {
      const store = new AgentApprovalStore()
      const request = store.create(
        binding,
        'terminal_run',
        { executable: 'git', argv: ['status'] },
        { now: 1_000, ttlMs: 30_000 }
      )
      expect(store.approve(request.id, 2_000)).toBe(true)
      expect(store.consume(request.id, mutation.context, mutation.tool, mutation.args, 3_000)).toBe(
        false
      )
    }
  })

  it('is one-time, expiring, revocable, and capped to a ten-minute TTL', () => {
    const store = new AgentApprovalStore()
    const request = store.create(
      binding,
      'terminal_run',
      { executable: 'git', argv: ['status'] },
      { now: 1_000, ttlMs: 60 * 60_000 }
    )
    expect(request.expiresAt).toBe(601_000)
    expect(store.approve(request.id, 2_000)).toBe(true)
    expect(
      store.consume(
        request.id,
        binding,
        'terminal_run',
        { executable: 'git', argv: ['status'] },
        3_000
      )
    ).toBe(true)
    expect(
      store.consume(
        request.id,
        binding,
        'terminal_run',
        { executable: 'git', argv: ['status'] },
        4_000
      )
    ).toBe(false)

    const expired = store.create(
      binding,
      'terminal_run',
      { executable: 'git', argv: ['status'] },
      { now: 10_000, ttlMs: 1_000 }
    )
    expect(store.approve(expired.id, 11_000)).toBe(false)

    const revoked = store.create(
      binding,
      'terminal_run',
      { executable: 'git', argv: ['status'] },
      { now: 20_000, ttlMs: 5_000 }
    )
    expect(store.revoke(revoked.id)).toBe(true)
    expect(store.approve(revoked.id, 21_000)).toBe(false)
  })

  it('rejects noncanonical, cyclic, oversized, and excessively deep actions', () => {
    const store = new AgentApprovalStore()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => store.create(binding, 'terminal_run', cyclic)).toThrow('approval_action_cycle')
    expect(() => store.create(binding, 'terminal_run', { value: Number.NaN })).toThrow(
      'approval_action_invalid_number'
    )
    expect(() => store.create(binding, 'terminal_run', { value: 'x'.repeat(70 * 1024) })).toThrow(
      'approval_action_too_large'
    )

    let deep: Record<string, unknown> = {}
    const root = deep
    for (let index = 0; index < 24; index += 1) {
      const next: Record<string, unknown> = {}
      deep.next = next
      deep = next
    }
    expect(() => store.create(binding, 'terminal_run', root)).toThrow('approval_action_too_deep')
  })
})
