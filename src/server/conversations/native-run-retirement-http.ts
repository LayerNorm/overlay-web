import { NextResponse } from 'next/server'
import {
  isNativeRunRetiredError,
  NATIVE_RUN_RETIRED_CODE,
  NATIVE_RUN_RETIRED_MESSAGE,
} from '@/shared/agents/native-run-retirement'

export function nativeRunRetirementErrorResponse(error: unknown) {
  if (!isNativeRunRetiredError(error)) return null
  return NextResponse.json({
    code: NATIVE_RUN_RETIRED_CODE,
    error: NATIVE_RUN_RETIRED_MESSAGE,
  }, { status: 410 })
}
