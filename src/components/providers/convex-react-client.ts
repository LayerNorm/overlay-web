'use client'

import { ConvexReactClient } from 'convex/react'
import { resolveConvexUrl } from '@/shared/database/convex-url'

const convexUrl = resolveConvexUrl()

export const convexReactClientEnabled = Boolean(convexUrl)

export const convexReactClient = convexUrl
  ? new ConvexReactClient(convexUrl)
  : null
