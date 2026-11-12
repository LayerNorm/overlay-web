'use client'

import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'
import type { WorkspaceThreadPullRequest } from '@overlay/workspace-contracts'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@overlay/ui/primitives'

const STATES = {
  draft: { icon: GitPullRequestDraft, label: 'Draft', color: 'text-(--muted)' },
  open: { icon: GitPullRequest, label: 'Open', color: 'text-green-700 dark:text-green-400' },
  merged: { icon: GitMerge, label: 'Merged', color: 'text-purple-600 dark:text-purple-400' },
  closed: { icon: GitPullRequestClosed, label: 'Closed', color: 'text-orange-700 dark:text-orange-400' },
}

export function ThreadPullRequests({ pullRequests }: { pullRequests?: readonly WorkspaceThreadPullRequest[] }) {
  if (!pullRequests?.length) return null
  const groups = Object.entries(STATES).flatMap(([state, meta]) => {
    const count = pullRequests.filter(pr => pr.state === state).length
    return count ? [{ ...meta, state, count }] : []
  })
  const label = `Pull requests: ${groups.map(group => `${group.count} ${group.label.toLowerCase()}`).join(', ')}`
  return <Popover>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-1" aria-label={label} title={label}>
        {groups.map(({ state, icon: Icon, color, count }) => <span key={state} className={`inline-flex items-center gap-0.5 ${color}`}>
          <Icon size={13} aria-hidden />{count > 1 ? <span className="text-[10px]">{count}</span> : null}
        </span>)}
      </Button>
    </PopoverTrigger>
    <PopoverContent side="right" align="start" className="w-80 max-w-[calc(100vw-2rem)] p-2" aria-label="Thread pull requests">
      <h3 className="px-2 py-1 text-xs font-medium text-(--muted)">Pull requests</h3>
      <div className="max-h-80 overflow-y-auto">
        {pullRequests.map(pr => {
          const { icon: Icon, color, label: state } = STATES[pr.state]
          return <Button key={`${pr.owner}/${pr.repo}#${pr.number}`} asChild variant="ghost" className="h-auto w-full justify-start gap-2 p-2 text-left font-normal">
            <a href={`https://github.com/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/pull/${pr.number}`} target="_blank" rel="noopener noreferrer">
              <Icon size={16} className={`shrink-0 ${color}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] text-(--muted)">{pr.owner}/{pr.repo}</span>
                <span className="block truncate text-sm">{pr.title || `Pull request #${pr.number}`}</span>
                <span className="block text-xs text-(--muted)">#{pr.number} · <span className={color}>{state}</span></span>
                <span className="block text-[10px] text-(--muted)">Last observed <time dateTime={new Date(pr.observedAt).toISOString()}>{new Date(pr.observedAt).toLocaleString()}</time></span>
              </span>
            </a>
          </Button>
        })}
      </div>
      <p className="px-2 pt-2 text-[11px] text-(--muted)">Status from this thread’s GitHub actions. Open GitHub for the latest.</p>
    </PopoverContent>
  </Popover>
}
