'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from '@overlay/ui/primitives'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { buildWorkspaceHandleHref, buildWorkspaceSwitchHref } from '@/shared/workspaces/routing'
import { WorkspaceSwitcherView } from './WorkspaceSwitcherView'

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
  const currentScope = usePanelScope()
  const buildWorkspaceHref = useWorkspaceHref()
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
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function closeForAccountAction() {
      setOpen(false)
    }
    window.addEventListener('overlay:account-menu-action', closeForAccountAction)
    return () => window.removeEventListener('overlay:account-menu-action', closeForAccountAction)
  }, [])

  async function selectWorkspace(workspaceId: string) {
    try {
      await switchWorkspace(workspaceId)
      setOpen(false)
      onNavigate?.()
      const destination = workspaces.find((workspace) => workspace.id === workspaceId)
      const search = new URLSearchParams(searchParams?.toString() ?? '')
      if (showcase) search.set('showcase', '1')
      const href = buildWorkspaceSwitchHref({
        workspaceId,
        handle: destination?.slug,
        pathname,
        search: search.toString(),
        currentScope,
      })
      router.push(href)
    } catch (switchError) {
      toast.error(switchError instanceof Error ? switchError.message : 'Could not switch workspaces.')
    }
  }

  async function createAndSelect(name: string) {
    setCreateBusy(true)
    try {
      const workspace = await createWorkspace({ name })
      await switchWorkspace(workspace.id)
      setCreateOpen(false)
      setOpen(false)
      onNavigate?.()
      const params = new URLSearchParams({ section: 'workspace' })
      if (showcase) params.set('showcase', '1')
      const settings = `/app/settings?${params.toString()}`
      router.push(
        workspace.slug
          ? buildWorkspaceHandleHref(workspace.slug, settings)
          : buildWorkspaceHref(workspace.id, settings),
      )
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : 'Could not create the workspace.')
    } finally {
      setCreateBusy(false)
    }
  }

  function openCreateDialog() {
    setOpen(false)
    setCreateOpen(true)
  }

  function handleCreateOpenChange(nextOpen: boolean) {
    if (createBusy) return
    setCreateOpen(nextOpen)
  }

  return (
    <WorkspaceSwitcherView
      rootRef={rootRef}
      menuRef={menuRef}
      open={open}
      compact={compact}
      placement={placement}
      accountMenu={accountMenu}
      userLabel={userLabel}
      status={status}
      workspaces={workspaces}
      activeWorkspace={activeWorkspace}
      activeWorkspaceId={activeWorkspaceId}
      switchingWorkspaceId={switchingWorkspaceId}
      error={error}
      actionError={null}
      refresh={() => void refresh()}
      onSelectWorkspace={(workspaceId) => void selectWorkspace(workspaceId)}
      onCreateRequest={openCreateDialog}
      onOpenChange={setOpen}
      createOpen={createOpen}
      createBusy={createBusy}
      onCreateOpenChange={handleCreateOpenChange}
      onCreate={createAndSelect}
    />
  )
}
