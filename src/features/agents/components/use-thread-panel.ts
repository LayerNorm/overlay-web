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
  openLink,
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
  return { open, width, expanded, tabs: tabsFromPanels(tabs, active) }
}

/** Expanded, the panel takes most of the window but leaves the thread a readable column beside the sidebars. */
function threadPanelWidth({ width, expanded }: ThreadPanelState): number {
  if (!expanded || typeof window === 'undefined') return width
  return Math.max(width, Math.round(window.innerWidth - 60 - 272 - 400))
}

/**
 * An agent thread's right panel: open state, tabs, width and expansion, remembered across visits, plus its
 * shortcuts while a thread is open (⌥T opens a launcher and ⌥F the Files panel).
 */
export function useThreadPanel({ conversationId, threadOpen }: { conversationId: string | null; threadOpen: boolean }) {
  const [panel, setPanel] = useState<ThreadPanelState>(initialThreadPanel)
  // Opened files belong to one thread, so switching threads closes their tabs.
  const [panelConversationId, setPanelConversationId] = useState(conversationId)
  if (panelConversationId !== conversationId) {
    setPanelConversationId(conversationId)
    setPanel((current) => ({ ...current, tabs: withoutFileTabs(current.tabs) }))
  }

  useEffect(() => {
    setAgentRightSidebarPreferences({ open: panel.open, width: panel.width, expanded: panel.expanded, ...panelsOf(panel.tabs) })
  }, [panel])

  useEffect(() => {
    if (!threadOpen) return
    const show = (update: TabsUpdate) => setPanel((current) => ({ ...current, open: true, tabs: update(current.tabs) }))
    // Option shortcuts only: they clash with no browser or text-editing command (the browser owns Cmd+P and Cmd+J).
    const onKey = (event: KeyboardEvent) => {
      // A dialog (agent editor, share, create) owns the keyboard while it is open.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
      if (event.code === 'KeyT') show((tabs) => openLauncher(tabs, nextLauncherId()))
      else if (event.code === 'KeyF') show((tabs) => openPanel(tabs, 'files'))
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
    openLink: (url: string, title?: string) => setPanel((current) => ({ ...current, open: true, tabs: openLink(current.tabs, url, title) })),
    /** Shows the computer tab widened, for taking control. */
    showComputerExpanded: () => setPanel((current) => ({ ...current, open: true, expanded: true, tabs: openPanel(current.tabs, 'computer') })),
    setExpanded: (expanded: boolean) => setPanel((current) => ({ ...current, expanded })),
    toggleExpanded: () => setPanel((current) => ({ ...current, expanded: !current.expanded })),
    resize: (width: number) => setPanel((current) => ({
      ...current, width: Math.max(THREAD_PANEL_MIN_WIDTH, Math.round(width)), expanded: false,
    })),
  }
}
