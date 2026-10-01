import 'server-only'

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { SandboxInstance } from '@overlay/sandbox-runtime'
import {
  parseSha256sum,
  planMirror,
  pullWorkspaceIntoSandbox,
  pushSandboxChangesToWorkspace,
  resolveMirrorRoot,
  type WorkspaceFileNode,
  type WorkspaceFileSource,
} from './sandbox-file-sync'

const ROOT = '/home/sb/workspace/overlay'
const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/** In-memory sandbox that understands the few shell commands the sync runs. */
function fakeSandbox() {
  const files = new Map<string, Uint8Array>()
  const instance = {
    async runCommand({ command, args = [] }: { command: string; args?: string[] }) {
      let stdout = ''
      if (command === 'pwd') stdout = '/home/sb\n'
      else if (command === 'sh' && args[1]?.includes('rm -rf')) {
        for (const path of [...files.keys()]) if (path.startsWith(`${args[3]}/`)) files.delete(path)
      } else if (command === 'sh' && args[1]?.includes('sha256sum')) {
        const root = args[3]!
        stdout = [...files.entries()]
          .filter(([path]) => path.startsWith(`${root}/`) && !path.endsWith('/.overlay-sync.json'))
          .map(([path, bytes]) => `${createHash('sha256').update(bytes).digest('hex')}  ./${path.slice(root.length + 1)}`)
          .join('\n')
      }
      return { wait: async () => ({ commandId: 'c', exitCode: 0, stdout, stderr: '', startedAt: 0, endedAt: 0 }) }
    },
    async writeFiles(entries: Array<{ path: string; contents: Uint8Array }>) {
      for (const entry of entries) files.set(entry.path, entry.contents)
    },
    async readFile(path: string) {
      return files.get(path) ?? null
    },
  }
  return { files, instance: instance as unknown as SandboxInstance }
}

const node = (overrides: Partial<WorkspaceFileNode> & Pick<WorkspaceFileNode, 'fileId' | 'name'>): WorkspaceFileNode => ({
  type: 'file',
  kind: 'upload',
  parentId: null,
  updatedAt: 1,
  sizeBytes: 10,
  hasText: true,
  hasBinary: false,
  ...overrides,
})

const TREE: WorkspaceFileNode[] = [
  node({ fileId: 'd1', name: 'Research', type: 'folder', kind: 'folder', hasText: false }),
  node({ fileId: 'n1', name: 'Plan', kind: 'note', parentId: 'd1', updatedAt: 5 }),
  node({ fileId: 'f1', name: 'data.csv', parentId: 'd1', updatedAt: 6 }),
  node({ fileId: 'f2', name: 'data.csv', parentId: 'd1' }),
  node({ fileId: 'b1', name: 'logo.png', hasText: false, hasBinary: true }),
  node({ fileId: 'x1', name: '../escape', parentId: 'missing-folder' }),
  node({ fileId: 'e1', name: 'empty', hasText: false }),
]

function fakeSource(tree = TREE) {
  const calls: string[] = []
  const texts: Record<string, string> = { n1: '# Plan\n', f1: 'a,b\n', f2: 'c,d\n', x1: 'x' }
  const source: WorkspaceFileSource = {
    listTree: async () => tree,
    readText: async (file) => texts[file.fileId] ?? '',
    readBinary: async () => new Uint8Array([137, 80, 78, 71, 0]),
    updateText: async (file, text, expectedUpdatedAt) => {
      calls.push(`update ${file.fileId} ${file.mode} @${expectedUpdatedAt} ${JSON.stringify(text)}`)
      return file.fileId === 'f1' ? 'conflict' : 'ok'
    },
    createFolder: async (name, parentId) => { calls.push(`folder ${name} in ${parentId}`); return `new_${name}` },
    createTextFile: async (name, parentId, text) => { calls.push(`text ${name} in ${parentId} ${JSON.stringify(text)}`); return 't' },
    createBinaryFile: async (name, parentId, bytes) => { calls.push(`binary ${name} in ${parentId} ${bytes.byteLength}B`); return 'b' },
  }
  return { calls, source }
}

