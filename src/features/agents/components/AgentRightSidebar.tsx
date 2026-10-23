'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { RightSidebar } from '@overlay/modules-react/shell'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useAgentEditorController } from './AgentEditorPage'
import { AgentComputerTabView } from './AgentComputerTab.parts'
import { AgentSidebarDetails } from './AgentSidebarDetails'
import { AgentLibraryTab } from './AgentRightSidebar.parts'
import { AgentSidebarHero } from './AgentSidebarHero.parts'
import { useAgentSidebarComputer } from './use-agent-sidebar-computer'
import { createAgentAutosaveScheduler } from '../lib/agent-autosave-scheduler'
import { isAgentEditSaveFailure } from '../lib/agent-edit-save-result'

export function AgentRightSidebar({
  agentId,
  activeWorkspaceId,
  conversationId,
  activeTab,
  onTabChange,
  onClose,
  onArchived,
  showcase = false,
  controlled,
  onTakeControl,
}: {
  agentId: string
  activeWorkspaceId: string | null
  conversationId: string
  activeTab: string
  onTabChange(id: string): void
  onClose(): void
  onArchived(): void
  showcase?: boolean
  controlled: boolean
  onTakeControl(ticketUrl: string, computerName: string, refreshTicket: () => void): void
}) {
  const { capabilities } = useOverlayCapabilities()
  const computersEnabled = capabilities.computers === true && !showcase
  const editor = useAgentEditorController({
    mode: 'edit',
    agentId,
    showcase,
    presentation: 'panel',
    keepOpenOnSave: true,
    onClose,
    onArchived,
  })
  const selectedTab = activeTab
  const computerAccess = useAgentSidebarComputer({
    activeWorkspaceId,
    agentId,
    enabled: computersEnabled,
    visible: selectedTab === 'computer',
  })
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
          waking={computerAccess.waking}
          onWake={() => void computerAccess.wake()}
          onRetry={() => void (computerAccess.computerError
            ? computerAccess.loadComputer()
            : computerAccess.retryTicket())}
          onTakeControl={(ticketUrl, computerName) => {
            onTakeControl(ticketUrl, computerName, computerAccess.retryTicket)
          }}
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
