'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Bot,
  CircleHelp,
  File,
  FolderKanban,
  Home,
  MessageSquare,
  Moon,
  Plug,
  RefreshCcw,
  Sparkles,
  Sun,
  Workflow,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { MARKETING_DOCS_URL } from '@/shared/marketing/marketing'
import { useLandingThemeOptional } from '@/contexts/LandingThemeContext'

type PublicSurface = 'chat' | 'files' | 'projects' | 'automations' | 'extensions'

const SURFACES: Array<{ id: PublicSurface; label: string; icon: typeof MessageSquare }> = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'files', label: 'Files', icon: File },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'automations', label: 'Automations', icon: Workflow },
  { id: 'extensions', label: 'Extensions', icon: Plug },
]

export function PublicSiteRail({
  activeSurface,
  onNavigateSurface,
  onTour,
  onReset,
}: {
  activeSurface?: PublicSurface
  onNavigateSurface?: (surface: PublicSurface) => void
  onTour?: () => void
  onReset?: () => void
}) {
  const pathname = usePathname() ?? '/'
  const landingTheme = useLandingThemeOptional()
  const [documentDark, setDocumentDark] = useState(false)
  const dark = landingTheme?.isLandingDark ?? documentDark

  useEffect(() => {
    if (landingTheme) return
    const frame = requestAnimationFrame(() => setDocumentDark(document.documentElement.dataset.theme === 'dark'))
    return () => cancelAnimationFrame(frame)
  }, [landingTheme])

  function toggleTheme() {
    if (landingTheme) {
      landingTheme.toggleLandingTheme()
      return
    }
    const next = !dark
    setDocumentDark(next)
    document.documentElement.dataset.theme = next ? 'dark' : 'light'
    document.documentElement.style.colorScheme = next ? 'dark' : 'light'
  }

  return (
    <nav aria-label="Overlay website" className="flex w-14 shrink-0 flex-col items-center border-r border-[var(--border)] bg-[var(--surface-elevated)] py-3 sm:w-16">
      <Link href="/" aria-label="Showcase home" title="Showcase home" className="mb-4 flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/overlay-logo.png" alt="" className="h-full w-full object-cover" />
      </Link>
      {onNavigateSurface ? (
        <>
          <div className="flex flex-col gap-1">
            {SURFACES.map((item) => <RailButton key={item.id} label={item.label} icon={item.icon} onClick={() => onNavigateSurface(item.id)} selected={activeSurface === item.id} />)}
          </div>
          <div className="my-3 h-px w-7 bg-[var(--border)]" />
        </>
      ) : null}
      <div className="flex flex-col gap-1">
        <RailLink href="/home" label="Home" active={pathname === '/home' && !onNavigateSurface} icon={Home} />
        <RailLink href="/manifesto" label="Manifesto" active={pathname === '/manifesto'} icon={Sparkles} />
        <RailLink href="/pricing" label="Pricing" active={pathname === '/pricing'} icon={CircleHelp} />
        <a href={MARKETING_DOCS_URL} target="_blank" rel="noreferrer" aria-label="Docs" title="Docs" className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]">
          <File size={17} strokeWidth={1.7} />
        </a>
      </div>
      <div className="mt-auto flex flex-col gap-1">
        {onTour ? <RailButton label="Take the tour" icon={Bot} onClick={onTour} /> : null}
        <RailButton label={dark ? 'Use light mode' : 'Use dark mode'} icon={dark ? Sun : Moon} onClick={toggleTheme} />
        {onReset ? <RailButton label="Reset showcase" icon={RefreshCcw} onClick={onReset} /> : null}
        <RailLink href="/app/chat" label="Open app" icon={MessageSquare} emphasized />
      </div>
    </nav>
  )
}

function RailLink({ href, label, icon: Icon, active = false, emphasized = false }: { href: string; label: string; icon: typeof Home; active?: boolean; emphasized?: boolean }) {
  return <Link href={href} aria-label={label} title={label} className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${emphasized ? 'bg-[var(--foreground)] text-[var(--background)]' : active ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'}`}><Icon size={17} strokeWidth={1.7} /></Link>
}

function RailButton({ label, icon: Icon, onClick, selected = false }: { label: string; icon: typeof Home; onClick: () => void; selected?: boolean }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${selected ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'}`}><Icon size={17} strokeWidth={1.7} /></button>
}
