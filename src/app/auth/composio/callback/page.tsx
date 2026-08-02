'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { notifyOpenerIntegrationsChanged } from '@/shared/integrations/integrations-events'
import posthog from 'posthog-js'

function CallbackContent() {
  const searchParams = useSearchParams()
  const status = searchParams?.get('status')
  const error = searchParams?.get('error')
  const [countdown, setCountdown] = useState(3)

  const isSuccess = status === 'success' && !error

  useEffect(() => {
    if (isSuccess) {
      posthog.capture('integration_connect_completed')
      notifyOpenerIntegrationsChanged()
      const interval = setInterval(() => {
        setCountdown((n) => {
          if (n <= 1) {
            clearInterval(interval)
            window.close()
          }
          return n - 1
        })
      }, 1000)
      return () => clearInterval(interval)
    } else {
      posthog.capture('integration_connect_failed', {
        failure_class: error ? 'provider_error' : 'unknown',
      })
    }
  }, [isSuccess, error])

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-white">
      {isSuccess ? (
        <>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 mb-4">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4 10l4.5 4.5L16 6" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-sm font-medium text-[#0a0a0a]">Connected successfully</p>
          <p className="text-xs text-[#888] mt-1">Closing in {countdown}…</p>
          <button
            onClick={() => window.close()}
            className="mt-4 text-xs text-[#525252] underline underline-offset-2 hover:text-[#0a0a0a]"
          >
            Close now
          </button>
        </>
      ) : (
        <>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 mb-4">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M6 6l8 8M14 6l-8 8" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-sm font-medium text-[#0a0a0a]">Connection failed</p>
          {error && <p className="text-xs text-[#888] mt-1">{error}</p>}
          <button
            onClick={() => window.close()}
            className="mt-4 text-xs text-[#525252] underline underline-offset-2 hover:text-[#0a0a0a]"
          >
            Close
          </button>
        </>
      )}
    </div>
  )
}

export default function ComposioCallbackPage() {
  return (
    <Suspense>
      <CallbackContent />
    </Suspense>
  )
}
