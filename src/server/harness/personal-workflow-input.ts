import type { ModelMessage } from 'ai'
import type { SourceCitationMap } from '@/shared/knowledge/ask-knowledge-types'
import type { PersonalHarnessAccess } from './personal-access'
import type { PersonalHarnessToolsInput } from './personal-tools'
import type { HarnessModelSettings } from './ports'

export type PersonalHarnessWorkflowInput = {
  access: Omit<PersonalHarnessAccess, 'workflowRunId'>
  context: PersonalHarnessToolsInput['context']
  definitions: PersonalHarnessToolsInput['definitions']
  instructions: string
  messages: ModelMessage[]
  settings?: HarnessModelSettings
  modelCandidates?: string[]
  delivery?: {
    emitWebhook: boolean
    sourceCitations?: SourceCitationMap
    closeStream?: boolean
    surface?: { placeholderTs?: string }
  }
}
