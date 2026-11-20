import { readNativeRecoveryWork, executeNativeRecoveryWork, acknowledgeNativeRecoveryWork } from '@/server/harness/native-recovery-steps'
import type { NativeRecoveryRequest } from '@/shared/agents/assignment-recovery'

export async function nativeRecoveryWorkflow(request: NativeRecoveryRequest) {
  'use workflow'
  const work = await readNativeRecoveryWork(request)
  if (work) {
    await executeNativeRecoveryWork(work)
    await acknowledgeNativeRecoveryWork(request)
  }
}
