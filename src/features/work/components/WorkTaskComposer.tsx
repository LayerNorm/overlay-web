'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useConvex } from 'convex/react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { Settings, X } from 'lucide-react'
import { Button, Textarea } from '@overlay/ui/primitives'
import { unstyledTextarea } from '@overlay/ui/control-reset'
import { useAutosizeTextarea } from '@overlay/ui/hooks'
import { PromptInput, PromptInputBody, PromptInputFooter, PromptInputSubmit } from '@overlay/chat-react'
import type { CreateWorkItemRequest, WorkContextRef, WorkItem, WorkPerson } from '@overlay/app-core'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import { WORK_LIMITS, WORK_PRIORITIES, WORK_PRIORITY_LABELS } from '@/shared/work/status'
import { DesktopComposerControls } from '@/components/desktop/DesktopComposerControls'
import { composerRequest, emptyComposerDraft, type ComposerDraft } from '../lib/composer-draft'
import { useWorkRoute } from '../lib/use-work-route'
import { useWorkData } from './WorkDataProvider'
import { ComposerAssignee, ComposerDependencies, ComposerSchedule } from './WorkComposerPickers'
import { WorkComposerContext } from './WorkComposerContext'
import { searchContext } from './WorkPeekSections'

export interface WorkTaskComposerHandle { focus(): void }
type ComposerProps = {
  disabled?: boolean
  people: readonly WorkPerson[]
  tasks: readonly WorkItem[]
  scope: PanelScope
  principalId: string | null
  search(query: string): Promise<WorkContextRef[]>
  createTask(input: Omit<CreateWorkItemRequest, 'scope'>): Promise<WorkItem | null>
}

export const WorkTaskComposerForm = forwardRef<WorkTaskComposerHandle, ComposerProps>(function WorkTaskComposerForm({ disabled, people, tasks, scope, principalId, createTask, search }, ref) {
  const [draft, setDraft] = useState(emptyComposerDraft)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const inFlight = useRef(false)
  const refocus = useRef(false)
  const locked = disabled || busy
  useAutosizeTextarea(input, draft.text)
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), [])
  useEffect(() => {
    if (!busy && refocus.current) { refocus.current = false; input.current?.focus() }
  }, [busy])
  const patch = (value: Partial<ComposerDraft>) => { setDraft(current => ({ ...current, ...value })); setError('') }
  const assignee = people.find(person => person.principalId === draft.assigneePrincipalId)

  async function submit() {
    if (locked || inFlight.current) return
    const request = composerRequest(draft)
    if (!request.input) { setError(request.error); return }
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const created = await createTask(request.input)
      if (created) { setDraft(emptyComposerDraft()); setSettingsOpen(false) }
      else setError('Could not add the task. Your draft is unchanged.')
    } catch {
      setError('Could not add the task. Your draft is unchanged.')
    } finally {
      inFlight.current = false
      refocus.current = true
      setBusy(false)
    }
  }

  return <div className="shrink-0 px-3 pb-3 pt-2 md:px-6 md:pb-5" data-testid="work-task-composer">
    <div className="rounded-2xl bg-(--surface-subtle)">
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5">
        <ComposerAssignee people={people} scope={scope} principalId={principalId} value={draft.assigneePrincipalId} onChange={assigneePrincipalId => patch({ assigneePrincipalId })} disabled={locked} />
        <ComposerSchedule draft={draft} onChange={patch} disabled={locked} />
        <ComposerDependencies tasks={tasks} value={draft.blockedBy} onChange={blockedBy => patch({ blockedBy })} disabled={locked} />
        <Button type="button" variant="ghost" size="icon-sm" className="ml-auto text-(--muted)" aria-label="Task settings" aria-expanded={settingsOpen} disabled={locked} onClick={() => setSettingsOpen(!settingsOpen)}><Settings size={15} /></Button>
      </div>
      {settingsOpen ? <div className="grid gap-1 px-3.5 pb-3">
        <div className="flex flex-wrap items-center gap-1"><span className="w-14 text-xs text-(--muted-light)">Status</span>{(['backlog', 'todo'] as const).map(status => <Button key={status} type="button" size="sm" className="h-7 px-2 text-xs" variant={draft.status === status ? 'secondary' : 'ghost'} aria-pressed={draft.status === status} disabled={locked} onClick={() => patch({ status })}>{status === 'todo' ? 'Todo' : 'Backlog'}</Button>)}</div>
        <div className="flex flex-wrap items-center gap-1"><span className="w-14 text-xs text-(--muted-light)">Priority</span>{WORK_PRIORITIES.map(priority => <Button key={priority} type="button" size="sm" className="h-7 px-2 text-xs" variant={draft.priority === priority ? 'secondary' : 'ghost'} aria-pressed={draft.priority === priority} disabled={locked} onClick={() => patch({ priority })}>{WORK_PRIORITY_LABELS[priority]}</Button>)}</div>
      </div> : null}
      <PromptInput><PromptInputBody>
        <Textarea ref={input} rows={1} aria-label="Describe a task" placeholder="Describe a task" value={draft.text} disabled={locked} onChange={event => patch({ text: event.target.value })}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }}
          className={unstyledTextarea('block max-h-48 min-h-11 w-full resize-none overflow-y-auto bg-transparent px-1 py-1.5 text-sm text-(--foreground) outline-none placeholder:text-(--muted-light)')} />
        {draft.context.length ? <div className="flex flex-wrap gap-1 pt-1">{draft.context.map((context, index) => <Button key={`${context.type}:${context.id}`} type="button" variant="secondary" size="sm" className="h-7 max-w-full text-xs" disabled={locked} aria-label={`Remove ${context.label}`} onClick={() => patch({ context: draft.context.filter((_, i) => i !== index) })}><span className="truncate">{context.label}</span><X size={12} /></Button>)}</div> : null}
        <PromptInputFooter className="mt-1 flex-wrap">
          <WorkComposerContext search={search} disabled={locked || draft.context.length >= WORK_LIMITS.contextItems} onAdd={context => patch({ context: [...draft.context.filter(item => item.type !== context.type || item.id !== context.id), context] })} />
          <span className="flex-1" />
          {assignee?.type === 'agent' && draft.blockedBy.length ? <span className="text-[11px] text-(--muted-light)">Starts when dependencies finish</span> : null}
          <DesktopComposerControls disabled={locked} onAppendText={text => setDraft(current => ({ ...current, text: [current.text, text].filter(Boolean).join('\n') }))} />
          <PromptInputSubmit aria-label="Add task" status={busy ? 'submitted' : 'ready'} disabled={locked || !draft.text.trim()} onClick={() => void submit()} className="size-8" />
        </PromptInputFooter>
        {error ? <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
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
