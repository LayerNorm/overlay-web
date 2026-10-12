/**
 * Shared, mutable channel between the scroll engine and the scene graphic.
 *
 * The engine writes the scroll progress through the current scene (`p`) every
 * frame and, when you jump straight to a scene, flips `auto` so the graphic
 * plays itself. The graphic registers `frame` / `kick` while it is mounted.
 * It is a plain object on purpose: it changes every scroll frame and must not
 * trigger React renders.
 */
export type GfxBus = {
  /** Scroll progress through the current scene, 0..1. */
  p: number
  /** True after a jump: ignore scroll and autoplay over time instead. */
  auto: boolean
  /** performance.now() when autoplay started. */
  t0: number
  /** Redraw for the current progress. Returns true while autoplay is running. */
  frame: (() => boolean) | null
  /** Start the autoplay loop (no-op when no graphic is mounted). */
  kick: (() => void) | null
}

export const createGfxBus = (): GfxBus => ({ p: 0, auto: false, t0: 0, frame: null, kick: null })

/** Register the mounted graphic's redraw / autoplay hooks. Returns the detach function. */
export function attachGfx(bus: GfxBus, frame: () => boolean, kick: () => void): () => void {
  bus.frame = frame
  bus.kick = kick
  return () => {
    bus.frame = null
    bus.kick = null
  }
}
