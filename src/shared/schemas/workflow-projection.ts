import { z } from 'zod'

export const WorkflowProjectionRequest = z.object({
  workflowRunId: z.string().min(1).max(200), cursor: z.string().max(2000).nullable(),
})

export const WorkflowProjectionPage = z.object({
  cursor: z.string().nullable(), complete: z.boolean(),
  events: z.array(z.object({
    sourceEventId: z.string(), correlationId: z.string(), stepName: z.string().optional(),
    stepStatus: z.enum(['running', 'completed', 'failed']), createdAt: z.number().finite(),
    error: z.string().max(500).optional(), stack: z.string().max(1000).optional(),
  })).max(100),
})
export type WorkflowProjectionPage = z.infer<typeof WorkflowProjectionPage>
