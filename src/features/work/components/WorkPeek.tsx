'use client'
import { useEffect, useState } from 'react'
import { X, Archive, RotateCcw } from 'lucide-react'
import { Toggle } from '@overlay/ui/primitives'
import { useDialogFocus } from '@overlay/ui/hooks'
import type { WorkItem, WorkEvent, WorkPerson, WorkPatch, WorkAction } from '@overlay/app-core/work'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
import { notifyWorkChanged } from '../lib/useWorkItems'
import { StatusPicker } from './StatusPicker'
import { OwnerPicker } from './OwnerPicker'
import { WorkObjectiveEditor } from './WorkObjectiveEditor'
import { WorkContextEditor } from './WorkContextEditor'

const inputClass = 'w-full min-w-0 rounded-md border border-(--border) bg-transparent px-2 py-1.5 text-sm disabled:opacity-60'
function patchFor(item: WorkItem): WorkPatch {
  return { title: item.title, description: item.description, status: item.status, priority: item.priority, blocked: item.blocked, assigneePrincipalId: item.assigneePrincipalId ?? null, reviewerUserId: item.reviewerUserId ?? null, startDate: item.startDate ?? null, dueDate: item.dueDate ?? null, parentId: item.parentId ?? null, doneWhen: item.doneWhen ?? [], context: item.context ?? [] }
}
export function WorkPeek({ id, workspaceId, people, items, canEdit, onUpdate, onClose }: { id: string; workspaceId: string; people: WorkPerson[]; items: WorkItem[]; canEdit: (item: WorkItem) => boolean; onUpdate: (item: WorkItem, patch: WorkPatch) => Promise<WorkItem>; onClose: () => void }) {
  const [result, setResult] = useState<{ item: WorkItem; events: WorkEvent[] } | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [dirty, setDirty] = useState(false)
  const dialog = useDialogFocus<HTMLElement>(true)
  const close = () => { if (!dirty || window.confirm('Discard your unsaved task changes?')) onClose() }
  useEffect(() => {
    const controller = new AbortController()
    overlayAppClient.work.get(id, { headers: { [ACTIVE_WORKSPACE_HEADER]: workspaceId }, signal: controller.signal }).then(setResult).catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load task') })
    return () => controller.abort()
  }, [id, workspaceId, attempt])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); if (!dirty || window.confirm('Discard your unsaved task changes?')) onClose() } }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [dirty, onClose])
  return <div className="fixed inset-0 z-60 flex justify-end">
    <button aria-label="Close task backdrop" className="absolute inset-0 bg-black/15" onClick={close} tabIndex={-1} />
    <aside ref={dialog} role="dialog" aria-modal="true" aria-label="Task brief" className="relative flex h-full w-full max-w-lg flex-col border-l border-(--border) bg-(--background) shadow-xl">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-(--border) px-5"><span className="text-xs text-(--muted)">Task brief</span><button data-autofocus aria-label="Close task" onClick={close} className="rounded p-2 hover:bg-(--surface-subtle)"><X size={16} /></button></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {error ? <div role="alert" className="space-y-2 text-sm"><p>{error}</p><button onClick={() => { setError(''); setAttempt(attempt + 1) }} className="underline">Reload task</button></div> : result ? <WorkBrief key={`${workspaceId}:${id}:${attempt}`} initial={result.item} initialEvents={result.events} people={people} items={items} editable={canEdit(result.item)} onUpdate={onUpdate} onClose={onClose} onDirty={setDirty} onReload={() => { setDirty(false); setResult(null); setAttempt(attempt + 1) }} /> : <p aria-busy="true" className="text-sm text-(--muted)">Loading task…</p>}
      </div>
    </aside>
  </div>
}
function WorkBrief({ initial, initialEvents, people, items, editable, onUpdate, onClose, onDirty, onReload }: { initial: WorkItem; initialEvents: WorkEvent[]; people: WorkPerson[]; items: WorkItem[]; editable: boolean; onUpdate: (item: WorkItem, patch: WorkPatch) => Promise<WorkItem>; onClose: () => void; onDirty: (dirty: boolean) => void; onReload: () => void }) {
  const [item, setItem] = useState(initial)
  const [draft, setDraft] = useState(() => patchFor(initial))
  const [events, setEvents] = useState(initialEvents)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editorVersion, setEditorVersion] = useState(0)
  const dirty = JSON.stringify(draft) !== JSON.stringify(patchFor(item))
  const disabled = !editable || busy || item.archivedAt !== undefined
  const eligible = people.filter((person) => item.scope !== 'personal' || person.userId === item.userId)
  function change(patch: WorkPatch) { const next = { ...draft, ...patch }; setDraft(next); onDirty(JSON.stringify(next) !== JSON.stringify(patchFor(item))) }
  const init = { headers: { [ACTIVE_WORKSPACE_HEADER]: item.workspaceId } }
  async function activity() { const next = await overlayAppClient.work.get(item._id, init); setEvents(next.events) }
  async function save() {
    setBusy(true); setError('')
    try { const saved = await onUpdate(item, draft); setItem(saved); setDraft(patchFor(saved)); onDirty(false); await activity() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save task') } finally { setBusy(false) }
  }
  async function action(body: WorkAction) {
    setBusy(true); setError('')
    try {
      await overlayAppClient.work.action(item._id, body, init); notifyWorkChanged(item.workspaceId)
      if (body.action === 'comment') { setComment(''); await activity() } else onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not change task') } finally { setBusy(false) }
  }
  const section = 'mb-3 text-xs font-medium text-(--muted)'
  return <div className="space-y-6">
    {item.archivedAt !== undefined ? <div className="flex items-center justify-between rounded border border-(--border) p-3 text-xs"><span>Archived task</span>{editable ? <button disabled={busy} onClick={() => { void action({ action: 'restored' }) }} className="flex items-center gap-1"><RotateCcw size={13} />Restore</button> : null}</div> : null}
    <fieldset disabled={disabled} className="space-y-6">
      <input aria-label="Task title" maxLength={200} value={draft.title ?? ''} onChange={(e) => change({ title: e.target.value })} className="w-full bg-transparent text-xl font-medium outline-none" />
      <div className="grid grid-cols-[90px_minmax(0,1fr)] items-center gap-x-3 gap-y-3 text-xs">
        <span className="text-(--muted)">Status</span><StatusPicker value={draft.status ?? item.status} onChange={(status) => change({ status })} />
        <span className="text-(--muted)">Owner</span><OwnerPicker value={draft.assigneePrincipalId ?? undefined} people={eligible} label="Task owner" onChange={(assigneePrincipalId) => change({ assigneePrincipalId })} />
        <label htmlFor="work-reviewer" className="text-(--muted)">Reviewer</label><select id="work-reviewer" value={draft.reviewerUserId ?? ''} onChange={(e) => change({ reviewerUserId: e.target.value || null })} className={inputClass}><option value="">No reviewer</option>{eligible.map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}</select>
        <label htmlFor="work-priority" className="text-(--muted)">Priority</label><select id="work-priority" value={draft.priority} onChange={(e) => change({ priority: e.target.value === '1' ? 1 : e.target.value === '3' ? 3 : 2 })} className={inputClass}><option value="1">High</option><option value="2">Normal</option><option value="3">Low</option></select>
        <span className="text-(--muted)">Blocked</span><Toggle aria-label="Task blocked" checked={draft.blocked ?? false} onCheckedChange={(blocked) => change({ blocked })} />
        <label htmlFor="work-start" className="text-(--muted)">Start date</label><input id="work-start" type="date" value={draft.startDate ?? ''} onChange={(e) => change({ startDate: e.target.value || null })} className={inputClass} />
        <label htmlFor="work-due" className="text-(--muted)">Due date</label><input id="work-due" type="date" min={draft.startDate ?? undefined} value={draft.dueDate ?? ''} onChange={(e) => change({ dueDate: e.target.value || null })} className={inputClass} />
        <label htmlFor="work-parent" className="text-(--muted)">Objective</label><select id="work-parent" value={draft.parentId ?? ''} onChange={(e) => change({ parentId: e.target.value || null })} className={inputClass}><option value="">No parent objective</option>{items.filter((row) => row._id !== item._id && !row.parentId && row.scope === item.scope).map((row) => <option key={row._id} value={row._id}>{row.title}</option>)}</select>
      </div>
      <section><h2 className={section}>Objective</h2><WorkObjectiveEditor key={editorVersion} value={draft.description ?? ''} disabled={disabled} onChange={(description) => change({ description })} /></section>
      <section><h2 className={section}>Context</h2><WorkContextEditor value={draft.context ?? []} onChange={(context) => change({ context })} disabled={disabled} workspaceId={item.workspaceId} scope={item.scope} /></section>
      <section><h2 className={section}>Done when</h2><div className="space-y-2">
        {(draft.doneWhen ?? []).map((entry, index) => <div key={index} className="flex items-center gap-2"><Toggle checked={entry.checked} aria-label={`Complete checklist item ${index + 1}`} onCheckedChange={(checked) => change({ doneWhen: draft.doneWhen?.map((row, i) => i === index ? { ...row, checked } : row) })} /><input aria-label={`Checklist item ${index + 1}`} maxLength={1000} value={entry.text} onChange={(e) => change({ doneWhen: draft.doneWhen?.map((row, i) => i === index ? { ...row, text: e.target.value } : row) })} className={inputClass} /><button type="button" aria-label={`Remove checklist item ${index + 1}`} onClick={() => change({ doneWhen: draft.doneWhen?.filter((_, i) => i !== index) })}><X size={14} /></button></div>)}
        {!disabled ? <button type="button" className="text-xs text-(--muted)" onClick={() => change({ doneWhen: [...(draft.doneWhen ?? []), { text: '', checked: false }] })}>Add condition</button> : null}
      </div></section>
    </fieldset>
    {error ? <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}<button onClick={() => { if (!dirty || window.confirm('Discard your changes and reload?')) onReload() }} className="ml-2 underline">Reload task</button></p> : null}
    {!disabled && dirty ? <div className="flex gap-3"><button disabled={busy} onClick={() => { void save() }} className="rounded-md bg-(--surface-subtle) px-3 py-2 text-xs font-medium">Save changes</button><button onClick={() => { setDraft(patchFor(item)); setEditorVersion(editorVersion + 1); onDirty(false); setError('') }} className="text-xs text-(--muted)">Cancel changes</button></div> : null}
    <section><h2 className={section}>Activity</h2><ol className="space-y-3 text-xs">{events.map((event) => <li key={event._id} className="border-l border-(--border) pl-3"><div className="mb-1 text-(--muted)">{people.find((person) => person.principalId === event.actorPrincipalId)?.name ?? 'Member'} · {new Date(event.createdAt).toLocaleString()}</div><p className="whitespace-pre-wrap break-words">{event.kind === 'comment' ? event.data.text : event.kind === 'updated' ? `Changed ${event.data.field ?? 'task'}` : event.kind === 'status' ? 'Changed status' : event.kind === 'assignee' ? 'Changed owner' : event.kind === 'scope' ? `Moved to ${event.data.after}` : `${event.kind[0].toUpperCase()}${event.kind.slice(1)} task`}</p></li>)}</ol>
      {item.archivedAt === undefined ? <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); void action({ action: 'comment', text: comment }) }}><textarea aria-label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={5000} disabled={busy} placeholder="Add a comment…" className={inputClass} /><button disabled={busy || !comment.trim()} className="rounded bg-(--surface-subtle) px-3 py-1.5 text-xs disabled:opacity-50">Post comment</button></form> : null}
    </section>
    {editable && item.archivedAt === undefined ? <div className="flex flex-wrap gap-4 border-t border-(--border) pt-4 text-xs text-(--muted)"><button disabled={busy || dirty} onClick={() => { void action({ action: 'scope', to: item.scope === 'personal' ? 'workspace' : 'personal' }) }}>Move to {item.scope === 'personal' ? 'Workspace' : 'Personal'}</button><button disabled={busy || dirty} onClick={() => { void action({ action: 'archived' }) }} className="flex items-center gap-1"><Archive size={13} />Archive task</button>{dirty ? <span>Save or cancel changes first.</span> : null}</div> : null}
  </div>
}
