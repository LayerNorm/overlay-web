import { useState, type ReactNode } from 'react'
import {
  ArrowDownToLine, Check, ChevronDown, Cloud, CloudUpload, FolderGit2, FolderPlus, GitBranch, Laptop, Loader2, ShieldCheck,
} from 'lucide-react'
import {
  Button, DialogFrame, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, toast,
} from '@overlay/ui/primitives'
import { splitHref, useHref } from '../../shims/router'
import {
  CLOUD_FILES, CONTEXT_PACKAGE, DELEGATED_TASKS, HANDOFF_EXCLUDED, HANDOFF_FILES, HANDOFF_UNTRACKED, PROJECT, PROJECT_AGENT_ID,
  THREAD_BRANCH, isProjectThread, markApplied, moveThread, readMarker, useContinuity, type DelegatedTask, type Where,
} from './model'

function useConversationId(): string | null {
  const { search } = splitHref(useHref())
  return new URLSearchParams(search).get('id')
}

const WHERE_LABEL: Record<Where, string> = { mac: 'This Mac', cloud: 'Cloud computer' }
const WhereIcon = ({ where, size = 12 }: { where: Where; size?: number }) =>
  where === 'mac' ? <Laptop size={size} strokeWidth={1.75} /> : <Cloud size={size} strokeWidth={1.75} />

function DiffStats({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="inline-flex shrink-0 gap-1 text-[11px] tabular-nums">
      <span className="text-(--success)">+{added}</span>
      <span className="text-(--danger)">−{removed}</span>
    </span>
  )
}

function FileList({ files, extra }: { files: Array<{ path: string; added: number; removed: number }>; extra?: ReactNode }) {
  return (
    <ul className="divide-y divide-(--border) rounded-lg border border-(--border)">
      {files.map((file) => (
        <li key={file.path} className="flex items-center gap-3 px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-(--foreground)/85">{file.path}</span>
          <DiffStats added={file.added} removed={file.removed} />
        </li>
      ))}
      {extra}
    </ul>
  )
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-xs font-medium text-(--foreground)">{title}</h3>
        {aside ? <span className="ml-auto text-[11px] text-(--muted-light)">{aside}</span> : null}
      </div>
      {children}
    </section>
  )
}

const dialogClass = 'flex max-h-[min(760px,calc(100vh-32px))] w-[min(480px,94vw)]! flex-col rounded-[20px]! p-0! [&>div:first-child]:px-5 [&>div:first-child]:pt-4 [&>p]:px-5'

// ---- Phase 3: continue in the cloud

function ContinueInCloudDialog({ open, branch, onClose, onConfirm }: { open: boolean; branch: string; onClose(): void; onConfirm(): void }) {
  const [stripeKey, setStripeKey] = useState('')
  const added = HANDOFF_FILES.reduce((sum, file) => sum + file.added, 0)
  const removed = HANDOFF_FILES.reduce((sum, file) => sum + file.removed, 0)
  return (
    <DialogFrame
      open={open}
      onOpenChange={(next) => { if (!next) onClose() }}
      title="Continue in the cloud"
      description="Atlas keeps this thread and carries on in a cloud computer. Your Mac is left as it is until you bring the work back."
      className={dialogClass}
    >
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5 pt-4">
        <Section title="Snapshot" aside={<DiffStats added={added} removed={removed} />}>
          <p className="text-xs text-(--muted)">
            Your uncommitted work on <span className="font-mono text-(--foreground)/85">{branch}</span> is pushed as{' '}
            <span className="font-mono text-(--foreground)/85">overlay/handoff/pricing-mobile</span>.
          </p>
          <FileList
            files={HANDOFF_FILES}
            extra={HANDOFF_UNTRACKED.map((path) => (
              <li key={path} className="flex items-center gap-3 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-(--foreground)/85">{path}</span>
                <span className="text-[11px] text-(--muted-light)">New</span>
              </li>
            ))}
          />
          <p className="flex items-start gap-1.5 text-[11px] text-(--muted-light)">
            <ShieldCheck size={12} className="mt-px shrink-0" />
            <span>Not uploaded: {HANDOFF_EXCLUDED.map((path, index) => <span key={path}>{index ? ', ' : ''}<span className="font-mono">{path}</span></span>)}</span>
          </p>
        </Section>
        <Section title="Context" aside={`Version ${CONTEXT_PACKAGE.version}`}>
          <ContextSummary />
        </Section>
        <Section title="Needed values">
          <div className="space-y-2">
            {CONTEXT_PACKAGE.neededValues.map((value) => (
              <div key={value.name} className="flex items-center gap-3">
                <span className="w-36 shrink-0 truncate font-mono text-[11px] text-(--foreground)/85">{value.name}</span>
                {value.saved ? (
                  <span className="flex h-8 flex-1 items-center gap-1.5 text-xs text-(--muted)"><Check size={13} className="text-(--success)" />Saved in Overlay</span>
                ) : (
                  <Input type="password" value={stripeKey} onChange={(event) => setStripeKey(event.target.value)} placeholder="Paste a value" aria-label={value.name} className="h-8 flex-1 text-xs" />
                )}
              </div>
            ))}
          </div>
        </Section>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-(--border) px-5 py-3">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={onConfirm}><CloudUpload size={14} />Continue in cloud</Button>
      </div>
    </DialogFrame>
  )
}

