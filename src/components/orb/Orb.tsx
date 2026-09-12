'use client'

/**
 * The orb mark lives in `@overlay/ui` so the web app, chat-react, and
 * modules-react all render the same component. This module keeps the
 * established `@/components/orb/Orb` import path working. Agent avatars live
 * in `./Creature`.
 */

export {
  Orb,
  OverlayMark,
  OVERLAY_ORB_DEFAULT_COLOR,
} from '@overlay/ui'
export type { OrbProps, OrbState, OrbVariant } from '@overlay/ui'
