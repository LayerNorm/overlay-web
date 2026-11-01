import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const path = name => fileURLToPath(new URL(name, import.meta.url))
const stem = 'harness-resource-pause-mockup'
const bundle = await build({
  entryPoints: [path(`${stem}.tsx`)], bundle: true, minify: true, write: false,
  platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'inline',
})
const stylesheet = path(`${stem}.css`)
const css = await postcss([tailwind({ optimize: true })]).process(await readFile(stylesheet, 'utf8'), { from: stylesheet })
const escapeEndTag = text => text.replace(/<\//g, '<\\/')
await writeFile(path(`${stem}.html`), `<!doctype html>
<!-- Generated from ${stem}.tsx with the repository's shadcn components.
     Rebuild: node internal/plans/mockups/build-harness-resource-pause-mockup.mjs -->
<html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Overlay | Task pause and resume</title><style>${css.css}</style></head><body><div id="root"></div><script>${escapeEndTag(bundle.outputFiles[0].text)}</script></body></html>`)
console.log(`Built self-contained ${stem}.html with bundled React, Radix and shadcn controls.`)
