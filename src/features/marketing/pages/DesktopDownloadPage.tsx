import Link from 'next/link'
import { ArrowRight, ArrowUpRight, BookOpen, Cpu, Download, FileCheck, Shield } from 'lucide-react'
import { GithubMark } from '@/features/marketing/landing/GithubMark'
import type { ReactNode } from 'react'
import { MarketingPageHead, StaticMarketingShell } from '@/features/marketing/components/StaticMarketingShell'
import type { LatestReleaseInfo } from '@/shared/web/latest-release'
import { LATEST_RELEASE_DOWNLOAD_PATH } from '@/shared/web/latest-release'

const DESKTOP_REPO_URL = 'https://github.com/LayerNorm/overlay-desktop'

export type DesktopDownloadPageProps = {
  downloadsEnabled: boolean
  release: LatestReleaseInfo | null
  releaseError: string | null
}

function formatPublishedAt(iso: string | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function ExternalButton({ href, primary = false, children }: { href: string; primary?: boolean; children: ReactNode }) {
  return (
    <a className={primary ? 'btn primary' : 'btn ghost'} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

/** What the page offers right now: the signed build, a load error, or source only. */
function DownloadState({ downloadsEnabled, release, releaseError }: DesktopDownloadPageProps) {
  if (!downloadsEnabled) {
    return (
      <>
        <p className="body">
          Signed public downloads are not open yet. Source is available now; the official beta DMG ships after signing, notarization and release review.
        </p>
        <div className="actions">
          <ExternalButton href={DESKTOP_REPO_URL} primary><GithubMark /> View source</ExternalButton>
          <ExternalButton href={`${DESKTOP_REPO_URL}#readme`}><BookOpen className="i" /> Read me</ExternalButton>
        </div>
      </>
    )
  }
  if (releaseError || !release) {
    return (
      <>
        <p className="body">
          A signed build could not be loaded right now{releaseError ? ` (${releaseError})` : ''}. Try again later, or install from source.
        </p>
        <div className="actions">
          <ExternalButton href={`${DESKTOP_REPO_URL}/releases`} primary>GitHub Releases <ArrowUpRight className="i" /></ExternalButton>
          <ExternalButton href={DESKTOP_REPO_URL}><GithubMark /> Build from source</ExternalButton>
        </div>
      </>
    )
  }
  const published = formatPublishedAt(release.publishedAt ?? undefined)
  return (
    <>
      <div className="actions">
        <Link className="btn primary" href={LATEST_RELEASE_DOWNLOAD_PATH}><Download className="i" /> Download for macOS</Link>
        <ExternalButton href={`${DESKTOP_REPO_URL}/releases/latest`}>Release notes <ArrowUpRight className="i" /></ExternalButton>
      </div>
      <p className="meta-line">
        Version {release.version}
        {published ? ` · ${published}` : null}
        {release.releaseName ? ` · ${release.releaseName}` : null}
      </p>
    </>
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
  const canDownload = downloadsEnabled && Boolean(release)
  return (
    <StaticMarketingShell>
      <main>
        <MarketingPageHead
          label="Desktop"
          title="Download Overlay for macOS"
          lead={
            <>
              Official builds are for macOS on Apple Silicon. Hosted cloud features use Overlay Server, which is{' '}
              <a href="https://getoverlay.io">getoverlay.io</a> by default.
            </>
          }
        >
          {loading ? (
            <p className="meta-line" role="status">Loading the latest release…</p>
          ) : (
            <DownloadState downloadsEnabled={downloadsEnabled} release={release} releaseError={releaseError} />
          )}
        </MarketingPageHead>

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
              {canDownload ? (
                <DetailRow href={`${DESKTOP_REPO_URL}/releases/latest`} icon={<FileCheck className="i" />} label="Checksums and provenance" />
              ) : null}
            </div>
          </div>
        </section>
      </main>
    </StaticMarketingShell>
  )
}
