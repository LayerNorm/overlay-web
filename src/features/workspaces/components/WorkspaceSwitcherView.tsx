'use client'

import { unstyledButton } from './control-reset'

import { workspaceMemberLabel } from '@/shared/workspaces/solo-workspace'
import { type ReactNode, type RefObject } from 'react'
import { Check, ChevronDown, Loader2, Plus, RefreshCw } from 'lucide-react'
import { CollapsibleSection, MenuItem, Popover, PopoverContent, PopoverTrigger, Button } from '@overlay/ui/primitives'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { WorkspaceAvatar } from './WorkspaceAvatar'
import type { WorkspaceLifecycleStatus, WorkspaceSummary } from '@/shared/workspaces/types'

type WorkspaceListProps = {
  status: WorkspaceLifecycleStatus
  workspaces: readonly WorkspaceSummary[]
  activeWorkspaceId: string | null
  switchingWorkspaceId: string | null
  error: string | null
  onRetry(): void
  onSelectWorkspace(workspaceId: string): void
  onCreateRequest(): void
}

function WorkspaceList({
  status,
  workspaces,
  activeWorkspaceId,
  switchingWorkspaceId,
  error,
  onRetry,
  onSelectWorkspace,
  onCreateRequest,
}: WorkspaceListProps) {
  return (
    <>
      {status === 'loading' ? (
        <div className="space-y-1 px-2 py-2" aria-label="Loading workspaces">
          {[0, 1].map((item) => (
            <div key={item} className="flex items-center gap-2.5">
              <span className="h-7 w-7 animate-pulse rounded-lg bg-(--surface-subtle)" />
              <span className="h-3 flex-1 animate-pulse rounded-sm bg-(--surface-subtle)" />
            </div>
          ))}
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="px-2 py-3 text-xs text-(--muted)">
          <p>{error ?? 'Could not load workspaces.'}</p>
          <Button variant="ghost"
            type="button"
            className={unstyledButton(`mt-2 inline-flex items-center gap-1.5 font-medium text-(--foreground)`)}
            onClick={onRetry}
          >
            <RefreshCw size={12} />
            Try again
          </Button>
        </div>
      ) : null}

      {status === 'ready' && workspaces.length === 0 ? (
        <div className="px-2 py-3 text-xs text-(--muted)">
          No workspaces yet. Create one to start collaborating.
        </div>
      ) : null}

      {status === 'ready'
        ? workspaces.map((workspace) => {
            const selected = workspace.id === activeWorkspaceId
            const switching = workspace.id === switchingWorkspaceId
            // Every workspace reads the same: a name and how many people are in it.
            const memberLabel = workspaceMemberLabel(workspace) ?? '1 member'
            return (
              <MenuItem
                key={workspace.id}
                aria-pressed={selected}
                disabled={Boolean(switchingWorkspaceId)}
                className="rounded-lg py-2"
                onClick={() => onSelectWorkspace(workspace.id)}
              >
                <WorkspaceAvatar workspace={workspace} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-(--foreground)">
                    {workspace.name}
                  </span>
                  <span className="block truncate text-[10px] capitalize text-(--muted-light)">
                    {memberLabel}
                  </span>
                </span>
                {switching ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : selected ? (
                  <Check size={13} className="text-(--foreground)" />
                ) : null}
              </MenuItem>
            )
          })
        : null}

      <MenuItem className="rounded-lg" onClick={onCreateRequest}>
        <Plus size={14} />
        Create workspace
      </MenuItem>
    </>
  )
}

type WorkspaceSwitcherMenuProps = WorkspaceListProps & {
  isFooter: boolean
  compact: boolean
  menuRef: RefObject<HTMLDivElement | null>
  activeWorkspaceName?: string
  actionError: string | null
  accountMenu?: ReactNode
}

function WorkspaceSwitcherMenu({
  isFooter,
  compact,
  menuRef,
  activeWorkspaceName,
  actionError,
  accountMenu,
  ...workspaceListProps
}: WorkspaceSwitcherMenuProps) {
  return (
    <PopoverContent
      ref={menuRef}
      side={isFooter ? 'top' : 'bottom'}
      align={compact && !isFooter ? 'end' : 'start'}
      aria-label={isFooter ? 'Workspace and account' : 'Workspaces'}
      className="w-[min(280px,calc(100vw-16px))] p-1"
    >
      <CollapsibleSection
        label="Workspaces"
        defaultOpen
        headerClassName="px-2 py-1.5 tracking-[0.08em]"
        contentClassName="pb-0"
        collapsedSummary={activeWorkspaceName}
      >
        <WorkspaceList {...workspaceListProps} />
      </CollapsibleSection>
      {actionError ? (
        <p role="alert" className="px-3 pb-2 pt-1 text-[11px] text-red-500">
          {actionError}
        </p>
      ) : null}
      {accountMenu}
    </PopoverContent>
  )
}

type WorkspaceSwitcherTriggerProps = {
  open: boolean
  compact: boolean
  isFooter: boolean
  status: WorkspaceLifecycleStatus
  activeWorkspace: WorkspaceSummary | null
  userLabel?: string
}

function triggerButtonClassName(isFooter: boolean, compact: boolean): string {
  if (isFooter) {
    return `w-full gap-2 px-2 py-1.5 ${compact ? 'justify-center' : ''}`
  }
  if (compact) return 'h-9 max-w-full gap-2 px-2'
  return 'h-10 w-full gap-2.5 px-1.5'
}

