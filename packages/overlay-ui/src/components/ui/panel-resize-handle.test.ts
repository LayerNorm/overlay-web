import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PanelResizeHandle } from './panel-resize-handle'

const props = {
  width: 300,
  onResize: () => {},
  onResizingChange: () => {},
}

describe('PanelResizeHandle', () => {
  it('remains inset by default and can target the outside gutter', () => {
    const inset = renderToStaticMarkup(createElement(PanelResizeHandle, { ...props, edge: 'right' }))
    const rightOutside = renderToStaticMarkup(createElement(PanelResizeHandle, { ...props, edge: 'right', placement: 'outside' }))
    const leftOutside = renderToStaticMarkup(createElement(PanelResizeHandle, { ...props, edge: 'left', placement: 'outside' }))

    expect(inset).toMatch(/\bright-0\b/)
    expect(inset).not.toMatch(/\bleft-full\b|\bright-full\b/)
    expect(rightOutside).toMatch(/\bleft-full\b/)
    expect(leftOutside).toMatch(/\bright-full\b/)
  })
})
