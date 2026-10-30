import React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OverlayMark } from './OverlayMark'
import { BrandLockup } from './BrandLockup'

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')

describe('OverlayMark', () => {
  it('renders an accessible, theme-colored inline O with static eyes by default', () => {
    const html = renderToStaticMarkup(React.createElement(OverlayMark))
    expect(html).toContain('width="20" height="20"')
    expect(html).toContain('viewBox="43 -815 860 860"')
    expect(html).toContain('fill="currentColor"')
    expect(html).toContain('role="img" aria-label="Overlay"')
    expect(html).toContain('overlay-mark--none')
    expect(html.match(/<path /g)).toHaveLength(2)
    expect(html).not.toMatch(/<img|<filter|<linearGradient|#[0-9a-f]{6}/i)
  })

  it('uses the approved small eyes up to and including 24 pixels', () => {
    for (const size of [6.5, 20, 24]) {
      const html = renderToStaticMarkup(React.createElement(OverlayMark, { size }))
      expect(html).toContain('M347.0 -447.0A46.0 46.0')
      expect(html).not.toContain('M377.0 -451.0A33.0 33.0')
    }
    const large = renderToStaticMarkup(React.createElement(OverlayMark, { size: 25 }))
    expect(large).toContain('M377.0 -451.0A33.0 33.0')
    expect(large).not.toContain('M347.0 -447.0A46.0 46.0')
  })

  it('hides decorative marks and forwards a custom label, size, and class', () => {
    const decorative = renderToStaticMarkup(React.createElement(OverlayMark, { label: '' }))
    expect(decorative).toContain('aria-hidden="true"')
    expect(decorative).not.toMatch(/aria-label|role=/)
    const named = renderToStaticMarkup(React.createElement(OverlayMark, {
      size: 32,
      label: 'Workspace brand',
      className: 'custom-mark',
    }))
    expect(named).toContain('width="32" height="32"')
    expect(named).toContain('aria-label="Workspace brand"')
    expect(named).toContain('custom-mark')
    expect(named).not.toContain('aria-hidden')
  })

  it('animates only the eyes with the selected motion', () => {
    for (const motion of ['none', 'blink', 'look'] as const) {
      const html = renderToStaticMarkup(React.createElement(OverlayMark, { motion }))
      expect(html).toContain(`overlay-mark--${motion}`)
      expect(html).toContain('<g class="overlay-mark-eyes"><path')
    }
    expect(css).toMatch(/\.overlay-mark-eyes\s*\{\s*transform-box: fill-box;\s*transform-origin: center;/)
    expect(css).toContain('animation: overlay-mark-blink 6s infinite')
    expect(css).toContain('animation: overlay-mark-look 2.4s ease-in-out infinite')
    expect(css).toContain('96.5% { transform: scaleY(0.1); }')
    expect(css).toContain('20%, 40% { transform: translateX(-95px); }')
    expect(css).toContain('60%, 80% { transform: translateX(95px); }')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.overlay-mark--look \.overlay-mark-eyes,\s*\.overlay-mark--blink \.overlay-mark-eyes\s*\{\s*animation: none;/)
  })
})

describe('BrandLockup', () => {
  it('reads as Overlay once while composing the O mark with selectable verlay text', () => {
    const html = renderToStaticMarkup(React.createElement(BrandLockup, {
      className: 'text-xl',
      style: { fontSize: 24 },
    }))
    expect(html.match(/aria-label="Overlay"/g)).toHaveLength(1)
    expect(html).toContain('role="img"')
    expect(html).toContain('brand-lockup text-xl')
    expect(html).toContain('font-size:24px')
    expect(html).toContain('brand-lockup-word">verlay</span>')
    expect(html).not.toContain('>overlay<')
    expect(html).toContain('brand-lockup-mark" aria-hidden="true"')
    expect(css).toContain("font-family: 'Libre Baskerville'")
    expect(css).toContain('width: 0.86em')
    expect(css).toContain('height: 0.86em')
  })

  it('keeps the accessible brand name with no class or a conflicting label', () => {
    const html = renderToStaticMarkup(React.createElement(BrandLockup, { 'aria-label': '' }))
    expect(html).toContain('class="brand-lockup"')
    expect(html).toContain('aria-label="Overlay"')
  })

  it('can move the mark eyes without animating the wordmark', () => {
    const html = renderToStaticMarkup(React.createElement(BrandLockup, { motion: 'look' }))
    expect(html).toContain('overlay-mark--look')
    expect(html).not.toMatch(/style=.*animation/)
  })
})
