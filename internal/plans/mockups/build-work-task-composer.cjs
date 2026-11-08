async function main() {
  const { createRequire } = await import('node:module')
  const loadModule = createRequire(__filename)
  const { build } = loadModule('esbuild')
  const postcss = loadModule('postcss')
  const tailwind = loadModule('@tailwindcss/postcss')
  const { readFileSync, writeFileSync } = loadModule('node:fs')
  const path = loadModule('node:path')
  const stem = path.join(__dirname, 'work-task-composer')
  const nodePaths = process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : []
  const ui = path.resolve(__dirname, '../../../packages/overlay-ui/src')
  const shellImports = {
    '@overlay/ui': `export { cn } from '${ui}/utils/cn'`,
    '@overlay/ui/primitives': ['button', 'sidebar', 'popover', 'panel-resize-handle', 'command'].map(name => `export * from '${ui}/components/ui/${name}'`).join('\n'),
    '@overlay/ui/overlays': `export { DelayedTooltip } from '${ui}/components/overlays/DelayedTooltip'`,
    '@overlay/ui/control-reset': `export * from '${ui}/control-reset'`,
  }
  const bundle = await build({ entryPoints: [`${stem}.tsx`], bundle: true, minify: true, write: false,
    plugins: [{ name: 'focused-ui-exports', setup(build) {
      build.onResolve({ filter: /^@overlay\/ui(?:\/.*)?$/ }, args => shellImports[args.path] ? { path: args.path, namespace: 'focused-ui' } : undefined)
      build.onLoad({ filter: /.*/, namespace: 'focused-ui' }, args => ({ contents: shellImports[args.path], resolveDir: ui }))
    } }],
    nodePaths, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })
  const sourceCss = readFileSync(`${stem}.css`, 'utf8').replace("@import 'tailwindcss'", `@import '${loadModule.resolve('tailwindcss/index.css')}'`)
  const css = await postcss([tailwind({ optimize: true })]).process(sourceCss, { from: `${stem}.css` })
  writeFileSync(`${stem}.html`, `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Overlay | Work task composer</title><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\//g, '<\\/')}</script></body></html>`.replace(/[ \t]+$/gm, ''))
  console.log(`Built ${stem}.html`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
