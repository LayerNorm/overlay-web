import 'server-only'

import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { FatalError } from 'workflow'
import { refreshNativeHarnessAccess, type NativeHarnessAccess } from './native-access'
import { authorizeHarnessModelDispatch, type HarnessModelDispatch } from './model-dispatch'
import type { HarnessModelReference } from './secure-model'

export type NativeHarnessModelDispatch = Omit<HarnessModelDispatch, 'access' | 'billingProgrammaticSubjectId'> & {
  access: NativeHarnessAccess
  memoryEnabled: boolean
  sharedRoom: boolean
}

export async function authorizeNativeHarnessModelDispatch(reference: HarnessModelReference, options: LanguageModelV4CallOptions): Promise<void> {
  const input = reference.native
  if (!input) throw new FatalError('Native model dispatch identity or routing is invalid.')
  await authorizeHarnessModelDispatch(reference, options, {
    ...input, billingProgrammaticSubjectId: `agent:${input.access.agentId}`,
  }, () => refreshNativeHarnessAccess(input.access, {
    modelId: reference.modelId, memoryEnabled: input.memoryEnabled, sharedRoom: input.sharedRoom,
    requestFingerprint: input.requestFingerprint,
  }))
}
