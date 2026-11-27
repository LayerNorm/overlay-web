'use client'

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { useConvex } from 'convex/react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { CalendarDays, GitFork, Plus, Settings, User, X } from 'lucide-react'
import { Button, Popover, PopoverContent, PopoverTrigger, Textarea } from '@overlay/ui/primitives'
import { unstyledTextarea } from '@overlay/ui/control-reset'
import { useAutosizeTextarea } from '@overlay/ui/hooks'
import { PromptInput, PromptInputBody, PromptInputButton, PromptInputFooter, PromptInputSubmit } from '@overlay/chat-react'
import type { CreateWorkItemRequest, WorkContextRef, WorkItem, WorkPerson } from '@overlay/app-core'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import { WORK_LIMITS, WORK_PRIORITIES, WORK_PRIORITY_LABELS } from '@/shared/work/status'
import { composerRequest, emptyComposerDraft, type ComposerDraft } from '../lib/composer-draft'
import { useWorkRoute } from '../lib/use-work-route'
import { useWorkData } from './WorkDataProvider'
import { ComposerAssignee, ComposerDependencies, ComposerPickerButton, ComposerSchedule } from './WorkComposerPickers'
import { WorkComposerContext } from './WorkComposerContext'
import { searchContext } from './WorkPeekSections'

export interface WorkTaskComposerHandle { focus(): void }

export function WorkTaskSettings({ draft, disabled, onChange }: {
  draft: ComposerDraft
  disabled?: boolean
  onChange(value: Partial<ComposerDraft>): void
}) {
  return <div className="grid gap-3">
    <h3 className="text-sm font-medium">Task settings</h3>
    <div role="group" aria-label="Status" className="grid gap-1.5"><span className="text-xs text-(--muted)">Status</span><div className="flex flex-wrap gap-1">{(['backlog', 'todo'] as const).map(status => <Button key={status} type="button" size="sm" className="h-7 px-2 text-xs" variant={draft.status === status ? 'secondary' : 'ghost'} aria-pressed={draft.status === status} disabled={disabled} onClick={() => onChange({ status })}>{status === 'todo' ? 'Todo' : 'Backlog'}</Button>)}</div></div>
    <div role="group" aria-label="Priority" className="grid gap-1.5"><span className="text-xs text-(--muted)">Priority</span><div className="flex flex-wrap gap-1">{WORK_PRIORITIES.map(priority => <Button key={priority} type="button" size="sm" className="h-7 px-2 text-xs" variant={draft.priority === priority ? 'secondary' : 'ghost'} aria-pressed={draft.priority === priority} disabled={disabled} onClick={() => onChange({ priority })}>{WORK_PRIORITY_LABELS[priority]}</Button>)}</div></div>
  </div>
}

type ComposerProps = {
  disabled?: boolean
  people: readonly WorkPerson[]
  tasks: readonly WorkItem[]
  scope: PanelScope
  principalId: string | null
  search(query: string): Promise<WorkContextRef[]>
  createTask(input: Omit<CreateWorkItemRequest, 'scope'>): Promise<WorkItem | null>
}

type FailedSubmission = { id: number; draft: ComposerDraft; retrying: boolean }

