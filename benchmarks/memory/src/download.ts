import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { config } from './config'

/**
 * Dataset downloader. Everything lands in benchmarks/memory/datasets/
 * (gitignored — never committed).
 *
 *   npx tsx benchmarks/memory/src/download.ts locomo
 *   npx tsx benchmarks/memory/src/download.ts convomem [filesPerCategory]
 *   npx tsx benchmarks/memory/src/download.ts longmemeval
 */

const HF = 'https://huggingface.co'

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return await res.text()
}

async function hfList(repo: string, dir: string): Promise<string[]> {
  const res = await fetch(`${HF}/api/datasets/${repo}/tree/main/${dir}`)
  if (!res.ok) throw new Error(`HF list failed ${res.status}: ${dir}`)
  const items = (await res.json()) as Array<{ path: string; type: string }>
  return items.map((i) => i.path)
}

async function hfDownload(repo: string, remotePath: string, localPath: string): Promise<void> {
  if (existsSync(localPath)) return
  const res = await fetch(`${HF}/datasets/${repo}/resolve/main/${remotePath}`)
  if (!res.ok) throw new Error(`HF download failed ${res.status}: ${remotePath}`)
  mkdirSync(path.dirname(localPath), { recursive: true })
  writeFileSync(localPath, Buffer.from(await res.arrayBuffer()))
}

async function downloadLocomo(): Promise<void> {
  const out = path.join(config.datasetsDir, 'locomo10.json')
  if (!existsSync(out)) {
    const res = await fetch('https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json')
    if (!res.ok) throw new Error(`locomo download failed: ${res.status}`)
    writeFileSync(out, Buffer.from(await res.arrayBuffer()))
  }
  console.log('locomo10.json ready')
}

export const CONVOMEM_CATEGORIES = [
  'user_evidence',
  'preference_evidence',
  'assistant_facts_evidence',
  'changing_evidence',
  'implicit_connection_evidence',
  'abstention_evidence',
] as const

async function downloadConvomem(filesPerCategory = 1, fillerCount = 10): Promise<void> {
  const repo = 'Salesforce/ConvoMem'
  const root = path.join(config.datasetsDir, 'convomem')
  for (const category of CONVOMEM_CATEGORIES) {
    // Evidence-count dirs vary per category (changing_evidence starts at 2).
    const catDir = `core_benchmark/evidence_questions/${category}`
    const subdirs = (await hfList(repo, catDir))
      .map((p) => p.split('/').pop() ?? '')
      .filter((d) => /^\d+_evidence$/.test(d))
      .sort((a, b) => parseInt(a) - parseInt(b))
    const dir = `${catDir}/${subdirs[0]}`
    const files = (await hfList(repo, dir)).filter((p) => p.endsWith('.json')).slice(0, filesPerCategory)
    for (const remote of files) {
      const local = path.join(root, category, path.basename(remote))
      await hfDownload(repo, remote, local)
      process.stdout.write('.')
    }
    console.log(` ${category}: ${files.length} files`)
  }
  const fillers = (await hfList(repo, 'core_benchmark/filler_conversations'))
    .filter((p) => p.endsWith('.json'))
    .slice(0, fillerCount)
  for (const remote of fillers) {
    await hfDownload(repo, remote, path.join(root, 'filler', path.basename(remote)))
    process.stdout.write('.')
  }
  console.log(` filler: ${fillers.length} files`)
}

async function downloadLongMemEval(): Promise<void> {
  const repo = 'xiaowu0162/longmemeval-v2'
  const root = path.join(config.datasetsDir, 'longmemeval-v2')
  for (const file of ['questions.jsonl', 'trajectories.jsonl']) {
    await hfDownload(repo, file, path.join(root, file))
    console.log(` ${file} ready`)
  }
}

async function main(): Promise<void> {
  const which = process.argv[2]
  const arg3 = process.argv[3]
  if (which === 'locomo') await downloadLocomo()
  else if (which === 'convomem') await downloadConvomem(arg3 ? Number(arg3) : 1)
  else if (which === 'longmemeval') await downloadLongMemEval()
  else if (which === 'all') {
    await downloadLocomo()
    await downloadConvomem(arg3 ? Number(arg3) : 1)
    await downloadLongMemEval()
  } else {
    console.log('usage: download.ts <locomo|convomem|longmemeval|all> [filesPerCategory]')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('download failed:', err)
  process.exit(1)
})
