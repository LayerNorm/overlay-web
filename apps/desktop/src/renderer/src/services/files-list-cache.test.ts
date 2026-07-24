import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchDesktopFileList,
  getCachedDesktopFileList,
  setCachedDesktopFileList
} from './files-list-cache'

afterEach(() => {
  setCachedDesktopFileList([])
})

describe('desktop files list cache', () => {
  it('returns a warmed cache without repeating file requests', async () => {
    const fetchRemoteFiles = vi.fn().mockResolvedValue([])
    const bridge = {
      loadNotes: vi.fn().mockResolvedValue([{ id: 'local-1', title: 'Ready', updatedAt: 1 }]),
      document: { getAll: vi.fn().mockResolvedValue([]) }
    }

    setCachedDesktopFileList([])
    await fetchDesktopFileList({ force: true, bridge, fetchRemoteFiles })
    const cached = await fetchDesktopFileList({ bridge, fetchRemoteFiles })

    expect(fetchRemoteFiles).toHaveBeenCalledTimes(1)
    expect(cached).toEqual(getCachedDesktopFileList())
    expect(bridge.loadNotes).not.toHaveBeenCalled()
    expect(cached).toEqual([])
  })

  it('exposes legacy local storage only through the explicit On this Mac authority', async () => {
    const fetchRemoteFiles = vi.fn().mockResolvedValue([])
    const bridge = {
      loadNotes: vi.fn().mockResolvedValue([{ id: 'local-1', title: 'Ready', updatedAt: 1 }]),
      document: { getAll: vi.fn().mockResolvedValue([]) }
    }
    const local = await fetchDesktopFileList({
      force: true,
      authority: 'on-this-mac',
      bridge,
      fetchRemoteFiles
    })
    expect(fetchRemoteFiles).not.toHaveBeenCalled()
    expect(local).toEqual([
      expect.objectContaining({ id: 'local-1', name: 'Ready', pathLabel: 'On this Mac · Note' })
    ])
  })
})
