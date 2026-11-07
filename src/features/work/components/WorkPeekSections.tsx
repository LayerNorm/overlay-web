'use client'
import { unstyledButton, unstyledInput, unstyledTextarea } from '@overlay/ui/control-reset'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, FileText, Link as LinkIcon, MessageSquare, NotebookText, Plus, X } from 'lucide-react'
import { FloatingMenu, MenuItem, Button, Input, Textarea } from '@overlay/ui/primitives'
import { MarkdownMessage } from '@overlay/chat-react'
import type { WorkContextRef, WorkContextType, WorkDoneWhen, WorkEvent, WorkItem } from '@overlay/app-core'
import { useConvex, type ConvexReactClient } from 'convex/react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { api } from '../../../../convex/_generated/api'
import { actorName, commentBody, describeEvent, formatAgo, indexPeople } from '@/shared/work/activity'
import { hrefForContext, labelForLink, safeLinkUrl } from '@/shared/work/context-links'
import { checkBlockedBy } from '@/shared/work/graph'
import { WORK_LIMITS } from '@/shared/work/status'
import { useWorkData } from './WorkDataProvider'
import { useLiveWorkEvents, useWorkCommands } from '../lib/use-live-work'
import { parseWorkErrorReason, workErrorMessage } from '@/shared/work/errors'
import { Avatar, StatusIcon } from './work-ui'

export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-(--muted-light)">
        {title}
        {hint ? <em className="ml-auto text-[12px] font-normal normal-case not-italic tracking-normal">{hint}</em> : null}
      </h3>
      {children}
    </section>
  )
}

/** The outcome, not the steps: Markdown, shown formatted and edited as plain text. */
export function ObjectiveSection({ value, editable, onSave }: { value: string | null; editable: boolean; onSave: (value: string | null) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (editing) field.current?.focus() }, [editing])

  function commit() {
    setEditing(false)
    const next = draft.replace(/\s+$/, '')
    if (next === (value ?? '')) return
    onSave(next === '' ? null : next)
  }

  if (editing) {
    return (
      <Textarea
        ref={field}
        value={draft}
        maxLength={WORK_LIMITS.description}
        aria-label="Objective"
        rows={Math.min(14, Math.max(4, draft.split('\n').length + 1))}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); setDraft(value ?? ''); setEditing(false) }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); commit() }
        }}
        className={unstyledTextarea(`w-full resize-y rounded-lg bg-(--surface-elevated) px-3 py-2 text-[14.5px] leading-relaxed text-(--foreground) outline-none`)}
        placeholder="Describe what a good result looks like. Markdown works."
      />
    )
  }
  const empty = !value
  return (
    <div
      role={editable ? 'button' : undefined}
      tabIndex={editable ? 0 : undefined}
      aria-label={editable ? 'Edit objective' : undefined}
      onClick={() => { if (editable) { setDraft(value ?? ''); setEditing(true) } }}
      onKeyDown={(event) => { if (editable && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setDraft(value ?? ''); setEditing(true) } }}
      className={`rounded-lg text-[14.5px] leading-relaxed ${editable ? 'cursor-text hover:bg-(--surface-muted) -mx-2 px-2 py-1' : ''}`}
      data-testid="work-objective"
    >
      {empty
        ? <p className="text-(--muted-light)">{editable ? 'Describe what a good result looks like. Markdown works.' : 'No objective yet.'}</p>
        : <div className="overlay-chat-surface"><MarkdownMessage text={value} isStreaming={false} /></div>}
    </div>
  )
}

const CONTEXT_ICONS: Record<WorkContextType, typeof FileText> = { file: FileText, note: NotebookText, chat: MessageSquare, link: LinkIcon }

type SearchHit = WorkContextRef

/** Files, notes and chats matching the text, from the native workspace search (notes are typed as notes). */
async function searchContext(convex: Pick<ConvexReactClient, 'query'>, workspaceId: string, query: string): Promise<SearchHit[]> {
  const result = await convex.query(api.search.browse.mentions, { workspaceId, query })
  if (!result) return []
  return [
    ...result.files.map((file): SearchHit => (file.kind === 'note'
      ? { type: 'note', id: file.id, label: file.name || 'Untitled' }
      : { type: 'file', id: file.id, label: file.name })),
    ...result.chats.map((chat): SearchHit => ({ type: 'chat', id: chat.id, label: chat.title || 'Untitled chat' })),
  ].slice(0, 12)
}

