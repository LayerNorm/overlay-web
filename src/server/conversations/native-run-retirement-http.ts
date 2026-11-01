import { NextResponse } from 'next/server'
import {
  isNativeRunRetiredError,
  isNativeThreadUnavailableError,
  NATIVE_THREAD_UNAVAILABLE_CODE,
  NATIVE_THREAD_UNAVAILABLE_MESSAGE,
  NATIVE_RUN_RETIRED_CODE,
  NATIVE_RUN_RETIRED_MESSAGE,
} from '@/shared/agents/native-run-retirement'

export function nativeRunRetirementErrorResponse(error: unknown) {
  if (isNativeThreadUnavailableError(error)) {
    return NextResponse.json({
      code: NATIVE_THREAD_UNAVAILABLE_CODE,
      error: NATIVE_THREAD_UNAVAILABLE_MESSAGE,
    }, { status: 503, headers: { 'Retry-After': '10' } })
  }
  if (!isNativeRunRetiredError(error)) return null
  return NextResponse.json({
    code: NATIVE_RUN_RETIRED_CODE,
    error: NATIVE_RUN_RETIRED_MESSAGE,
  }, { status: 410 })
}
