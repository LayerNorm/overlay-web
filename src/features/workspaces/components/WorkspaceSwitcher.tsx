'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  UsersRound,
} from 'lucide-react'
import { MenuItem, MenuSurface } from '@overlay/ui/primitives'
import { useWorkspace } from './WorkspaceProvider'
import { buildWorkspaceHref } from '../lib/workspace-routing'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { WorkspaceAvatar } from './WorkspaceAvatar'

export function WorkspaceSwitcher({
  onNavigate,
  compact = false,
  showcase = false,
  placement = 'header',
  accountMenu,
  userLabel,
}: {
  onNavigate?: () => void
  compact?: boolean
  showcase?: boolean
  /** Footer placement opens upward and can host the account menu. */
  placement?: 'header' | 'footer'
  accountMenu?: ReactNode
  userLabel?: string
}) {
  const pathname = usePathname() ?? '/app/chat'
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    status,
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    switchingWorkspaceId,
    error,
    refresh,
    createWorkspace,
    switchWorkspace,
  } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const isFooter = placement === 'footer'

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  async function selectWorkspace(workspaceId: string) {
    setActionError(null)
    try {
      await switchWorkspace(workspaceId)
      setOpen(false)
      onNavigate?.()
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      // Resource selectors belong to the previous workspace and must never
      // cross the isolation boundary during navigation.
      params.delete('id')
      if (showcase) params.set('showcase', '1')
      const query = params.toString()
      router.push(`${buildWorkspaceHref(workspaceId, pathname)}${query ? `?${query}` : ''}`)
    } catch (switchError) {
      setActionError(switchError instanceof Error ? switchError.message : 'Could not switch workspaces.')
    }
  }

  async function createAndSelect(name: string) {
    setCreateBusy(true)
    setActionError(null)
    try {
      const workspace = await createWorkspace({ name })
      await switchWorkspace(workspace.id)
      setCreateOpen(false)
      setOpen(false)
      onNavigate?.()
      const params = new URLSearchParams({ section: 'workspace' })
      if (showcase) params.set('showcase', '1')
      router.push(
        `${buildWorkspaceHref(workspace.id, '/app/settings')}?${params.toString()}`,
      )
    } catch (createError) {
      setActionError(createError instanceof Error ? createError.message : 'Could not create the workspace.')
    } finally {
      setCreateBusy(false)
    }
  }

  if (status === 'idle') return null

  const Chevron = isFooter ? ChevronUp : ChevronDown

  return (
    <>
      <div ref={rootRef} className="relative min-w-0">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
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
            <WorkspaceAvatar workspace={activeWorkspace} size={compact || isFooter ? 'sm' : 'md'} />
          ) : (
            <span className={`${compact || isFooter ? 'h-6 w-6' : 'h-8 w-8'} shrink-0 animate-pulse rounded-lg bg-[var(--surface-subtle)]`} />
          )}
          {!compact || accountMenu ? (
            <span className={`min-w-0 flex-1 ${compact && isFooter ? 'sr-only' : ''}`}>
              <span className={`block truncate font-medium text-[var(--foreground)] ${isFooter || compact ? 'text-xs' : 'text-[13px]'}`}>
                {status === 'loading'
                  ? 'Loading workspace…'
                  : activeWorkspace?.name ?? 'Choose a workspace'}
              </span>
              {(userLabel || activeWorkspace) && !compact ? (
                <span className="block truncate text-[10px] text-[var(--muted-light)]">
                  {userLabel ?? activeWorkspace?.role}
                </span>
              ) : null}
            </span>
          ) : null}
          {!compact || accountMenu ? (
            <Chevron
              size={13}
              className={`shrink-0 text-[var(--muted-light)] transition-transform ${
                open ? (isFooter ? '' : 'rotate-180') : isFooter ? 'rotate-180' : ''
              }`}
            />
          ) : null}
        </button>

        {open ? (
          <MenuSurface
            role="menu"
            aria-label={isFooter ? 'Workspace and account' : 'Workspaces'}
            className={`overlay-pop-in absolute z-[80] w-[min(280px,calc(100vw-2rem))] overflow-hidden p-1 ${
              isFooter
                ? 'bottom-full left-0 right-0 mb-1.5 w-auto'
                : compact
                  ? 'right-0 top-full mt-1.5'
                  : 'left-0 top-full mt-1.5 -translate-x-1'
            }`}
          >
            <div className="px-2 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--muted-light)]">
              Workspaces
            </div>

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
                  onClick={() => void refresh()}
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
              return (
                <MenuItem
                  key={workspace.id}
                  role="menuitemradio"
                  aria-checked={selected}
                  disabled={Boolean(switchingWorkspaceId)}
                  className="rounded-lg py-2"
                  onClick={() => void selectWorkspace(workspace.id)}
                >
                  <WorkspaceAvatar workspace={workspace} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-[var(--foreground)]">
                      {workspace.name}
                    </span>
                    <span className="block truncate text-[10px] capitalize text-[var(--muted-light)]">
                      {workspace.kind === 'personal'
                        ? 'Personal'
                        : `${workspace.memberCount ?? 1} ${workspace.memberCount === 1 ? 'member' : 'members'}`}
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

            <div className="my-1 h-px bg-[var(--border)]" />
            <MenuItem
              role="menuitem"
              className="rounded-lg"
              onClick={() => {
                setOpen(false)
                setCreateOpen(true)
                setActionError(null)
              }}
            >
              <Plus size={14} />
              Create workspace
            </MenuItem>
            {activeWorkspaceId ? (
              <MenuItem
                role="menuitem"
                className="rounded-lg"
                onClick={() => {
                  setOpen(false)
                  onNavigate?.()
                  router.push(
                    `${buildWorkspaceHref(activeWorkspaceId, '/app/settings')}?section=workspace${showcase ? '&showcase=1' : ''}`,
                  )
                }}
              >
                <Settings size={14} />
                Workspace settings
              </MenuItem>
            ) : null}
            <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] text-[var(--muted-light)]">
              <UsersRound size={11} />
              People, agents, and resources share this boundary.
            </div>
            {actionError ? (
              <p role="alert" className="px-3 pb-2 pt-1 text-[11px] text-red-500">
                {actionError}
              </p>
            ) : null}

            {accountMenu ? (
              <div className="mt-1 border-t border-[var(--border)] pt-1">
                {accountMenu}
              </div>
            ) : null}
          </MenuSurface>
        ) : null}
      </div>

      {createOpen ? (
        <CreateWorkspaceDialog
          open
          busy={createBusy}
          error={actionError}
          onOpenChange={(nextOpen) => {
            if (!createBusy) {
              setCreateOpen(nextOpen)
              if (!nextOpen) setActionError(null)
            }
          }}
          onCreate={createAndSelect}
        />
      ) : null}
    </>
  )
}
