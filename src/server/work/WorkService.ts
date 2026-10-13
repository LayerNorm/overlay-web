import 'server-only'
import type { z } from 'zod'
import type { CreateWork, UpdateWork, WorkAction, WorkEvent, WorkItem, WorkView } from '@overlay/app-core/work'
import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { WorkEventSchema, WorkItemSchema } from '@/shared/work/schema'

function read<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error('Work backend returned an invalid response')
  return result.data
}

export type WorkActor = { userId: string; workspaceId: string }
export interface WorkRepository {
  list(actor: WorkActor, view?: WorkView): Promise<WorkItem[]>
  get(actor: WorkActor, id: string): Promise<WorkItem>
  create(actor: WorkActor, body: CreateWork): Promise<WorkItem>
  update(actor: WorkActor, id: string, body: UpdateWork): Promise<WorkItem>
  events(actor: WorkActor, id: string): Promise<WorkEvent[]>
  action(actor: WorkActor, id: string, body: WorkAction): Promise<void>
}
export class ConvexWorkRepository implements WorkRepository {
  private auth(actor: WorkActor) { return { ...actor, serverSecret: getInternalApiSecret() } }
  async list(actor: WorkActor, view?: WorkView) {
    return read(WorkItemSchema.array(), await lazyConvex.query('work/workItems:list', { ...this.auth(actor), ...(view ? { view } : {}) }, { throwOnError: true }))
  }
  async get(actor: WorkActor, id: string) {
    return read(WorkItemSchema, await lazyConvex.query('work/workItems:get', { ...this.auth(actor), id }, { throwOnError: true }))
  }
  async create(actor: WorkActor, body: CreateWork) {
    return read(WorkItemSchema, await lazyConvex.mutation('work/workItems:create', { ...body, ...this.auth(actor) }, { throwOnError: true }))
  }
  async update(actor: WorkActor, id: string, body: UpdateWork) {
    return read(WorkItemSchema, await lazyConvex.mutation('work/workItems:update', { ...body, ...this.auth(actor), id }, { throwOnError: true }))
  }
  async events(actor: WorkActor, id: string) {
    return read(WorkEventSchema.array(), await lazyConvex.query('work/workItemEvents:list', { ...this.auth(actor), id }, { throwOnError: true }))
  }
  async action(actor: WorkActor, id: string, body: WorkAction) {
    if (body.action === 'comment') {
      await lazyConvex.mutation('work/workItemEvents:comment', { ...this.auth(actor), id, text: body.text }, { throwOnError: true })
    } else {
      await lazyConvex.mutation('work/workItems:lifecycle', { ...body, ...this.auth(actor), id }, { throwOnError: true })
    }
  }
}
export class WorkService {
  constructor(private readonly repository: WorkRepository) {}
  list(actor: WorkActor, view?: WorkView) { return this.repository.list(actor, view) }
  get(actor: WorkActor, id: string) { return this.repository.get(actor, id) }
  create(actor: WorkActor, body: CreateWork) { return this.repository.create(actor, body) }
  update(actor: WorkActor, id: string, body: UpdateWork) { return this.repository.update(actor, id, body) }
  events(actor: WorkActor, id: string) { return this.repository.events(actor, id) }
  action(actor: WorkActor, id: string, body: WorkAction) { return this.repository.action(actor, id, body) }
}