export const WorkTaskComposerForm = forwardRef<WorkTaskComposerHandle, ComposerProps>(function WorkTaskComposerForm({ disabled, people, tasks, scope, principalId, createTask, search }, ref) {
  const [draft, setDraft] = useState(emptyComposerDraft)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState('')
  const [failedSubmissions, setFailedSubmissions] = useState<FailedSubmission[]>([])
  const input = useRef<HTMLTextAreaElement>(null)
  const pendingDrafts = useRef(new WeakSet<ComposerDraft>())
  const retryingSubmissions = useRef(new Set<number>())
  const nextFailedSubmissionId = useRef(0)
  const locked = Boolean(disabled)
  useAutosizeTextarea(input, draft.text)
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), [])
  const patch = (value: Partial<ComposerDraft>) => { setDraft(current => ({ ...current, ...value })); setError('') }
  const assignee = people.find(person => person.principalId === draft.assigneePrincipalId)

  // Keep the composer available while each request completes; failed submissions remain independent of the current draft.
  async function submit() {
    if (locked || pendingDrafts.current.has(draft)) return
    const request = composerRequest(draft)
    if (!request.input) { setError(request.error); return }
    const submitted = {
      ...draft,
      blockedBy: [...draft.blockedBy],
      context: draft.context.map(context => ({ ...context })),
    }
    pendingDrafts.current.add(draft)
    setDraft(emptyComposerDraft())
    setSettingsOpen(false)
    setError('')
    input.current?.focus()
    let created: WorkItem | null
    try {
      created = await createTask(request.input)
    } catch {
      created = null
    }
    pendingDrafts.current.delete(draft)
    if (created) return
    const failed = { id: nextFailedSubmissionId.current++, draft: submitted, retrying: false }
    setFailedSubmissions(current => [...current, failed].sort((a, b) => a.id - b.id))
  }

  async function retryFailedSubmission(submission: FailedSubmission) {
    if (locked || submission.retrying || retryingSubmissions.current.has(submission.id)) return
    const request = composerRequest(submission.draft)
    if (!request.input) return
    retryingSubmissions.current.add(submission.id)
    setFailedSubmissions(current => current.map(item => item.id === submission.id ? { ...item, retrying: true } : item))
    let created: WorkItem | null
    try {
      created = await createTask(request.input)
    } catch {
      created = null
    }
    retryingSubmissions.current.delete(submission.id)
    if (created) {
      setFailedSubmissions(current => current.filter(item => item.id !== submission.id))
      return
    }
    setFailedSubmissions(current => current.map(item => item.id === submission.id ? { ...item, retrying: false } : item))
  }

  // The same composer box as chat and agent threads: one outlined card, centered at the transcript width.
  return <div className="shrink-0 px-3 pb-3 sm:px-4 sm:pb-4" data-testid="work-task-composer">
    <div className="@container/work-composer mx-auto w-full min-w-0 max-w-4xl">
      <PromptInput><PromptInputBody>
        <Textarea ref={input} rows={1} aria-label="Describe a task" placeholder="Describe a task" value={draft.text} disabled={locked} onChange={event => patch({ text: event.target.value })}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }}
          className={unstyledTextarea('block min-h-11 max-h-40 w-full resize-none overflow-y-auto bg-transparent px-0.5 py-1 text-sm leading-6 text-(--foreground) outline-none placeholder:text-(--muted-light)')} />
        {draft.context.length ? <div className="flex flex-wrap gap-1 pt-1">{draft.context.map((context, index) => <Button key={`${context.type}:${context.id}`} type="button" variant="secondary" size="sm" className="h-7 max-w-full text-xs" disabled={locked} aria-label={`Remove ${context.label}`} onClick={() => patch({ context: draft.context.filter((_, i) => i !== index) })}><span className="truncate">{context.label}</span><X size={12} /></Button>)}</div> : null}
        <PromptInputFooter className="flex-nowrap">
          <WorkComposerContext search={search} disabled={locked || draft.context.length >= WORK_LIMITS.contextItems} onAdd={context => patch({ context: [...draft.context.filter(item => item.type !== context.type || item.id !== context.id), context] })} />
          <ComposerAssignee people={people} scope={scope} principalId={principalId} value={draft.assigneePrincipalId} onChange={assigneePrincipalId => patch({ assigneePrincipalId })} disabled={locked} />
          <ComposerSchedule draft={draft} onChange={patch} disabled={locked} />
          <ComposerDependencies tasks={tasks} value={draft.blockedBy} onChange={blockedBy => patch({ blockedBy })} disabled={locked} />
          <Popover open={settingsOpen && !locked} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild><PromptInputButton aria-label="Task settings" disabled={locked}><Settings size={15} /></PromptInputButton></PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-72 max-w-[calc(100vw-2rem)] p-3" aria-label="Task settings">
              <WorkTaskSettings draft={draft} disabled={locked} onChange={patch} />
            </PopoverContent>
          </Popover>
          <span className="min-w-0 flex-1" />
          {assignee?.type === 'agent' && draft.blockedBy.length ? <span className="text-[11px] text-(--muted-light) @max-[520px]/work-composer:hidden">Starts when dependencies finish</span> : null}
          <PromptInputSubmit aria-label="Add task" status="ready" disabled={locked || !draft.text.trim()} onClick={() => void submit()} />
        </PromptInputFooter>
        {error ? <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
        {failedSubmissions.length ? <div className="mt-2 grid gap-2">
          {failedSubmissions.map(submission => {
            const title = submission.draft.text.split(/\r?\n/, 1)[0]?.trim() || 'Untitled task'
            return <div key={submission.id} className="flex items-center justify-between gap-3 rounded-md border border-(--border) bg-(--surface-subtle) px-3 py-2">
              <p role="alert" className="min-w-0 text-xs text-red-600 dark:text-red-400">Couldn’t add “{title}”. Retry with your saved draft and settings.</p>
              <Button type="button" variant="secondary" size="sm" disabled={locked || submission.retrying} aria-label={`${submission.retrying ? 'Retrying' : 'Retry'} ${title}`} onClick={() => void retryFailedSubmission(submission)}>{submission.retrying ? 'Retrying…' : 'Retry'}</Button>
            </div>
          })}
        </div> : null}
      </PromptInputBody></PromptInput>
    </div>
  </div>
})

