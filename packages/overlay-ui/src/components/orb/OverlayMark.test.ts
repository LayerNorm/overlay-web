import React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OverlayMark } from './OverlayMark'
import { BrandLockup } from './BrandLockup'

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')

describe('approved Overlay brand', () => {
  it('uses the approved geometry, scale and eye outlines at every size', () => {
    for (const size of [20, 24, 40]) {
      const html = renderToStaticMarkup(React.createElement(OverlayMark, { size }))
      expect(html).toContain(`width="${size}" height="${size}"`)
      expect(html).toContain('scale(1.05)')
      expect(html).toContain('M347.0 -447.0A46.0 46.0')
      expect(html).toContain('role="img" aria-label="Overlay"')
      expect(html).toContain('fill="currentColor"')
      expect(html).not.toMatch(/<img|<filter|<linearGradient/)
    }
  })

  it('supports decorative marks, labels, sizes and classes', () => {
    const decorative = renderToStaticMarkup(React.createElement(OverlayMark, { label: '' }))
    expect(decorative).toContain('aria-hidden="true"')
    expect(decorative).not.toMatch(/aria-label|role=/)
    const named = renderToStaticMarkup(React.createElement(OverlayMark, { label: 'Workspace brand', size: 32, className: 'custom-mark' }))
    expect(named).toContain('aria-label="Workspace brand"')
    expect(named).toContain('custom-mark')
    expect(named).toContain('width="32" height="32"')
  })

  it('animates only the eyes and respects reduced motion', () => {
    for (const motion of ['none', 'blink', 'look'] as const) {
      const html = renderToStaticMarkup(React.createElement(OverlayMark, { motion }))
      expect(html).toContain(`approved-brand--${motion}`)
      expect(html).toContain('<g class="brand-eyes">')
    }
    expect(css).toContain('.approved-brand--look .brand-eyes { animation: overlay-mark-look 2.4s ease-in-out infinite; }')
    expect(css).toContain('.approved-brand--blink .brand-eyes { animation: overlay-mark-blink 6s infinite; }')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.approved-brand \.brand-eyes \{ animation: none; \}/)
  })

  it('uses one accessible, font-independent SVG with the approved O offset and spacing', () => {
    const html = renderToStaticMarkup(React.createElement(BrandLockup, { className: 'text-xl', style: { fontSize: 40 }, motion: 'look' }))
    expect(html.match(/aria-label="Overlay"/g)).toHaveLength(1)
    expect(html.match(/<svg/g)).toHaveLength(1)
    expect(html).toContain('brand-lockup text-xl')
    expect(html).toContain('font-size:40px')
    expect(html).toContain('viewBox="57.0 0 3938.0 1090"')
    expect(html).toContain('transform="translate(0 50.0)"')
    expect(html).toContain('approved-brand--look')
    expect(html.match(/data-glyph=/g)).toHaveLength(7)
    expect(html).not.toMatch(/<text|verlay<|brand-lockup-word/)
  })
})
