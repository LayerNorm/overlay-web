// Real adapters, Radix, Overlay tokens, and Tailwind v4 in isolated Chromium.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { chromium } from 'playwright'
import { expect } from 'playwright/test'

const root = process.cwd()
const evidence = path.join(root, 'artifacts/select-qa')
await mkdir(evidence, { recursive: true })
const fixture = `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {Select} from './packages/overlay-ui/src/components/primitives/Select';
import {ListboxSelect} from './packages/overlay-ui/src/components/primitives/ListboxSelect';
import {DialogFrame} from './packages/overlay-ui/src/components/primitives/Dialog';
import {PRESETS} from './packages/overlay-app-core/src/theme/presets';
window.presets=PRESETS; window.events=[];
function App(){
 const [value,setValue]=useState(''); const [dialog,setDialog]=useState(false); const [blocked,setBlocked]=useState(false); window.setBlocked=setBlocked;
 const options=[{value:'',label:'Choose account'}, {value:'a',label:'Alpha',group:'Accounts'}, {value:'b',label:'Beta',group:'Accounts',disabled:true}, {value:'z',label:'Zulu',group:'Accounts'}, ...Array.from({length:70},(_,i)=>({value:'long-'+i,label:'Long option '+String(i).padStart(2,'0'),group:'More'}))];
 const record=(v)=>{setValue(v);window.events.push(v)};
 return <main style={{padding:24,maxWidth:420}}>
 <form id="form" onSubmit={e=>{e.preventDefault();window.submitted=true}} onChange={e=>window.formEvent=e.target.value}>
 <label htmlFor="native">Workspace target</label><Select id="native" name="target" value={value} required onChange={e=>{window.eventShape=[e.target.tagName,e.currentTarget.tagName,e.target.name];record(e.target.value)}}>
 <option value="">Choose target</option><optgroup label="People"><option value="a">Alpha</option><option value="b" disabled>Beta</option><option value="z">Zulu</option></optgroup><optgroup label="Unavailable" disabled><option value="no">No access</option></optgroup></Select>
 <label>Uncontrolled plan<Select name="plan" defaultValue="800"><option value="800">$8/month</option><option value="2000">$20/month</option></Select></label>
 <button type="reset">Reset form</button><button type="submit">Submit form</button>
 </form>
 <ListboxSelect disabled={blocked} id="generic" aria-label="Account" name="account" value={value} options={options} onChange={record}/>
 <button id="next">Next control</button>
 <ListboxSelect aria-label="Disabled" value="a" options={options} disabled onChange={()=>{throw Error('disabled callback')}}/>
 <ListboxSelect aria-label="Empty" value="" options={[]} placeholder="No accounts" onChange={record}/>
 <ListboxSelect aria-label="Unknown" value="Select a channel" options={[{value:'c',label:'# channel'}]} onChange={()=>{}}/>
 <ListboxSelect aria-label="Inline" value="a" options={options.slice(0,4)} portal={false} onChange={()=>{}}/>
 <button onClick={()=>setDialog(true)}>Open dialog</button>
 <DialogFrame open={dialog} onOpenChange={setDialog} title="Select fixture" description="Select in a scroll container"><ListboxSelect aria-label="First dialog account" value={value} options={options} onChange={record}/><div style={{height:200,overflow:'auto'}}><div style={{height:100}}/><ListboxSelect aria-label="Dialog account" value={value} options={options} onChange={record}/><div style={{height:400}}/></div><button disabled>Busy action</button></DialogFrame>
 <div style={{position:'fixed',bottom:8,right:8,width:180}}><ListboxSelect aria-label="Edge account" value={value} options={options} onChange={record}/></div>
 </main>
}
createRoot(document.getElementById('root')).render(<App/>);
`
const js = await build({stdin:{contents:fixture,resolveDir:root,loader:'tsx'},bundle:true,write:false,jsx:'automatic',format:'iife',define:{'process.env.NODE_ENV':'"production"'}})
const css = await postcss([tailwind()]).process(`@import "tailwindcss"; @source "${root}/packages/overlay-ui/src";`,{from:path.join(root,'select-qa.css')})
const tokens = await readFile(path.join(root,'packages/overlay-ui/src/styles.css'),'utf8')
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}\n${tokens}\nbody{background:var(--background);color:var(--foreground);font-family:var(--font-sans)}</style><div id="root"></div><script>${js.outputFiles[0].text.replaceAll('</script>','<\\/script>')}</script>`
const server = createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(html)})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
let browser
try {
 browser=await chromium.launch({headless:true,...(process.env.SELECT_QA_CHROMIUM ? {executablePath:process.env.SELECT_QA_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage']} : {})})
 const origin='http://127.0.0.1:'+server.address().port
 const page=await browser.newPage({viewport:{width:900,height:700}})
 page.setDefaultTimeout(5000)
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(origin)
 const native=page.getByRole('combobox',{name:'Workspace target',exact:true})
 const account=page.getByRole('combobox',{name:'Account',exact:true})
 const closed=()=>page.getByRole('listbox').waitFor({state:'detached'})
 await native.focus();await page.keyboard.press('ArrowDown');await page.getByRole('listbox').waitFor()
 assert.equal(await page.getByRole('option',{name:'Beta',exact:true}).getAttribute('aria-disabled'),'true')
 assert.equal(await page.getByRole('option',{name:'No access',exact:true}).getAttribute('aria-disabled'),'true')
 await page.keyboard.press('z');await page.waitForFunction(()=>document.activeElement?.textContent==='Zulu');await page.keyboard.press('Enter');await closed()
 assert.deepEqual(await page.evaluate(()=>window.eventShape),['SELECT','SELECT','target'])
 assert.equal(await native.textContent(),'Zulu')
 assert.equal(await page.evaluate(()=>window.formEvent),'z')
 assert.equal(await page.evaluate(()=>new FormData(document.getElementById('form')).get('target')),'z')
 await expect(native).toBeFocused()
 await native.click();await page.getByRole('option',{name:'Choose target',exact:true}).click();await closed()
 assert.equal(await page.evaluate(()=>window.events.at(-1)),'')
 await page.getByRole('button',{name:'Submit form'}).click();assert.equal(await page.evaluate(()=>!!window.submitted),false)
 await expect(native).toBeFocused()
 console.log('native event target/currentTarget, FormData, empty reselection, disabled groups and required focus: PASS')
 const plan=page.getByRole('combobox',{name:'Uncontrolled plan',exact:true})
 await plan.click();await page.getByRole('option',{name:'$20/month',exact:true}).click();await closed()
 await page.getByRole('button',{name:'Reset form'}).click();await page.waitForFunction(()=>document.querySelector('[name="plan"]').value==='800')
 assert.equal(await plan.textContent(),'$8/month')
 assert.equal(await page.evaluate(()=>new FormData(document.getElementById('form')).get('target')),'')
 console.log('uncontrolled selection and form reset: PASS')
 await account.focus();await page.keyboard.press('ArrowDown');await page.getByRole('listbox').waitFor();await page.keyboard.press('a');await page.waitForFunction(()=>document.activeElement?.textContent==='Alpha');await page.keyboard.press('Enter');await closed()
 assert.equal(await account.textContent(),'Alpha')
 await account.click();await page.keyboard.press('ArrowDown');await page.waitForFunction(()=>document.activeElement?.textContent==='Zulu');await page.keyboard.press('Enter');await closed();assert.equal(await account.textContent(),'Zulu')
 await account.click();await page.keyboard.press('Escape');await closed();await expect(account).toBeFocused()
 await account.click();await page.mouse.click(650,500);await closed()
 await account.click();await page.keyboard.press('Tab');await closed();await expect(page.locator('#next')).toBeFocused()
 await account.click();await page.keyboard.press('Shift+Tab');await closed();await expect(page.getByRole('button',{name:'Submit form'})).toBeFocused()
 await account.click();await page.evaluate(()=>window.setBlocked(true));await closed();assert.equal(await account.isDisabled(),true);await page.evaluate(()=>window.setBlocked(false));assert.equal(await page.getByRole('listbox').count(),0)
 console.log('arrows skip disabled, typeahead, Enter, Escape, outside/Tab and disable-while-open dismissal: PASS')
 assert.equal(await page.getByRole('combobox',{name:'Disabled',exact:true}).isDisabled(),true)
 assert.equal(await page.getByRole('combobox',{name:'Unknown',exact:true}).textContent(),'Select a channel')
 await page.getByRole('combobox',{name:'Empty',exact:true}).click();await page.keyboard.press('Escape');await closed()
 await page.getByRole('combobox',{name:'Inline',exact:true}).click();assert.equal(await page.locator('[data-slot="select-content"]').evaluate(el=>!!el.closest('main')),true);await page.keyboard.press('Escape');await closed()
 console.log('disabled/empty/unknown and portal=false: PASS')
 await page.getByRole('combobox',{name:'Edge account',exact:true}).click();await page.getByRole('listbox').waitFor()
 const box=await page.getByRole('listbox').boundingBox();assert.ok(box.x>=0 && box.y>=0 && box.x+box.width<=900 && box.y+box.height<=700)
 await page.keyboard.press('End');await page.waitForFunction(()=>document.activeElement?.textContent==='Long option 69');await page.keyboard.press('Enter');await closed();assert.equal(await account.textContent(),'Long option 69')
 console.log('long-list keyboard scroll and bottom/right collision: PASS')
 await page.getByRole('button',{name:'Open dialog'}).click();await page.getByRole('combobox',{name:'Dialog account',exact:true}).click();await page.getByRole('option',{name:'Alpha',exact:true}).click();await closed()
 assert.equal(await page.getByRole('dialog').count(),1);await page.getByRole('combobox',{name:'Dialog account',exact:true}).click();await page.keyboard.press('Escape');await closed();assert.equal(await page.getByRole('dialog').count(),1)
 await expect(page.getByRole('combobox',{name:'Dialog account',exact:true})).toBeFocused()
 await page.getByRole('combobox',{name:'Dialog account',exact:true}).click();await page.keyboard.press('Tab');await closed();await expect(page.getByRole('combobox',{name:'First dialog account',exact:true})).toBeFocused()
 await page.getByRole('combobox',{name:'First dialog account',exact:true}).click();await page.keyboard.press('Shift+Tab');await closed();await expect(page.getByRole('combobox',{name:'Dialog account',exact:true})).toBeFocused()
 console.log('dialog boundary Tab/Shift+Tab wraps past disabled footer controls: PASS')
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'})
 console.log('select in dialog/scroll container, selection, Escape layering and focus return: PASS')
 const presets=await page.evaluate(()=>window.presets)
 for(const preset of presets){
  await page.evaluate(p=>{document.documentElement.dataset.theme=p.variant;document.documentElement.dataset.themePreset=p.id;Object.entries(p.cssVars).forEach(([key,value])=>document.documentElement.style.setProperty(key,value))},preset)
  await account.click();await page.getByRole('listbox').waitFor()
  const colors=await page.getByRole('listbox').evaluate(el=>({actual:getComputedStyle(el).backgroundColor,expected:getComputedStyle(document.documentElement).getPropertyValue('--surface-elevated')}))
  const expected=await page.evaluate(color=>{const el=document.createElement('div');el.style.backgroundColor=color;document.body.append(el);const result=getComputedStyle(el).backgroundColor;el.remove();return result},colors.expected)
  assert.equal(colors.actual,expected,preset.id)
  await page.waitForTimeout(300)
  if(['default-light','default-dark','catppuccin'].includes(preset.id))await page.screenshot({path:path.join(evidence,preset.id+'.png')})
  await page.keyboard.press('Escape');await closed()
 }
 console.log('portal colors match Overlay vars for all '+presets.length+' presets: PASS')
 const mobile=await browser.newContext({viewport:{width:390,height:700},hasTouch:true,isMobile:true});const touch=await mobile.newPage();touch.on('pageerror',e=>errors.push(e.message));await touch.goto(origin)
 await touch.getByRole('combobox',{name:'Account',exact:true}).tap();await touch.getByRole('option',{name:'Zulu',exact:true}).tap();await touch.getByRole('listbox').waitFor({state:'detached'})
 assert.equal(await touch.getByRole('combobox',{name:'Account',exact:true}).textContent(),'Zulu')
 await touch.getByRole('combobox',{name:'Edge account',exact:true}).tap();const edge=await touch.getByRole('listbox').boundingBox();assert.ok(edge.x>=0&&edge.x+edge.width<=390&&edge.y>=0&&edge.y+edge.height<=700)
 await touch.waitForTimeout(300)
 await touch.screenshot({path:path.join(evidence,'mobile.png')})
 assert.deepEqual(errors,[]);console.log('mobile touch selection/collision; zero browser errors: PASS')
 await writeFile(path.join(evidence,'result.json'),JSON.stringify({presets:presets.map(p=>p.id),errors,localOnly:true},null,2))
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve))}
