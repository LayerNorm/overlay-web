import { Suspense } from 'react'
import { redirect, notFound } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'
import { publicEnv } from '@/shared/env/public-env'
import WorkScreen from '@/features/work/components/WorkScreen'
import WorkLoading from './loading'

async function WorkContent() {
  if (!publicEnv.workEnabled) notFound()
  if (!(await getOverlaySession())) redirect('/app/chat?signin=nav')
  return <Suspense fallback={<WorkLoading />}><WorkScreen /></Suspense>
}
export default function WorkPage() {
  return <Suspense fallback={<WorkLoading />}><WorkContent /></Suspense>
}
