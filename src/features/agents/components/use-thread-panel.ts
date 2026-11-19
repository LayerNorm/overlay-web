'use client'

import { useEffect, useState } from 'react'
import {
  THREAD_PANEL_MIN_WIDTH,
  getAgentRightSidebarPreferences,
  setAgentRightSidebarPreferences,
} from '@/shared/agents/agent-right-sidebar-preferences'
import {
  activeTab,
  openFile,
  openLauncher,
  openPanel,
  panelsOf,
  tabsFromPanels,
  withoutFileTabs,
  type ThreadPanelTabs,
} from '../lib/thread-panel-tabs'
import { nextLauncherId } from './ThreadPanel'

type ThreadPanelState = { open: boolean; width: number; expanded: boolean; tabs: ThreadPanelTabs }
type TabsUpdate = (tabs: ThreadPanelTabs) => ThreadPanelTabs

function initialThreadPanel(): ThreadPanelState {
  const { open, width, expanded, tabs, active } = getAgentRightSidebarPreferences()
  const restored = tabsFromPanels(tabs, active)
  return { open, width, expanded, tabs: restored.tabs.length ? restored : openLauncher(restored, nextLauncherId()) }
}

/** Expanded, the panel takes most of the window but leaves the thread a readable column beside the sidebars. */
function threadPanelWidth({ width, expanded }: ThreadPanelState): number {
  if (!expanded || typeof window === 'undefined') return width
  return Math.max(width, Math.round(window.innerWidth - 60 - 272 - 400))
}

/**
 * An agent thread's right panel: open state, tabs, width and expansion, remembered across visits, plus its
 * shortcuts while a thread is open (⌥T opens a launcher, ⌘J the Terminal and ⌘P the Files panel).
 */
export function useThreadPanel({ conversationId, threadOpen }: { conversationId: string | null; threadOpen: boolean }) {
  const [panel, setPanel] = useState<ThreadPanelState>(initialThreadPanel)
  // Opened files belong to one thread, so switching threads closes their tabs.
  const [panelConversationId, setPanelConversationId] = useState(conversationId)
  if (panelConversationId !== conversationId) {
    setPanelConversationId(conversationId)
    setPanel((current) => ({ ...current, tabs: withoutFileTabs(current.tabs, nextLauncherId()) }))
  }

  useEffect(() => {
    setAgentRightSidebarPreferences({ open: panel.open, width: panel.width, expanded: panel.expanded, ...panelsOf(panel.tabs) })
  }, [panel])

  useEffect(() => {
    if (!threadOpen) return
    const show = (update: TabsUpdate) => setPanel((current) => ({ ...current, open: true, tabs: update(current.tabs) }))
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      const plainMod = mod && !event.altKey && !event.shiftKey
      const key = event.key.toLowerCase()
      if (event.altKey && !mod && event.code === 'KeyT') show((tabs) => openLauncher(tabs, nextLauncherId()))
      else if (plainMod && key === 'j') show((tabs) => openPanel(tabs, 'terminal'))
      else if (plainMod && key === 'p') show((tabs) => openPanel(tabs, 'files'))
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [threadOpen])

  return {
    open: panel.open,
    tabs: panel.tabs,
    expanded: panel.expanded,
    width: threadPanelWidth(panel),
    shownTab: panel.open ? activeTab(panel.tabs) : null,
    setOpen: (open: boolean) => setPanel((current) => ({ ...current, open })),
    updateTabs: (update: TabsUpdate) => setPanel((current) => ({ ...current, tabs: update(current.tabs) })),
    openFile: (fileId: string) => setPanel((current) => ({ ...current, open: true, tabs: openFile(current.tabs, fileId) })),
    toggleExpanded: () => setPanel((current) => ({ ...current, expanded: !current.expanded })),
    resize: (width: number) => setPanel((current) => ({
      ...current, width: Math.max(THREAD_PANEL_MIN_WIDTH, Math.round(width)), expanded: false,
    })),
  }
}
