async function main() {
  const { createRequire } = await import('node:module')
  const loadModule = createRequire(__filename)
  const { build } = loadModule('esbuild')
  const postcss = loadModule('postcss')
  const tailwind = loadModule('@tailwindcss/postcss')
  const { readFileSync, writeFileSync } = loadModule('node:fs')
  const path = loadModule('node:path')
  const root = path.resolve(__dirname, '../../..')
  const name = process.argv[2] ?? 'chief-harness-ui-audit'
  const stem = path.join(__dirname, name)
  const ui = path.join(root, 'packages/overlay-ui/src')
  // Offline adapters replace routing/data only. Product presentation components are imported unchanged.
  const adapters = {
    '@overlay/ui': `export { cn } from '${ui}/utils/cn'`,
    '@overlay/ui/primitives': ['button', 'sidebar', 'popover', 'panel-resize-handle', 'avatar'].map(name => `export * from '${ui}/components/ui/${name}'`).join('\n'),
    '@overlay/ui/overlays': `export { DelayedTooltip } from '${ui}/components/overlays/DelayedTooltip'`,
    '@overlay/ui/ai': `export * from '${ui}/components/ui/trace'`,
    '@overlay/ui/control-reset': `export * from '${ui}/control-reset'`,
    'next/link': `import React from 'react'; export default React.forwardRef(function Link(props, ref) { return React.createElement('a', {...props, ref}); });`,
    '@/hooks/use-workspace-href': `export const useWorkspaceHref = () => (_workspace, href) => href;`,
    '@/components/layout/sidebar-nav': `export const agentThreadHref = (_base, _agent, conversation) => '#' + conversation;`,
    '../lib/use-live-work': `export const useLiveAssignments = () => ({ results: [], status: 'Exhausted', loadMore() {} });`,
    '../lib/use-work-route': `export const useWorkRoute = () => ({ listView: 'workspace' });`,
  }
  const bundle = await build({ entryPoints: [`${stem}.tsx`], bundle: true, minify: true, write: false,
    outdir: path.join(__dirname, '.unused-output'), platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'offline-preview-adapters', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => adapters[args.path] ? { path: args.path, namespace: 'offline' } : undefined)
      builder.onLoad({ filter: /.*/, namespace: 'offline' }, args => ({ contents: adapters[args.path], resolveDir: root }))
    } }],
  })
  const css = await postcss([tailwind({ optimize: true })]).process(readFileSync(`${stem}.css`, 'utf8'), { from: `${stem}.css` })
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
  const moduleCss = bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n')
  writeFileSync(`${stem}.html`, `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Overlay | ${name === 'work-agent-assignments' ? 'Work agent assignments proposal' : 'Chief harness UI audit'}</title><style>${css.css}\n${moduleCss}</style></head><body><div id="root"></div><script>${js.replace(/<\//g, '<\\/')}</script></body></html>`.replace(/[ \t]+$/gm, ''))
  console.log(`Built ${stem}.html`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