export const WorkTaskComposer = forwardRef<WorkTaskComposerHandle, { disabled?: boolean }>(function WorkTaskComposer({ disabled }, ref) {
  const { people, items, viewer, createTask } = useWorkData()
  const { scope } = useWorkRoute()
  const convex = useConvex()
  const { activeWorkspaceId } = useWorkspace()
  const search = useCallback((query: string) => activeWorkspaceId ? searchContext(convex, activeWorkspaceId, query) : Promise.resolve([]), [activeWorkspaceId, convex])
  return <WorkTaskComposerForm key={`${activeWorkspaceId}:${scope}`} ref={ref} disabled={disabled} people={people} tasks={items} scope={scope} principalId={viewer?.principalId ?? null} createTask={createTask} search={search} />
})

/** The composer as it looks before Work's data loads: the same card and footer, disabled. Used by loading skeletons. */
export function WorkComposerPlaceholder() {
  return <div className="shrink-0 px-3 pb-3 sm:px-4 sm:pb-4" aria-hidden>
    <div className="@container/work-composer mx-auto w-full min-w-0 max-w-4xl">
      <PromptInput><PromptInputBody>
        <Textarea rows={1} tabIndex={-1} aria-label="Describe a task" placeholder="Describe a task" disabled readOnly
          className={unstyledTextarea('block min-h-11 max-h-40 w-full resize-none overflow-y-auto bg-transparent px-0.5 py-1 text-sm leading-6 text-(--foreground) outline-none placeholder:text-(--muted-light)')} />
        <PromptInputFooter className="flex-nowrap">
          <PromptInputButton aria-label="Add context" disabled tabIndex={-1}><Plus size={16} /></PromptInputButton>
          <ComposerPickerButton label="Assignee" icon={<User size={14} />} disabled tabIndex={-1} />
          <ComposerPickerButton label="Schedule" icon={<CalendarDays size={14} />} disabled tabIndex={-1} />
          <ComposerPickerButton label="Depends on" icon={<GitFork size={14} />} disabled tabIndex={-1} />
          <PromptInputButton aria-label="Task settings" disabled tabIndex={-1}><Settings size={15} /></PromptInputButton>
          <span className="min-w-0 flex-1" />
          <PromptInputSubmit aria-label="Add task" status="ready" disabled tabIndex={-1} />
        </PromptInputFooter>
      </PromptInputBody></PromptInput>
    </div>
  </div>
}
