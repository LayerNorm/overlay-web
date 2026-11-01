import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(directory, '../../..')
const name = path.join(directory, 'extension-cards-dialogs')
const bundle = await build({ entryPoints: [`${name}.tsx`], bundle: true, write: false, minify: true, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })
const styles = await postcss([tailwindcss({ base: root })]).process(await readFile(`${name}.css`, 'utf8'), { from: `${name}.css` })
const font = await readFile(path.join(root, 'node_modules/next/dist/next-devtools/server/font/geist-latin.woff2'))
await writeFile(`${name}.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Overlay | Extensions design preview</title><style>@font-face{font-family:Geist;src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');font-weight:100 900;font-display:swap}${styles.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`)
console.log(`Built ${name}.html`)
