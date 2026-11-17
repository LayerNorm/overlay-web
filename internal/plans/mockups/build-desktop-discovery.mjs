#!/usr/bin/env node
/**
 * Builds desktop-discovery.html: how a visitor finds and downloads the desktop app.
 *
 * The mockup is the production marketing page with the proposed changes applied, not a
 * redrawing. This script reads the live home page (markup, stylesheets, fonts and logos),
 * inlines them so the file opens from disk, and then adds:
 *   - a Download link in the top navigation and the footer,
 *   - a "Download for Mac" hero button for Mac visitors,
 *   - an "Overlay for Mac" section,
 *   - a Mac row in the "Hire your first AI employee" card,
 *   - the proposed /download page, in its before and after-click states.
 * Everything added is marked `data-new`, so the bar at the bottom can outline it.
 *
 *   node internal/plans/mockups/build-desktop-discovery.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const ORIGIN = 'https://www.getoverlay.io'
const OUT = path.join(import.meta.dirname, 'desktop-discovery.html')
const RELEASE = { version: '0.3.0', file: 'overlay-0.3.0.dmg', date: 'November 17, 2026', size: '131 MB' }

const get = async (url, binary = false) => {
  const response = await fetch(url.startsWith('http') ? url : ORIGIN + url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh)' } })
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  return binary ? Buffer.from(await response.arrayBuffer()) : response.text()
}

/** Lucide icons, drawn the way the page draws them. */
const SHAPES = {
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  terminal: '<path d="M12 19h8"/><path d="m4 17 6-6-6-6"/>',
  mic: '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  out: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  right: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  cpu: '<path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/><path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/><path d="M7 20v2"/><path d="M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  fileCheck: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="m9 15 2 2 4-4"/>',
}
const icon = (name, cls = 'i') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${cls}" aria-hidden="true">${SHAPES[name]}</svg>`

/** Apple's mark, from the landing page's own logo set (public/assets/svg/landing/apple.svg), in the button's text colour. */
const APPLE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 814 1000" fill="currentColor" class="apple" aria-hidden="true"><path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/></svg>'

const replaceOnce = (text, find, replacement) => {
  const at = text.indexOf(find)
  if (at < 0) throw new Error(`The live page no longer contains: ${find.slice(0, 80)}`)
  return text.slice(0, at) + replacement + text.slice(at + find.length)
}

const desktopSection = `
<section class="sec" id="desktop" data-new>
  <div class="onmac">
    <div>
      <h2 class="h2">Overlay for Mac<br/><span class="dim">agents on your computer</span></h2>
      <p class="lead">Run a thread on your Mac, in the folders you choose. Nothing is uploaded, and Overlay asks before it runs a command.</p>
      <div class="actions">
        <a class="btn primary" href="#download" data-go="download-start">${APPLE} Download for Mac</a>
        <a class="btn ghost" href="https://github.com/LayerNorm/overlay-desktop" target="_blank" rel="noopener noreferrer">Source ${icon('out')}</a>
      </div>
      <p class="meta-line">Apple silicon · Open source</p>
    </div>
    <div class="step-art">
      <div class="mini">
        <div class="mini-h">${icon('monitor', 'i sm')}This computer<span class="meta">Maya’s MacBook Pro</span></div>
        <div class="mini-r">${icon('folder', 'i sm')}<span class="k">~/Projects/website</span><span class="meta">working folder</span></div>
        <div class="mini-r">${icon('terminal', 'i sm')}<span class="k">npm test</span><span class="meta" style="color:var(--sl-ok)">214 passed</span></div>
        <div class="mini-r">${icon('mic', 'i sm')}<span class="k">Dictate into any app</span><span class="meta"><kbd>⌃</kbd><kbd>Space</kbd></span></div>
        <div class="mini-r">${icon('panel', 'i sm')}<span class="k">Chat over any window</span><span class="meta"><kbd>⌘</kbd><kbd>.</kbd></span></div>
      </div>
    </div>
  </div>
</section>`

const installSteps = `
<section class="sec" data-new>
  <div class="head"><h2 class="h2">Install in three steps</h2></div>
  <div class="grid3">
    <div class="cell"><div class="num">01</div><h3 class="h3">Open the download</h3><p class="body">Find <span class="file">${RELEASE.file}</span> in your Downloads folder and open it.</p></div>
    <div class="cell"><div class="num">02</div><h3 class="h3">Drag Overlay to Applications</h3><p class="body">The disk image shows Overlay next to your Applications folder. Drag it across.</p></div>
    <div class="cell"><div class="num">03</div><h3 class="h3">Open Overlay and sign in</h3><p class="body">Sign-in happens in your browser and brings you straight back to the app.</p></div>
  </div>
</section>`

