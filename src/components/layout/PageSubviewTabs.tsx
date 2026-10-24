'use client'

import { Loader2 } from 'lucide-react'
import { TabButton, TabsList } from '@overlay/ui/primitives'
import { usePageSubviews } from './sidebar/pageSubviewStore'

export function PageSubviewTabs() {
  const subviews = usePageSubviews()
  if (!subviews || subviews.items.length < 2) return null
  return (
    <TabsList aria-label="Views" className="h-8 items-stretch rounded-md p-[3px]">
      {subviews.items.map((item) => {
        const pending = subviews.pendingId === item.id
        const Icon = pending ? Loader2 : item.icon
        return (
          <TabButton
            key={item.id}
            value={item.id}
            active={item.id === subviews.activeId}
            disabled={item.locked}
            className="gap-1.5 rounded-sm px-2 py-0 leading-4 data-[state=active]:bg-(--button-secondary-hover) data-[state=active]:shadow-none"
            onClick={() => subviews.onSelect(item.id)}
          >
            {Icon ? <Icon size={13} aria-hidden className={pending ? 'animate-spin' : undefined} /> : null}
            {item.label}
          </TabButton>
        )
      })}
    </TabsList>
  )
}
