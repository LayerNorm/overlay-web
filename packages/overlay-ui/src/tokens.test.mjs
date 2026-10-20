import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { tsImport } from 'tsx/esm/api'

const { overlayDesignTokens, overlayTailwindTheme } = await import('./tokens.ts')
const { getPresetCssVars } = await tsImport('../../overlay-app-core/src/theme/presets.ts', import.meta.url)
const { lightColorTheme, darkColorTheme } = await tsImport('../../overlay-app-core/src/theme/base.ts', import.meta.url)

test('overlay ui exposes design tokens and a Tailwind-compatible theme', () => {
  assert.equal(overlayDesignTokens.colors.background, 'var(--background)')
  assert.equal(overlayDesignTokens.spacing[4], '1rem')
  assert.equal(overlayTailwindTheme.colors.background, 'var(--background)')
  assert.equal(overlayTailwindTheme.borderRadius.lg, '0.75rem')
})

test('neutral buttons have separate surfaces and readable text in both themes', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
  assert.match(css, /--primary: var\(--button-primary-bg\)/)
  assert.match(css, /--secondary: var\(--button-secondary-bg\)/)
  const luminance = (hex) => {
    const channels = hex.match(/[0-9a-f]{2}/gi).map((part) => parseInt(part, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  for (const block of [css.match(/:root \{([\s\S]*?)\}/)[1], css.match(/\[data-theme='dark'\] \{([\s\S]*?)\}/)[1]]) {
    for (const variant of ['primary', 'secondary']) {
      const token = (name) => block.match(new RegExp(`--button-${variant}-${name}: (#[0-9a-f]+)`))[1]
      for (const surface of ['bg', 'hover']) {
        assert.notEqual(token(surface), '#ffffff')
        assert.notEqual(token(surface), '#000000')
        const [lighter, darker] = [luminance(token(surface)), luminance(token('text'))].sort((a, b) => b - a)
        assert.ok((lighter + 0.05) / (darker + 0.05) >= 4.5, `${variant} ${surface} text contrast`)
      }
    }
  }
})

test('runtime default presets and fallback colors preserve the stylesheet control palette', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
  const blocks = [css.match(/:root \{([\s\S]*?)\}/)[1], css.match(/\[data-theme='dark'\] \{([\s\S]*?)\}/)[1]]
  for (const [index, mode] of ['light', 'dark'].entries()) {
    const preset = getPresetCssVars(`default-${mode}`)
    const fallback = index === 0 ? lightColorTheme : darkColorTheme
    for (const [, key, value] of blocks[index].matchAll(/(--(?:button|toast)-[\w-]+): (#[0-9a-f]+);/g)) {
      assert.equal(preset[key], value, `${mode} runtime ${key}`)
      const field = key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      if (field in fallback) assert.equal(fallback[field], value, `${mode} fallback ${key}`)
    }
  }
})
