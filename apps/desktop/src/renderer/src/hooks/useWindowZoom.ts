import { useCallback, useEffect, useRef } from 'react'

type ZoomCommand = 'in' | 'out' | 'reset'

const ZOOM_STEP = 0.1
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.5

const clampZoom = (value: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))

export const useWindowZoom = (): void => {
  const zoomRef = useRef(1)

  const applyZoom = useCallback((nextZoom: number) => {
    const clamped = clampZoom(nextZoom)
    zoomRef.current = clamped
    // Store zoom as a CSS variable so panel content can apply it
    // without affecting DockablePanel positioning/sizing
    document.documentElement.style.setProperty('--app-zoom', `${clamped}`)
    window.bridge?.setWindowZoomFactor?.(clamped)
  }, [])

  useEffect(() => {
    applyZoom(zoomRef.current)

    const handleZoomCommand = (payload: { action?: ZoomCommand }) => {
      if (!payload?.action) return
      if (payload.action === 'reset') {
        applyZoom(1)
        return
      }
      const delta = payload.action === 'in' ? ZOOM_STEP : -ZOOM_STEP
      applyZoom(zoomRef.current + delta)
    }

    return window.bridge?.onWindowZoomCommand?.(handleZoomCommand)
  }, [applyZoom])
}
