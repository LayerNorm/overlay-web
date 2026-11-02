import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import {
  NATIVE_THREAD_COMPATIBILITY_REVISION,
  nativeThreadUnavailableError,
} from '@/shared/agents/native-run-retirement'

export async function isNativeThreadCompatibilityBackendReady(userId: string): Promise<boolean> {
  // This existing query is available during web-first releases; missing-function errors are redacted.
  const settings = await convex.query<{ nativeThreadCompatibilityRevision?: unknown } | null>(
    'platform/uiSettings:getByServer',
    { userId, serverSecret: getInternalApiSecret() },
    { throwOnError: true },
  )
  return settings?.nativeThreadCompatibilityRevision === NATIVE_THREAD_COMPATIBILITY_REVISION
}

export async function requireNativeThreadCompatibilityBackend(userId: string): Promise<void> {
  if (!await isNativeThreadCompatibilityBackendReady(userId)) throw nativeThreadUnavailableError()
}
