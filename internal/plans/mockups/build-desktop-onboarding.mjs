#!/usr/bin/env node
/**
 * Builds desktop-onboarding.html from desktop-onboarding.src.html: the proposed first-run setup in
 * Overlay Desktop (internal/plans/DESKTOP_ONBOARDING_PLAN.md).
 *
 * Inlines, so the file opens from disk with no network:
 *   - app logos from public/assets/svg/landing (Claude, OpenAI, Cursor),
 *   - model provider marks from @overlay/ui's provider-logo.tsx (Anthropic, Google, OpenRouter),
 *   - the approved wordmark and O-with-eyes mark from desktop-signed-out-home.html.
 *
 *   node internal/plans/mockups/build-desktop-onboarding.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const here = import.meta.dirname
const root = path.resolve(here, '../../..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const dataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

const logos = {}
for (const name of ['claude', 'openai', 'openai_dark', 'cursor', 'cursor_dark']) {
  logos[name] = dataUri(read(`public/assets/svg/landing/${name}.svg`))
}

// Provider marks are single-colour paths drawn with currentColor in the app; give each theme its colour.
const providerSource = read('packages/overlay-ui/src/components/ui/provider-logo.tsx')
for (const id of ['anthropic', 'google', 'openrouter']) {
  const match = providerSource.match(new RegExp(`"${id}": \\{ label: "[^"]+", paths: \\[\\{ d: "([^"]+)"`))
  if (!match) throw new Error(`provider-logo.tsx no longer has the ${id} mark`)
  const svg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${fill}" d="${match[1]}"/></svg>`
  logos[id] = dataUri(svg('#27272a'))
  logos[`${id}_dark`] = dataUri(svg('#ededf0'))
}

const home = fs.readFileSync(path.join(here, 'desktop-signed-out-home.html'), 'utf8')
const lockup = home.match(/<svg[^>]*class="lockup"[\s\S]*?<\/svg>/)?.[0]
if (!lockup) throw new Error('desktop-signed-out-home.html no longer has the lockup')
const iconGroup = lockup.match(/<g data-brand-icon=""[\s\S]*?<\/g><\/g>/)?.[0]
if (!iconGroup) throw new Error('lockup has no brand icon group')
const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 40 906 906" fill="currentColor" role="img" aria-label="Overlay" style="width:100%;height:100%"><g transform="translate(0 50.0)">${iconGroup}</g></svg>`

const source = fs.readFileSync(path.join(here, 'desktop-onboarding.src.html'), 'utf8')
const out = source
  .replace('/*LOGOS*/{}', JSON.stringify(logos))
  .replace('`/*LOCKUP*/`', JSON.stringify(lockup))
  .replace('`/*MARK*/`', JSON.stringify(mark))
fs.writeFileSync(path.join(here, 'desktop-onboarding.html'), out)
console.log(`Wrote desktop-onboarding.html (${Math.round(out.length / 1024)} KB)`)