function triggerWorkspaceLabel(
  status: WorkspaceLifecycleStatus,
  activeWorkspace: WorkspaceSummary | null,
): string {
  if (status === 'loading') return 'Loading workspace…'
  return activeWorkspace?.name ?? 'Choose a workspace'
}

function triggerSecondaryLabel(
  compact: boolean,
  isFooter: boolean,
  userLabel: string | undefined,
  activeWorkspace: WorkspaceSummary | null,
): string | null | undefined {
  if (!isFooter && !compact) return userLabel ?? activeWorkspace?.role
  if (isFooter) return userLabel
  return null
}

function WorkspaceSwitcherTriggerAvatar({
  compact,
  isFooter,
  activeWorkspace,
}: {
  compact: boolean
  isFooter: boolean
  activeWorkspace: WorkspaceSummary | null
}) {
  if (activeWorkspace) {
    return <WorkspaceAvatar workspace={activeWorkspace} size={compact || isFooter ? 'sm' : 'md'} />
  }
  return (
    <span className={`${compact || isFooter ? 'h-6 w-6' : 'h-8 w-8'} shrink-0 animate-pulse rounded-lg bg-(--surface-subtle)`} />
  )
}

function WorkspaceSwitcherTriggerLabels({
  isFooter,
  workspaceLabel,
  secondaryLabel,
}: {
  isFooter: boolean
  workspaceLabel: string
  secondaryLabel?: string | null
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className={`block truncate font-medium text-(--foreground) ${isFooter ? 'text-xs' : 'text-[13px]'}`}>
        {workspaceLabel}
      </span>
      {secondaryLabel ? (
        <span className="block truncate text-[10px] text-(--muted-light)">
          {secondaryLabel}
        </span>
      ) : null}
    </span>
  )
}

function WorkspaceSwitcherTrigger({
  open,
  compact,
  isFooter,
  status,
  activeWorkspace,
  userLabel,
}: WorkspaceSwitcherTriggerProps) {
  return (
    <PopoverTrigger asChild>
      <Button variant="ghost"
        type="button"
        aria-label={isFooter ? 'Workspace and account menu' : 'Switch workspace'}
        aria-expanded={open}
        className={unstyledButton(`group flex min-w-0 items-center rounded-lg text-left transition-colors hover:bg-(--surface-subtle) ${triggerButtonClassName(isFooter, compact)}`)}
      >
        <WorkspaceSwitcherTriggerAvatar
          compact={compact}
          isFooter={isFooter}
          activeWorkspace={activeWorkspace}
        />
        {!compact ? (
          <WorkspaceSwitcherTriggerLabels
            isFooter={isFooter}
            workspaceLabel={triggerWorkspaceLabel(status, activeWorkspace)}
            secondaryLabel={triggerSecondaryLabel(compact, isFooter, userLabel, activeWorkspace)}
          />
        ) : null}
        {!compact ? (
          <ChevronDown
            size={13}
            className={`shrink-0 text-(--muted-light) transition-transform ${open ? 'rotate-180' : ''}`}
          />
        ) : null}
      </Button>
    </PopoverTrigger>
  )
}

export type WorkspaceSwitcherViewProps = {
  rootRef: RefObject<HTMLDivElement | null>
  menuRef: RefObject<HTMLDivElement | null>
  open: boolean
  compact: boolean
  placement: 'header' | 'footer'
  accountMenu?: ReactNode
  userLabel?: string
  status: WorkspaceLifecycleStatus
  workspaces: readonly WorkspaceSummary[]
  activeWorkspace: WorkspaceSummary | null
  activeWorkspaceId: string | null
  switchingWorkspaceId: string | null
  error: string | null
  actionError: string | null
  refresh(): void
  onSelectWorkspace(workspaceId: string): void
  onCreateRequest(): void
  onOpenChange(open: boolean): void
  createOpen: boolean
  createBusy: boolean
  onCreateOpenChange(open: boolean): void
  onCreate(name: string): Promise<void>
}

export function WorkspaceSwitcherView({
  rootRef,
  menuRef,
  open,
  compact,
  placement,
  accountMenu,
  userLabel,
  status,
  workspaces,
  activeWorkspace,
  activeWorkspaceId,
  switchingWorkspaceId,
  error,
  actionError,
  refresh,
  onSelectWorkspace,
  onCreateRequest,
  onOpenChange,
  createOpen,
  createBusy,
  onCreateOpenChange,
  onCreate,
}: WorkspaceSwitcherViewProps) {
  const isFooter = placement === 'footer'

  // Footer hosts the account control. Never unmount it while workspaces are idle
  // (first paint before the client session enables the workspace provider).
  if (status === 'idle' && !isFooter && !accountMenu) return null

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <div ref={rootRef} className="relative min-w-0">
          <WorkspaceSwitcherTrigger
            open={open}
            compact={compact}
            isFooter={isFooter}
            status={status}
            activeWorkspace={activeWorkspace}
            userLabel={userLabel}
          />
          <WorkspaceSwitcherMenu
            compact={compact}
            isFooter={isFooter}
            menuRef={menuRef}
            activeWorkspaceName={activeWorkspace?.name}
            actionError={actionError}
            accountMenu={accountMenu}
            status={status}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            switchingWorkspaceId={switchingWorkspaceId}
            error={error}
            onRetry={refresh}
            onSelectWorkspace={onSelectWorkspace}
            onCreateRequest={onCreateRequest}
          />
        </div>
      </Popover>
      {createOpen ? (
        <CreateWorkspaceDialog
          open
          busy={createBusy}
          error={actionError}
          onOpenChange={onCreateOpenChange}
          onCreate={onCreate}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
          }}
        />
      ) : null}
    </>
  )
}
