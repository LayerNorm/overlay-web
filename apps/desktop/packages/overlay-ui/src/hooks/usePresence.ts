import { useEffect, useState } from 'react'

/**
 * Drives enter/exit animations for elements that mount/unmount based on an
 * `open` flag. Keeps the element mounted for `durationMs` after `open` flips to
 * `false` so a CSS exit transition can play before unmount.
 *
 * Usage (matches the AppSidebar motion language — slide for panels, fade for
 * everything else):
 *
 *   const { mounted, visible } = usePresence(open)
 *   if (!mounted) return null
 *   return (
 *     <div className={cn(
 *       'transition-opacity duration-200 ease-[var(--overlay-ease)]',
 *       visible ? 'opacity-100' : 'opacity-0',
 *     )} />
 *   )
 *
 * `visible` starts `false` so the enter transition always runs from the closed
 * state. All state updates happen inside async callbacks (rAF / timeout) so the
 * hook never triggers cascading synchronous re-renders from inside the effect.
 */
export function usePresence(open: boolean, durationMs = 220): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (open) {
      let revealFrame = 0
      const mountFrame = requestAnimationFrame(() => {
        setMounted(true)
        // Reveal on the following frame so the element transitions in from its
        // closed state rather than appearing instantly.
        revealFrame = requestAnimationFrame(() => setVisible(true))
      })
      return () => {
        cancelAnimationFrame(mountFrame)
        cancelAnimationFrame(revealFrame)
      }
    }

    const hideFrame = requestAnimationFrame(() => setVisible(false))
    const unmountTimer = setTimeout(() => setMounted(false), durationMs)
    return () => {
      cancelAnimationFrame(hideFrame)
      clearTimeout(unmountTimer)
    }
  }, [open, durationMs])

  return { mounted, visible }
}
