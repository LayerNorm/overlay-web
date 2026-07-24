import { describe, expect, it, vi } from 'vitest'
import { AgentTaskSecuritySession } from './agent-task-security-session'

describe('AgentTaskSecuritySession', () => {
  it('uses a non-renderer random task identifier', () => {
    const session = new AgentTaskSecuritySession({
      coordinator: { revokeTask: vi.fn() },
      infrastructure: { cancelTask: vi.fn() }
    })

    expect(session.taskId).toMatch(/^task_[A-Za-z0-9_-]{24}$/)
  })

  it('revokes grants and cleans every provider exactly once', async () => {
    const revokeTask = vi.fn()
    const cancelTask = vi.fn()
    const session = new AgentTaskSecuritySession(
      {
        coordinator: { revokeTask },
        infrastructure: { cancelTask }
      },
      'task_1234567890123456'
    )

    await Promise.all([session.cancel(), session.finish(), session.cancel()])

    expect(revokeTask).toHaveBeenCalledOnce()
    expect(revokeTask).toHaveBeenCalledWith('task_1234567890123456')
    expect(cancelTask).toHaveBeenCalledOnce()
    expect(cancelTask).toHaveBeenCalledWith('task_1234567890123456')
  })

  it('rejects renderer-shaped or path-like identifiers', () => {
    expect(
      () =>
        new AgentTaskSecuritySession(
          {
            coordinator: { revokeTask: vi.fn() },
            infrastructure: { cancelTask: vi.fn() }
          },
          '../renderer-stream'
        )
    ).toThrow('invalid_agent_task_id')
  })
})
