'use client'

import { ConvexReactClient } from 'convex/react'
import { resolveConvexUrl } from '@/shared/database/convex-url'

const convexUrl = resolveConvexUrl()

export const convexReactClientEnabled = Boolean(convexUrl)

export const convexReactClient = new ConvexReactClient(
  convexUrl || 'https://missing-convex-url.convex.cloud',
)
