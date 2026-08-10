'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useWorkspace } from './WorkspaceProvider'
import { buildWorkspaceHref } from '../lib/workspace-routing'
import { WorkspaceSwitcherView, type WorkspaceSwitcherMenuPosition } from './WorkspaceSwitcherView'

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
  const [menuPosition, setMenuPosition] = useState<WorkspaceSwitcherMenuPosition | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const isFooter = placement === 'footer'
  const portalMenu = isFooter || compact

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
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

  useLayoutEffect(() => {
    if (!open || !portalMenu) return
    function updatePosition() {
      const root = rootRef.current
      if (!root) return
      const rect = root.getBoundingClientRect()
      const width = Math.min(280, window.innerWidth - 16)
      const left = Math.min(
        Math.max(8, rect.left),
        Math.max(8, window.innerWidth - width - 8),
      )
      if (isFooter) {
        setMenuPosition({
          left,
          bottom: Math.max(8, window.innerHeight - rect.top + 6),
          width,
        })
        return
      }
      setMenuPosition({
        left,
        top: rect.bottom + 6,
        width,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isFooter, open, portalMenu])

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

  function openCreateDialog() {
    setOpen(false)
    setCreateOpen(true)
    setActionError(null)
  }

  function handleCreateOpenChange(nextOpen: boolean) {
    if (createBusy) return
    setCreateOpen(nextOpen)
    if (!nextOpen) setActionError(null)
  }

  const closeForAccountAction = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const action = target.closest('a, button')
    if (!action) return
    const isNavigation = action.tagName === 'A'
    const isSignOut = action.tagName === 'BUTTON' && action.textContent?.trim() === 'Sign out'
    if (!isNavigation && !isSignOut) return
    setOpen(false)
    onNavigate?.()
  }, [onNavigate])

  return (
    <WorkspaceSwitcherView
      rootRef={rootRef}
      menuRef={menuRef}
      open={open}
      compact={compact}
      placement={placement}
      accountMenu={accountMenu ? (
        <div onClickCapture={closeForAccountAction}>
          {accountMenu}
        </div>
      ) : null}
      userLabel={userLabel}
      status={status}
      workspaces={workspaces}
      activeWorkspace={activeWorkspace}
      activeWorkspaceId={activeWorkspaceId}
      switchingWorkspaceId={switchingWorkspaceId}
      error={error}
      actionError={actionError}
      refresh={() => void refresh()}
      onSelectWorkspace={(workspaceId) => void selectWorkspace(workspaceId)}
      onCreateRequest={openCreateDialog}
      onToggle={() => setOpen((current) => !current)}
      menuPosition={menuPosition}
      createOpen={createOpen}
      createBusy={createBusy}
      onCreateOpenChange={handleCreateOpenChange}
      onCreate={createAndSelect}
    />
  )
}