test('the mirror plan makes notes .md, names path-safe and unique, and orphans top-level', () => {
  const plan = planMirror(TREE)
  assert.deepEqual(plan.folders, [{ relDir: 'Research', folderId: 'd1' }])
  assert.deepEqual(plan.files.map((file) => [file.relPath, file.mode]), [
    ['.._escape', 'text'],
    ['logo.png', 'binary'],
    ['Research/data.csv', 'text'],
    ['Research/data (2).csv', 'text'],
    ['Research/Plan.md', 'note'],
  ])
})

test('pull rebuilds the mirror and push saves edits, new files, and conflict copies back', async () => {
  const { files, instance } = fakeSandbox()
  const { calls, source } = fakeSource()
  files.set(`${ROOT}/stale-from-another-turn.txt`, encode('old'))
  assert.equal(await resolveMirrorRoot(instance, '/workspace'), ROOT)

  const pulled = await pullWorkspaceIntoSandbox({ instance, root: ROOT, source })
  assert.equal(pulled.files, 5)
  assert.equal(files.has(`${ROOT}/stale-from-another-turn.txt`), false)
  assert.equal(decode(files.get(`${ROOT}/Research/Plan.md`)!), '# Plan\n')

  // The agent edits a note, edits a file changed in Overlay meanwhile, adds files, and deletes one.
  files.set(`${ROOT}/Research/Plan.md`, encode('# Plan\n\n- ship\n'))
  files.set(`${ROOT}/Research/data.csv`, encode('a,b\n1,2\n'))
  files.set(`${ROOT}/Research/notes/summary.md`, encode('done'))
  files.set(`${ROOT}/chart.png`, new Uint8Array([0, 1, 2]))
  files.delete(`${ROOT}/logo.png`)

  const pushed = await pushSandboxChangesToWorkspace({ instance, root: ROOT, source })
  assert.deepEqual(pushed, { updated: 1, created: 2, conflictCopies: 1, unchanged: 2, deletedInSandbox: 1, skipped: 0 })
  assert.deepEqual(calls, [
    'update n1 note @5 "# Plan\\n\\n- ship\\n"',
    'update f1 text @6 "a,b\\n1,2\\n"',
    'text data (agent copy).csv in d1 "a,b\\n1,2\\n"',
    'folder notes in d1',
    'text summary.md in new_notes "done"',
    'binary chart.png in null 3B',
  ])
})

test('a repeated push saves nothing twice', async () => {
  const { files, instance } = fakeSandbox()
  const { calls, source } = fakeSource()
  await pullWorkspaceIntoSandbox({ instance, root: ROOT, source })
  files.set(`${ROOT}/new.txt`, encode('hello'))
  files.set(`${ROOT}/Research/Plan.md`, encode('# Plan v2\n'))
  await pushSandboxChangesToWorkspace({ instance, root: ROOT, source })
  const second = await pushSandboxChangesToWorkspace({ instance, root: ROOT, source })
  assert.equal(calls.length, 2)
  assert.deepEqual({ updated: second?.updated, created: second?.created }, { updated: 0, created: 0 })
})

test('push without a pulled mirror does nothing', async () => {
  const { instance } = fakeSandbox()
  assert.equal(await pushSandboxChangesToWorkspace({ instance, root: ROOT, source: fakeSource().source }), null)
})

test('sha256sum parsing skips escaped names', () => {
  const hash = 'a'.repeat(64)
  const parsed = parseSha256sum(`${hash}  ./a b.txt\n\\${hash}  ./we\\nird\n${hash} *./bin.dat\n`)
  assert.deepEqual([...parsed.keys()], ['a b.txt', 'bin.dat'])
})
