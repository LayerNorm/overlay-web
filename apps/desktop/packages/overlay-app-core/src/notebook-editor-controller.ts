export interface NotebookEditorDocument {
  id: string
  title: string
  content: string
  revision?: string
  updatedAt?: number
}

export interface NotebookEditorConflict {
  localRevision?: string
  remoteRevision?: string
  message: string
}

export interface NotebookEditorSaveRequest extends NotebookEditorDocument {
  baseRevision?: string
}

export interface NotebookEditorSaveResult {
  document?: NotebookEditorDocument
  conflict?: NotebookEditorConflict
}

export interface NotebookEditorLifecycleSnapshot {
  selectedId: string | null
  title: string
  content: string
  revision?: string
  dirty: boolean
  saving: boolean
  hydrating: boolean
  conflict?: NotebookEditorConflict
  error?: string
}

export interface NotebookEditorControllerOptions {
  debounceMs?: number
  save(request: NotebookEditorSaveRequest): Promise<NotebookEditorSaveResult>
}

type Listener = (snapshot: NotebookEditorLifecycleSnapshot) => void

/**
 * Platform-neutral authority for notebook hydration and persistence. The editor
 * may emit arbitrary update events while TipTap hydrates; only explicit `edit`
 * calls enter the dirty/save lifecycle.
 */
export class NotebookEditorController {
  private readonly debounceMs: number
  private readonly saveDocument: NotebookEditorControllerOptions['save']
  private readonly listeners = new Set<Listener>()
  private state: NotebookEditorLifecycleSnapshot = {
    selectedId: null,
    title: '',
    content: '',
    dirty: false,
    saving: false,
    hydrating: false,
  }
  private selectionVersion = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<void> | null = null

  constructor(options: NotebookEditorControllerOptions) {
    this.debounceMs = options.debounceMs ?? 800
    this.saveDocument = options.save
  }

  snapshot(): NotebookEditorLifecycleSnapshot {
    return { ...this.state, conflict: this.state.conflict ? { ...this.state.conflict } : undefined }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  /** Starts a note switch and returns the token required to finish hydration. */
  beginHydration(noteId: string): number {
    void this.flush()
    this.selectionVersion += 1
    this.state = {
      selectedId: noteId,
      title: '',
      content: '',
      dirty: false,
      saving: false,
      hydrating: true,
    }
    this.emit()
    return this.selectionVersion
  }

  /** Ignores late repository responses from a previously selected note. */
  hydrate(document: NotebookEditorDocument, token = this.selectionVersion): boolean {
    if (token !== this.selectionVersion || document.id !== this.state.selectedId) return false
    this.clearTimer()
    this.state = {
      selectedId: document.id,
      title: document.title,
      content: document.content,
      revision: document.revision,
      dirty: false,
      saving: false,
      hydrating: false,
    }
    this.emit()
    return true
  }

  select(document: NotebookEditorDocument): number {
    const token = this.beginHydration(document.id)
    this.hydrate(document, token)
    return token
  }

  clearSelection(): void {
    void this.flush()
    this.selectionVersion += 1
    this.clearTimer()
    this.state = {
      selectedId: null,
      title: '',
      content: '',
      dirty: false,
      saving: false,
      hydrating: false,
    }
    this.emit()
  }

  edit(update: { title?: string; content?: string }): void {
    if (!this.state.selectedId || this.state.hydrating) return
    const title = update.title ?? this.state.title
    const content = update.content ?? this.state.content
    if (title === this.state.title && content === this.state.content) return
    this.state = {
      ...this.state,
      title,
      content,
      dirty: true,
      conflict: undefined,
      error: undefined,
    }
    this.scheduleSave()
    this.emit()
  }

  async flush(): Promise<void> {
    this.clearTimer()
    if (this.inFlight) {
      await this.inFlight
      if (this.state.dirty) await this.flush()
      return
    }
    if (!this.state.dirty || !this.state.selectedId || this.state.hydrating) return

    const version = this.selectionVersion
    const request: NotebookEditorSaveRequest = {
      id: this.state.selectedId,
      title: this.state.title,
      content: this.state.content,
      revision: this.state.revision,
      baseRevision: this.state.revision,
    }
    this.state = { ...this.state, saving: true, error: undefined }
    this.emit()

    const task = this.saveDocument(request).then((result) => {
      if (version !== this.selectionVersion || request.id !== this.state.selectedId) return
      if (result.conflict) {
        this.state = { ...this.state, saving: false, dirty: true, conflict: result.conflict }
        this.emit()
        return
      }
      const unchanged = this.state.title === request.title && this.state.content === request.content
      this.state = {
        ...this.state,
        title: unchanged ? result.document?.title ?? request.title : this.state.title,
        content: unchanged ? result.document?.content ?? request.content : this.state.content,
        revision: result.document?.revision ?? this.state.revision,
        saving: false,
        dirty: !unchanged,
        conflict: undefined,
      }
      this.emit()
    }).catch((error: unknown) => {
      if (version !== this.selectionVersion || request.id !== this.state.selectedId) return
      this.state = {
        ...this.state,
        saving: false,
        dirty: true,
        error: error instanceof Error ? error.message : String(error),
      }
      this.emit()
    }).finally(() => {
      if (this.inFlight === task) this.inFlight = null
    })
    this.inFlight = task
    await task
  }

  async dispose(): Promise<void> {
    await this.flush()
    this.listeners.clear()
  }

  private scheduleSave(): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.debounceMs)
  }

  private clearTimer(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }

  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
