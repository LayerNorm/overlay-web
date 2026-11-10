import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import { api, convexWorkspaceId, mutateConvex, subscribeConvex, type Id } from './convexClient'
import { getRequestWorkspaceId } from './appApi'

export type PersonalTurn = Omit<FunctionArgs<typeof api.chat.personal.submit>, 'workspaceId'>
export type PersonalRun = NonNullable<FunctionReturnType<typeof api.chat.personal.getExecution>>['run']

export async function submitPersonalTurn(turn: PersonalTurn, workspaceId = convexWorkspaceId()) {
  if (getRequestWorkspaceId() !== workspaceId) throw new Error('Workspace changed. Reopen this chat.')
  const result = await mutateConvex(api.chat.personal.submit, { ...turn, workspaceId })
  if (getRequestWorkspaceId() !== workspaceId) throw new Error('Workspace changed. Reopen this chat.')
  return result
}

export function watchPersonalExecution(workspaceId: string, conversationId: string, onValue: (run: PersonalRun) => void, onError: (error: unknown) => void) {
  return subscribeConvex(api.chat.personal.getExecution, { workspaceId, conversationId: conversationId as Id<'conversations'> }, value => onValue(value?.run ?? null), onError)
}
