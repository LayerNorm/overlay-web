import { randomUUID } from 'node:crypto'
import type { DriveContentResult, DriveManifestEntry, DriveMetadataResult, DriveSavedEntry } from '@layernorm/overlay-agent-bridge-protocol'
import { AgentDriveCache, type DriveCacheEntry, type DriveCacheIdentity } from './drive-cache.js'
import { AgentDriveClient } from './drive-client.js'
import { SqliteDriveJournal } from './drive-journal.js'
import { SqliteDriveSyncState, type DriveBaseline, type DriveLocalReference, type DriveSyncOperation } from './drive-sync-state.js'
import { AgentDriveWriter } from './drive-writer.js'

/** One leased scope cache. Initialize before starting its adapter; final sync must precede completion. */
export class AgentDriveSynchronizer {
  private tail: Promise<unknown> = Promise.resolve()
  private prepared = false
  private readonly forceCopies = new Set<string>()
  private readonly writer: AgentDriveWriter

  constructor(private readonly options: { runId: string; cache: AgentDriveCache; client: AgentDriveClient;
    journal: SqliteDriveJournal; state: SqliteDriveSyncState }) {
    this.writer = new AgentDriveWriter(options.journal, options.client)
  }

  initialize(): Promise<void> {
    return this.serial(async () => {
      await this.recover()
      const snapshot = this.options.state.read()
      if (snapshot.phase !== 'idle') throw Error('DRIVE_WRITE_UNSAVED')
      if (snapshot.turn?.runId !== this.options.runId) this.options.state.write({ ...snapshot, turn: { runId: this.options.runId, saved: [] } })
      const inventory = await this.options.cache.inventory()
      if (!snapshot.initialized && inventory.some(item => !snapshot.baseline.some(row => row.local?.path === item.path))) throw Error('DRIVE_UNTRACKED_CACHE')
      const remote = await this.options.client.manifest()
      await this.refreshKnownEntries(remote, inventory)
      await this.reconcileRemovedFolders(remote)
      await this.adoptRemoteFolders(remote)
      await this.syncSnapshot(await this.options.cache.inventory())
      await this.normalizeAliases()
      await this.hydrateManifest()
      this.prepared = true
    })
  }

  private async refreshKnownEntries(remote: DriveManifestEntry[], inventory: DriveCacheEntry[]) {
    const snapshot = this.options.state.read()
    // Refresh only unchanged versions. A newer remote file cannot silently become the
    // expected revision for an edit made against the earlier cached bytes.
    for (const row of snapshot.baseline.filter(row => row.entry.kind === 'folder')) {
      const fresh = remote.find(entry => entry.fileId === row.entry.fileId)
      if (fresh?.kind === 'folder') row.entry = fresh
    }
    this.options.state.write(snapshot)
    for (const row of [...snapshot.baseline].filter(row => row.entry.kind === 'file')) {
      const current = localEntry(inventory, row)
      const fresh = remote.find(entry => entry.fileId === row.entry.fileId)
      if (!row.local) continue
      const unchanged = sameContent(current, row.entry)
      if (!fresh) {
        if (!current) this.drop(row.entry.fileId)
        else if (unchanged) { await this.options.cache.removeUnchanged(current); this.drop(row.entry.fileId) }
        else this.forceCopies.add(row.entry.fileId)
      } else if (sameVersion(fresh, row.entry)) this.replaceBaseline({ ...row, entry: fresh })
      else if (unchanged) await this.hydrate(fresh, row.local.path, row.local)
      else if (!current) throw Error('DRIVE_DELETE_CONFLICT')
      else this.forceCopies.add(row.entry.fileId)
    }
  }

  private async reconcileRemovedFolders(remote: DriveManifestEntry[]) {
    const snapshot = this.options.state.read()
    // A removed folder may still contain changed local children. Leave its physical
    // directory for the normal mkdir/create path; unchanged deleted files are gone above.
    for (const row of snapshot.baseline) if (row.entry.kind === 'folder' && !remote.some(entry => entry.fileId === row.entry.fileId)) {
      const current = localEntry(await this.options.cache.inventory(), row)
      if (current?.kind === 'folder') {
        try { await this.options.cache.removeUnchanged(current) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error }
      }
      this.drop(row.entry.fileId)
    }
  }

