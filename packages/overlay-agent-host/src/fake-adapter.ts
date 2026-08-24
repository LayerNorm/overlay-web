import { randomUUID } from 'node:crypto'
import type { AgentAdapter, AgentAdapterSession, EmitAgentEvent, StartAdapterSessionInput } from './adapter'

export class FakeAgentAdapter implements AgentAdapter {
  readonly capability = {
    id: 'fake', displayName: 'Deterministic fake agent', protocol: 'fake' as const, version: '1',
    supports: { prompt: true, approval: true, cancel: true, resume: true },
  }

  async discover() { return this.capability }

  async start(input: StartAdapterSessionInput, emit: EmitAgentEvent): Promise<AgentAdapterSession> {
    const remoteSessionId = input.remoteSessionId ?? `fake_${randomUUID()}`
    let stopped = false
    const approvals = new Map<string, string>()
    const runPrompt = async (prompt: string) => {
      if (stopped) throw new Error('fake session is stopped')
      await emit({ type: 'text_checkpoint', payload: { text: `fake: ${prompt}` } })
      if (prompt.includes('[approval]')) {
        await emit({ type: 'approval_requested', payload: { requestKey: 'fake-permission', prompt: 'Allow fake action?', options: [{ id: 'allow_once', label: 'Allow once' }, { id: 'reject', label: 'Reject' }], context: {} } })
        return
      }
      await emit({ type: 'completed', payload: { summary: 'Fake adapter completed', usage: {} } })
    }
    return {
      remoteSessionId,
      prompt: runPrompt,
      approve: async (requestKey, optionId) => {
        approvals.set(requestKey, optionId)
        await emit({ type: 'action', payload: { actionId: requestKey, title: `Approval: ${optionId}`, status: 'completed' } })
        await emit({ type: 'completed', payload: { summary: 'Fake approval resolved', usage: {} } })
      },
      cancel: async (reason) => { stopped = true; await emit({ type: 'cancelled', payload: { ...(reason ? { reason } : {}) } }) },
      resume: async () => { stopped = false; await emit({ type: 'action', payload: { actionId: 'resume', title: 'Session resumed', status: 'completed' } }) },
      stop: async (reason) => { stopped = true; if (reason) approvals.set('stop-reason', reason) },
    }
  }
}