function AddContext({ onAdd }: { onAdd: (ref: WorkContextRef) => void }) {
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Results are kept with the text they answer, so a slow answer to an old query is never shown for a new one.
  const [searched, setSearched] = useState<{ query: string; hits: SearchHit[] }>({ query: '', hits: [] })
  const convex = useConvex()
  const { activeWorkspaceId } = useWorkspace()
  const link = safeLinkUrl(query)
  const text = query.trim()
  const hits = !link && text.length >= 2 && searched.query === text ? searched.hits : []

  useEffect(() => {
    if (!open || text.length < 2 || link || !activeWorkspaceId) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      searchContext(convex, activeWorkspaceId, text)
        .then((found) => { if (!cancelled) setSearched({ query: text, hits: found }) })
        .catch(() => { if (!cancelled) setSearched({ query: text, hits: [] }) })
    }, 200)
    return () => { window.clearTimeout(timer); cancelled = true }
  }, [activeWorkspaceId, convex, link, open, text])

  function pick(ref: WorkContextRef) {
    onAdd(ref)
    setOpen(false)
    setQuery('')
  }

  return (
    <>
      <Button variant="ghost"
        ref={anchor}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={unstyledButton(`inline-flex h-[26px] items-center gap-1.5 rounded-[5px] bg-(--surface-subtle) px-2.5 text-[12.5px] text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)`)}
      >
        <Plus size={12} aria-hidden />
        Add file, note, chat or link
      </Button>
      <FloatingMenu anchorRef={anchor} open={open} onOpenChange={setOpen} className="w-72" role="dialog" aria-label="Add context" data-work-menu>
        <div className="px-2 pb-1 pt-1.5">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && link) pick({ type: 'link', id: link, label: labelForLink(link) }) }}
            aria-label="Search files, notes and chats, or paste a link"
            placeholder="Search, or paste a link"
            className={unstyledInput(`h-8 w-full rounded-md bg-(--surface-subtle) px-2.5 text-[13px] text-(--foreground) outline-none focus:bg-(--surface-muted)`)}
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {link ? (
            <MenuItem onClick={() => pick({ type: 'link', id: link, label: labelForLink(link) })} className="text-(--foreground)">
              <LinkIcon size={13} aria-hidden />
              <span className="flex-1 truncate">Add link {labelForLink(link)}</span>
            </MenuItem>
          ) : null}
          {hits.map((hit) => {
            const Icon = CONTEXT_ICONS[hit.type]
            return (
              <MenuItem key={`${hit.type}:${hit.id}`} onClick={() => pick(hit)} className="text-(--foreground)">
                <Icon size={13} aria-hidden />
                <span className="flex-1 truncate">{hit.label}</span>
              </MenuItem>
            )
          })}
          {!link && hits.length === 0 ? (
            <div className="px-3 py-2 text-xs text-(--muted-light)">{query.trim().length < 2 ? 'Type to search your files, notes and chats.' : 'Nothing found.'}</div>
          ) : null}
        </div>
      </FloatingMenu>
    </>
  )
}

