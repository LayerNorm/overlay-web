import type { CreateWork, UpdateWork, WorkAction, WorkItem, WorkEvent, WorkView } from '@overlay/app-core/work'
import type { HttpContext } from '../shared/http'
export class WorkClient {
  constructor(private readonly http: HttpContext) {}
  list(view?: WorkView, init?: RequestInit) { return this.http.json<WorkItem[]>(this.http.appendQuery('/api/v1/work', { view }), init) }
  get(id: string, init?: RequestInit) { return this.http.json<{ item: WorkItem; events: WorkEvent[] }>(`/api/v1/work/${encodeURIComponent(id)}`, init) }
  create(body: CreateWork, init?: RequestInit) { return this.http.json<WorkItem>('/api/v1/work', this.http.jsonRequest(body, { ...init, method: 'POST' })) }
  update(id: string, body: UpdateWork, init?: RequestInit) { return this.http.json<WorkItem>(`/api/v1/work/${encodeURIComponent(id)}`, this.http.jsonRequest(body, { ...init, method: 'PATCH' })) }
  action(id: string, body: WorkAction, init?: RequestInit) { return this.http.json<{ success: true }>(`/api/v1/work/${encodeURIComponent(id)}`, this.http.jsonRequest(body, { ...init, method: 'POST' })) }
  archive(id: string, init?: RequestInit) { return this.http.json<{ success: true }>(`/api/v1/work/${encodeURIComponent(id)}`, { ...init, method: 'DELETE' }) }
}
