'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { RightSidebar } from '@overlay/modules-react/shell'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import type { useAgentEditorController } from './AgentEditorPage'
import { AgentComputerTabView } from './AgentComputerTab.parts'
import { AgentSidebarDetails } from './AgentSidebarDetails'
import { AgentLibraryTab } from './AgentRightSidebar.parts'
import { AgentSidebarHero } from './AgentSidebarHero.parts'
import type { useAgentSidebarComputer } from './use-agent-sidebar-computer'
import { createAgentAutosaveScheduler } from '../lib/agent-autosave-scheduler'
import { isAgentEditSaveFailure } from '../lib/agent-edit-save-result'

export function AgentRightSidebar({
  conversationId,
  activeTab,
  onTabChange,
  showcase = false,
  editor,
  controlled,
  computerAccess,
  onTakeControl,
  onReleaseControl,
}: {
  conversationId: string
  activeTab: string
  onTabChange(id: string): void
  showcase?: boolean
  editor: ReturnType<typeof useAgentEditorController>
  controlled: boolean
  computerAccess: ReturnType<typeof useAgentSidebarComputer>
  onTakeControl(ticketUrl: string, computerName: string): void
  onReleaseControl(): void
}) {
  const { capabilities } = useOverlayCapabilities()
  const computersEnabled = capabilities.computers === true && !showcase
  const selectedTab = activeTab
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
  const tabs = [
    {
      id: 'details',
      label: 'Details',
      content: selectedTab === 'details' ? (
        <AgentSidebarDetails
          editor={editor}
          saveFailed={saveFailed}
          onRetry={flushSave}
          onBlurSave={flushSave}
        />
      ) : null,
    },
    {
      id: 'library',
      label: 'Library',
      content: selectedTab === 'library' ? <AgentLibraryTab conversationId={conversationId} /> : null,
    },
    {
      id: 'computer',
      label: 'Computer',
      content: selectedTab === 'computer' ? (
        <AgentComputerTabView
          agentName={agentName}
          agentColor={agent?.avatarColor}
          agentShape={agent?.avatarShape}
          unavailable={!computersEnabled}
          computer={computerAccess.computer}
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
      ) : null,
    },
  ]

  return (
    <RightSidebar
      ariaLabel="Agent sidebar"
      hero={{
        avatar: hero.avatar,
        title: hero.title,
        titleText: hero.titleText,
        subtitle: hero.subtitle,
      }}
      tabs={tabs}
      activeTab={selectedTab}
      onTabChange={onTabChange}
    />
  )
}
