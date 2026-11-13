async function main() {
  const { createRequire } = await import('node:module')
  const { execFileSync } = await import('node:child_process')
  const loadModule = createRequire(__filename)
  const { build } = loadModule('esbuild')
  const postcss = loadModule('postcss')
  const tailwind = loadModule('@tailwindcss/postcss')
  const { existsSync, readFileSync, writeFileSync } = loadModule('node:fs')
  const path = loadModule('node:path')
  const root = path.resolve(__dirname, '../../..')
  const stem = path.join(__dirname, 'agent-files-and-activity')
  const nodePaths = process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : []
  const ui = path.resolve(root, 'packages/overlay-ui/src')
  const shellImports = {
    '@overlay/ui': `export { cn } from '${ui}/utils/cn'`,
    '@overlay/ui/primitives': ['button', 'sidebar', 'popover', 'panel-resize-handle'].map(name => `export * from '${ui}/components/ui/${name}'`).join('\n'),
    '@overlay/ui/overlays': `export { DelayedTooltip } from '${ui}/components/overlays/DelayedTooltip'`,
    '@overlay/ui/control-reset': `export * from '${ui}/control-reset'`,
  }
  const creatureCss = []
  const bundle = await build({
    entryPoints: [`${stem}.tsx`],
    bundle: true,
    minify: true,
    write: false,
    plugins: [{
      name: 'mockup-shell-and-creature-imports',
      setup(build) {
        build.onResolve({ filter: /^@overlay\/ui(?:\/.*)?$/ }, args => shellImports[args.path] ? { path: args.path, namespace: 'focused-ui' } : undefined)
        build.onLoad({ filter: /.*/, namespace: 'focused-ui' }, args => ({ contents: shellImports[args.path], resolveDir: ui }))
        build.onResolve({ filter: /^@\// }, args => {
          const base = path.resolve(root, 'src', args.path.slice(2))
          const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')].find(existsSync)
          return resolved ? { path: resolved } : undefined
        })
        build.onResolve({ filter: /^@overlay\/workspace-contracts$/ }, () => ({ path: path.resolve(root, 'packages/overlay-workspace-contracts/src/types.ts') }))
        build.onResolve({ filter: /\.module\.css$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'mockup-css-module' }))
        build.onLoad({ filter: /.*/, namespace: 'mockup-css-module' }, args => {
          const source = readFileSync(args.path, 'utf8')
          creatureCss.push(source)
          const names = [...new Set([...source.matchAll(/\.([\w-]+)\s*\{/g)].map(([, name]) => name))]
          const classes = Object.fromEntries(names.map(name => [name, name]))
          return { contents: `export default ${JSON.stringify(classes)}`, loader: 'js' }
        })
      },
    }],
    nodePaths,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })

  function createDemoVideo(variant) {
    const background = variant === 'a' ? '0x263331' : '0x333632'
    const filters = variant === 'a'
      ? "drawbox=x='90+80*sin(2*PI*t/4)':y=62:w=196:h=236:color=0xd9ae73@0.60:t=fill,drawbox=x='410-42*sin(2*PI*t/4)':y=0:w=220:h=360:color=0x4a665c@0.74:t=fill,drawbox=x='320+28*cos(2*PI*t/4)':y=24:w=2:h=312:color=0xffe8b6@0.76:t=fill"
      : "drawbox=x='60+42*sin(2*PI*t/4)':y=92:w=152:h=180:color=0xa96f55@0.62:t=fill,drawbox=x='370-90*cos(2*PI*t/4)':y=28:w=200:h=300:color=0xd3c7a9@0.44:t=fill,drawbox=x=0:y='258+8*sin(2*PI*t/4)':w=640:h=3:color=0xf5e5c3@0.58:t=fill"
    const bytes = execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=${background}:s=640x360:r=24:d=4`,
      '-vf', filters,
      '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'baseline',
      '-pix_fmt', 'yuv420p', '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4', 'pipe:1',
    ], { maxBuffer: 4 * 1024 * 1024 })
    return `data:video/mp4;base64,${bytes.toString('base64')}`
  }

  const media = { a: createDemoVideo('a'), b: createDemoVideo('b') }
  const sourceCss = readFileSync(`${stem}.css`, 'utf8')
    .replace("@import 'tailwindcss'", `@import '${loadModule.resolve('tailwindcss/index.css')}'`)
    + `\n${creatureCss.join('\n')}`
  const css = await postcss([tailwind({ optimize: true })]).process(sourceCss, { from: `${stem}.css` })
  const script = bundle.outputFiles[0].text.replace(/<\//g, '<\\/')
  const html = `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Overlay | Agent files and activity</title><style>${css.css}</style></head><body><div id="root"></div><script>window.__AGENT_FILES_MEDIA__=${JSON.stringify(media)};</script><script>${script}</script></body></html>`.replace(/[ \t]+$/gm, '')
  writeFileSync(`${stem}.html`, html)
  console.log(`Built ${stem}.html`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
