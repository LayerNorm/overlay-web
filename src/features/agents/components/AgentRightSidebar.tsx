'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { WorkspaceAgentDirectoryItem, WorkspaceThreadPullRequest } from '@overlay/workspace-contracts'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import type { useAgentEditorController } from './AgentEditorPage'
import { AgentComputerTabView } from './AgentComputerTab.parts'
import { AgentSidebarDetails } from './AgentSidebarDetails'
import { AgentLibraryTab } from './AgentRightSidebar.parts'
import { ThreadPanel, type ThreadComputerStatus } from './ThreadPanel'
import { openFile, openPanel, type ThreadPanelTabs } from '../lib/thread-panel-tabs'
import { AgentLibraryPreview } from './AgentLibraryPreview'
import { AgentSidebarHero } from './AgentSidebarHero.parts'
import type { useAgentSidebarComputer } from './use-agent-sidebar-computer'
import { createAgentAutosaveScheduler } from '../lib/agent-autosave-scheduler'
import { isAgentEditSaveFailure } from '../lib/agent-edit-save-result'
import { usesOverlayMark } from '@/shared/agents/chief-identity'

export function AgentRightSidebar({
  conversationId,
  tabs,
  onTabsChange,
  onOpenLauncher,
  expanded,
  onToggleExpanded,
  onClose,
  pullRequests,
  assignments,
  editor,
  controlled,
  computerAccess,
  onTakeControl,
  onReleaseControl,
}: {
  conversationId: string
  tabs: ThreadPanelTabs
  onTabsChange(update: (tabs: ThreadPanelTabs) => ThreadPanelTabs): void
  onOpenLauncher(): void
  expanded: boolean
  onToggleExpanded(): void
  onClose(): void
  pullRequests: readonly WorkspaceThreadPullRequest[]
  assignments: ReactNode

  editor: ReturnType<typeof useAgentEditorController>
  controlled: boolean
  computerAccess: ReturnType<typeof useAgentSidebarComputer>
  onTakeControl(ticketUrl: string, computerName: string): void
  onReleaseControl(): void
}) {
  const { capabilities } = useOverlayCapabilities()
  const computersEnabled = capabilities.computers === true
  const [saveFailed, setSaveFailed] = useState(false)
  const schedulerRef = useRef<ReturnType<typeof createAgentAutosaveScheduler> | null>(null)

  const saveRef = useRef(editor.saveEdit)
  saveRef.current = editor.saveEdit
  const validRef = useRef(editor.valid && editor.form.dirty)
  validRef.current = editor.valid && editor.form.dirty
  const saveNow = useCallback(async () => {
    setSaveFailed(false)
    const result = await saveRef.current({ silent: true, ignoreBusy: true })
    setSaveFailed(isAgentEditSaveFailure(result))
  }, [])
  useEffect(() => {
    const scheduler = createAgentAutosaveScheduler()
    schedulerRef.current = scheduler
    return () => {
      scheduler.cancel()
      if (schedulerRef.current === scheduler) schedulerRef.current = null
    }
  }, [])
  useEffect(() => {
    schedulerRef.current?.schedule(saveNow, editor.valid && editor.form.dirty)
  }, [editor.form.dirty, editor.form.version, editor.valid, saveNow])
  const flushSave = useCallback(() => {
    schedulerRef.current?.flush(saveNow, validRef.current)
  }, [saveNow])

  const agent = editor.agent as WorkspaceAgentDirectoryItem | null
  const agentName = editor.form.name.trim() || agent?.name || 'Agent'
  const hero = AgentSidebarHero({ editor, onBlurSave: flushSave })
  const computer = computerAccess.computer
  const computerStatus: ThreadComputerStatus = !computersEnabled ? 'unavailable'
    : computer?.status === 'ready' ? 'running'
      : computerAccess.waking || computer?.status === 'provisioning' ? 'starting' : 'asleep'

  return (
    <ThreadPanel
      agentName={agentName}
      hero={hero}
      agent={
        <AgentSidebarDetails
          editor={editor}
          saveFailed={saveFailed}
          onRetry={flushSave}
          onBlurSave={flushSave}
        />
      }
      assignments={assignments}
      files={<AgentLibraryTab conversationId={conversationId} onOpenFile={(fileId) => onTabsChange((current) => openFile(current, fileId))} />}
      computer={
        <AgentComputerTabView
          agentName={agentName}
          agentColor={agent?.avatarColor}
          agentShape={agent?.avatarShape}
          isDefault={usesOverlayMark(agent)}
          unavailable={!computersEnabled}
          computer={computer}
          computerLoading={computerAccess.computerLoading}
          computerError={computerAccess.computerError}
          ticketUrl={computerAccess.ticketUrl}
          ticketError={computerAccess.ticketError}
          ticketLoading={computerAccess.ticketLoading}
          controlled={controlled}
          currentUserId={computerAccess.currentUserId}
          controlBusy={computerAccess.controlBusy}
          waking={computerAccess.waking}
          onWake={() => void computerAccess.wake()}
          onRetry={() => void (computerAccess.computerError
            ? computerAccess.loadComputer()
            : computerAccess.retryTicket())}
          onTakeControl={onTakeControl}
          onReleaseControl={onReleaseControl}
        />
      }
      computerStatus={computerStatus}
      pullRequests={pullRequests}
      renderFile={(fileId, close) => (
        <AgentLibraryPreview
          fileId={fileId}
          onBack={() => { close(); onTabsChange((current) => openPanel(current, 'files')) }}
          onClose={close}
        />
      )}
      tabs={tabs}
      onTabsChange={onTabsChange}
      onOpenLauncher={onOpenLauncher}
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
      onClose={onClose}
    />
  )
}
