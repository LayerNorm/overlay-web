'use client'

import { createContext } from 'react'
import type { AgentRunResource } from '@overlay/api-client'
import { ACTIVE_AGENT_RUN_STATUSES } from '@/shared/agents/agent-run'

export const ACTIVE_RUN_STATUSES: ReadonlySet<string> = new Set(ACTIVE_AGENT_RUN_STATUSES)

/** The conversation's latest run, read by the response it belongs to. */
export const RunPlanContext = createContext<AgentRunResource | null>(null)
