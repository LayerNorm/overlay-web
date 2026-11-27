import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const mocks = vi.hoisted(() => ({
  directory: '',
  load: vi.fn(),
  destroy: vi.fn(),
  read: vi.fn(),
  notice: vi.fn(),
  error: vi.fn(),
  open: vi.fn(),
  create: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.directory },
  BrowserWindow: class {
    webContents = { executeJavaScript: mocks.read }
    loadFile = mocks.load
    destroy = mocks.destroy
    constructor() {
      mocks.create()
    }
  },
  dialog: { showMessageBox: mocks.notice, showErrorBox: mocks.error },
  shell: { openPath: mocks.open }
}))
import { migrateLegacyDesktopData } from './desktop-migration'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.directory = mkdtempSync(join(tmpdir(), 'overlay-upgrade-'))
  mocks.load.mockResolvedValue(undefined)
  mocks.notice.mockResolvedValue({ response: 0 })
  mocks.read.mockResolvedValue({
    transcriptions: [{ id: 'one', text: 'Preserve this transcript' }],
    settings: { selectedModelId: 'parakeet_v2' }
  })
})
afterEach(() => rmSync(mocks.directory, { recursive: true, force: true }))
it('fresh profiles do not display an upgrade notice or load the retired renderer', async () => {
  await migrateLegacyDesktopData()
  expect(mocks.create).not.toHaveBeenCalled()
  expect(mocks.notice).not.toHaveBeenCalled()
  expect(
    JSON.parse(readFileSync(join(mocks.directory, 'web-shell-migration-v1.json'), 'utf8')).legacy
  ).toBe(false)
})
it('exports transcripts privately once and preserves recordings and local knowledge', async () => {
  writeFileSync(join(mocks.directory, 'settings.json'), '{}')
  mkdirSync(join(mocks.directory, 'recordings'))
  writeFileSync(join(mocks.directory, 'recordings', 'old.wav'), 'existing audio')
  writeFileSync(join(mocks.directory, 'knowledge-journal.json'), 'existing journal')
  await migrateLegacyDesktopData()
  const exported = join(mocks.directory, 'legacy-desktop-export', 'transcripts-and-settings.json')
  expect(JSON.parse(readFileSync(exported, 'utf8')).transcriptions[0].text).toBe(
    'Preserve this transcript'
  )
  expect(statSync(exported).mode & 0o077).toBe(0)
  expect(readFileSync(join(mocks.directory, 'recordings', 'old.wav'), 'utf8')).toBe(
    'existing audio'
  )
  expect(readFileSync(join(mocks.directory, 'knowledge-journal.json'), 'utf8')).toBe(
    'existing journal'
  )
  await migrateLegacyDesktopData()
  expect(mocks.notice).toHaveBeenCalledOnce()
  expect(mocks.destroy).toHaveBeenCalledOnce()
})
it('failed export remains retryable, keeps data and allows the web shell to start', async () => {
  writeFileSync(join(mocks.directory, 'settings.json'), '{}')
  mocks.load.mockRejectedValueOnce(new Error('Synthetic disk failure'))
  await migrateLegacyDesktopData()
  expect(existsSync(join(mocks.directory, 'web-shell-migration-v1.json'))).toBe(false)
  expect(readFileSync(join(mocks.directory, 'settings.json'), 'utf8')).toBe('{}')
  expect(mocks.error).toHaveBeenCalledOnce()
  expect(mocks.destroy).toHaveBeenCalledOnce()
})
