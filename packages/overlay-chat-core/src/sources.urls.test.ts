import assert from 'node:assert/strict'
import test from 'node:test'
import { Worker } from 'node:worker_threads'
import { collectWebSourcesFromSingleBlock } from './sources'

test('source URLs lose trailing prose punctuation while internal punctuation and deduplication are preserved', () => {
  const sources = collectWebSourcesFromSingleBlock({
    kind: 'tool', key: 'search', name: 'web_search', state: 'output-available',
    toolOutput: { summary: 'https://example.test/a,b;c.,; https://example.test/a,b;c https://example.test/other;' },
  })
  assert.deepEqual(sources.map(source => source.url), ['https://example.test/a,b;c', 'https://example.test/other'])
})

test('long comma runs cannot hold source extraction in a quadratic scan', { timeout: 15_000 }, async t => {
  const worker = new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    import(workerData.source).then(({collectWebSourcesFromSingleBlock})=>{
      const extract=summary=>collectWebSourcesFromSingleBlock({kind:'tool',key:'search',name:'web_search',state:'output-available',toolOutput:{summary}});
      const interior='https://example.test/'+','.repeat(250000)+'x';
      const trailing='https://example.test/'+','.repeat(250000);
      parentPort.postMessage({interiorPreserved:extract(interior)[0]?.url===interior,trailingTrimmed:extract(trailing)[0]?.url==='https://example.test/'});
    }).catch(error=>{throw error});
  `, { eval: true, execArgv: ['--import', 'tsx'], workerData: { source: new URL('./sources.ts', import.meta.url).href } })
  t.after(() => worker.terminate())
  const result = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Source extraction exceeded its ten-second isolated budget')) }, 10_000)
    worker.once('message', value => { clearTimeout(timer); resolve(value) })
    worker.once('error', error => { clearTimeout(timer); reject(error) })
    worker.once('exit', code => { if (code !== 0) { clearTimeout(timer); reject(new Error(`Source worker exited with code ${code}`)) } })
  })
  assert.deepEqual(result, { interiorPreserved: true, trailingTrimmed: true })
})
