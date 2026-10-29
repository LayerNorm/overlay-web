'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from '@overlay/ui/primitives'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { buildWorkspaceHandleHref, buildWorkspaceSwitchHref } from '@/shared/workspaces/routing'
import { workspaceMemberLabel } from '@/shared/workspaces/solo-workspace'
import { WorkspaceAvatar } from '@/components/identity/WorkspaceAvatar'
import { WorkspaceSwitcherView, type ShellWorkspace } from '@overlay/shell-react'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import type { WorkspaceSummary } from '@/shared/workspaces/types'

function toShellWorkspace(workspace: WorkspaceSummary): ShellWorkspace {
  return { ...workspace, memberLabel: workspaceMemberLabel(workspace) }
}

export function WorkspaceSwitcher({
  onNavigate,
  compact = false,
  placement = 'header',
  accountMenu,
  userLabel,
}: {
  onNavigate?: () => void
  compact?: boolean
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
  const shellWorkspaces = useMemo(() => workspaces.map(toShellWorkspace), [workspaces])
  const shellActiveWorkspace = activeWorkspace ? toShellWorkspace(activeWorkspace) : null

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
      const href = buildWorkspaceSwitchHref({
        workspaceId,
        handle: destination?.routingHandle,
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
      const settings = `/app/settings?${params.toString()}`
      router.push(
        workspace.routingHandle
          ? buildWorkspaceHandleHref(workspace.routingHandle, settings)
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
      createDialog={createOpen ? (
        <CreateWorkspaceDialog
          open
          busy={createBusy}
          error={null}
          onOpenChange={handleCreateOpenChange}
          onCreate={createAndSelect}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
          }}
        />
      ) : null}
      userLabel={userLabel}
      renderAvatar={(workspace, size) => <WorkspaceAvatar workspace={workspace} size={size} />}
      status={status}
      workspaces={shellWorkspaces}
      activeWorkspace={shellActiveWorkspace}
      activeWorkspaceId={activeWorkspaceId}
      switchingWorkspaceId={switchingWorkspaceId}
      error={error}
      actionError={null}
      refresh={() => void refresh()}
      onSelectWorkspace={(workspaceId) => void selectWorkspace(workspaceId)}
      onCreateRequest={openCreateDialog}
      onOpenChange={setOpen}
    />
  )
}
