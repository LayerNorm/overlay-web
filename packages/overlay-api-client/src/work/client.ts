import type {
  CreateWork,
  UpdateWork,
  WorkAction,
  WorkItem,
  WorkEvent,
  WorkView,
  WorkPerson,
  WorkContext,
  WorkScope,
  WorkPlacement,
  WorkPage,
  WorkPageOptions,
} from '@overlay/app-core/work'
import type { HttpContext } from '../shared/http'
export class WorkClient {
  constructor(private readonly http: HttpContext) {}
  context(scope: WorkScope, init?: RequestInit) {
    return this.http.jsonData<WorkContext[]>(
      this.http.appendQuery('/api/v1/work/context', { scope }),
      init,
    )
  }
  people(init?: RequestInit) {
    return this.http.jsonData<WorkPerson[]>('/api/v1/work/people', init)
  }
  page(view?: WorkView, page: WorkPageOptions = {}, init?: RequestInit) {
    return this.http.json<WorkPage>(this.http.appendQuery('/api/v1/work', { view, ...page }), init)
  }
  async list(view?: WorkView, init?: RequestInit) {
    const items = new Map<string, WorkItem>()
    const seen = new Set<string>()
    let cursor: string | undefined
    do {
      const page = await this.page(view, { cursor, limit: 200 }, init)
      for (const item of page.data) items.set(item._id, item)
      if (!page.hasMore) return [...items.values()]
      if (!page.nextCursor || seen.has(page.nextCursor))
        throw new Error('Task pagination did not advance')
      cursor = page.nextCursor
      seen.add(cursor)
    } while (!init?.signal?.aborted)
    throw new DOMException('Request aborted', 'AbortError')
  }
  get(id: string, init?: RequestInit) {
    return this.http.json<{ item: WorkItem; events: WorkEvent[] }>(
      `/api/v1/work/${encodeURIComponent(id)}`,
      init,
    )
  }
  create(body: CreateWork, init?: RequestInit) {
    return this.http.json<WorkItem>(
      '/api/v1/work',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }
  update(id: string, body: UpdateWork, init?: RequestInit) {
    return this.http.json<WorkItem>(
      `/api/v1/work/${encodeURIComponent(id)}`,
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }
  reorder(id: string, body: Omit<WorkPlacement, 'action'>, init?: RequestInit) {
    return this.http.json<{ success: true; item: WorkItem }>(
      `/api/v1/work/${encodeURIComponent(id)}`,
      this.http.jsonRequest({ ...body, action: 'reorder' }, { ...init, method: 'POST' }),
    )
  }
  action(id: string, body: WorkAction, init?: RequestInit) {
    return this.http.json<{ success: true }>(
      `/api/v1/work/${encodeURIComponent(id)}`,
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }
  archive(id: string, init?: RequestInit) {
    return this.http.json<{ success: true }>(`/api/v1/work/${encodeURIComponent(id)}`, {
      ...init,
      method: 'DELETE',
    })
  }
}
