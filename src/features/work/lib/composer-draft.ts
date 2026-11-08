import type { CreateWorkItemRequest, WorkContextRef, WorkPriority } from '@overlay/app-core'
import { validateWorkDates, validateWorkTitle, WORK_LIMITS } from '@/shared/work/status'

export type ComposerDraft = {
  text: string
  assigneePrincipalId: string
  startDate: string
  dueDate: string
  blockedBy: string[]
  status: 'backlog' | 'todo'
  priority: WorkPriority
  context: WorkContextRef[]
}

export function emptyComposerDraft(): ComposerDraft {
  return { text: '', assigneePrincipalId: '', startDate: '', dueDate: '', blockedBy: [], status: 'todo', priority: 2, context: [] }
}

export function composerRequest(draft: ComposerDraft): { input: CreateWorkItemRequest; error?: never } | { error: string; input?: never } {
  const [first, ...lines] = draft.text.replace(/\r\n?/g, '\n').split('\n')
  const title = first.trim()
  const description = lines.join('\n').trim()
  const error = validateWorkTitle(title) || validateWorkDates(draft.startDate || null, draft.dueDate || null)
    || (description.length > WORK_LIMITS.description ? `Descriptions can be up to ${WORK_LIMITS.description} characters.` : null)
  if (error) return { error }
  return { input: {
    title, ...(description ? { description } : {}), status: draft.status, priority: draft.priority,
    ...(draft.assigneePrincipalId ? { assigneePrincipalId: draft.assigneePrincipalId } : {}),
    ...(draft.startDate ? { startDate: draft.startDate } : {}), ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
    blockedBy: [...draft.blockedBy], context: [...draft.context],
  } }
}