  private async adoptRemoteFolders(remote: DriveManifestEntry[]) {
    // Adopt existing remote folders so new local files can be saved beside them.
    const beforeWrites = await this.options.cache.inventory()
    for (const entry of remote.filter(entry => entry.kind === 'folder')) {
      const state = this.options.state.read()
      if (state.baseline.some(row => row.entry.fileId === entry.fileId)) continue
      const current = beforeWrites.find(item => item.kind === 'folder' && item.path === entry.path)
      if (current && !state.baseline.some(row => row.local?.path === current.path)) this.replaceBaseline({ entry, local: reference(current) })
    }
  }

  private async hydrateManifest() {
    const manifest = await this.options.client.manifest()
    for (const entry of manifest.sort((a, b) => depth(a.path) - depth(b.path))) {
      const state = this.options.state.read(), row = state.baseline.find(row => row.entry.fileId === entry.fileId)
      const local = (await this.options.cache.inventory()).find(item => item.path === entry.path)
      if (entry.kind === 'file' && entry.hydration === 'deferred') {
        if (row?.local) throw Error('DRIVE_DEFERRED_LOCAL_CHANGES')
        this.replaceBaseline({ entry, local: null }); continue
      }
      if (entry.kind === 'folder' && local?.kind === 'folder' && !row?.local) {
        this.replaceBaseline({ entry, local: reference(local) }); continue
      }
      if (row?.local && row.local.path === entry.path && sameContent(local, entry)) {
        this.replaceBaseline({ entry, local: local ? reference(local) : null }); continue
      }
      if (local && (!row?.local || !sameContent(local, row.entry))) throw Error('DRIVE_LOCAL_PATH_CONFLICT')
      await this.hydrate(entry, entry.path, row?.local ?? null)
    }
    const state = this.options.state.read()
    if (state.phase !== 'idle') throw Error('DRIVE_WRITE_UNSAVED')
    this.options.state.write({ ...state, initialized: true,
      baseline: state.baseline.filter(row => manifest.some(entry => entry.fileId === row.entry.fileId)) })
  }

  sync(final = false): Promise<DriveSavedEntry[]> {
    return this.serial(async () => {
      if (!this.prepared) throw Error('DRIVE_NOT_HYDRATED')
      await this.recover()
      for (let pass = 0; pass < (final ? 4 : 1); pass++) {
        const changes = await this.syncSnapshot(await this.options.cache.inventory())
        if (!final || !changes) return this.options.state.read().turn?.saved ?? []
      }
      throw Error('DRIVE_LOCAL_FILES_KEEP_CHANGING')
    })
  }

