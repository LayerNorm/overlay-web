import { Avatar, AvatarFallback } from '@overlay/ui/primitives'
import type { WorkspaceSummary } from '@/shared/workspaces/types'

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'W'
}

/** Every workspace looks the same: its initials. (There is no longer a separate look for a personal workspace.) */
export function WorkspaceAvatar({
  workspace,
  size = 'md',
}: {
  workspace: Pick<WorkspaceSummary, 'name'>
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeClass = {
    sm: 'h-6 w-6 rounded-md text-[9px]',
    md: 'h-8 w-8 rounded-lg text-[10px]',
    lg: 'h-10 w-10 rounded-xl text-xs',
  }[size]

  return (
    <Avatar className={`border border-(--border) bg-(--surface-subtle) font-semibold text-(--foreground) ${sizeClass}`} aria-hidden>
      <AvatarFallback className="bg-transparent font-semibold">{initials(workspace.name)}</AvatarFallback>
    </Avatar>
  )
}
