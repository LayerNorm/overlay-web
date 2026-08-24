import type { AdapterCapability, AgentHostEvent } from '@overlay/agent-bridge-protocol'

type NormalizeEvent<Event> = Event extends AgentHostEvent ? Pick<Event, 'type' | 'payload'> : never
export type NormalizedAgentEvent = NormalizeEvent<AgentHostEvent>
export type EmitAgentEvent = (event: NormalizedAgentEvent) => Promise<void>

export type StartAdapterSessionInput = {
  runId: string
  workingDirectory: string
  additionalDirectories: string[]
  prompt: string
  remoteSessionId?: string
  metadata: Record<string, unknown>
}

export interface AgentAdapterSession {
  readonly remoteSessionId: string
  prompt(prompt: string): Promise<void>
  approve(requestKey: string, optionId: string): Promise<void>
  cancel(reason?: string): Promise<void>
  resume(): Promise<void>
  stop(reason?: string): Promise<void>
}

export interface AgentAdapter {
  readonly capability: AdapterCapability
  discover(): Promise<AdapterCapability>
  start(input: StartAdapterSessionInput, emit: EmitAgentEvent): Promise<AgentAdapterSession>
}
