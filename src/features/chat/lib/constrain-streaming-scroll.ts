import {
  streamingTranscriptReservedSpace,
  streamingTranscriptTailHeight,
} from '@overlay/chat-react/transcript-scroll'

export const streamingTailHeight = streamingTranscriptTailHeight

/**
 * Size of the reserved spacer rendered below the latest exchange while
 * streaming. Sizing the spacer to `clientHeight - tail` turns the scroll limit
 * into a *natural* boundary: the user can scroll until only the tail remains
 * visible and then the container simply stops — no per-scroll JS correction
 * (which fights inertial scrolling and causes flicker) is required.
 */
export const streamingReservedSpacerHeight = streamingTranscriptReservedSpace

export function constrainStreamingScrollTop({
  clientHeight,
  containerTop,
  markerTop,
  scrollTop,
}: {
  clientHeight: number
  containerTop: number
  markerTop: number
  scrollTop: number
}): number {
  const minimumMarkerTop = containerTop + streamingTailHeight(clientHeight)
  if (markerTop >= minimumMarkerTop) return scrollTop
  return Math.max(0, scrollTop - (minimumMarkerTop - markerTop))
}
