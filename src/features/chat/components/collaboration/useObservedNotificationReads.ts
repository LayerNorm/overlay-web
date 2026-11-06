'use client'

import { useEffect, useRef } from 'react'
import { toast } from '@overlay/ui/primitives'
import type { NativeActivity } from '@/components/providers/native-activity-context'

export function useObservedNotificationReads(native: NativeActivity | null) {
  const attempted = useRef(new Set<string>())
  useEffect(() => {
    if (!native?.ready) return
    const items = native.notifications.filter(item => item.readAt === undefined && !attempted.current.has(item.id))
    if (!items.length) return
    items.forEach(item => attempted.current.add(item.id))
    void native.mark(items.map(item => item.id), Math.max(...items.map(item => item.createdAt)))
      .catch(() => toast.error('Notifications could not be marked read'))
  }, [native])
}
