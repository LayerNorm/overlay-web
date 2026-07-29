import { Building2, UserRound } from 'lucide-react'
import type { WorkspaceSummary } from '../types'

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'W'
}

export function WorkspaceAvatar({
  workspace,
  size = 'md',
}: {
  workspace: Pick<WorkspaceSummary, 'name' | 'kind'>
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeClass = {
    sm: 'h-6 w-6 rounded-md text-[9px]',
    md: 'h-8 w-8 rounded-lg text-[10px]',
    lg: 'h-10 w-10 rounded-xl text-xs',
  }[size]
  const Icon = workspace.kind === 'personal' ? UserRound : Building2

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center border border-[var(--border)] bg-[var(--surface-subtle)] font-semibold text-[var(--foreground)] ${sizeClass}`}
      aria-hidden
    >
      <span>{initials(workspace.name)}</span>
      <Icon
        size={9}
        strokeWidth={2}
        className="absolute -bottom-0.5 -right-0.5 rounded-sm bg-[var(--surface-elevated)] p-px text-[var(--muted)]"
      />
    </span>
  )
}
