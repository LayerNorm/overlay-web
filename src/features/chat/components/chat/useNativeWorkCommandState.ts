'use client'

import { useEffect, useRef, useState } from 'react'
import {
  nativeRunCommandAllowed,
  nativeRunCommandIdentity,
} from './native-personal-lifecycle'
import type { NativeRunCommandScope } from './native-personal-lifecycle'
import type { AgentRunResource } from '@overlay/api-client'

export function useNativeWorkCommandState({
  run,
  activeChatId,
  scope,
}: {
  run: AgentRunResource | null
  activeChatId: string | null
  scope?: NativeRunCommandScope
}) {
  const [submittingKey, setSubmittingKey] = useState<string | null>(null)
  const [approvalConsumedKey, setApprovalConsumedKey] = useState<string | null>(null)
  const [inputConsumedKey, setInputConsumedKey] = useState<string | null>(null)
  const pendingRef = useRef<string | null>(null)
  const consumedRef = useRef<string | null>(null)
  const inputConsumedRef = useRef<string | null>(null)
  const approvalRun = run?.approval ? run : null
  const inputRun = run?.inputRequest ? run : null
  const approvalKey = scope?.enabled && approvalRun?.approval
    ? nativeRunCommandIdentity(scope.scopeKey, approvalRun.id, approvalRun.approval.token)
    : null
  const inputKey = scope?.enabled && inputRun?.inputRequest
    ? nativeRunCommandIdentity(scope.scopeKey, inputRun.id, inputRun.inputRequest.token)
    : null

  useEffect(() => {
    if (scope?.enabled && scope.status === 'ready'
      && consumedRef.current
      && (consumedRef.current !== approvalKey || approvalRun?.status !== 'waiting_for_approval')) {
      consumedRef.current = null
    }
    if (scope?.enabled && scope.status === 'ready'
      && inputConsumedRef.current
      && (inputConsumedRef.current !== inputKey || inputRun?.status !== 'waiting_for_input')) {
      inputConsumedRef.current = null
    }
  }, [approvalKey, approvalRun?.status, inputKey, inputRun?.status, scope])

  const approvalConsumed = approvalKey !== null
    && approvalRun?.status === 'waiting_for_approval'
    && approvalConsumedKey === approvalKey
  const inputConsumed = inputKey !== null
    && inputRun?.status === 'waiting_for_input'
    && inputConsumedKey === inputKey

  return {
    approvalRun,
    inputRun,
    approvalKey,
    inputKey,
    submittingKey,
    setSubmittingKey,
    setApprovalConsumedKey,
    setInputConsumedKey,
    inputConsumed,
    pendingRef,
    consumedRef,
    inputConsumedRef,
    approvalAllowed: nativeRunCommandAllowed({ scope, run: approvalRun, activeChatId }),
    inputAllowed: nativeRunCommandAllowed({ scope, run: inputRun, activeChatId }),
    approvalSubmitting: approvalKey !== null && submittingKey === approvalKey,
    approvalConsumed,
  }
}
