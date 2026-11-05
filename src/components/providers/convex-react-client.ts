'use client'

import { ConvexReactClient } from 'convex/react'
import { resolveConvexUrl } from '@/shared/database/convex-url'

const convexUrl = resolveConvexUrl()

export const convexReactClientEnabled = Boolean(convexUrl)

export function createConvexReactClient() {
  return convexUrl ? new ConvexReactClient(convexUrl) : null
}
