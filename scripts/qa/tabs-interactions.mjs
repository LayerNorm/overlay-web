import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const result = await build({ stdin: { contents: `
  import React, {useState} from 'react'
  import {createRoot} from 'react-dom/client'
  import {TabsList,TabButton} from './packages/overlay-ui/src/components/primitives/Tabs'
  function App(){const [active,setActive]=useState('second');return <>
    <button id="external" onClick={()=>setActive('first')}>External selection</button>
    <TabsList aria-label="Fixture tabs">
      <TabButton active={active==='first'} onClick={()=>setActive('first')}>First</TabButton>
      <TabButton active={active==='second'} onClick={()=>setActive('second')}>Second</TabButton>
      <TabButton disabled>Disabled</TabButton>
      <TabButton active={active==='fourth'} onClick={()=>setActive('fourth')}>Fourth</TabButton>
    </TabsList><output>{active}</output></>}
  createRoot(document.getElementById('root')).render(<App/>);
`, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })
const html = '<!doctype html><div id="root"></div><script>' + result.outputFiles[0].text.replaceAll('</script>', '<\\/script>') + '</script>'
const server = createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end(html)})
let browser
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  browser = await chromium.launch({headless:true,executablePath:process.env.OVERLAY_QA_BROWSER_EXECUTABLE})
  const page = await browser.newPage()
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(`http://127.0.0.1:${address.port}`)
  const selected=()=>page.getByRole('tab',{selected:true}).allTextContents()
  assert.deepEqual(await selected(),['Second'])
  await page.locator('#external').click()
  assert.deepEqual(await selected(),['First'])
  await page.getByRole('tab',{name:'First',exact:true}).focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(()=>document.activeElement?.textContent==='Second',null,{timeout:2000})
  assert.deepEqual(await selected(),['First'])
  await page.keyboard.press('Enter')
  assert.deepEqual(await selected(),['Second'])
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(()=>document.activeElement?.textContent==='Fourth',null,{timeout:2000})
  await page.keyboard.press('Space')
  assert.deepEqual(await selected(),['Fourth'])
  await page.keyboard.press('Home')
  await page.waitForFunction(()=>document.activeElement?.textContent==='First',null,{timeout:2000})
  await page.keyboard.press('Enter')
  assert.deepEqual(await selected(),['First'])
  assert.deepEqual(errors,[])
  console.log('PASS: initial selection, external selection, arrow focus, Enter/Space activation, disabled skip, Home key; no browser errors')
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve))}
