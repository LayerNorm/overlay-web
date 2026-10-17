/**
 * Embeds a finished smoke run into internal/plans/mockups/reliable-agents-mockup.html so the Run tab replays it.
 * Usage: npx tsx scripts/smoke/cloud-agent-long-horizon/build-mockup.mts [artifacts/smoke/cloud-agent-long-horizon/<run>]
 * Reads report.json and events.ndjson from the run folder; file previews and upload times come from R2.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'

const here = dirname(fileURLToPath(import.meta.url))
const runsDir = join(here, '../../../artifacts/smoke/cloud-agent-long-horizon')
const runDir = process.argv[2] ?? join(runsDir, readdirSync(runsDir).filter((name) => name.startsWith('run-')).sort().at(-1)!)
const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'))
const events = readFileSync(join(runDir, 'events.ndjson'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
const session = events.find((event) => event.type === 'session')

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
})
const bucket = process.env.R2_BUCKET_NAME!
const prefix = report.drive.prefix.replace(`r2://${bucket}/`, '')
const read = async (key: string) => (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body!.transformToString()
const ledger: Array<{ at: number; path: string; sha: string; bytes: number }> =
  JSON.parse(await read(`${prefix}.overlay/runs/${report.runId}.json`)).ledger

// Show each file when it first reached storage; keep its final hash and contents.
const files = await Promise.all(report.drive.files.map(async (file: { path: string; sha: string; bytes: number }) => ({
  ...file,
  at: ledger.find((entry) => entry.path === file.path)?.at ?? events[0].t,
  preview: (await read(`${prefix}${file.path}`)).slice(0, 12_000),
})))

const data = {
  // The repository is public: keep machine ids and bucket names out of the embedded report.
  report: { ...report, timeline: undefined, box: undefined, rehydrate: report.rehydrate && { ...report.rehydrate, box: undefined },
    drive: { ...report.drive, prefix: report.drive.prefix.replace(`r2://${bucket}/`, 'r2://<bucket>/') } },
  // Unwrap hard-wrapped lines so the message reads like something a person typed.
  prompt: readFileSync(join(here, 'PROMPT.md'), 'utf8').trim().replace(/([^\n])\n(?!\n)/g, '$1 '),
  modelSet: events.find((event) => event.type === 'model_set')?.model,
  modeSet: events.find((event) => event.type === 'mode_set')?.mode,
  effort: session?.configOptions?.find((option: { id: string }) => option.id === 'effort')?.values,
  events: events.filter((event) => ['text', 'tool', 'heartbeat', 'stall', 'done', 'plan'].includes(event.type)),
  files,
}

const mockup = join(here, '../../../internal/plans/mockups/reliable-agents-mockup.html')
const html = readFileSync(mockup, 'utf8')
const json = JSON.stringify(data).replace(/</g, '\\u003c')
writeFileSync(mockup, html.replace(/\/\*RUN_DATA\*\/[\s\S]*?\/\*END_RUN_DATA\*\//, () => `/*RUN_DATA*/${json}/*END_RUN_DATA*/`))
console.log(`embedded ${data.events.length} events and ${files.length} files from ${report.runId}`)
