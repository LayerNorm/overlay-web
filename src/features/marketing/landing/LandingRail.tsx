import { Button } from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
import { memo, type CSSProperties } from 'react'
import { RAIL_LABEL, RAIL_ORDER } from './landing-scenes'

/** The five phrases of the pitch, stacked on the left. Clicking one jumps to its section. */
export const LandingRail = memo(function LandingRail() {
  return (
    <nav className="rail" data-lp="rail" aria-label="Sections">
      <span className="rail-box" data-lp="rail-box" />
      {RAIL_ORDER.map((k, i) => (
        <Button variant="ghost"
          key={k}
          type="button"
          className={unstyledButton("rail-item")}
          data-lp="rail-item"
          data-k={k}
          style={{ '--c': `var(--c-${k})`, '--i': i } as CSSProperties}
        >
          <span className="t">{RAIL_LABEL[k]}</span>
        </Button>
      ))}
    </nav>
  )
})
