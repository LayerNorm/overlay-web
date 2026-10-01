import { describe, expect, it, vi } from 'vitest'
import type { MouseEvent, ReactElement } from 'react'
import { Toggle, type ToggleProps } from './Toggle'

/**
 * Toggle is a hook-free function component, so it can be invoked directly to
 * inspect the element it produces. This keeps the test a pure unit assertion:
 * no DOM, no network, no timers.
 */
function renderToggleButton(props: ToggleProps): ReactElement<Record<string, unknown>> {
  return Toggle(props) as unknown as ReactElement<Record<string, unknown>>
}

function makeClickEvent(): MouseEvent<HTMLButtonElement> {
  const event: Record<string, unknown> = { defaultPrevented: false }
  event.preventDefault = () => {
    event.defaultPrevented = true
  }
  return event as unknown as MouseEvent<HTMLButtonElement>
}

describe('Toggle', () => {
  it('still reports the next checked state when the caller also supplies onClick', () => {
    const onCheckedChange = vi.fn()
    const onClick = vi.fn()

    const button = renderToggleButton({ checked: false, onCheckedChange, onClick })

    const handleClick = button.props.onClick as
      | ((event: MouseEvent<HTMLButtonElement>) => void)
      | undefined
    expect(typeof handleClick).toBe('function')

    const event = makeClickEvent()
    handleClick!(event)

    // Must still hold: the caller's own click behaviour runs, with the event.
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith(event)

    // The regression: the toggle must still notify the app of its new state.
    expect(onCheckedChange).toHaveBeenCalledTimes(1)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })
})