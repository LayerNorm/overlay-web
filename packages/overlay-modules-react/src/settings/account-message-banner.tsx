'use client'

import { AlertCircle, Check } from 'lucide-react'

export interface AccountMessage {
  type: 'success' | 'error'
  text: string
}

export interface AccountMessageBannerProps {
  message: AccountMessage
  onOpenDesktop: () => void
  onOpenWeb: () => void
  onDismiss: () => void
}

export function AccountMessageBanner({ message, onOpenDesktop, onOpenWeb, onDismiss }: AccountMessageBannerProps) {
  return (
    <div
      className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${
        message.type === 'success'
          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          : 'bg-red-50 text-red-800 border border-red-200'
      }`}
    >
      {message.type === 'success' ? <Check className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
      <p className="text-sm">{message.text}</p>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {message.type === 'success' ? (
          <>
            <button
              type="button"
              onClick={onOpenDesktop}
              className="rounded-lg bg-emerald-600 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Open in desktop app
            </button>
            <button
              type="button"
              onClick={onOpenWeb}
              className="rounded-lg border border-emerald-300 px-3 py-1 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-100/70"
            >
              Open web app
            </button>
          </>
        ) : null}
        <button type="button" onClick={onDismiss} className="text-sm opacity-60 hover:opacity-100">
          Dismiss
        </button>
      </div>
    </div>
  )
}