  /** Release resources only after the last scheduled pass has finished. */
  settle(): Promise<void> { return this.serial(async () => undefined) }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(work)
    this.tail = pending.catch(() => undefined)
    return pending
  }

  private async syncSnapshot(inventory: DriveCacheEntry[]): Promise<number> {
    let changes = 0
    for (;;) {
      const operation = this.next(inventory)
      if (!operation) return changes
      if (++changes > 1000) throw Error('DRIVE_SYNC_OPERATION_LIMIT')
      const state = this.options.state.read()
      if (state.phase !== 'idle') throw Error('DRIVE_WRITE_UNSAVED')
      this.options.state.write({ phase: 'writing', initialized: state.initialized, baseline: state.baseline, turn: state.turn, operation })
      if (operation.kind === 'content') {
        const file = inventory.find(item => item.path === operation.target.path)
        if (!file || file.kind !== 'file') throw Error('DRIVE_FILE_CHANGED')
        await this.writer.content(operation.request, file.bytes)
      } else await this.writer.metadata(operation.request)
      await this.applyWrite(operation)
    }
  }

  private next(inventory: DriveCacheEntry[]): DriveSyncOperation | undefined {
    const state = this.options.state.read()
    if (state.phase !== 'idle') throw Error('DRIVE_WRITE_UNSAVED')
    return this.nextFolder(inventory, state.baseline) ?? this.nextFile(inventory, state.baseline) ?? this.nextDeletion(inventory, state.baseline)
  }

  private nextFolder(inventory: DriveCacheEntry[], baseline: DriveBaseline[]): DriveSyncOperation | undefined {
    for (const item of inventory.filter(item => item.kind === 'folder').sort((a, b) => depth(a.path) - depth(b.path))) {
      const row = matchingRow(baseline, item)
      if (!row) return { kind: 'metadata', target: reference(item), request: { action: 'metadata', requestId: randomUUID(),
        operation: { kind: 'mkdir', name: name(item.path), ...this.parent(item.path) } } }
      if (row.local?.path !== item.path) return this.move(row, item)
      if (row.entry.kind !== 'folder') throw Error('DRIVE_LOCAL_KIND_CHANGED')
      if (row.local && !sameIdentity(row.local.identity, item.identity)) this.replaceBaseline({ ...row, local: reference(item) })
    }
  }

  private nextFile(inventory: DriveCacheEntry[], baseline: DriveBaseline[]): DriveSyncOperation | undefined {
    for (const item of inventory.filter(item => item.kind === 'file')) {
      if (item.kind !== 'file') continue
      const row = matchingRow(baseline, item)
      const copy = row && this.forceCopies.has(row.entry.fileId)
      if (row && !copy && row.local?.path !== item.path) return this.move(row, item)
      if (row && !copy && sameContent(item, row.entry)) {
        if (row.local && !sameIdentity(row.local.identity, item.identity)) this.replaceBaseline({ ...row, local: reference(item) })
        continue
      }
      const entry = row?.entry
      const operation = entry?.kind === 'file' && entry.hydration === 'ready' && !copy
        ? { kind: 'replace' as const, entry: { fileId: entry.fileId, path: entry.path, kind: entry.kind, updatedAt: entry.updatedAt }, metadataMac: entry.metadataMac }
        : { kind: 'create' as const, name: name(item.path), ...this.parent(item.path) }
      return { kind: 'content', target: reference(item), ...(row ? { priorFileId: row.entry.fileId } : {}),
        request: { action: 'upload', requestId: randomUUID(), operation, sha256: item.sha256, sizeBytes: item.size, mimeType: mime(item.path) } }
    }
  }

  private nextDeletion(inventory: DriveCacheEntry[], baseline: DriveBaseline[]): DriveSyncOperation | undefined {
    for (const row of [...baseline].sort((a, b) => depth(b.local?.path ?? '') - depth(a.local?.path ?? ''))) {
      if (!row.local || localEntry(inventory, row)) continue
      if (row.entry.kind === 'folder' && baseline.some(child => child.entry.path.startsWith(`${row.entry.path}/`) && !child.local)) throw Error('DRIVE_UNHYDRATED_CHILDREN')
      if (!('metadataMac' in row.entry)) throw Error('DRIVE_DEFERRED_LOCAL_CHANGES')
      return { kind: 'metadata', target: row.local, request: { action: 'metadata', requestId: randomUUID(), operation: {
        kind: 'remove', entry: { fileId: row.entry.fileId, path: row.entry.path, kind: row.entry.kind, updatedAt: row.entry.updatedAt }, metadataMac: row.entry.metadataMac,
      } } }
    }
  }

  private move(row: DriveBaseline, item: DriveCacheEntry): DriveSyncOperation {
    if (!('metadataMac' in row.entry)) throw Error('DRIVE_DEFERRED_LOCAL_CHANGES')
    return { kind: 'metadata', target: reference(item), request: { action: 'metadata', requestId: randomUUID(), operation: {
      kind: 'move', entry: { fileId: row.entry.fileId, path: row.entry.path, kind: row.entry.kind, updatedAt: row.entry.updatedAt },
      metadataMac: row.entry.metadataMac, name: name(item.path), ...this.parent(item.path),
    } } }
  }

  private parent(path: string): { parentId?: string } {
    const parentPath = path.split('/').slice(0, -1).join('/')
    if (!parentPath) return {}
    const parent = this.options.state.read().baseline.find(row => row.local?.path === parentPath && row.entry.kind === 'folder')
    if (!parent) throw Error('DRIVE_PARENT_UNSAVED')
    return { parentId: parent.entry.fileId }
  }

  private async recover(): Promise<void> {
    const state = this.options.state.read()
    if (state.phase === 'hydrating') { await this.finishHydration(state.entry, state.path, state.prior); return }
    if (state.phase !== 'writing') {
      if (this.options.journal.pending().length) throw Error('DRIVE_UNTRACKED_PENDING_WRITE')
      return
    }
    const record = this.options.journal.find(state.operation.request.requestId)
    if (!record) {
      // No journal record means no network request was sent. Rescan the live cache.
      this.options.state.write({ phase: 'idle', initialized: state.initialized, baseline: state.baseline, turn: state.turn }); return
    }
    if (this.options.journal.pending().some(row => row.request.requestId !== record.request.requestId)) throw Error('DRIVE_UNTRACKED_PENDING_WRITE')
    if (record.phase.kind !== 'committed') await this.writer.flush()
    await this.applyWrite(state.operation)
  }

  private async applyWrite(operation: DriveSyncOperation): Promise<void> {
    const record = this.options.journal.find(operation.request.requestId)
    if (!record || record.phase.kind !== 'committed') throw Error('DRIVE_WRITE_UNSAVED')
    const state = this.options.state.read()
    if (state.phase !== 'writing' || state.operation.request.requestId !== operation.request.requestId) throw Error('DRIVE_SYNC_STATE_CHANGED')
    if (state.turn?.runId !== this.options.runId) throw Error('DRIVE_SYNC_EXECUTION_CHANGED')
    const manifest = await this.options.client.manifest()
    let baseline = [...state.baseline]
    const saved = new Map(state.turn.saved.map(item => [item.fileId, item]))
    if (operation.kind === 'content' && record.kind === 'content' && record.phase.kind === 'committed')
      baseline = this.applyContentEffect(operation, record.phase.result, manifest, baseline, saved)
    else if (operation.kind === 'metadata' && record.kind === 'metadata' && record.phase.kind === 'committed')
      baseline = this.applyMetadataEffect(operation, record.phase.result, manifest, baseline, saved)
    else throw Error('DRIVE_JOURNAL_REQUEST_CONFLICT')
    for (const fileId of saved.keys()) {
      const current = manifest.find(entry => entry.fileId === fileId)
      if (current) saved.set(fileId, { fileId, path: current.path, kind: current.kind })
    }
    this.options.state.write({ phase: 'idle', initialized: state.initialized, baseline,
      turn: { runId: this.options.runId, saved: [...saved.values()] } })
    this.options.journal.forgetCompleted(operation.request.requestId)
  }

  private applyContentEffect(operation: Extract<DriveSyncOperation, { kind: 'content' }>, result: DriveContentResult,
    manifest: DriveManifestEntry[], baseline: DriveBaseline[], saved: Map<string, DriveSavedEntry>): DriveBaseline[] {
    const entry = manifest.find(item => item.fileId === result.fileId)
    if (!entry || entry.kind !== 'file' || entry.hydration !== 'ready' || entry.updatedAt !== result.updatedAt
      || entry.sha256 !== result.sha256 || entry.sizeBytes !== result.sizeBytes) throw Error('DRIVE_COMMITTED_VERSION_CHANGED')
    baseline = baseline.map(row => row.entry.fileId === operation.priorFileId ? { ...row, local: null } : row)
      .filter(row => row.entry.fileId !== result.fileId)
    baseline.push({ entry, local: operation.target })
    if (operation.priorFileId) this.forceCopies.delete(operation.priorFileId)
    saved.set(entry.fileId, { fileId: entry.fileId, path: entry.path, kind: entry.kind })
    return baseline
  }

  private applyMetadataEffect(operation: Extract<DriveSyncOperation, { kind: 'metadata' }>, result: DriveMetadataResult,
    manifest: DriveManifestEntry[], baseline: DriveBaseline[], saved: Map<string, DriveSavedEntry>): DriveBaseline[] {
    const op = operation.request.operation
    if (op.kind === 'remove') {
      if (manifest.some(entry => entry.fileId === result.fileId)) throw Error('DRIVE_DELETE_CONFLICT')
      baseline = baseline.filter(row => row.entry.fileId !== result.fileId)
      saved.delete(result.fileId)
    } else {
      const entry = manifest.find(item => item.fileId === result.fileId)
      if (!entry || entry.updatedAt !== result.updatedAt) throw Error('DRIVE_COMMITTED_VERSION_CHANGED')
      const previous = baseline.find(row => row.entry.fileId === result.fileId)
      baseline = baseline.filter(row => row.entry.fileId !== result.fileId)
      if (previous?.entry.kind === 'folder' && previous.local) {
        const oldPath = previous.local.path
        baseline = baseline.map(row => {
          if (!row.local?.path.startsWith(`${oldPath}/`)) return row
          const fresh = manifest.find(item => item.fileId === row.entry.fileId)
          if (!fresh || !sameVersion(fresh, row.entry)) throw Error('DRIVE_CHILD_VERSION_CHANGED')
          return { entry: fresh, local: { ...row.local, path: operation.target.path + row.local.path.slice(oldPath.length) } }
        })
      }
      baseline.push({ entry, local: operation.target })
      saved.set(entry.fileId, { fileId: entry.fileId, path: entry.path, kind: entry.kind })
    }
    return baseline
  }

  private async hydrate(entry: DriveManifestEntry, path: string, prior: DriveLocalReference | null): Promise<void> {
    if (entry.kind === 'file' && entry.hydration === 'deferred') {
      const row = this.options.state.read().baseline.find(row => row.entry.fileId === entry.fileId)
      const local = (await this.options.cache.inventory()).find(item => item.path === path)
      if (local && (!row || !sameContent(local, row.entry))) throw Error('DRIVE_DEFERRED_LOCAL_CHANGES')
      if (local) await this.options.cache.removeUnchanged(local)
      this.replaceBaseline({ entry, local: null }); return
    }
    const state = this.options.state.read()
    if (state.phase !== 'idle') throw Error('DRIVE_WRITE_UNSAVED')
    this.options.state.write({ phase: 'hydrating', initialized: state.initialized, baseline: state.baseline, turn: state.turn, entry, path, prior })
    await this.finishHydration(entry, path, prior)
  }

  private async finishHydration(entry: DriveManifestEntry, path: string, prior: DriveLocalReference | null): Promise<void> {
    let item = (await this.options.cache.inventory()).find(item => item.path === path)
    if (!sameContent(item, entry)) {
      const previous = this.options.state.read().baseline.find(row => row.entry.fileId === entry.fileId)
      if (item && (!prior || !sameIdentity(item.identity, prior.identity) || !previous || !sameContent(item, previous.entry))) throw Error('DRIVE_LOCAL_PATH_CONFLICT')
      if (entry.kind === 'folder') await this.options.cache.ensureFolder(path)
      else if (entry.hydration === 'ready') {
        // Refresh expired run grants only for this exact immutable version.
        const fresh = (await this.options.client.manifest()).find(item => item.fileId === entry.fileId)
        if (!fresh || fresh.kind !== 'file' || fresh.hydration !== 'ready' || !sameVersion(fresh, entry)) throw Error('DRIVE_HYDRATION_VERSION_CHANGED')
        await this.options.cache.hydrate(path, await this.options.client.download(fresh), fresh.sha256)
        entry = fresh
      } else throw Error('DRIVE_DEFERRED_LOCAL_CHANGES')
      item = (await this.options.cache.inventory()).find(item => item.path === path)
    }
    if (!item || !sameContent(item, entry)) throw Error('DRIVE_HYDRATION_UNCONFIRMED')
    const state = this.options.state.read()
    if (state.phase !== 'hydrating') throw Error('DRIVE_SYNC_STATE_CHANGED')
    this.options.state.write({ phase: 'idle', initialized: state.initialized, turn: state.turn,
      baseline: [...state.baseline.filter(row => row.entry.fileId !== entry.fileId), { entry, local: reference(item) }] })
  }

  private async normalizeAliases(): Promise<void> {
    for (;;) {
      const state = this.options.state.read()
      if (state.phase !== 'idle') throw Error('DRIVE_WRITE_UNSAVED')
      const row = [...state.baseline].sort((a, b) => depth(a.entry.path) - depth(b.entry.path))
        .find(row => row.local && row.local.path !== row.entry.path)
      if (!row?.local) return
      const oldPath = row.local.path
      await this.options.cache.relocate(oldPath, row.entry.path, row.local.identity)
      this.options.state.write({ ...state, baseline: state.baseline.map(child => !child.local ? child
        : child.local.path === oldPath || (row.entry.kind === 'folder' && child.local.path.startsWith(`${oldPath}/`))
          ? { ...child, local: { ...child.local, path: row.entry.path + child.local.path.slice(oldPath.length) } } : child) })
    }
  }

  private replaceBaseline(row: DriveBaseline) {
    const state = this.options.state.read()
    if (state.phase !== 'idle') throw Error('DRIVE_WRITE_UNSAVED')
    this.options.state.write({ ...state, baseline: [...state.baseline.filter(prior => prior.entry.fileId !== row.entry.fileId), row] })
  }
  private drop(fileId: string) {
    const state = this.options.state.read()
    if (state.phase !== 'idle') throw Error('DRIVE_WRITE_UNSAVED')
    this.options.state.write({ ...state, baseline: state.baseline.filter(row => row.entry.fileId !== fileId),
      turn: state.turn ? { ...state.turn, saved: state.turn.saved.filter(item => item.fileId !== fileId) } : null })
  }
}

