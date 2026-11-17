'use client'

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight, BookOpen, Check, Copy, Cpu, FileCheck, Shield } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
import { useAuth } from '@/contexts/AuthContext'
import { AppleMark } from '@/features/marketing/landing/AppleMark'
import { GithubMark } from '@/features/marketing/landing/GithubMark'
import { MarketingPageHead, StaticMarketingShell } from '@/features/marketing/components/StaticMarketingShell'
import { useVisitorPlatform } from '@/features/marketing/lib/visitor-platform'
import { getMarketingAppHref } from '@/shared/marketing/marketing'
import { DESKTOP_DOWNLOAD_PATH, LATEST_RELEASE_DOWNLOAD_PATH, type LatestReleaseInfo } from '@/shared/web/latest-release'

const DESKTOP_REPO_URL = 'https://github.com/LayerNorm/overlay-desktop'
const REQUIREMENT = 'Apple silicon (M1 or later)'

export type DesktopDownloadPageProps = {
  downloadsEnabled: boolean
  release: LatestReleaseInfo | null
  releaseError: string | null
}

function formatPublishedAt(iso: string | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

/** "Version 0.3.0 · November 17, 2026 · Apple silicon (M1 or later) · 131 MB". */
export function releaseLine(release: LatestReleaseInfo, withSize: boolean): string {
  const size = withSize && release.sizeBytes ? `${Math.round(release.sizeBytes / 1_000_000)} MB` : null
  return [`Version ${release.version.replace(/^v/, '')}`, formatPublishedAt(release.publishedAt), REQUIREMENT, size]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Whether this visit has started a download. It outlives the `?start=1` that a
 * "Download for Mac" button arrives with, which is removed so a reload doesn't
 * download again.
 */
let downloadStarted = false
const startedListeners = new Set<() => void>()
function markDownloadStarted() {
  downloadStarted = true
  for (const listener of startedListeners) listener()
}
function subscribeToStarted(listener: () => void) {
  startedListeners.add(listener)
  return () => {
    startedListeners.delete(listener)
  }
}

function ExternalButton({ href, primary = false, children }: { href: string; primary?: boolean; children: ReactNode }) {
  return (
    <a className={primary ? 'btn primary' : 'btn ghost'} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

const ReleaseNotes = () => (
  <ExternalButton href={`${DESKTOP_REPO_URL}/releases/latest`}>Release notes <ArrowUpRight className="i" /></ExternalButton>
)

function CopyLinkButton() {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(`${window.location.origin}${DESKTOP_DOWNLOAD_PATH}`).then(() => setCopied(true), () => {})
  }
  return (
    <Button variant="ghost" className={unstyledButton('btn ghost')} type="button" onClick={copy}>
      {copied ? <Check className="i" /> : <Copy className="i" />} {copied ? 'Link copied' : 'Copy link for your Mac'}
    </Button>
  )
}

/** The top of the page when a signed build is available. */
function ReleaseHead({ release }: { release: LatestReleaseInfo }) {
  const { isAuthenticated } = useAuth()
  const platform = useVisitorPlatform()
  const started = useSyncExternalStore(subscribeToStarted, () => downloadStarted, () => false)

  // A "Download for Mac" button elsewhere on the site links here with ?start=1.
  useEffect(() => {
    if (platform !== 'mac' || downloadStarted) return
    if (new URLSearchParams(window.location.search).get('start') !== '1') return
    window.history.replaceState(window.history.state, '', DESKTOP_DOWNLOAD_PATH)
    markDownloadStarted()
    window.location.assign(LATEST_RELEASE_DOWNLOAD_PATH)
  }, [platform])

  if (platform === 'other') {
    return (
      <MarketingPageHead
        label="Desktop"
        title="Overlay for Mac"
        lead="The desktop app is for Mac with Apple silicon today. Everything else in Overlay works in your browser, on any computer."
      >
        <div className="actions">
          <Link className="btn primary" href={getMarketingAppHref(isAuthenticated)}>Open Overlay in your browser <ArrowRight className="i go" /></Link>
          <CopyLinkButton />
        </div>
        <p className="meta-line">{releaseLine(release, false)}</p>
      </MarketingPageHead>
    )
  }

  return (
    <MarketingPageHead
      label="Desktop"
      title={started ? 'Your download has started' : 'Overlay for Mac'}
      lead={started ? (
        <><span className="file">{release.fileName}</span> is on its way to your Downloads folder. Three steps and you’re in.</>
      ) : 'Run agents on your own computer, dictate into any app and keep Overlay one shortcut away.'}
    >
      <div className="actions">
        <a className={started ? 'btn ghost' : 'btn primary'} href={LATEST_RELEASE_DOWNLOAD_PATH} onClick={markDownloadStarted}>
          <AppleMark /> {started ? 'Download again' : 'Download for Mac'}
        </a>
        <ReleaseNotes />
      </div>
      <p className="meta-line">{releaseLine(release, true)}</p>
    </MarketingPageHead>
  )
}

/** The top of the page when no signed build can be offered. */
function UnavailableHead({ downloadsEnabled, releaseError, loading }: { downloadsEnabled: boolean; releaseError: string | null; loading: boolean }) {
  return (
    <MarketingPageHead
      label="Desktop"
      title="Overlay for Mac"
      lead="Run agents on your own computer, dictate into any app and keep Overlay one shortcut away."
    >
      {loading ? (
        <p className="meta-line" role="status">Loading the latest release…</p>
      ) : !downloadsEnabled ? (
        <>
          <p className="body">This site doesn’t offer a signed build. The source is public, and you can build the app yourself.</p>
          <div className="actions">
            <ExternalButton href={DESKTOP_REPO_URL} primary><GithubMark /> View source</ExternalButton>
            <ExternalButton href={`${DESKTOP_REPO_URL}#readme`}><BookOpen className="i" /> Read me</ExternalButton>
          </div>
        </>
      ) : (
        <>
          <p className="body">
            A signed build could not be loaded right now{releaseError ? ` (${releaseError})` : ''}. Try again later, or install from source.
          </p>
          <div className="actions">
            <ExternalButton href={`${DESKTOP_REPO_URL}/releases`} primary>GitHub Releases <ArrowUpRight className="i" /></ExternalButton>
            <ExternalButton href={DESKTOP_REPO_URL}><GithubMark /> Build from source</ExternalButton>
          </div>
        </>
      )}
    </MarketingPageHead>
  )
}

function InstallSteps({ fileName }: { fileName: string }) {
  return (
    <section className="sec">
      <div className="head"><h2 className="h2">Install in three steps</h2></div>
      <div className="grid3">
        <div className="cell">
          <div className="num">01</div>
          <h3 className="h3">Open the download</h3>
          <p className="body">Find <span className="file">{fileName}</span> in your Downloads folder and open it.</p>
        </div>
        <div className="cell">
          <div className="num">02</div>
          <h3 className="h3">Drag Overlay to Applications</h3>
          <p className="body">The disk image shows Overlay next to your Applications folder. Drag it across.</p>
        </div>
        <div className="cell">
          <div className="num">03</div>
          <h3 className="h3">Open Overlay and sign in</h3>
          <p className="body">Sign-in happens in your browser and brings you straight back to the app.</p>
        </div>
      </div>
    </section>
  )
}

function DetailRow({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  const content = <>{icon}{label}<ArrowRight className="i go" /></>
  return href.startsWith('/') ? (
    <Link className="prow" href={href}>{content}</Link>
  ) : (
    <a className="prow" href={href} target="_blank" rel="noopener noreferrer">{content}</a>
  )
}

/** The desktop download page; pass no release while loading. */
export function DesktopDownloadPage({ downloadsEnabled, release, releaseError, loading = false }: DesktopDownloadPageProps & { loading?: boolean }) {
  const platform = useVisitorPlatform()
  const offered = downloadsEnabled && !loading ? release : null
  return (
    <StaticMarketingShell>
      <main>
        {offered
          ? <ReleaseHead release={offered} />
          : <UnavailableHead downloadsEnabled={downloadsEnabled} releaseError={releaseError} loading={loading} />}

        {offered && platform !== 'other' ? <InstallSteps fileName={offered.fileName} /> : null}

        <section className="sec">
          <div className="split">
            <div className="head">
              <h2 className="h2">Before you install</h2>
              <p className="lead">Check the requirements, read how your data is handled, or build it yourself.</p>
            </div>
            <div className="pcol">
              <DetailRow href={`${DESKTOP_REPO_URL}#readme`} icon={<Cpu className="i" />} label="System requirements" />
              <DetailRow href="/privacy" icon={<Shield className="i" />} label="Privacy policy" />
              <DetailRow href={DESKTOP_REPO_URL} icon={<GithubMark />} label="Source repository" />
              {offered ? (
                <DetailRow href={`${DESKTOP_REPO_URL}/releases/latest`} icon={<FileCheck className="i" />} label="Checksums and provenance" />
              ) : null}
            </div>
          </div>
        </section>
      </main>
    </StaticMarketingShell>
  )
}
