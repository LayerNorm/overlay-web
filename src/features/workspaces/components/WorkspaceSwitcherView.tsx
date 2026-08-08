'use client'

import { type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  ChevronDown,
  Loader2,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { CollapsibleSection, MenuItem, MenuSurface } from '@overlay/ui/primitives'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { WorkspaceAvatar } from './WorkspaceAvatar'
import type { WorkspaceLifecycleStatus, WorkspaceSummary } from '../types'

export type WorkspaceSwitcherMenuPosition = {
  left: number
  bottom?: number
  top?: number
  width: number
}

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
              <span className="h-7 w-7 animate-pulse rounded-lg bg-[var(--surface-subtle)]" />
              <span className="h-3 flex-1 animate-pulse rounded bg-[var(--surface-subtle)]" />
            </div>
          ))}
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="px-2 py-3 text-xs text-[var(--muted)]">
          <p>{error ?? 'Could not load workspaces.'}</p>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1.5 font-medium text-[var(--foreground)]"
            onClick={onRetry}
          >
            <RefreshCw size={12} />
            Try again
          </button>
        </div>
      ) : null}

      {status === 'ready' && workspaces.length === 0 ? (
        <div className="px-2 py-3 text-xs text-[var(--muted)]">
          No workspaces yet. Create one to start collaborating.
        </div>
      ) : null}

      {status === 'ready' ? workspaces.map((workspace) => {
        const selected = workspace.id === activeWorkspaceId
        const switching = workspace.id === switchingWorkspaceId
        const memberLabel = workspace.kind === 'personal'
          ? 'Personal'
          : `${workspace.memberCount ?? 1} ${workspace.memberCount === 1 ? 'member' : 'members'}`
        return (
          <MenuItem
            key={workspace.id}
            role="menuitemradio"
            aria-checked={selected}
            disabled={Boolean(switchingWorkspaceId)}
            className="rounded-lg py-2"
            onClick={() => onSelectWorkspace(workspace.id)}
          >
            <WorkspaceAvatar workspace={workspace} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-[var(--foreground)]">
                {workspace.name}
              </span>
              <span className="block truncate text-[10px] capitalize text-[var(--muted-light)]">
                {memberLabel}
              </span>
            </span>
            {switching ? (
              <Loader2 size={13} className="animate-spin" />
            ) : selected ? (
              <Check size={13} className="text-[var(--foreground)]" />
            ) : null}
          </MenuItem>
        )
      }) : null}

      <MenuItem
        role="menuitem"
        className="rounded-lg"
        onClick={onCreateRequest}
      >
        <Plus size={14} />
        Create workspace
      </MenuItem>
    </>
  )
}

type WorkspaceSwitcherMenuProps = WorkspaceListProps & {
  open: boolean
  compact: boolean
  portalMenu: boolean
  isFooter: boolean
  menuPosition: WorkspaceSwitcherMenuPosition | null
  menuRef: RefObject<HTMLDivElement | null>
  activeWorkspaceName?: string
  actionError: string | null
  accountMenu?: ReactNode
}

function WorkspaceSwitcherMenu({
  open,
  compact,
  portalMenu,
  isFooter,
  menuPosition,
  menuRef,
  activeWorkspaceName,
  actionError,
  accountMenu,
  ...workspaceListProps
}: WorkspaceSwitcherMenuProps) {
  if (!open) return null

  const menu = (
    <div
      ref={menuRef}
      className={`overlay-pop-in z-[10080] ${
        portalMenu
          ? 'fixed'
          : `absolute w-[min(280px,calc(100vw-2rem))] ${
            isFooter
              ? 'bottom-full left-0 mb-1.5'
              : compact
                ? 'right-0 top-full mt-1.5'
                : 'left-0 top-full mt-1.5 -translate-x-1'
          }`
      }`}
      style={portalMenu
        ? {
            left: menuPosition?.left,
            bottom: menuPosition?.bottom,
            top: menuPosition?.top,
            width: menuPosition?.width,
            visibility: menuPosition ? 'visible' : 'hidden',
          }
        : undefined}
    >
      <MenuSurface
        role="menu"
        aria-label={isFooter ? 'Workspace and account' : 'Workspaces'}
        className="overflow-hidden p-1"
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
      </MenuSurface>
    </div>
  )

  return portalMenu && typeof document !== 'undefined'
    ? createPortal(menu, document.body)
    : menu
}

