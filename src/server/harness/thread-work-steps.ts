import 'server-only'

import type { NativeHarnessAccess, NativeHarnessContext } from './native-access'

/**
 * Workflow steps around an agent thread's run (internal/develop/thread-folders.md): copy the chosen folders onto
 * the computer before the model starts, and save changes back after the reply is delivered.
 */

const threadRun = (access: NativeHarnessAccess) => ({
  actorUserId: access.actorUserId, workspaceId: access.workspaceId, agentId: access.agentId,
  conversationId: access.conversationId, agentRunId: access.agentRunId, messageId: access.assistantMessageId,
})

/** Returns a note for the agent about what was copied, or an empty string. Never fails the run. */
export async function prepareThreadWorkStep(access: NativeHarnessAccess, context: NativeHarnessContext): Promise<string> {
  'use step'
  if (!context.work) return ''
  const { prepareThreadWork } = await import('@/server/agents/thread-work/thread-work-service')
  return await prepareThreadWork({ run: threadRun(access), work: context.work, agentName: context.agentName ?? 'Agent' })
    .catch((error: unknown) => `Folder setup failed: ${error instanceof Error ? error.message : String(error)}`)
}

/** Saves the run's copied folders back to Files and adds the summary card. Never fails the run. */
export async function saveThreadWorkStep(access: NativeHarnessAccess, context: NativeHarnessContext): Promise<void> {
  'use step'
  if (!context.work) return
  const [{ saveThreadWork }, { getOverlayServerContext }, { asConversationId }] = await Promise.all([
    import('@/server/agents/thread-work/thread-work-service'),
    import('@/server/bootstrap'),
    import('@/server/conversations/ActConversationRepository'),
  ])
  const run = await getOverlayServerContext().appData.repositories.conversations.getLatestAgentRun({
    agentRunId: access.agentRunId, conversationId: asConversationId(access.conversationId), userId: access.actorUserId,
  }).catch((_error) => null)
  await saveThreadWork({
    run: threadRun(access),
    runStartedAt: run?.createdAt ?? Date.now() - 60 * 60_000, agentName: context.agentName,
  }).catch((_error) => undefined)
}

// Plain helpers the workflow calls, so its own control flow stays the same size. Each step runs only when the
// thread chose folders.

export async function prepareThreadWork(access: NativeHarnessAccess, context: NativeHarnessContext, owns: boolean): Promise<string> {
  return owns && context.work ? await prepareThreadWorkStep(access, context) : ''
}

export function instructionsWithWork(instructions: string, workNote: string): string {
  return workNote ? `${instructions}\n\n${workNote}` : instructions
}

export async function saveThreadWorkIfChosen(access: NativeHarnessAccess, context: NativeHarnessContext): Promise<void> {
  if (context.work) await saveThreadWorkStep(access, context)
}