const beforeYouInstall = `
<section class="sec">
  <div class="split">
    <div class="head">
      <h2 class="h2">Before you install</h2>
      <p class="lead">Check the requirements, read how your data is handled, or build it yourself.</p>
    </div>
    <div class="pcol">
      <a class="prow" href="#">${icon('cpu')}System requirements${icon('right', 'i go')}</a>
      <a class="prow" href="#">${icon('shield')}Privacy policy${icon('right', 'i go')}</a>
      <a class="prow" href="#">${icon('globe')}Source repository${icon('right', 'i go')}</a>
      <a class="prow" href="#">${icon('fileCheck')}Checksums and provenance${icon('right', 'i go')}</a>
    </div>
  </div>
</section>`

const downloadPage = `
<div data-view="download" hidden>
  <section class="sec page-head" data-visitor="mac">
    <p class="eyebrow">Desktop</p>
    <h1 class="h1" data-when="ready">Overlay for Mac</h1>
    <h1 class="h1" data-when="started" data-new>Your download has started</h1>
    <p class="lead" data-when="ready">Run agents on your own computer, dictate into any app and keep Overlay one shortcut away.</p>
    <p class="lead" data-when="started" data-new><span class="file">${RELEASE.file}</span> is on its way to your Downloads folder. Three steps and you’re in.</p>
    <div class="actions" data-when="ready">
      <a class="btn primary" href="#download" data-go="download-start">${APPLE} Download for Mac</a>
      <a class="btn ghost" href="#">Release notes ${icon('out')}</a>
    </div>
    <div class="actions" data-when="started" data-new>
      <a class="btn ghost" href="#download" data-go="download-start">${icon('download')} Download again</a>
      <a class="btn ghost" href="#">Release notes ${icon('out')}</a>
    </div>
    <p class="meta-line">Version ${RELEASE.version} · ${RELEASE.date} · Apple silicon (M1 or later) · ${RELEASE.size}</p>
  </section>
  <section class="sec page-head" data-visitor="other" data-new>
    <p class="eyebrow">Desktop</p>
    <h1 class="h1">Overlay for Mac</h1>
    <p class="lead">The desktop app is for Mac with Apple silicon today. Everything else in Overlay works in your browser, on any computer.</p>
    <div class="actions">
      <a class="btn primary" href="#">Open Overlay in your browser ${icon('right', 'i go')}</a>
      <a class="btn ghost" href="#" data-copy>${icon('copy')} <span>Copy link for your Mac</span></a>
    </div>
    <p class="meta-line">Version ${RELEASE.version} · ${RELEASE.date} · Apple silicon (M1 or later)</p>
  </section>
  <div data-visitor="mac">${installSteps}</div>
  ${beforeYouInstall}
</div>`

const mockupStyles = `
/* Added for the proposal. */
.sl .onmac { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }
.sl .onmac .lead { margin-top: 18px; max-width: 440px; }
.sl .onmac .actions { justify-content: flex-start; }
.sl .onmac .step-art .mini { max-width: 360px; }
.sl .apple { width: 14px; height: 16px; flex: none; margin-top: -2px; }
.sl .prow > .apple { width: 16px; color: var(--sl-muted); }
.sl kbd { font-family: var(--sl-sans); font-size: 11px; line-height: 1; color: var(--sl-muted); border: 1px solid var(--sl-line-2); border-radius: 5px; padding: 3px 5px; background: var(--sl-panel); }
.sl kbd + kbd { margin-left: 3px; }
.sl .file { font-family: var(--sl-mono); font-size: .92em; color: var(--sl-text); }
.sl .cell .h3 { margin-top: 10px; }
@media (max-width: 860px) { .sl .onmac { grid-template-columns: 1fr; gap: 28px; } }

/* Mockup states. */
[hidden] { display: none !important; }
html[data-visitor='mac'] [data-visitor='other'], html[data-visitor='other'] [data-visitor='mac'] { display: none !important; }
html[data-download='ready'] [data-when='started'], html[data-download='started'] [data-when='ready'] { display: none !important; }
html[data-outline='on'] [data-new] { outline: 1.5px dashed #2563eb; outline-offset: 4px; border-radius: 6px; }

/* The mockup's own control bar; not part of the proposal. */
.mock-bar { position: fixed; z-index: 50; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; align-items: center; gap: 14px; max-width: calc(100vw - 24px); overflow-x: auto; padding: 6px 8px 6px 14px; border-radius: 999px; background: #1c1c1c; color: #c9c9c9; font: 500 12px/1 ui-sans-serif, system-ui, -apple-system, sans-serif; box-shadow: 0 8px 28px -8px rgba(0,0,0,.45); white-space: nowrap; }
.mock-bar { scrollbar-width: none; }
.mock-bar::-webkit-scrollbar { display: none; }
.mock-bar .group { display: flex; align-items: center; gap: 2px; }
.mock-bar .label { color: #8a8a8a; margin-right: 6px; }
.mock-bar button { all: unset; cursor: pointer; padding: 7px 10px; border-radius: 999px; color: #c9c9c9; }
.mock-bar button:hover { color: #fff; }
.mock-bar button[aria-pressed='true'] { background: #3a3a3a; color: #fff; }
`

