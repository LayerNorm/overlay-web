import { useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  SidebarAccountMenu,
  WorkspaceSwitcherView,
  type ShellWorkspace,
} from '@overlay/shell-react'
import { useWorkspace } from '../contexts/WorkspaceContext'

function memberLabel(workspace: { kind: string; role?: string }): string {
  if (workspace.kind === 'personal') return 'Personal'
  return workspace.role ? `Organization · ${workspace.role}` : 'Organization'
}

function renderWorkspaceAvatar(workspace: ShellWorkspace, size: 'sm' | 'md' | 'lg'): ReactNode {
  const dimensions = size === 'lg' ? 'h-9 w-9' : size === 'md' ? 'h-8 w-8' : 'h-7 w-7'
  return (
    <span
      className={`${dimensions} flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-(--border) bg-(--surface-subtle) text-xs font-semibold text-(--foreground)`}
    >
      {workspace.iconUrl ? (
        <img src={workspace.iconUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        workspace.name.trim().slice(0, 1).toUpperCase() || '?'
      )}
    </span>
  )
}

export function DesktopWorkspaceSwitcher({
  onOpenAccount,
  onOpenSettings,
  onSignOut,
}: {
  onOpenAccount: () => void
  onOpenSettings: () => void
  onSignOut: () => void
}): ReactElement<any> {
  const {
    status,
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    error,
    switchingWorkspaceId,
    refresh,
    switchWorkspace,
  } = useWorkspace()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const shellWorkspaces: ShellWorkspace[] = workspaces.map((workspace) => ({
    ...workspace,
    memberLabel: memberLabel(workspace),
  }))
  const activeShellWorkspace =
    shellWorkspaces.find((workspace) => workspace.id === activeWorkspace?.id) ?? null
  const accountMenu = (
    <SidebarAccountMenu
      onAccountClick={onOpenAccount}
      onSettingsClick={onOpenSettings}
      onSignOut={onSignOut}
    />
  )

  return (
    <WorkspaceSwitcherView
      rootRef={rootRef}
      menuRef={menuRef}
      open={open}
      compact={false}
      placement="footer"
      accountMenu={accountMenu}
      userLabel={activeWorkspace ? memberLabel(activeWorkspace) : 'Account'}
      renderAvatar={renderWorkspaceAvatar}
      status={status}
      workspaces={shellWorkspaces}
      activeWorkspace={activeShellWorkspace}
      activeWorkspaceId={activeWorkspaceId}
      switchingWorkspaceId={switchingWorkspaceId}
      error={error}
      actionError={null}
      refresh={() => void refresh()}
      onSelectWorkspace={(workspaceId) => void switchWorkspace(workspaceId)}
      onCreateRequest={() => window.bridge.openExternal('https://www.getoverlay.io/app/workspaces?create=1')}
      onOpenChange={setOpen}
    />
  )
}
