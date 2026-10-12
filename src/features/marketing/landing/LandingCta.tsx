import { memo, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, Braces, LogIn } from 'lucide-react'
import { MARKETING_DOCS_URL } from '@/shared/marketing/marketing'
import { LandingLogo, type LogoName } from './LandingLogo'
import { LandingOrb } from './LandingOrb'

type Row = { name: string; href: string; icon: ReactNode; main?: boolean; external?: boolean }

const API_DOCS = `${MARKETING_DOCS_URL}/api-reference/overview`

const COLUMNS: Array<{ title: string; color: string; rows: (appHref: string) => Row[] }> = [
  {
    title: 'Web',
    color: 'ai',
    rows: (appHref) => [
      { name: 'Get started', href: appHref, icon: <LandingOrb />, main: true },
      { name: 'Sign in', href: '/auth/sign-in', icon: <LogIn className="i plat" /> },
    ],
  },
  {
    title: 'Desktop',
    color: 'cp',
    rows: () => [
      { name: 'macOS', href: '/download', icon: <LandingLogo name="apple" className="plat" /> },
      { name: 'Windows', href: '/download', icon: <LandingLogo name="windows" className="plat" /> },
    ],
  },
  {
    title: 'Mobile',
    color: 'cloud',
    rows: () => [
      { name: 'iOS', href: '/download', icon: <LandingLogo name="apple" className="plat" /> },
      { name: 'Android', href: '/download', icon: <LandingLogo name={'android' satisfies LogoName} className="plat" /> },
    ],
  },
  {
    title: 'Developer',
    color: 'oss',
    rows: () => [
      { name: 'MCP', href: API_DOCS, icon: <LandingLogo name="mcp" className="plat" />, external: true },
      { name: 'API', href: API_DOCS, icon: <Braces className="i plat" />, external: true },
    ],
  },
]

/** The last scene: where to get Overlay, grouped by platform. */
export const LandingCta = memo(function LandingCta({ appHref }: { appHref: string }) {
  return (
    <div className="cta">
      {COLUMNS.map((col, i) => (
        <div className="col" key={col.title} style={{ '--i': i, '--c': `var(--c-${col.color})` } as CSSProperties}>
          <h3><span>{col.title}</span></h3>
          {col.rows(appHref).map((row) => {
            const body = (
              <>
                {row.icon}
                <span className="nm">{row.name}</span>
                <ArrowRight className="i go" />
              </>
            )
            const cls = row.main ? 'row main' : 'row'
            return row.external ? (
              <a key={row.name} className={cls} href={row.href} target="_blank" rel="noopener noreferrer">{body}</a>
            ) : (
              <Link key={row.name} className={cls} href={row.href}>{body}</Link>
            )
          })}
        </div>
      ))}
    </div>
  )
})
