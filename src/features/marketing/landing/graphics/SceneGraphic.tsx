'use client'

import { useEffect, useRef, type ComponentType } from 'react'
import { clamp, ease } from '../landing-math'
import { attachGfx, type GfxBus } from './gfx-bus'
import { runGfx } from './gfx-runner'
import { GfxByoa, GfxCreate, GfxDeploy, GfxManage } from './scenes-cp'
import { GfxComputer, GfxEmployee, GfxMemory, GfxSuperpowers, GfxTools } from './scenes-ai'
import { GfxCloud, GfxMultiplayer, GfxOpenSource } from './scenes-more'

/** One graphic per scene, in scene order. The last scene (get started) has none. */
const GRAPHICS: ComponentType[] = [
  GfxSuperpowers,
  GfxMemory,
  GfxTools,
  GfxComputer,
  GfxEmployee,
  GfxCreate,
  GfxManage,
  GfxDeploy,
  GfxByoa,
  GfxCloud,
  GfxMultiplayer,
  GfxOpenSource,
]

export const hasGraphic = (scene: number): boolean => scene < GRAPHICS.length

/** Stage size the graphics are drawn at, plus breathing room. */
const FIT_W = 660
const FIT_H = 456

/**
 * Renders the current scene's graphic and drives it from the scroll engine's
 * progress (`bus.p`). After a jump it plays itself over ~2.4s instead.
 */
export function SceneGraphic({ scene, bus }: { scene: number; bus: GfxBus }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const Graphic = GRAPHICS[scene]

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !Graphic) return
    const panel = stage.closest<HTMLElement>('.graphic')
    const fit = () => {
      if (!panel) return
      const scale = Math.min(panel.clientWidth / FIT_W, panel.clientHeight / FIT_H, 1.3)
      panel.style.setProperty('--gs', String(scale))
    }
    const observer = new ResizeObserver(fit)
    if (panel) observer.observe(panel)
    fit()

    let raf = 0
    const frame = (): boolean => {
      const t = bus.auto ? clamp((performance.now() - bus.t0 - 250) / 2400) : 1
      const gp = bus.auto ? Math.max(bus.p, ease(t)) : bus.p
      runGfx(stage, gp)
      return bus.auto && t < 1
    }
    const step = () => {
      raf = 0
      if (frame()) raf = requestAnimationFrame(step)
    }
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(step)
    }
    const detach = attachGfx(bus, frame, kick)
    frame()
    if (bus.auto) kick()

    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf)
      detach()
    }
  }, [scene, bus, Graphic])

  if (!Graphic) return null
  return (
    <div className="gfx" aria-hidden="true">
      <div className="stage" ref={stageRef}>
        <Graphic />
      </div>
    </div>
  )
}
