import type { ModelMessage } from 'ai'
import type { PersonalChatWorkToolDefinition } from '@/shared/agents/personal-chat-work'
import type { HarnessModelSettings } from './ports'
import type { NativeHarnessAccess, NativeHarnessContext } from './native-access'
import type { HarnessRunnerCheckpoint } from './ports'

export type NativeHarnessWorkflowInput = {
  access: Omit<NativeHarnessAccess, 'workflowRunId'>
  context: NativeHarnessContext
  definitions: PersonalChatWorkToolDefinition[]
  instructions: string
  messages: ModelMessage[]
  settings?: HarnessModelSettings
  modelCandidates?: string[]
  continuation?: HarnessRunnerCheckpoint
}
