'use client'

import { Loader2 } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@overlay/ui/primitives'
import { usePageSubviews } from './sidebar/pageSubviewStore'

/** Header tabs for the current page's subviews, published by the single sidebar. Renders nothing in the classic layout. */
export function PageSubviewTabs() {
  const subviews = usePageSubviews()
  if (!subviews || subviews.items.length < 2) return null
  return (
    <Tabs value={subviews.activeId} onValueChange={subviews.onSelect} className="gap-0">
      <TabsList aria-label="Views">
        {subviews.items.map((item) => {
          const Icon = subviews.pendingId === item.id ? Loader2 : item.icon
          return (
            <TabsTrigger key={item.id} value={item.id} disabled={item.locked} className="gap-1.5">
              {Icon ? <Icon size={13} aria-hidden className={subviews.pendingId === item.id ? 'animate-spin' : undefined} /> : null}
              {item.label}
            </TabsTrigger>
          )
        })}
      </TabsList>
    </Tabs>
  )
}