function ContextSummary() {
  const rows: Array<[string, string]> = [
    ['Instructions', CONTEXT_PACKAGE.instructions.join(', ')],
    ['Skills', CONTEXT_PACKAGE.skills.join(', ')],
    ['MCP servers', `${CONTEXT_PACKAGE.mcpServers.join(', ')} (no secrets)`],
  ]
  return (
    <dl className="space-y-1.5 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-3">
          <dt className="w-24 shrink-0 text-(--muted)">{label}</dt>
          <dd className="min-w-0 flex-1 truncate text-(--foreground)/85">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ---- Phase 3: bring back, and Phase 4: review a delegated branch

function BringBackDialog({ open, title, description, files, confirmLabel, onClose, onConfirm }: {
  open: boolean
  title: string
  description: ReactNode
  files: Array<{ path: string; added: number; removed: number }>
  confirmLabel: string
  onClose(): void
  onConfirm(): void
}) {
  return (
    <DialogFrame open={open} onOpenChange={(next) => { if (!next) onClose() }} title={title} description={description} className={dialogClass}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">
        <FileList files={files} />
        <p className="flex items-center gap-1.5 text-xs text-(--muted)">
          <Check size={13} className="shrink-0 text-(--success)" />
          No edits on your Mac since then, so nothing conflicts.
        </p>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-(--border) px-5 py-3">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={onConfirm}><ArrowDownToLine size={14} />{confirmLabel}</Button>
      </div>
    </DialogFrame>
  )
}

// ---- Phase 2: where the thread runs, under the composer

function MenuSection({ label }: { label: string }) {
  return <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-light)">{label}</div>
}

function ComposerChip({ children, ...props }: { children: ReactNode } & Record<string, unknown>) {
  return (
    <Button variant="ghost" size="xs" className="h-6 max-w-[220px] gap-1.5 px-1.5 text-[11px] font-normal text-(--muted)" {...props}>
      {children}
    </Button>
  )
}

/** Shown under the composer of a thread bound to a project, in place of the disclaimer. */
export function ContinuityComposerFooter({ fallback }: { fallback: ReactNode }) {
  const conversationId = useConversationId()
  const { where } = useContinuity()
  const [dialog, setDialog] = useState<'cloud' | 'mac' | null>(null)
  if (!isProjectThread(conversationId)) return <>{fallback}</>
  const current = where[conversationId] ?? 'mac'
  const branch = THREAD_BRANCH[conversationId]
  const choose = (next: Where) => { if (next !== current) setDialog(next) }

  return (
    <>
      <div className="mt-1.5 flex min-w-0 items-center gap-0.5 px-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ComposerChip aria-label="Where this thread runs">
              <WhereIcon where={current} />
              <span className="truncate">{WHERE_LABEL[current]}</span>
              <ChevronDown size={11} className="shrink-0 opacity-60" />
            </ComposerChip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <MenuSection label="Runs on" />
            {(['mac', 'cloud'] as const).map((option) => (
              <DropdownMenuItem key={option} onSelect={() => choose(option)} className="gap-2 text-xs">
                <WhereIcon where={option} size={14} />
                <span className="flex-1">
                  {WHERE_LABEL[option]}
                  <span className="block text-[11px] text-(--muted-light)">{option === 'mac' ? 'MacBook Pro · online' : 'Atlas’s computer · ready'}</span>
                </span>
                {option === current ? <Check size={13} /> : null}
              </DropdownMenuItem>
            ))}
            <MenuSection label="Project" />
            <DropdownMenuItem className="gap-2 text-xs">
              <FolderGit2 size={14} strokeWidth={1.75} />
              <span className="flex-1">{PROJECT.name}<span className="block text-[11px] text-(--muted-light)">{PROJECT.path}</span></span>
              <Check size={13} />
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs">
              <FolderGit2 size={14} strokeWidth={1.75} />
              <span className="flex-1">northwind-api<span className="block text-[11px] text-(--muted-light)">~/code/northwind-api</span></span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs text-(--muted)">
              <FolderPlus size={14} strokeWidth={1.75} />
              Add a folder…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ComposerChip aria-label="Project folder" className="h-6 max-w-[220px] gap-1.5 px-1.5 text-[11px] font-normal text-(--muted) max-sm:hidden">
          <FolderGit2 size={12} strokeWidth={1.75} />
          <span className="truncate">{PROJECT.name}</span>
        </ComposerChip>
        <ComposerChip aria-label="Branch" className="h-6 max-w-[220px] gap-1.5 px-1.5 text-[11px] font-normal text-(--muted) max-sm:hidden">
          <GitBranch size={12} strokeWidth={1.75} />
          <span className="truncate font-mono">{branch}</span>
        </ComposerChip>
        <span className="flex-1" />
        <Button variant="ghost" size="xs" className="h-6 shrink-0 gap-1.5 px-2 text-[11px]" onClick={() => setDialog(current === 'mac' ? 'cloud' : 'mac')}>
          {current === 'mac' ? <CloudUpload size={12} /> : <ArrowDownToLine size={12} />}
          {current === 'mac' ? 'Continue in cloud' : 'Bring back to Mac'}
        </Button>
      </div>
      <ContinueInCloudDialog
        open={dialog === 'cloud'}
        branch={branch}
        onClose={() => setDialog(null)}
        onConfirm={() => { moveThread(conversationId, 'cloud'); setDialog(null); toast('Atlas is continuing in the cloud') }}
      />
      <BringBackDialog
        open={dialog === 'mac'}
        title="Bring back to this Mac"
        description={<>Atlas made 3 commits in the cloud since the handoff. They’ll be checked out on <span className="font-mono">{branch}</span> in {PROJECT.path}.</>}
        files={CLOUD_FILES}
        confirmLabel="Bring back"
        onClose={() => setDialog(null)}
        onConfirm={() => { moveThread(conversationId, 'mac'); setDialog(null); toast('Back on your Mac') }}
      />
    </>
  )
}

// ---- Transcript rows: the handoff divider and delegated tasks

export function ContinuityTranscriptRow({ message, children }: { message: { content?: unknown }; children: ReactNode }) {
  const marker = readMarker(message.content)
  if (!marker) return <>{children}</>
  if (marker.kind === 'handoff') {
    return (
      <div className="flex items-center gap-3 py-1 text-[11px] text-(--muted-light)">
        <span className="h-px flex-1 bg-(--border)" />
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {marker.to === 'cloud' ? <CloudUpload size={12} className="shrink-0" /> : <ArrowDownToLine size={12} className="shrink-0" />}
          <span className="truncate">
            {marker.to === 'cloud' ? 'Continued in the cloud' : 'Brought back to this Mac'} · <span className="font-mono">{marker.snapshot}</span> · {marker.files} files
          </span>
        </span>
        <span className="h-px flex-1 bg-(--border)" />
      </div>
    )
  }
  return <DelegatedTasks />
}

function DelegatedTasks() {
  const { applied } = useContinuity()
  const [reviewing, setReviewing] = useState<DelegatedTask | null>(null)
  return (
    <div className="pl-11 pr-2">
      <div className="divide-y divide-(--border) rounded-xl border border-(--border)">
        {DELEGATED_TASKS.map((task) => {
          const added = task.files.reduce((sum, file) => sum + file.added, 0)
          const removed = task.files.reduce((sum, file) => sum + file.removed, 0)
          return (
            <div key={task.id} className="flex items-center gap-3 px-3 py-2.5">
              {task.status === 'running'
                ? <Loader2 size={14} className="shrink-0 animate-spin text-(--muted)" />
                : <Cloud size={14} strokeWidth={1.75} className="shrink-0 text-(--muted)" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-(--foreground)">{task.title}</p>
                <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-(--muted-light)">
                  {task.status === 'running' ? (
                    <span className="truncate">Atlas in the cloud · {task.step} · {task.minutes}m</span>
                  ) : (
                    <>
                      <span className="truncate">Atlas in the cloud · <span className="font-mono">{task.branch}</span> · {task.files.length} files</span>
                      <DiffStats added={added} removed={removed} />
                    </>
                  )}
                </p>
              </div>
              {task.status === 'done' ? (
                applied[task.id] ? (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-(--muted)"><Check size={12} className="text-(--success)" />On your Mac</span>
                ) : (
                  <Button variant="secondary" size="xs" className="shrink-0" onClick={() => setReviewing(task)}>Review</Button>
                )
              ) : (
                <Button variant="ghost" size="xs" className="shrink-0">Open</Button>
              )}
            </div>
          )
        })}
      </div>
      <BringBackDialog
        open={Boolean(reviewing)}
        title={reviewing?.title ?? ''}
        description={reviewing ? <>Atlas finished this in the cloud on <span className="font-mono">{reviewing.branch}</span>. Bringing it back merges the branch into <span className="font-mono">feat/stripe-v2</span> in {PROJECT.path}.</> : null}
        files={reviewing?.files ?? []}
        confirmLabel="Bring to my Mac"
        onClose={() => setReviewing(null)}
        onConfirm={() => { if (reviewing) markApplied(reviewing.id); setReviewing(null); toast('Merged into feat/stripe-v2 on your Mac') }}
      />
    </div>
  )
}

// ---- Phase 2: the agent's project, in the right panel's Details

export function continuityProjectSummary(agentId: string | undefined): string | null {
  return agentId === PROJECT_AGENT_ID ? `${PROJECT.name} · This Mac` : null
}

export function ContinuityProjectDetails() {
  const rows: Array<[string, ReactNode]> = [
    ['Folder', <span key="f" className="font-mono">{PROJECT.path}</span>],
    ['New threads', 'Start on This Mac'],
    ['Instructions', CONTEXT_PACKAGE.instructions.join(', ')],
    ['Skills', CONTEXT_PACKAGE.skills.join(', ')],
    ['MCP servers', CONTEXT_PACKAGE.mcpServers.join(', ')],
    ['Needed values', `${CONTEXT_PACKAGE.neededValues.length} (1 saved)`],
  ]
  return (
    <div className="space-y-3 px-1">
      <dl className="space-y-1.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-3">
            <dt className="w-24 shrink-0 text-(--muted)">{label}</dt>
            <dd className="min-w-0 flex-1 truncate text-(--foreground)/85">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[11px] leading-relaxed text-(--muted-light)">
        Context version {CONTEXT_PACKAGE.version}, read from the folder. Secrets and <span className="font-mono">.env</span> files never leave your Mac; needed values are asked for by name.
      </p>
    </div>
  )
}
