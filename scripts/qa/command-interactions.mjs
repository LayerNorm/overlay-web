// Real CommandPalette + GlobalSearchDialog, deterministic search responses.
// Component evidence complements authenticated current-head preview QA.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { chromium } from 'playwright'
import { expect } from 'playwright/test'
const root = process.cwd()
const evidence = path.join(root, 'artifacts/command-qa')
await mkdir(evidence, { recursive: true })
const fixture = `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{useHotkeys}from'react-hotkeys-hook';import{requireShortcutHotkey}from'./src/shared/shortcuts/shortcut-registry';
import{CommandPalette,Command,CommandInput,CommandList,CommandGroup,CommandItem}from'@overlay/ui';
import{GlobalSearchDialog}from'./src/components/layout/GlobalSearchDialog';
import{PRESETS}from'./packages/overlay-app-core/src/theme/presets';window.presets=PRESETS;window.activations=[];window.destinations=[];
function App(){const[open,setOpen]=useState(false),[query,setQuery]=useState(''),[crumb,setCrumb]=useState(false),[mode,setMode]=useState('product'),[loading,setLoading]=useState(false),[empty,setEmpty]=useState(false);window.fixture=(next)=>{setMode(next);setQuery('');setCrumb(false);setLoading(next==='loading');setEmpty(next==='empty')};
useHotkeys(requireShortcutHotkey('global.search'),()=>setOpen(v=>!v),{preventDefault:true,enableOnFormTags:true,enableOnContentEditable:true});
const rows=mode==='description'?[{kind:'item',id:'described',label:'Overlay',description:'Master workspace agent with full access to workspace context, memory, files, notes, automations, and all tools.'}]:mode==='long'?Array.from({length:80},(_,i)=>({kind:'item',id:'item-'+i,label:'Result '+i,description:'Long result description'})):mode==='loading'||mode==='empty'?[]:[{kind:'action',id:'z',label:'Zulu',emphasized:true},{kind:'item',id:'disabled',label:'Disabled',disabled:true},{kind:'category',id:'a',label:'Alpha'},{kind:'item',id:'b',label:'Beta',description:'Description'}];
return <><button id="opener" onClick={()=>setOpen(true)}>Open search</button><input id="outside" aria-label="Outside input"/><div contentEditable suppressContentEditableWarning id="editor">Editor</div>{mode==='product'?<GlobalSearchDialog open={open} onClose={()=>setOpen(false)} workspaceId="fixture" onNewChat={()=>window.activations.push('new-chat')}/>:<CommandPalette open={open} onClose={()=>setOpen(false)} query={query} onQueryChange={setQuery} rows={rows} loading={loading} emptyState={empty?'No results':undefined} breadcrumb={crumb?{label:'Chats'}:null} onBreadcrumbBack={()=>setCrumb(false)} onActivateRow={row=>{window.activations.push(row.id);if(row.kind==='category')setCrumb(true);else setOpen(false)}}/>}
{mode==='groups'?<Command shouldFilter={false} label="Grouped fixture"><CommandInput/><CommandList><CommandGroup heading="First"><CommandItem value="zulu">Zulu</CommandItem></CommandGroup><CommandGroup heading="Second"><CommandItem value="alpha">Alpha</CommandItem></CommandGroup></CommandList></Command>:null}</>}
createRoot(document.getElementById('root')).render(<App/>);
`
const output = await build({
  stdin: { contents: fixture, resolveDir: root, loader: 'tsx' },
  bundle: true,
  write: false,
  jsx: 'automatic',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'search-fixtures',
      setup(b) {
        b.onResolve(
          {
            filter:
              /^(next\/navigation|@\/shared\/app\/overlay-app-client|@\/components\/mentions\/mention-search|@\/components\/providers\/(CapabilitiesProvider|AuthorizationProvider))$/,
          },
          (args) => ({ path: args.path, namespace: 'fixture' }),
        )
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          loader: 'js',
          contents:
            args.path === 'next/navigation'
              ? `export const useRouter=()=>({push:path=>window.destinations.push(path)});`
              : args.path.includes('overlay-app-client')
                ? `export const overlayAppClient={agents:{list:async()=>({agents:[{id:'agent',name:'Fixture Agent',description:'description-match'}]})},work:{list:async()=>({items:[{id:'task',title:'Fixture Task description-match',status:'todo'}]})}};`
                : args.path.endsWith('CapabilitiesProvider')
                  ? `export const useOverlayCapabilities=()=>({capabilities:{work:true}});`
                  : args.path.endsWith('AuthorizationProvider')
                    ? `export const useAuthorization=()=>({allows:()=>true});`
                    : `export function invalidateMentionCache(){};export async function searchMentions(query){await new Promise(r=>setTimeout(r,query==='slow'?300:20));if(query==='missing'||query==='slow')return [];const types=['chat','file','automation','skill','mcp','connector'];return types.map(type=>({type,label:type,icon:'FileText',items:[{type,id:type,name:'Recent '+type,description:type==='file'?'note':type}]}));}`,
        }))
      },
    },
  ],
})
const css = await postcss([tailwind()]).process(
  `@import 'tailwindcss';@import './packages/overlay-ui/src/styles.css';@source './packages/overlay-ui/src';`,
  { from: path.join(root, 'command-qa.css') },
)
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}body{background:var(--background);color:var(--foreground);font-family:system-ui;height:150vh}</style><div id="root"></div><script>${output.outputFiles[0].text.replaceAll('</script>', '<\\/script>')}</script>`
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.end(html)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
      : {}),
  })
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const dialog = page.getByRole('dialog', { name: 'Command palette', exact: true }),
    input = dialog.getByRole('combobox'),
    selected = () => dialog.locator('[cmdk-item][aria-selected=true]')
  const open = async () => {
    await page.locator('#opener').click()
    await expect(input).toBeFocused()
    await page.waitForTimeout(75)
  }
  const close = async () => {
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.locator('#opener')).toBeFocused()
  }
  await open()
  await expect(dialog.getByRole('option', { name: 'Chats', exact: true })).toBeVisible()
  assert.equal(await page.locator('[role=dialog]').count(), 1)
  await page.keyboard.press('Enter')
  await expect(input).toHaveAttribute('placeholder', 'Search chats...')
  await expect(dialog.getByRole('option', { name: 'Recent chat chat', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(input).toHaveAttribute('placeholder', 'Type a command or search...')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('option', { name: 'Files', exact: true }).click()
  await expect(input).toHaveAttribute('placeholder', 'Search files...')
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'All', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(input).toBeFocused()
  assert.equal(await page.evaluate(() => window.destinations.length), 0)
  await input.fill('missing')
  await expect(dialog.getByRole('status')).toContainText('No results')
  await input.fill('')
  await expect(dialog.getByRole('option', { name: 'Chats', exact: true })).toBeVisible()
  await input.fill('description-match')
  await expect(dialog.getByRole('option')).toHaveCount(8) // already-ranked results have no label match
  for (const [label, href] of [
    ['Recent chat chat', '/app/chat?id=chat'],
    ['Recent file note', '/app/notes?id=file'],
    ['Recent automation automation', '/app/automations?automationId=automation'],
    ['Recent skill skill', '/app/tools?view=skills&id=skill'],
    ['Recent mcp mcp', '/app/tools?view=mcps&id=mcp'],
    ['Recent connector connector', '/app/tools?view=apps&slug=connector'],
    ['Fixture Agent description-match', '/app/agents?agentId=agent'],
    ['Fixture Task description-match Todo', '/app/work?task=task'],
  ]) {
    if (await dialog.isHidden()) {
      await open()
      await input.fill('description-match')
    }
    await dialog.getByRole('option', { name: label, exact: true }).click()
    await expect(dialog).toBeHidden()
    assert.equal(await page.evaluate(() => window.destinations.at(-1)), href)
  }
  await open()
  await input.fill('slow')
  await expect(dialog.locator('[cmdk-list]')).toHaveAttribute('aria-busy', 'true')
  await input.fill('')
  await expect(dialog.getByRole('option', { name: 'Chats', exact: true })).toBeVisible()
  await page.waitForTimeout(350)
  await expect(dialog.getByRole('option', { name: 'Chats', exact: true })).toBeVisible()
  await close()
  console.log(
    'PASS real GlobalSearchDialog: recent categories, drill/back, Tab breadcrumb, query/clear/empty/loading race, 8 destinations (including enabled Work tasks)',
  )
  await page.evaluate(() => window.fixture('palette'))
  await open()
  await expect(selected()).toHaveText('Zulu')
  await input.fill('not-a-label')
  await expect(dialog.getByRole('option')).toHaveCount(4)
  assert.deepEqual(await dialog.locator('[cmdk-item]').allTextContents(), [
    'Zulu',
    'Disabled',
    'Alpha',
    'BetaDescription',
  ])
  await page.keyboard.press('ArrowDown')
  await expect(selected()).toHaveText('Alpha')
  await page.keyboard.press('ArrowDown')
  await expect(selected()).toHaveText('BetaDescription')
  await page.keyboard.press('ArrowDown')
  await expect(selected()).toHaveText('BetaDescription')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(selected()).toHaveText('Zulu')
  await page.keyboard.press('ArrowUp')
  await expect(selected()).toHaveText('Zulu')
  await page.keyboard.press('Tab')
  await expect(input).toBeFocused()
  assert.ok(await page.evaluate(() => document.body.hasAttribute('data-scroll-locked')))
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  assert.equal(await page.evaluate(() => window.activations.at(-1)), 'z')
  await expect(page.locator('#opener')).toBeFocused()
  await open()
  await page.mouse.click(5, 5)
  await expect(dialog).toBeHidden()
  await expect(page.locator('#opener')).toBeFocused()
  await page.locator('#outside').focus()
  await page.keyboard.press('Meta+k')
  await expect(input).toBeFocused()
  await page.keyboard.press('Meta+k')
  await expect(dialog).toBeHidden()
  await expect(page.locator('#outside')).toBeFocused()
  await page.keyboard.type('normal typing')
  await expect(page.locator('#outside')).toHaveValue('normal typing')
  await page.locator('#editor').focus()
  await page.keyboard.press('Meta+k')
  await expect(input).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('#editor')).toBeFocused()
  console.log(
    'PASS palette: app order, disabled skip, clamped arrows, single activation, Tab trap, scroll lock, outside/shortcut dismissal, focus and normal input',
  )
  await page.evaluate(() => window.fixture('long'))
  await open()
  for (let i = 0; i < 79; i++) await page.keyboard.press('ArrowDown')
  await expect(selected()).toContainText('Result 79')
  assert.ok(await dialog.locator('[cmdk-list]').evaluate((e) => e.scrollTop > 0))
  const box = await dialog.boundingBox()
  assert.ok(box.height <= 560 && box.width <= 576)
  await page.screenshot({ path: path.join(evidence, 'long-light.png') })
  await close()
  await page.evaluate(() => window.fixture('loading'))
  await open()
  await expect(dialog.getByRole('status', { name: 'Searching' })).toBeVisible()
  await close()
  await page.evaluate(() => window.fixture('empty'))
  await open()
  await expect(dialog.getByRole('status')).toHaveText('No results')
  await close()
  await page.evaluate(() => window.fixture('palette'))
  await open()
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme)
    await page.waitForTimeout(250) // Settle token color transitions before visual evidence.
    await page.screenshot({ path: path.join(evidence, theme + '.png') })
  }
  const presets = await page.evaluate(() =>
    window.presets.map((p) => ({ id: p.id, css: p.cssVars })),
  )
  for (const preset of presets) {
    await page.evaluate((p) => {
      document.documentElement.dataset.themePreset = p.id
      for (const [k, v] of Object.entries(p.css)) document.documentElement.style.setProperty(k, v)
    }, preset)
    const expected = await page.evaluate(() => {
      let e = document.createElement('div')
      e.style.color = 'var(--surface-elevated)'
      document.body.append(e)
      let color = getComputedStyle(e).color
      e.remove()
      return color
    })
    await expect
      .poll(() => dialog.evaluate((e) => getComputedStyle(e).backgroundColor))
      .toBe(expected)
  }
  await page.screenshot({ path: path.join(evidence, 'preset.png') })
  await close()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => {
    document.documentElement.removeAttribute('style')
    document.documentElement.dataset.theme = 'light'
    window.fixture('long')
  })
  await open()
  const mobile = await dialog.boundingBox()
  assert.ok(mobile.x >= 15 && mobile.x + mobile.width <= 375 && mobile.y + mobile.height <= 844)
  await page.screenshot({ path: path.join(evidence, 'mobile.png') })
  await close()
  await page.evaluate(() => window.fixture('description'))
  await open()
  const described = dialog.locator('[cmdk-item]')
  const rowWidth = (await described.boundingBox()).width
  const labelWidth = (await described.locator('span').first().boundingBox()).width
  const descriptionWidth = (await described.locator('span').last().boundingBox()).width
  assert.ok(labelWidth >= 50, 'Long descriptions must leave the agent name visible')
  assert.ok(descriptionWidth <= rowWidth * 0.45 + 1)
  await page.screenshot({ path: path.join(evidence, 'mobile-long-description.png') })
  await close()
  await page.evaluate(() => window.fixture('groups'))
  const grouped = page.locator('[cmdk-root]').filter({ has: page.getByRole('group') })
  await expect(grouped.getByRole('group')).toHaveCount(2)
  await grouped.getByRole('combobox').fill('unmatched')
  assert.deepEqual(await grouped.getByRole('option').allTextContents(), ['Zulu', 'Alpha'])
  const windows = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
  })
  await windows.addInitScript(() =>
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' }),
  )
  await windows.goto(`http://127.0.0.1:${server.address().port}`)
  await windows.locator('#outside').focus()
  await windows.keyboard.press('Control+k')
  await expect(windows.getByRole('dialog')).toBeVisible()
  await windows.keyboard.press('Control+k')
  await expect(windows.getByRole('dialog')).toBeHidden()
  await expect(windows.locator('#outside')).toBeFocused()
  await windows.close()
  assert.deepEqual(errors, [])
  await writeFile(
    path.join(evidence, 'result.json'),
    JSON.stringify({ passed: true, presets: presets.length, errors }, null, 2),
  )
  console.log(
    'PASS long-list scrolling, loading/empty, groups, mobile, light/dark and ' +
      presets.length +
      ' actual preset tokens; no page errors',
  )
} finally {
  await browser?.close()
  server.close()
}
