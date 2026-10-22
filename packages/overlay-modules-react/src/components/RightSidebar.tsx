'use client'

import type { ReactNode } from 'react'
import { PanelRight } from 'lucide-react'
import { Button, Tabs, TabsContent, TabsTrigger, TabsTriggerList } from '@overlay/ui/primitives'

export type RightSidebarTab = {
  id: string
  label: string
  content: ReactNode
}

export function RightSidebar({
  ariaLabel,
  hero,
  tabs,
  activeTab,
  onTabChange,
}: {
  ariaLabel: string
  hero: { avatar: ReactNode; title: ReactNode; titleText: string; subtitle?: ReactNode }
  tabs: RightSidebarTab[]
  activeTab: string
  onTabChange(id: string): void
}) {
  const selectedTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : tabs[0]?.id ?? ''

  return (
    <aside
      aria-label={ariaLabel}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-(--border) bg-(--sidebar-surface)"
    >
      <div className="flex shrink-0 flex-col items-center px-5 pb-4 pt-9 text-center">
        <div className="flex h-[72px] w-[72px] items-center justify-center">
          {hero.avatar}
        </div>
        <h2
          aria-label={hero.titleText}
          className="mt-[14px] max-w-full text-lg font-medium leading-6 text-(--foreground)"
        >
          {hero.title}
        </h2>
        {hero.subtitle ? (
          <div className="mt-0.5 max-w-full text-[13px] leading-5 text-(--muted)">
            {hero.subtitle}
          </div>
        ) : null}
      </div>
      <Tabs
        value={selectedTab}
        onValueChange={(id) => {
          if (tabs.some((tab) => tab.id === id)) onTabChange(id)
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsTriggerList className="mx-auto mb-4 h-8 shrink-0 gap-1 rounded-full bg-transparent p-0">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="h-8 rounded-full px-3.5 text-xs text-(--muted) data-[state=active]:bg-(--surface-subtle) data-[state=active]:text-(--foreground) data-[state=active]:shadow-none"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsTriggerList>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6">
          {tabs.map((tab) => (
            <TabsContent
              key={tab.id}
              value={tab.id}
              className="mt-0 flex flex-1 flex-col"
            >
              {tab.content}
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </aside>
  )
}

export function RightSidebarToggle({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      aria-label={open ? 'Close sidebar' : 'Open sidebar'}
      aria-pressed={open}
      onClick={onToggle}
      className={`h-8 w-8 rounded-md text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground) ${
        open ? 'bg-(--surface-subtle) text-(--foreground)' : ''
      }`}
    >
      <PanelRight size={15} />
    </Button>
  )
}