const mockupScript = `
(() => {
  const root = document.documentElement
  const state = { view: 'home', visitor: 'mac', download: 'ready', outline: 'off' }
  const params = new URLSearchParams(location.search)
  for (const key of Object.keys(state)) if (params.get(key)) state[key] = params.get(key)
  if (params.get('theme') === 'dark') root.dataset.landingTheme = 'dark'

  const render = () => {
    root.dataset.visitor = state.visitor
    root.dataset.download = state.download
    root.dataset.outline = state.outline
    for (const view of document.querySelectorAll('[data-view]')) view.hidden = view.dataset.view !== state.view
    for (const button of document.querySelectorAll('.mock-bar button')) {
      const [key, value] = button.dataset.set.split(':')
      const page = state.view === 'home' ? 'home' : state.download === 'started' && state.visitor === 'mac' ? 'started' : 'download'
      button.setAttribute('aria-pressed', String(key === 'page' ? value === page : state[key] === value))
    }
  }
  const go = (page) => {
    state.view = page === 'home' ? 'home' : 'download'
    state.download = page === 'started' && state.visitor === 'mac' ? 'started' : 'ready'
    render()
    window.scrollTo({ top: 0 })
  }

  document.addEventListener('click', (event) => {
    const bar = event.target.closest('.mock-bar button')
    if (bar) {
      const [key, value] = bar.dataset.set.split(':')
      if (key === 'page') return go(value)
      state[key] = key === 'outline' ? (state.outline === 'on' ? 'off' : 'on') : value
      if (key === 'visitor' && value === 'other') state.download = 'ready'
      return render()
    }
    const link = event.target.closest('a, button')
    if (!link) return
    if (link.matches('[aria-label="Toggle light / dark mode"]')) {
      root.dataset.landingTheme = root.dataset.landingTheme === 'dark' ? 'light' : 'dark'
      return
    }
    const target = link.dataset.go
    if (target === 'home') { event.preventDefault(); return go('home') }
    if (target === 'download') { event.preventDefault(); return go('download') }
    // A "Download for Mac" button starts the download and lands on the install steps.
    if (target === 'download-start') { event.preventDefault(); return go(state.visitor === 'mac' ? 'started' : 'download') }
    if (link.hasAttribute('data-copy')) {
      event.preventDefault()
      link.querySelector('span').textContent = 'Link copied'
      return
    }
    const href = link.getAttribute('href') || ''
    if (href.startsWith('#') && href.length > 1 && document.getElementById(href.slice(1))) return
    event.preventDefault()
  })
  render()
})()
`

