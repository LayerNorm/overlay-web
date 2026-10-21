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
  hero: { avatar: ReactNode; title: string; subtitle?: ReactNode }
  tabs: RightSidebarTab[]
  activeTab: string
  onTabChange(id: string): void
}) {
  const selectedTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : tabs[0]?.id ?? ''

  return (
    <div className="h-full min-h-0 p-2 pr-3">
      <section
        aria-label={ariaLabel}
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-(--surface-elevated)"
      >
        <div className="flex shrink-0 flex-col items-center px-5 pb-4 pt-7 text-center">
          <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-full">
            {hero.avatar}
          </div>
          <h2 className="mt-3 max-w-full truncate text-lg font-medium leading-6 text-(--foreground)">
            {hero.title}
          </h2>
          {hero.subtitle ? (
            <p className="mt-1 max-w-full truncate text-xs leading-5 text-(--muted)">
              {hero.subtitle}
            </p>
          ) : null}
        </div>
        <Tabs
          value={selectedTab}
          onValueChange={(id) => {
            if (tabs.some((tab) => tab.id === id)) onTabChange(id)
          }}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <TabsTriggerList className="mx-auto mb-3 h-auto shrink-0 gap-1 rounded-full bg-transparent p-0">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="rounded-full px-3.5 py-1.5 text-xs data-[state=active]:bg-(--surface-subtle) data-[state=active]:shadow-none"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsTriggerList>
          {tabs.map((tab) => (
            <TabsContent
              key={tab.id}
              value={tab.id}
              forceMount
              className="min-h-0 flex-1 overflow-y-auto px-5 pb-5"
            >
              {tab.content}
            </TabsContent>
          ))}
        </Tabs>
      </section>
    </div>
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