function name(path: string) { return path.split('/').at(-1)! }
function depth(path: string) { return path.split('/').length }
function reference(item: DriveCacheEntry): DriveLocalReference { return { path: item.path, identity: item.identity } }
function sameIdentity(a: DriveCacheIdentity, b: DriveCacheIdentity) { return a.device === b.device && a.inode === b.inode && a.birthtimeNs === b.birthtimeNs }
function localEntry(inventory: DriveCacheEntry[], row: DriveBaseline) {
  return row.local ? inventory.find(item => sameIdentity(item.identity, row.local!.identity)) ?? inventory.find(item => item.path === row.local!.path) : undefined
}
function matchingRow(baseline: DriveBaseline[], item: DriveCacheEntry) {
  return baseline.find(row => row.local && sameIdentity(row.local.identity, item.identity)) ?? baseline.find(row => row.local?.path === item.path)
}
function sameContent(item: DriveCacheEntry | undefined, entry: DriveManifestEntry) {
  return item?.kind === 'folder' && entry.kind === 'folder' || item?.kind === 'file' && entry.kind === 'file' && entry.hydration === 'ready' && item.sha256 === entry.sha256
}
function sameVersion(a: DriveManifestEntry, b: DriveManifestEntry) {
  return a.kind === b.kind && a.updatedAt === b.updatedAt && (a.kind === 'folder' || b.kind === 'folder'
    || a.hydration === b.hydration && a.sizeBytes === b.sizeBytes && (a.hydration !== 'ready' || b.hydration !== 'ready' || a.sha256 === b.sha256))
}
function mime(path: string) {
  return /\.(?:md|txt|csv|ts|tsx|js|jsx|py|sh|json|html|css|xml|yaml|yml|log)$/i.test(path) ? 'text/plain' : 'application/octet-stream'
}
