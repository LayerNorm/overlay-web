'use client'

import AppSidebar from '@/components/layout/AppSidebar'
import { ChatInlinePanel } from '@/features/chat/components/ChatInlinePanel'
import { AutomationsInlinePanel } from '@/features/automations/components/AutomationsInlinePanel'
import { useSearchParams } from 'next/navigation'
import { SHOWCASE_CHAT_SUMMARIES } from '@/features/showcase/showcase-data'
import {
  PublicShowcaseAutomationsInlinePanel,
  PublicShowcaseFilesInlinePanel,
  PublicShowcaseProjectsInlinePanel,
} from '@/features/showcase/PublicShowcaseSidebarPanels'

export function AppShellSidebar() {
  const searchParams = useSearchParams()
  const publicShowcase = searchParams?.get('showcase') === '1'

  return (
    <AppSidebar
      publicShowcase={publicShowcase}
      renderChatPanel={({ refreshKey, onNavigate }) => (
        <ChatInlinePanel
          refreshKey={refreshKey}
          searchQuery=""
          onNavigate={onNavigate}
          seededChats={publicShowcase ? SHOWCASE_CHAT_SUMMARIES : undefined}
        />
      )}
      renderAutomationsPanel={({ onNavigate }) => (
        publicShowcase
          ? <PublicShowcaseAutomationsInlinePanel onNavigate={onNavigate} />
          : <AutomationsInlinePanel onNavigate={onNavigate} />
      )}
      renderFilesPanel={publicShowcase
        ? ({ onNavigate }) => <PublicShowcaseFilesInlinePanel onNavigate={onNavigate} />
        : undefined}
      renderProjectsPanel={publicShowcase
        ? ({ onNavigate }) => <PublicShowcaseProjectsInlinePanel onNavigate={onNavigate} />
        : undefined}
    />
  )
}
