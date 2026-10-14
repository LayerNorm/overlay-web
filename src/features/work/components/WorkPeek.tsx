'use client'
import { useEffect, useImperativeHandle, useState, type Ref } from 'react'
import { Archive, RotateCcw } from 'lucide-react'
import { ConfirmDialog } from '@overlay/ui/overlays'
import { useDialogFocus } from '@overlay/ui/hooks'
import { AppScreenSidePanel } from '@overlay/modules-react/shell'
import type { WorkItem, WorkEvent, WorkPerson, WorkPatch, WorkAction } from '@overlay/app-core/work'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
import { trackWorkAction } from '@/shared/observability/client-metrics'
import { notifyWorkChanged } from '../lib/useWorkItems'
import {
  WorkProperties,
  WorkChecklist,
  WorkDependencies,
  WorkActivity,
  workSectionClass as section,
} from './WorkBriefSections'
import { WorkObjectiveEditor } from './WorkObjectiveEditor'
import { WorkContextEditor } from './WorkContextEditor'

function patchFor(item: WorkItem): WorkPatch {
  return {
    title: item.title,
    description: item.description,
    status: item.status,
    priority: item.priority,
    blocked: item.blocked,
    assigneePrincipalId: item.assigneePrincipalId ?? null,
    reviewerUserId: item.reviewerUserId ?? null,
    startDate: item.startDate ?? null,
    dueDate: item.dueDate ?? null,
    parentId: item.parentId ?? null,
    doneWhen: item.doneWhen ?? [],
    context: item.context ?? [],
    blockedBy: item.blockedBy ?? [],
  }
}
export type WorkPeekHandle = {
  requestClose: (afterClose?: () => void) => void
}
export function WorkPeek({
  ref,
  id,
  workspaceId,
  people,
  items,
  canEdit,
  onUpdate,
  onClose,
}: {
  ref?: Ref<WorkPeekHandle>
  id: string
  workspaceId: string
  people: WorkPerson[]
  items: WorkItem[]
  canEdit: (item: WorkItem) => boolean
  onUpdate: (item: WorkItem, patch: WorkPatch) => Promise<WorkItem>
  onClose: () => void
}) {
  const [result, setResult] = useState<{
    item: WorkItem
    events: WorkEvent[]
  } | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState<(() => void) | null>(null)
  const [overlay, setOverlay] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)')
    const update = () => setOverlay(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])
  const dialog = useDialogFocus<HTMLDivElement>(overlay && discard === null, {
    restoreFocus: false,
  })
  const reload = () => {
    setDirty(false)
    setResult(null)
    setAttempt((value) => value + 1)
  }
  const requestClose = (afterClose = onClose) => {
    if (dirty) setDiscard(() => afterClose)
    else afterClose()
  }
  useImperativeHandle(ref, () => ({ requestClose }))
  useEffect(() => {
    const controller = new AbortController()
    overlayAppClient.work
      .get(id, {
        headers: { [ACTIVE_WORKSPACE_HEADER]: workspaceId },
        signal: controller.signal,
      })
      .then(setResult)
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Could not load task')
      })
    return () => controller.abort()
  }, [id, workspaceId, attempt])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.querySelector('[role="listbox"]')
      ) {
        event.preventDefault()
        if (discard !== null) return
        event.stopPropagation()
        if (dirty) setDiscard(() => onClose)
        else onClose()
      }
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [dirty, onClose, discard])
  return (
    <>
      <div
        ref={dialog}
        id="work-task-brief"
        role={overlay ? 'dialog' : undefined}
        aria-modal={overlay || undefined}
        aria-label="Task brief"
        className="h-full min-h-0"
      >
        <AppScreenSidePanel
          title="Task brief"
          closeLabel="Close task"
          onClose={() => requestClose()}
          bodyClassName="p-5"
        >
          {error ? (
            <div role="alert" className="space-y-2 text-sm">
              <p>{error}</p>
              <button
                onClick={() => {
                  setError('')
                  setAttempt(attempt + 1)
                }}
                className="underline"
              >
                Reload task
              </button>
            </div>
          ) : result ? (
            <WorkBrief
              key={`${workspaceId}:${id}:${attempt}`}
              initial={result.item}
              initialEvents={result.events}
              people={people}
              items={items}
              editable={canEdit(result.item)}
              onUpdate={onUpdate}
              onClose={onClose}
              onDirty={setDirty}
              onReload={() => {
                if (dirty) setDiscard(() => reload)
                else reload()
              }}
            />
          ) : (
            <p aria-busy="true" className="text-sm text-(--muted)">
              Loading task…
            </p>
          )}
        </AppScreenSidePanel>
      </div>
      <ConfirmDialog
        isOpen={discard !== null}
        title="Discard task changes?"
        description="Your unsaved changes will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onCancel={() => setDiscard(null)}
        onConfirm={() => {
          const intent = discard
          setDiscard(null)
          intent?.()
        }}
      />
    </>
  )
}
function WorkBrief({
  initial,
  initialEvents,
  people,
  items,
  editable,
  onUpdate,
  onClose,
  onDirty,
  onReload,
}: {
  initial: WorkItem
  initialEvents: WorkEvent[]
  people: WorkPerson[]
  items: WorkItem[]
  editable: boolean
  onUpdate: (item: WorkItem, patch: WorkPatch) => Promise<WorkItem>
  onClose: () => void
  onDirty: (dirty: boolean) => void
  onReload: () => void
}) {
  const [item, setItem] = useState(initial)
  const [draft, setDraft] = useState(() => patchFor(initial))
  const [events, setEvents] = useState(initialEvents)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editorVersion, setEditorVersion] = useState(0)
  const dirty = JSON.stringify(draft) !== JSON.stringify(patchFor(item))
  const disabled = !editable || busy || item.archivedAt !== undefined
  function change(patch: WorkPatch) {
    const next = { ...draft, ...patch }
    setDraft(next)
    onDirty(JSON.stringify(next) !== JSON.stringify(patchFor(item)))
  }
  const init = { headers: { [ACTIVE_WORKSPACE_HEADER]: item.workspaceId } }
  async function activity() {
    const next = await overlayAppClient.work.get(item._id, init)
    setEvents(next.events)
  }
  async function save() {
    setBusy(true)
    setError('')
    try {
      const saved = await onUpdate(item, draft)
      setItem(saved)
      setDraft(patchFor(saved))
      onDirty(false)
      await activity()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save task')
    } finally {
      setBusy(false)
    }
  }
  async function action(body: WorkAction) {
    setBusy(true)
    setError('')
    try {
      await overlayAppClient.work.action(item._id, body, init)
      trackWorkAction({ action: body.action, scope: item.scope })
      notifyWorkChanged(item.workspaceId)
      if (body.action === 'comment') {
        setComment('')
        await activity()
      } else onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change task')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-5">
      {item.archivedAt !== undefined ? (
        <div className="flex items-center justify-between rounded border border-(--border) p-3 text-xs">
          <span>Archived task</span>
          {editable ? (
            <button
              disabled={busy}
              onClick={() => {
                void action({ action: 'restored' })
              }}
              className="flex items-center gap-1"
            >
              <RotateCcw size={13} />
              Restore
            </button>
          ) : null}
        </div>
      ) : null}
      <fieldset disabled={disabled} className="min-w-0 space-y-5">
        <textarea
          aria-label="Task title"
          maxLength={200}
          value={draft.title ?? ''}
          onChange={(e) => change({ title: e.target.value })}
          rows={1}
          className="w-full resize-none bg-transparent text-lg font-medium leading-snug outline-none field-sizing-content"
        />
        <WorkProperties item={item} draft={draft} people={people} items={items} change={change} />
        <section>
          <h2 className={section}>Objective</h2>
          <WorkObjectiveEditor
            key={editorVersion}
            value={draft.description ?? ''}
            disabled={disabled}
            onChange={(description) => change({ description })}
          />
        </section>
        <section>
          <h2 className={section}>Context</h2>
          <WorkContextEditor
            value={draft.context ?? []}
            onChange={(context) => change({ context })}
            disabled={disabled}
            workspaceId={item.workspaceId}
            scope={item.scope}
          />
        </section>
        <WorkChecklist draft={draft} change={change} disabled={disabled} />
        <details open={Boolean(item.blockedBy?.length)} className="text-xs">
          <summary className="cursor-pointer text-(--muted) hover:text-(--foreground)">
            Dependencies
          </summary>
          <div className="pt-3">
            <WorkDependencies item={item} draft={draft} items={items} change={change} />
          </div>
        </details>
      </fieldset>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
          <button
            onClick={() => {
              onReload()
            }}
            className="ml-2 underline"
          >
            Reload task
          </button>
        </p>
      ) : null}
      {!disabled && dirty ? (
        <div className="flex gap-3">
          <button
            disabled={busy}
            onClick={() => {
              void save()
            }}
            className="rounded-md bg-(--surface-subtle) px-3 py-2 text-xs font-medium"
          >
            Save changes
          </button>
          <button
            onClick={() => {
              setDraft(patchFor(item))
              setEditorVersion(editorVersion + 1)
              onDirty(false)
              setError('')
            }}
            className="text-xs text-(--muted)"
          >
            Cancel changes
          </button>
        </div>
      ) : null}
      <WorkActivity
        events={events}
        people={people}
        item={item}
        comment={comment}
        busy={busy}
        setComment={setComment}
        onComment={() => {
          void action({ action: 'comment', text: comment })
        }}
      />
      {editable && item.archivedAt === undefined ? (
        <div className="flex flex-wrap gap-4 border-t border-(--border) pt-4 text-xs text-(--muted)">
          <button
            disabled={busy || dirty}
            onClick={() => {
              void action({
                action: 'scope',
                to: item.scope === 'personal' ? 'workspace' : 'personal',
              })
            }}
          >
            Move to {item.scope === 'personal' ? 'Workspace' : 'Personal'}
          </button>
          <button
            disabled={busy || dirty}
            onClick={() => {
              void action({ action: 'archived' })
            }}
            className="flex items-center gap-1"
          >
            <Archive size={13} />
            Archive task
          </button>
          {dirty ? <span>Save or cancel changes first.</span> : null}
        </div>
      ) : null}
    </div>
  )
}