async function main() {
  const page = await get('/home')

  // Stylesheets, with fonts inlined so the file opens from disk.
  let css = ''
  for (const [, href] of page.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)) css += await get(href)
  css = css.replace(/@font-face\{[^}]*KaTeX[^}]*\}/g, '')
  const fonts = new Map()
  for (const [whole, url] of css.matchAll(/url\((\/_next\/static\/media\/[^)]+\.woff2)[^)]*\)/g)) {
    if (!fonts.has(url)) fonts.set(url, `url(data:font/woff2;base64,${(await get(url, true)).toString('base64')})`)
    css = css.split(whole).join(fonts.get(url))
  }
  css = css.replace(/url\((\/assets\/[^)]+)\)/g, `url(${ORIGIN}$1)`)

  // The page itself: the marketing frame without the framework's scripts.
  const start = page.indexOf('<div class="sl')
  const end = page.indexOf('<script', page.indexOf('</footer>'))
  let body = page.slice(start, end).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')

  const logos = new Map()
  for (const [, src] of body.matchAll(/src="(\/assets\/svg\/landing\/[^"]+)"/g)) {
    if (!logos.has(src)) logos.set(src, `data:image/svg+xml;base64,${(await get(src, true)).toString('base64')}`)
  }
  for (const [src, data] of logos) body = body.split(`src="${src}"`).join(`src="${data}"`)

  // Navigation: a Download link, and the logo goes home.
  body = replaceOnce(body, '<a href="/blog">Blog</a></nav>', '<a href="/blog">Blog</a><a href="#download" data-go="download" data-new>Download</a></nav>')
  body = replaceOnce(body, '<a aria-label="Overlay home" href="/home">', '<a aria-label="Overlay home" href="#home" data-go="home">')
  body = replaceOnce(body, '<a href="/home">Product</a>', '<a href="#home" data-go="home">Product</a>')

  // Hero: Mac visitors get the download beside "Get started"; everyone else keeps "Star on GitHub".
  const star = body.match(/<a class="btn ghost" href="https:\/\/github\.com\/LayerNorm\/overlay-web"[\s\S]*?<\/a>/)
  if (!star) throw new Error('The hero no longer has its GitHub button')
  body = replaceOnce(body, star[0],
    `<a class="btn ghost" href="#download" data-go="download-start" data-visitor="mac" data-new>${APPLE} Download for Mac</a>`
    + star[0].replace('<a class="btn ghost"', '<a class="btn ghost" data-visitor="other"'))

  // The new section sits after "One place to get things done".
  body = replaceOnce(body, '<section class="sec"><div class="head"><h2 class="h2">Built for how teams', `${desktopSection}<section class="sec"><div class="head"><h2 class="h2">Built for how teams`)

  // "Hire your first AI employee": the Web column becomes Web and Mac.
  const signIn = body.match(/<a class="prow" href="\/auth\/sign-in">[\s\S]*?<\/a>/)
  if (!signIn) throw new Error('The platforms card no longer has its Sign in row')
  body = replaceOnce(body, signIn[0], `<a class="prow" href="#download" data-go="download-start" data-new>${APPLE}Download for Mac${icon('right', 'i sm go')}</a>`)
  body = replaceOnce(body, '<div class="pcol"><h3>Web</h3>', '<div class="pcol"><h3>Web and Mac</h3>')

  // Footer: Product column.
  const pricing = body.match(/<a class="([^"]*)" href="\/pricing">Pricing<\/a>(?![\s\S]*href="\/pricing">Pricing<\/a>)/)
  if (!pricing) throw new Error('The footer no longer has its Pricing link')
  body = replaceOnce(body, pricing[0], `${pricing[0]}<a class="${pricing[1]}" href="#download" data-go="download" data-new>Desktop app</a>`)

  // Two views inside the frame: the home page and the download page.
  body = replaceOnce(body, '<section class="hero">', '<div data-view="home"><section class="hero">')
  body = replaceOnce(body, '<footer', `</div>${downloadPage}<footer`)

  const htmlTag = page.match(/<html[^>]*>/)[0].replace(/ data-dpl-id="[^"]*"/, '')
  const bodyTag = page.match(/<body[^>]*>/)[0]
  const bar = `
<div class="mock-bar" role="toolbar" aria-label="Mockup controls">
  <div class="group"><span class="label">Page</span>
    <button data-set="page:home">Home</button><button data-set="page:download">Download</button><button data-set="page:started">After click</button></div>
  <div class="group"><span class="label">Visitor</span>
    <button data-set="visitor:mac">Mac</button><button data-set="visitor:other">Windows, Linux, phone</button></div>
  <div class="group"><button data-set="outline:on">Outline what’s new</button></div>
</div>`

  const html = `<!doctype html>
<!-- Built by build-desktop-discovery.mjs from the live marketing page. Do not edit by hand. -->
${htmlTag}
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Desktop discovery and download</title>
<style>${css}</style>
<style>${mockupStyles}</style>
</head>
${bodyTag}
${body}
${bar}
<script>${mockupScript}</script>
</body>
</html>
`
  fs.writeFileSync(OUT, html)
  console.log(`${path.relative(process.cwd(), OUT)}: ${(html.length / 1024).toFixed(0)} KB`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
