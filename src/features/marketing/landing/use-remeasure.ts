import { useEffect } from 'react'

/** Run `measure` when the window resizes or web fonts finish loading (text widths change). */
export function useRemeasure(measure: () => void) {
  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    let live = true
    void document.fonts?.ready.then(() => {
      if (live) measure()
    })
    return () => {
      live = false
      window.removeEventListener('resize', measure)
    }
  }, [measure])
}
