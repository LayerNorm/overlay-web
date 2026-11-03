import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(directory, '../../..')
const name = path.join(directory, 'paid-first')
const bundle = await build({ entryPoints: [`${name}.tsx`], outfile: `${name}.js`, bundle: true, write: false, minify: true, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })
const javascript = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
const componentStyles = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? ''
const styles = await postcss([tailwindcss({ base: root })]).process(await readFile(`${name}.css`, 'utf8'), { from: `${name}.css` })
const geist = await readFile(path.join(root, 'node_modules/next/dist/next-devtools/server/font/geist-latin.woff2'))
const libre = await readFile(path.join(root, 'public/assets/fonts/Libre_Baskerville/static/LibreBaskerville-Regular.ttf'))
await writeFile(`${name}.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Overlay | Onboarding</title><style>@font-face{font-family:Geist;src:url(data:font/woff2;base64,${geist.toString('base64')}) format('woff2');font-weight:100 900;font-display:swap}@font-face{font-family:'Libre Baskerville';src:url(data:font/ttf;base64,${libre.toString('base64')}) format('truetype');font-weight:400;font-display:swap}${styles.css}${componentStyles}</style></head><body><div id="root"></div><script>${javascript.replaceAll('</script', '<\\/script')}</script></body></html>`)
console.log(`Built ${name}.html`)
