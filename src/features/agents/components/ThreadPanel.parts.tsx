'use client'

import { useMemo, type ReactNode } from 'react'
import { ExternalLink, FileText, GitCompare, ListChecks, type LucideIcon } from 'lucide-react'
import type { WorkspaceThreadPullRequest } from '@overlay/workspace-contracts'
import { Button } from '@overlay/ui/primitives'
import { RunPlan, SingleToolCallRow } from '@overlay/chat-react/exchange'
import { useRoomTranscript } from '@/components/providers/RoomTranscriptProvider'
import { threadActivity } from '../lib/thread-activity'

function useThreadActivity() {
  const messages = useRoomTranscript()
  return useMemo(() => threadActivity(messages), [messages])
}

function SectionTitle({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between px-1">
      <h3 className="text-[12px] font-medium text-(--muted)">{children}</h3>
      {meta ? <span className="text-[11px] text-(--muted-light)">{meta}</span> : null}
    </div>
  )
}

function EmptyPanel({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-16 text-center">
      <Icon className="size-5 text-(--muted)" strokeWidth={1.75} />
      <p className="text-[13px] font-medium text-(--foreground)">{title}</p>
      <p className="text-[12px] leading-5 text-(--muted)">{body}</p>
    </div>
  )
}

function LineCounts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="shrink-0 text-[11px] tabular-nums">
      <span className="text-green-700 dark:text-green-400">+{added}</span>{' '}
      <span className="text-red-600 dark:text-red-400">−{removed}</span>
    </span>
  )
}

/** The newest plan and every tool call in the thread, in the transcript's row style. */
export function ProgressPanel({ agentName }: { agentName: string }) {
  const { plan, calls } = useThreadActivity()
  if (!plan && calls.length === 0) {
    return <EmptyPanel icon={ListChecks} title="Nothing yet" body={`${agentName}'s plan and the steps it takes show up here.`} />
  }
  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-3">
      {plan ? <RunPlan steps={plan.steps} phase={plan.phase} /> : null}
      {calls.length ? (
        <section>
          <SectionTitle meta={`${calls.length} ${calls.length === 1 ? 'step' : 'steps'}`}>Activity</SectionTitle>
          <div className="flex flex-col">
            {calls.map((call) => <SingleToolCallRow key={call.key} block={call} />)}
          </div>
        </section>
      ) : null}
    </div>
  )
}

const PR_STATE: Record<WorkspaceThreadPullRequest['state'], { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'text-(--muted)' },
  open: { label: 'Open', color: 'text-green-700 dark:text-green-400' },
  merged: { label: 'Merged', color: 'text-purple-600 dark:text-purple-400' },
  closed: { label: 'Closed', color: 'text-orange-700 dark:text-orange-400' },
}

/** The thread's pull requests and the files it changed on its computer, with line counts. */
export function ChangesPanel({ pullRequests }: { pullRequests: readonly WorkspaceThreadPullRequest[] }) {
  const { edits } = useThreadActivity()
  if (pullRequests.length === 0 && edits.length === 0) {
    return <EmptyPanel icon={GitCompare} title="No changes" body="Files this thread edits and its pull requests show up here." />
  }
  const added = edits.reduce((sum, edit) => sum + edit.added, 0)
  const removed = edits.reduce((sum, edit) => sum + edit.removed, 0)
  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-4">
      {pullRequests.length ? (
        <section className="flex flex-col gap-2">
          {pullRequests.map((pr) => (
            <div key={`${pr.owner}/${pr.repo}#${pr.number}`} className="flex items-start gap-2.5 rounded-xl border border-(--border) p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-(--foreground)">{pr.title || `Pull request #${pr.number}`}</p>
                <p className="mt-0.5 truncate text-[12px] text-(--muted)">
                  {pr.owner}/{pr.repo} #{pr.number} · <span className={PR_STATE[pr.state].color}>{PR_STATE[pr.state].label}</span>
                </p>
              </div>
              <Button asChild variant="ghost" size="icon-xs" className="text-(--muted)">
                <a href={`https://github.com/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/pull/${pr.number}`}
                  target="_blank" rel="noopener noreferrer" aria-label="Open on GitHub" title="Open on GitHub">
                  <ExternalLink />
                </a>
              </Button>
            </div>
          ))}
        </section>
      ) : null}
      {edits.length ? (
        <section>
          <SectionTitle meta={<LineCounts added={added} removed={removed} />}>
            {edits.length === 1 ? '1 file changed' : `${edits.length} files changed`}
          </SectionTitle>
          <ul className="overflow-hidden rounded-xl border border-(--border)">
            {edits.map((edit) => (
              <li key={edit.path} title={edit.path}
                className="flex items-center gap-2 border-b border-(--border) px-3 py-2 text-[12px] last:border-b-0">
                <FileText className="size-3.5 shrink-0 text-(--muted)" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate text-(--foreground) [direction:rtl] text-left">{edit.path}</span>
                <LineCounts added={edit.added} removed={edit.removed} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