/** Things the work depends on: files, notes, chats, links. */
export function ContextSection({ items, editable, onChange }: { items: WorkContextRef[]; editable: boolean; onChange: (items: WorkContextRef[]) => void }) {
  return (
    <Section title="Context">
      <div className="flex flex-wrap gap-1.5">
        {items.map((ref, index) => {
          const Icon = CONTEXT_ICONS[ref.type]
          const href = hrefForContext(ref)
          const body = (
            <>
              <Icon size={12} aria-hidden />
              <span className="max-w-48 truncate">{ref.label}</span>
            </>
          )
          return (
            <span key={`${ref.type}:${ref.id}:${index}`} className="group/ctx inline-flex h-[26px] items-center gap-1.5 rounded-[5px] bg-(--surface-elevated) pl-2.5 pr-1.5 text-[12.5px] text-(--foreground)">
              {href ? (
                <a href={href} {...(ref.type === 'link' ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="inline-flex items-center gap-1.5 hover:underline">{body}</a>
              ) : body}
              {editable ? (
                <Button variant="ghost" type="button" aria-label={`Remove ${ref.label}`} onClick={() => onChange(items.filter((_, i) => i !== index))} className={unstyledButton(`rounded p-0.5 text-(--muted-light) hover:bg-(--surface-subtle) hover:text-(--foreground)`)}>
                  <X size={11} />
                </Button>
              ) : null}
            </span>
          )
        })}
        {editable && items.length < WORK_LIMITS.contextItems ? <AddContext onAdd={(ref) => onChange([...items, ref])} /> : null}
        {!editable && items.length === 0 ? <span className="text-[13px] text-(--muted-light)">Nothing attached.</span> : null}
      </div>
    </Section>
  )
}

/** The conditions that make it done, as a checklist. A tap on the box ticks it. */
export function DoneWhenSection({ items, editable, onChange }: { items: WorkDoneWhen[]; editable: boolean; onChange: (items: WorkDoneWhen[]) => void }) {
  const [draft, setDraft] = useState('')
  const done = items.filter((item) => item.checked).length
  const set = (index: number, next: Partial<WorkDoneWhen>) => onChange(items.map((item, i) => (i === index ? { ...item, ...next } : item)))

  return (
    <Section title="Done when" hint={items.length > 0 ? `${done} of ${items.length}` : undefined}>
      <ul className="m-0 list-none p-0">
        {items.map((item, index) => (
          <li key={`${index}:${item.text}`} className="group/check flex items-start gap-2.5 py-1">
            <Button variant="ghost"
              type="button"
              role="checkbox"
              aria-checked={item.checked}
              aria-label={item.text}
              disabled={!editable}
              onClick={() => set(index, { checked: !item.checked })}
              // overlay:button-style: Checkbox.
              className={unstyledButton(`mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border-[1.5px] transition-colors ${item.checked ? 'border-(--foreground) bg-(--foreground) text-(--background)' : 'border-(--muted-light) text-transparent'}`)}
            >
              <Check size={11} strokeWidth={3} aria-hidden />
            </Button>
            {editable ? (
              <Input
                defaultValue={item.text}
                maxLength={WORK_LIMITS.doneWhenText}
                aria-label={`Condition ${index + 1}`}
                onBlur={(event) => {
                  const text = event.target.value.trim()
                  if (!text) onChange(items.filter((_, i) => i !== index))
                  else if (text !== item.text) set(index, { text })
                }}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                className={unstyledInput(`min-w-0 flex-1 bg-transparent text-[14.5px] leading-snug outline-none ${item.checked ? 'text-(--muted)' : 'text-(--foreground)'}`)}
              />
            ) : (
              <span className={`flex-1 text-[14.5px] leading-snug ${item.checked ? 'text-(--muted)' : 'text-(--foreground)'}`}>{item.text}</span>
            )}
            {editable ? (
              <Button variant="ghost" type="button" aria-label={`Remove “${item.text}”`} onClick={() => onChange(items.filter((_, i) => i !== index))} className={unstyledButton(`rounded p-0.5 text-(--muted-light) opacity-0 transition-opacity hover:text-(--foreground) group-hover/check:opacity-100 focus:opacity-100`)}>
                <X size={13} />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {editable && items.length < WORK_LIMITS.doneWhenItems ? (
        <div className="flex items-center gap-2.5 py-1 text-(--muted-light)">
          <span className="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border-[1.5px] border-dashed border-(--muted-light)" aria-hidden />
          <Input
            value={draft}
            maxLength={WORK_LIMITS.doneWhenText}
            aria-label="Add a condition"
            placeholder="Add a condition"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              const text = draft.trim()
              if (!text) return
              onChange([...items, { text, checked: false }])
              setDraft('')
            }}
            className={unstyledInput(`min-w-0 flex-1 bg-transparent text-[14.5px] text-(--foreground) outline-none placeholder:text-(--muted-light)`)}
          />
        </div>
      ) : null}
      {!editable && items.length === 0 ? <p className="text-[13px] text-(--muted-light)">No conditions yet.</p> : null}
    </Section>
  )
}

export function ActivitySection({ taskId, canComment }: { taskId: string; canComment: boolean }) {
  const { people, personByPrincipal, viewer } = useWorkData()
  // Live: comments and changes from anyone, in any tab, appear without reloading.
  const events = useLiveWorkEvents(taskId) ?? []
  const { addComment } = useWorkCommands()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const now = Date.now()
  const lookup = { ...indexPeople(people), viewerPrincipalId: viewer?.principalId ?? null }
  const me = viewer ? personByPrincipal.get(viewer.principalId) ?? null : null

  async function send() {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    setFailure(null)
    try {
      await addComment(taskId, body)
      setDraft('')
    } catch (caught) {
      const reason = parseWorkErrorReason(caught)
      setFailure(reason ? workErrorMessage(reason) : 'Could not post the comment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Activity">
      <ol className="m-0 ml-2 flex list-none flex-col gap-3.5 border-l border-(--border) p-0 pl-[18px]" data-testid="work-activity">
        {events.map((event) => {
          const body = commentBody(event)
          return (
            <li key={event.id} className="relative text-[13px] leading-normal text-(--muted)">
              <span className="absolute -left-[22px] top-[7px] box-content h-[7px] w-[7px] rounded-full border-[1.5px] border-(--background) bg-(--border)" aria-hidden />
              <span className="font-medium text-(--foreground)">{actorName(event, lookup)}</span>{' '}
              {body === null ? describeEvent(event, lookup) : 'commented'}
              <time className="ml-1.5 text-xs text-(--muted-light)" dateTime={new Date(event.createdAt).toISOString()}>{formatAgo(event.createdAt, now)}</time>
              {body !== null ? <p className="mt-1 whitespace-pre-wrap rounded-lg bg-(--surface-muted) px-3 py-2 text-[13.5px] text-(--foreground)">{body}</p> : null}
            </li>
          )
        })}
      </ol>
      {canComment ? (
        <div className="mt-4 flex items-center gap-2.5">
          <Avatar person={me} size={26} />
          <Input
            value={draft}
            maxLength={WORK_LIMITS.comment}
            disabled={busy}
            aria-label="Leave a comment"
            placeholder="Leave a comment"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }}
            className={unstyledInput(`h-9 min-w-0 flex-1 rounded-[10px] bg-(--surface-elevated) px-3.5 text-[13.5px] text-(--foreground) outline-none placeholder:text-(--muted-light) focus:border-(--muted-light)`)}
          />
        </div>
      ) : null}
      {failure ? <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{failure}</p> : null}
    </Section>
  )
}

/** Tasks that have to finish first. A task that would make a loop is not offered. */
export function WaitingOnSection({ item, editable, onChange }: { item: WorkItem; editable: boolean; onChange: (blockedBy: string[]) => void }) {
  const { items, byId, state } = useWorkData()
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const blockers = item.blockedBy.map((id) => byId.get(id)).filter((task): task is WorkItem => Boolean(task))
  const blocking = items.filter((other) => other.blockedBy.includes(item.id))
  const candidates = items
    .filter((other) => other.id !== item.id && other.scope === item.scope && other.archivedAt === null && !item.blockedBy.includes(other.id)
      && other.title.toLowerCase().includes(query.trim().toLowerCase())
      && checkBlockedBy({ id: item.id, blockers: [...item.blockedBy, other.id], blockedByOf: (id) => byId.get(id)?.blockedBy }).ok)
    .slice(0, 30)
  if (!editable && blockers.length === 0 && blocking.length === 0) return null
  if (state !== 'ready') return null
  const chip = (task: WorkItem, onRemove?: () => void) => (
    <span key={task.id} className="inline-flex h-[26px] items-center gap-1.5 rounded-[5px] bg-(--surface-elevated) pl-2 pr-1.5 text-[12.5px] text-(--foreground)">
      <StatusIcon status={task.status} size={13} />
      <span className="max-w-48 truncate">{task.title}</span>
      {onRemove ? (
        <Button variant="ghost" type="button" aria-label={`Stop waiting on ${task.title}`} onClick={onRemove} className={unstyledButton(`rounded p-0.5 text-(--muted-light) hover:bg-(--surface-subtle) hover:text-(--foreground)`)}>
          <X size={11} />
        </Button>
      ) : null}
    </span>
  )
  return (
    <Section title="Waiting on" hint={blockers.some((task) => task.status !== 'done') ? 'Not done yet' : undefined}>
      <div className="flex flex-wrap gap-1.5" data-testid="work-waiting-on">
        {blockers.map((task) => chip(task, editable ? () => onChange(item.blockedBy.filter((id) => id !== task.id)) : undefined))}
        {editable && item.blockedBy.length < WORK_LIMITS.blockedBy ? (
          <>
            <Button variant="ghost"
              ref={anchor}
              type="button"
              onClick={() => setOpen((current) => !current)}
              className={unstyledButton(`inline-flex h-[26px] items-center gap-1.5 rounded-[5px] bg-(--surface-subtle) px-2.5 text-[12.5px] text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)`)}
            >
              <Plus size={12} aria-hidden />
              Wait on a task
            </Button>
            <FloatingMenu anchorRef={anchor} open={open} onOpenChange={setOpen} className="w-72" role="dialog" aria-label="Wait on a task" data-work-menu>
              <div className="px-2 pb-1 pt-1.5">
                <Input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Find a task to wait on"
                  placeholder="Find a task"
                  className={unstyledInput(`h-8 w-full rounded-md bg-(--surface-subtle) px-2.5 text-[13px] text-(--foreground) outline-none focus:bg-(--surface-muted)`)}
                />
              </div>
              <div className="max-h-64 overflow-y-auto">
                {candidates.map((task) => (
                  <MenuItem key={task.id} onClick={() => { setOpen(false); setQuery(''); onChange([...item.blockedBy, task.id]) }} className="text-(--foreground)">
                    <StatusIcon status={task.status} size={13} />
                    <span className="flex-1 truncate">{task.title}</span>
                  </MenuItem>
                ))}
                {candidates.length === 0 ? <div className="px-3 py-2 text-xs text-(--muted-light)">No other task can be waited on here.</div> : null}
              </div>
            </FloatingMenu>
          </>
        ) : null}
        {blockers.length === 0 && !editable ? <span className="text-[13px] text-(--muted-light)">Nothing.</span> : null}
      </div>
      {blocking.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1.5 text-xs text-(--muted-light)">Holding up</div>
          <div className="flex flex-wrap gap-1.5" data-testid="work-holding-up">{blocking.map((task) => chip(task))}</div>
        </div>
      ) : null}
    </Section>
  )
}
