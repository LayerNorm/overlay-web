import type { AdapterCapability, AgentHostEvent } from '@layernorm/agent-bridge-protocol'

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
  adapterState?: Record<string, unknown>
  persistAdapterState?: (state: Record<string, unknown>) => void
}

export interface AgentAdapterSession {
  readonly remoteSessionId: string
  /** The adapter dispatched the first prompt while creating the remote session. */
  readonly initialPromptHandled?: boolean
  prompt(prompt: string): Promise<void>
  approve(requestKey: string, optionId: string): Promise<void>
  elicit(requestKey: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, unknown>): Promise<void>
  cancel(reason?: string): Promise<void>
  resume(): Promise<void>
  stop(reason?: string): Promise<void>
}

export interface AgentAdapter {
  readonly capability: AdapterCapability
  discover(): Promise<AdapterCapability>
  start(input: StartAdapterSessionInput, emit: EmitAgentEvent): Promise<AgentAdapterSession>
}
