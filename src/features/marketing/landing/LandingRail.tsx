import { memo, type CSSProperties } from 'react'
import { RAIL_LABEL, RAIL_ORDER } from './landing-scenes'

/** The five phrases of the pitch, stacked on the left. Clicking one jumps to its section. */
export const LandingRail = memo(function LandingRail() {
  return (
    <nav className="rail" data-lp="rail" aria-label="Sections">
      <span className="rail-box" data-lp="rail-box" />
      {RAIL_ORDER.map((k, i) => (
        <button
          key={k}
          type="button"
          className="rail-item"
          data-lp="rail-item"
          data-k={k}
          style={{ '--c': `var(--c-${k})`, '--i': i } as CSSProperties}
        >
          <span className="t">{RAIL_LABEL[k]}</span>
        </button>
      ))}
    </nav>
  )
})
