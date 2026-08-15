'use client'

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { SlackImportPanel } from './SlackImportPanel'

/**
 * A service the workspace can import history from. Slack is live today; the
 * others are declared here so the picker communicates the roadmap, but stay
 * disabled until their adapters land. The import flow itself is intentionally
 * service-agnostic — every adapter renders through the same stepped chrome.
 */
type ImportServiceKey = 'slack' | 'discord' | 'teams' | 'telegram' | 'whatsapp'

interface ImportService {
  key: ImportServiceKey
  name: string
  blurb: string
  /** Monogram + accent colour for the brand-neutral badge. */
  monogram: string
  accent: string
  available: boolean
}

const IMPORT_SERVICES: ImportService[] = [
  { key: 'slack', name: 'Slack', blurb: 'Channels, DMs, threads, and files', monogram: 'S', accent: '#4A154B', available: true },
  { key: 'discord', name: 'Discord', blurb: 'Servers and channels', monogram: 'D', accent: '#5865F2', available: false },
  { key: 'teams', name: 'Microsoft Teams', blurb: 'Teams and group chats', monogram: 'T', accent: '#4B53BC', available: false },
  { key: 'telegram', name: 'Telegram', blurb: 'Groups and chats', monogram: 'T', accent: '#229ED9', available: false },
  { key: 'whatsapp', name: 'WhatsApp', blurb: 'Chats and groups', monogram: 'W', accent: '#25D366', available: false },
]

/**
 * Entry point for the workspace "Import" tab. Presents the service picker, then
 * hands off to the selected adapter's flow. Keeping selection here (rather than
 * inside each adapter) lets every service share the same back-to-services chrome.
 */
export function ImportPanel() {
  const [service, setService] = useState<ImportServiceKey | null>(null)

  if (service === 'slack') {
    return <SlackImportPanel onBack={() => setService(null)} />
  }

  return (
    <div className="px-5 py-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">Import from another service</h3>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Bring your existing conversation history into Overlay. Pick a service to begin.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {IMPORT_SERVICES.map((item) => {
          const cardBody = (
            <>
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold text-white"
                style={{ backgroundColor: item.accent }}
                aria-hidden
              >
                {item.monogram}
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-[var(--foreground)]">{item.name}</span>
                  {!item.available ? (
                    <span className="rounded bg-[var(--surface-subtle)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted)]">
                      Coming soon
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">{item.blurb}</span>
              </span>
              {item.available ? (
                <ArrowRight size={14} className="shrink-0 text-[var(--muted)]" />
              ) : null}
            </>
          )

          if (!item.available) {
            return (
              <div
                key={item.key}
                aria-disabled
                className="flex cursor-not-allowed items-center gap-3 rounded-xl border border-[var(--border)] p-3 opacity-60"
              >
                {cardBody}
              </div>
            )
          }

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setService(item.key)}
              className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-left transition-colors hover:border-[var(--foreground)]/30 hover:bg-[var(--surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--foreground)]"
            >
              {cardBody}
            </button>
          )
        })}
      </div>

      <p className="mt-4 text-[11px] text-[var(--muted-light)]">
        Imported messages are read-only and appear as conversations in your workspace. More services are on the way.
      </p>
    </div>
  )
}