type WorkspaceSwitcherTriggerProps = {
  open: boolean
  compact: boolean
  isFooter: boolean
  status: WorkspaceLifecycleStatus
  activeWorkspace: WorkspaceSummary | null
  userLabel?: string
  onToggle(): void
}

function WorkspaceSwitcherTrigger({
  open,
  compact,
  isFooter,
  status,
  activeWorkspace,
  userLabel,
  onToggle,
}: WorkspaceSwitcherTriggerProps) {
  const avatarSize = compact || isFooter ? 'sm' : 'md'
  const workspaceLabel = status === 'loading'
    ? 'Loading workspace…'
    : activeWorkspace?.name ?? 'Choose a workspace'
  const secondaryLabel = !isFooter && !compact
    ? userLabel ?? activeWorkspace?.role
    : isFooter
      ? userLabel
      : null

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isFooter ? 'Workspace and account menu' : 'Switch workspace'}
      aria-haspopup="menu"
      aria-expanded={open}
      className={`group flex min-w-0 items-center rounded-lg text-left transition-colors hover:bg-[var(--surface-subtle)] ${
        isFooter
          ? `w-full gap-2 px-2 py-1.5 ${compact ? 'justify-center' : ''}`
          : compact
            ? 'h-9 max-w-full gap-2 px-2'
            : 'h-10 w-full gap-2.5 px-1.5'
      }`}
    >
      {activeWorkspace ? (
        <WorkspaceAvatar workspace={activeWorkspace} size={avatarSize} />
      ) : (
        <span className={`${compact || isFooter ? 'h-6 w-6' : 'h-8 w-8'} shrink-0 animate-pulse rounded-lg bg-[var(--surface-subtle)]`} />
      )}
      {!compact ? (
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium text-[var(--foreground)] ${isFooter ? 'text-xs' : 'text-[13px]'}`}>
            {workspaceLabel}
          </span>
          {secondaryLabel ? (
            <span className="block truncate text-[10px] text-[var(--muted-light)]">
              {secondaryLabel}
            </span>
          ) : null}
        </span>
      ) : null}
      {!compact ? (
        <ChevronDown
          size={13}
          className={`shrink-0 text-[var(--muted-light)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      ) : null}
    </button>
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
  onToggle(): void
  menuPosition: WorkspaceSwitcherMenuPosition | null
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
  onToggle,
  menuPosition,
  createOpen,
  createBusy,
  onCreateOpenChange,
  onCreate,
}: WorkspaceSwitcherViewProps) {
  const isFooter = placement === 'footer'
  const portalMenu = isFooter || compact

  if (status === 'idle') return null

  return (
    <>
      <div ref={rootRef} className="relative min-w-0">
        <WorkspaceSwitcherTrigger
          open={open}
          compact={compact}
          isFooter={isFooter}
          status={status}
          activeWorkspace={activeWorkspace}
          userLabel={userLabel}
          onToggle={onToggle}
        />
        <WorkspaceSwitcherMenu
          open={open}
          compact={compact}
          portalMenu={portalMenu}
          isFooter={isFooter}
          menuPosition={menuPosition}
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
      {createOpen ? (
        <CreateWorkspaceDialog
          open
          busy={createBusy}
          error={actionError}
          onOpenChange={onCreateOpenChange}
          onCreate={onCreate}
        />
      ) : null}
    </>
  )
}
