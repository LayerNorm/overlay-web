// Render the real shared wrappers and product pickers, without a backend.
// Hosted current-head QA is still required before a Builder marks a PR ready.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
const root = process.cwd()
const require = createRequire(path.join(root, 'package.json'))
const { build } = require('esbuild')
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const postcss = require('postcss')
const tailwind = require('@tailwindcss/postcss')
const output = await build({
  stdin: {
    contents: `
import React,{useState,useRef} from 'react';import{createRoot}from'react-dom/client';
import{FloatingMenu,MenuItem,DialogFrame,Popover,PopoverTrigger,PopoverContent,CollapsibleSection,Toggle}from'@overlay/ui/primitives';
import{ComprehensiveModelPicker}from'./packages/overlay-chat-react/src/components/ComprehensiveModelPicker';
import{ChatExperienceHeader}from'./packages/overlay-chat-react/src/components/ChatExperienceHeader';
import{WorkspaceSwitcherView}from'./src/features/workspaces/components/WorkspaceSwitcherView';
const models=Array.from({length:30},(_,i)=>({id:'model-'+i,name:i===0?'Alpha':i===1?'Beta':'Model '+i,provider:'QA',cost:0,supportsReasoning:true,reasoningLevels:[{value:'low',label:'Low'},{value:'high',label:'High'}]}));
function App(){const [open,setOpen]=useState(false),[dialog,setDialog]=useState(false),[selected,setSelected]=useState('none'),[prefs,setPrefs]=useState({modelId:'model-0'}),[workspaceOpen,setWorkspaceOpen]=useState(false),[createOpen,setCreateOpen]=useState(false),[headerOpen,setHeaderOpen]=useState(false),[hover,setHover]=useState(null),[pos,setPos]=useState(null),[mode,setMode]=useState('text'),[selectionMode,setSelectionMode]=useState('multiple'),[ids,setIds]=useState(['model-0']),[reason,setReason]=useState('low');const anchor=useRef(null),legacy=useRef(null),[legacyOpen,setLegacyOpen]=useState(false),rootRef=useRef(null),menuRef=useRef(null),pickerRef=useRef(null),scrollRef=useRef(null);const no=()=>{};
return <><button id="outside">Outside</button><output id="selected">{selected}</output><output id="reason">{reason}</output>
<div style={{position:'fixed',bottom:8,right:8}}><FloatingMenu anchorRef={anchor} open={open} onOpenChange={setOpen} kind="menu" trigger={<button id="actions" ref={anchor}>Actions</button>} className="w-48"><MenuItem onClick={()=>setSelected('Alpha')}>Alpha</MenuItem><MenuItem disabled onClick={()=>setSelected('disabled')}>Disabled</MenuItem><MenuItem onClick={()=>setSelected('Beta')}>Beta</MenuItem><MenuItem onClick={()=>setDialog(true)}>Open dialog</MenuItem></FloatingMenu></div>
<div style={{position:'fixed',top:8,right:8,width:240}}><ComprehensiveModelPicker generationMode="text" preferences={prefs} onPreferencesChange={setPrefs} chatModels={models}/></div>
<div style={{position:'fixed',top:48,left:8,width:280}}><WorkspaceSwitcherView rootRef={rootRef} menuRef={menuRef} open={workspaceOpen} onOpenChange={setWorkspaceOpen} compact={false} placement="footer" status="ready" workspaces={[{id:'one',name:'Workspace One',humanMemberCount:2},{id:'two',name:'Workspace Two',humanMemberCount:3}]} activeWorkspace={{id:'one',name:'Workspace One'}} activeWorkspaceId="one" switchingWorkspaceId={null} error={null} actionError={null} refresh={no} onSelectWorkspace={id=>{setSelected(id);setWorkspaceOpen(false)}} onCreateRequest={()=>{setWorkspaceOpen(false);setCreateOpen(true)}} createOpen={createOpen} createBusy={false} onCreateOpenChange={setCreateOpen} onCreate={async()=>setCreateOpen(false)} accountMenu={<CollapsibleSection label="Usage"><Toggle checked={true} onCheckedChange={no} aria-label="Example toggle"/></CollapsibleSection>}/></div>
<div style={{position:'fixed',top:180,left:8,right:8}}><ChatExperienceHeader activeChatId="qa" editingChatId={null} editingChatTitle="" onEditingChatTitleChange={no} onCommitChatRename={no} onCancelChatRename={no} headerTitleInputRef={anchor} showAutomationHeaderControls={false} titleLabel="Fixture chat" showRenameButton={false} showAutomationChatTab appMode="chat" isTemporaryChat={false} isActiveLoading={false} onTemporaryChatToggle={no} onGenerationModeChange={setMode} generationMode={mode} personalChatMode="chat" onPersonalChatModeChange={no} renderExportMenu={()=>null} modelPickerRef={pickerRef} videoSubModePickerRef={anchor} modelPickerListScrollRef={scrollRef} showModelPicker={headerOpen} onToggleModelPicker={()=>setHeaderOpen(v=>!v)} onSetShowModelPicker={setHeaderOpen} modelPickerLabel="Header models" hoveredModelId={hover} modelQualitiesPos={pos} onHoveredModelChange={(id,p)=>{setHover(id);setPos(p)}} resolveModel={id=>models.find(m=>m.id===id)} isFreeTier={false} isFreeTierChatModelId={()=>true} automationHeaderModelId="model-0" automationHeaderModels={models} onSaveAutomationHeaderModel={no} getChatModelDisplayName={id=>id} automationDetailTab="chat" onSelectAutomationDetailTab={no} videoSubMode="text-to-video" showVideoSubModePicker={false} onToggleVideoSubModePicker={no} onSetShowVideoSubModePicker={no} onVideoSubModeChange={no} imageModels={[{id:'image',name:'QA Image'}]} selectedImageModels={[]} imageModelSelectionMode={selectionMode} onToggleImageModel={no} onImageModelSelectionModeChange={setSelectionMode} videoModels={[]} selectedVideoModels={[]} videoModelSelectionMode="single" onToggleVideoModel={no} onVideoModelSelectionModeChange={no} selectableTextModels={models} textModelsLoading={false} askModelSelectionMode={selectionMode} selectedActModel={ids[0]} selectedModels={ids} onToggleTextModel={id=>{setIds(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);setSelected(id)}} onTextModelSelectionModeChange={setSelectionMode} hasAutomationContext={false} reasoning={reason} onReasoningChange={setReason}/></div>
<div style={{position:'fixed',bottom:8,left:8}} ref={legacy}><button id="legacy" onClick={()=>setLegacyOpen(v=>!v)}>Legacy anchor</button><FloatingMenu anchorRef={legacy} open={legacyOpen} onOpenChange={setLegacyOpen} side="top" aria-label="Legacy content"><input aria-label="Legacy input"/><button onClick={()=>setLegacyOpen(false)}>Done</button></FloatingMenu></div>
<DialogFrame open={dialog} onOpenChange={setDialog} title="Parent dialog" description="Nested menu test"><Popover><PopoverTrigger asChild><button id="nested">Nested picker</button></PopoverTrigger><PopoverContent aria-label="Nested content"><input aria-label="Nested input"/><button>Nested action</button></PopoverContent></Popover></DialogFrame>
</>}
createRoot(document.getElementById('root')).render(<App/>);
`,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const css = await postcss([tailwind()]).process(`@import 'tailwindcss';@import './packages/overlay-ui/src/styles.css';@source './packages/overlay-ui/src';@source './packages/overlay-chat-react/src';@source './src/features/workspaces/components';`, { from: path.join(root, 'menu-qa.css') })
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}body{background:var(--background);color:var(--foreground);font-family:system-ui}button:focus-visible{outline:2px solid var(--foreground)}</style><div id="root"></div><script>${output.outputFiles[0].text.replaceAll('</script>', '<\\/script>')}</script>`
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
const out = process.env.MENU_QA_OUTPUT ?? '/tmp/overlay-menu-qa'
await fs.mkdir(out, { recursive: true })
try {
  let launch = { headless: true }
  if (process.env.CHROMIUM_EXECUTABLE_PATH) launch.executablePath = process.env.CHROMIUM_EXECUTABLE_PATH
  if (process.env.CHROMIUM_RUNTIME_MODULE) {
    const runtime = (await import(process.env.CHROMIUM_RUNTIME_MODULE)).default
    launch = { ...launch, executablePath: await runtime.executablePath(), args: runtime.args }
  }
  browser = await chromium.launch(launch)
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const focused = async id => expect(page.locator(id)).toBeFocused()
  const contained = async selector => {
    const box = await page.locator(selector).boundingBox()
    const size = page.viewportSize()
    assert.ok(box && box.x >= 7 && box.y >= 7 && box.x + box.width <= size.width - 7 && box.y + box.height <= size.height - 7, JSON.stringify(box))
  }
  await page.locator('#actions').focus()
  await page.keyboard.press('ArrowDown')
  await page.getByRole('menu').waitFor()
  await focused('[role="menuitem"]:has-text("Alpha")')
  await page.keyboard.press('ArrowDown')
  await focused('[role="menuitem"]:has-text("Beta")')
  await page.keyboard.press('Home')
  await focused('[role="menuitem"]:has-text("Alpha")')
  await page.keyboard.type('b')
  await focused('[role="menuitem"]:has-text("Beta")')
  await contained('[role="menu"]')
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[role="menu"]')).opacity === '1')
  await page.screenshot({ path: `${out}/action-edge-light.png` })
  await focused('[role="menuitem"]:has-text("Beta")')
  await page.keyboard.press('Enter')
  await page.getByRole('menu').waitFor({ state: 'detached' })
  assert.equal(await page.locator('#selected').textContent(), 'Beta')
  await focused('#actions')
  await page.locator('#actions').click()
  await page.keyboard.press('Escape')
  await focused('#actions')
  await page.locator('#actions').click()
  await page.locator('#outside').click()
  await page.getByRole('menu').waitFor({ state: 'detached' })
  await focused('#outside')
  console.log('PASS action menu mouse, arrows, disabled skip, typeahead, selection, Escape/focus, outside, edge collision')

  await page.getByRole('button', { name: 'Alpha', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Choose model', exact: true })
  await picker.waitFor()
  assert.equal(await picker.getByRole('menuitem').count(), 0)
  await contained('[aria-label="Choose model"]')
  await picker.locator('.overflow-y-auto').evaluate(el => { el.scrollTop = 150 })
  assert.ok(await picker.locator('.overflow-y-auto').evaluate(el => el.scrollTop > 0))
  await picker.getByRole('button', { name: 'Beta', exact: true }).click()
  await picker.waitFor({ state: 'detached' })
  await focused('button:has-text("Beta")')
  await page.getByRole('button', { name: 'Beta', exact: true }).click()
  await page.keyboard.press('Tab')
  assert.equal(await picker.evaluate(el => el.contains(document.activeElement)), true)
  await page.keyboard.press('Escape')
  await picker.waitFor({ state: 'detached' })
  console.log('PASS comprehensive picker native controls, Tab, selection, Escape/focus, portal collision')

  const workspace = page.getByRole('button', { name: 'Workspace and account menu' })
  await workspace.click()
  const workspaces = page.getByRole('dialog', { name: 'Workspace and account', exact: true })
  await workspaces.getByRole('button', { name: 'Usage', exact: true }).click()
  await workspaces.getByRole('switch').waitFor()
  await workspaces.getByRole('button', { name: 'Workspace Two', exact: false }).click()
  assert.equal(await page.locator('#selected').textContent(), 'two')
  await workspace.click()
  await workspaces.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await page.getByRole('dialog', { name: 'Create a workspace' }).waitFor()
  await page.getByLabel('Workspace name').fill('QA')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Create a workspace' }).waitFor({ state: 'detached' })
  await focused('button[aria-label="Workspace and account menu"]')
  console.log('PASS workspace disclosures, selection, create-dialog handoff, Escape/focus')

  await page.locator('#legacy').click()
  await page.getByLabel('Legacy input').fill('works')
  await page.keyboard.press('Escape')
  await focused('#legacy')
  console.log('PASS legacy external anchor API and focus restoration')

  await page.locator('#actions').click()
  await page.getByRole('menuitem', { name: 'Open dialog' }).click()
  const dialog = page.getByRole('dialog', { name: 'Parent dialog', exact: true })
  await dialog.waitFor()
  await page.locator('#nested').click()
  await page.getByLabel('Nested input').fill('nested')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Nested content' }).waitFor({ state: 'detached' })
  assert.equal(await dialog.count(), 1)
  await focused('#nested')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  console.log('PASS portalled popover inside dialog: focus, top-layer Escape, parent stays open')

  await page.getByRole('button', { name: 'Header models', exact: true }).click()
  const header = page.getByRole('dialog', { name: 'Choose model', exact: true })
  await header.getByRole('button', { name: 'Beta', exact: true }).click()
  assert.equal(await header.count(), 1)
  await header.getByRole('button', { name: 'Beta', exact: true }).hover()
  const details = page.getByRole('dialog', { name: 'Model details' })
  await details.waitFor()
  await contained('[aria-label="Model details"]')
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[aria-label="Model details"]')).opacity === '1')
  await page.mouse.move(450, 650)
  const detailsAlignment = async () => {
    const panel = await details.boundingBox()
    const row = await header.getByRole('button', { name: 'Beta', exact: true }).boundingBox()
    return Math.abs(panel.y + panel.height / 2 - row.y - row.height / 2)
  }
  await expect.poll(detailsAlignment).toBeLessThan(2)
  await header.locator('.max-h-72.overflow-y-auto').evaluate(el => { el.scrollTop = 15 })
  await expect.poll(detailsAlignment).toBeLessThan(2)
  await details.getByRole('button', { name: 'Reasoning effort' }).click()
  await details.getByRole('option', { name: 'High', exact: true }).click()
  assert.equal(await page.locator('#reason').textContent(), 'high')
  assert.equal(await header.count(), 1)
  await page.mouse.move(450, 650)
  await page.keyboard.press('Escape')
  await header.waitFor({ state: 'detached' })
  console.log('PASS real chat model multi-selection, portalled rows, collision-aware details and reasoning control')

  for (const [theme, preset, color] of [['light', '', 'rgb(255, 255, 255)'], ['dark', '', 'rgb(17, 17, 19)'], ['dark', 'qa', 'rgb(48, 40, 60)']]) {
    await page.evaluate(({theme,preset}) => { document.documentElement.dataset.theme=theme;document.documentElement.dataset.themePreset=preset;document.documentElement.style.setProperty('--surface-elevated', preset ? '#30283c' : ''); }, {theme,preset})
    await page.locator('#actions').click()
    assert.equal(await page.getByRole('menu').evaluate(el => getComputedStyle(el).backgroundColor), color)
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[role="menu"]')).opacity === '1')
    await page.getByRole('menu').screenshot({ path: `${out}/action-${theme}${preset ? '-preset' : ''}.png` })
    await page.keyboard.press('Escape')
  }
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const mobile = await touch.newPage()
  mobile.on('pageerror', e => errors.push(e.message))
  await mobile.goto(`http://127.0.0.1:${server.address().port}`)
  await mobile.locator('#actions').tap()
  await mobile.getByRole('menuitem', { name: 'Beta', exact: true }).tap()
  assert.equal(await mobile.locator('#selected').textContent(), 'Beta')
  await mobile.getByRole('button', { name: 'Alpha', exact: true }).tap()
  await mobile.getByRole('dialog', { name: 'Choose model', exact: true }).getByRole('button', { name: 'Beta', exact: true }).tap()
  await mobile.screenshot({ path: `${out}/mobile-touch.png` })
  assert.deepEqual(errors, [])
  console.log(`PASS light/dark/CSS preset tokens and mobile/touch; screenshots: ${out}; no page errors`)
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
