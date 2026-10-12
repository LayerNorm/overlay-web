'use client'

import { useCallback, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { SIDE, type SectionKey, type SideItem } from './landing-scenes'
import { useRemeasure } from './use-remeasure'

/** An item with a short and a long label animates its width between the two. */
function Label({ item, on }: { item: SideItem; on: boolean }) {
  const boxRef = useRef<HTMLSpanElement>(null)
  const isPair = typeof item !== 'string'
  const fit = useCallback(() => {
    const box = boxRef.current
    const shown = box?.querySelector<HTMLElement>(on ? '.b' : '.a')
    if (box && shown) box.style.width = `${shown.offsetWidth}px`
  }, [on])
  useLayoutEffect(fit, [fit])
  useRemeasure(fit)
  if (!isPair) return <span className="t">{item}</span>
  return (
    <span className="t">
      <span className="lbl" ref={boxRef}>
        <span className="a">{item[0]}</span>
        <span className="b">{item[1]}</span>
      </span>
    </span>
  )
}

/** The right-hand list for sections that have sub-topics. `active` is the lit item, or 'all'. */
export function LandingSide({ sec, active, onPick }: { sec: SectionKey; active: number | 'all'; onPick: (item: number) => void }) {
  const items = SIDE[sec]
  return (
    <aside className="side" key={sec}>
      {items?.map((item, j) => {
        const on = active === 'all' || active === j
        return (
          <button
            key={j}
            type="button"
            className={on ? 'side-item on' : 'side-item'}
            style={{ '--c': `var(--c-${sec})`, '--i': j } as CSSProperties}
            onClick={() => onPick(j)}
          >
            <Label item={item} on={on} />
          </button>
        )
      })}
    </aside>
  )
}
