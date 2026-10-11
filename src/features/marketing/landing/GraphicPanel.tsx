'use client'

import { useEffect, useRef } from 'react'
import type { GfxBus } from './graphics/gfx-bus'
import { SceneGraphic, hasGraphic } from './graphics/SceneGraphic'
import { EASE_OUT } from './landing-math'
import { SCENES } from './landing-scenes'

/** The big panel that holds the current scene's graphic. It fades in when the section changes. */
export function GraphicPanel({ scene, bus }: { scene: number; bus: GfxBus }) {
  const ref = useRef<HTMLDivElement>(null)
  const sec = SCENES[scene].sec
  const prev = useRef(sec)

  useEffect(() => {
    if (prev.current !== sec && sec !== 'start') {
      ref.current?.animate(
        [{ opacity: 0, transform: 'scale(.985)' }, { opacity: 1, transform: 'none' }],
        { duration: 520, easing: EASE_OUT },
      )
    }
    prev.current = sec
  }, [sec])

  return (
    <div className={hasGraphic(scene) ? 'graphic has-gfx' : 'graphic'} ref={ref}>
      <SceneGraphic scene={scene} bus={bus} />
    </div>
  )
}
