import Link from 'next/link'
import { MarketingButton } from '@/features/marketing/components/MarketingButton'
import { MarketingFooter } from '@/features/marketing/components/MarketingFooter'
import { StaticMarketingShell } from '@/features/marketing/components/StaticMarketingShell'
import {
  minimalBody,
  minimalDisplay,
  minimalLabel,
  minimalSection,
  minimalSerif,
  minimalTextLink,
} from '@/features/marketing/lib/minimalLayout'
import type { LatestReleaseInfo } from '@/shared/web/latest-release'
import { LATEST_RELEASE_DOWNLOAD_PATH } from '@/shared/web/latest-release'

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

export function DesktopDownloadPage({
  downloadsEnabled,
  release,
  releaseError,
}: DesktopDownloadPageProps) {
  const published = formatPublishedAt(release?.publishedAt ?? undefined)
  const canDownload = downloadsEnabled && Boolean(release)

  return (
    <StaticMarketingShell>
      <main className="flex-1">
        <section className={minimalSection()}>
          <div className="mx-auto max-w-2xl">
            <p className={minimalLabel()}>Desktop</p>
            <h1 className={`mt-4 ${minimalDisplay()}`} style={minimalSerif()}>
              Download Overlay for macOS
            </h1>
            <p className={`mt-6 ${minimalBody()}`}>
              Official builds are for <strong>macOS on Apple Silicon</strong> only.
              Hosted cloud features require Overlay Server (default:{' '}
              <a className="underline underline-offset-4" href="https://getoverlay.io">
                getoverlay.io
              </a>
              ).
            </p>

            <div className="mt-10 space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-6">
              {!downloadsEnabled ? (
                <>
                  <p className={minimalBody()}>
                    Signed public downloads are not open yet. Source is available now;
                    the official beta DMG ships after Gate B (signing, notarization, and
                    release review).
                  </p>
                  <div className="flex flex-wrap gap-3 pt-2">
                    <MarketingButton
                      href="https://github.com/LayerNorm/overlay-desktop"
                      external
                      variant="primary"
                      arrow="up-right"
                    >
                      View source
                    </MarketingButton>
                    <MarketingButton
                      href="https://getoverlay.io/docs/desktop/overview"
                      external
                      variant="secondary"
                      arrow="up-right"
                    >
                      Desktop docs
                    </MarketingButton>
                  </div>
                </>
              ) : releaseError || !release ? (
                <>
                  <p className={minimalBody()}>
                    A signed build could not be loaded right now
                    {releaseError ? ` (${releaseError})` : ''}. Try again later, or
                    install from source.
                  </p>
                  <div className="flex flex-wrap gap-3 pt-2">
                    <MarketingButton
                      href="https://github.com/LayerNorm/overlay-desktop/releases"
                      external
                      variant="primary"
                      arrow="up-right"
                    >
                      GitHub Releases
                    </MarketingButton>
                    <MarketingButton
                      href="https://github.com/LayerNorm/overlay-desktop"
                      external
                      variant="secondary"
                      arrow="up-right"
                    >
                      Build from source
                    </MarketingButton>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-[var(--muted)]">
                    Version {release.version}
                    {published ? ` · ${published}` : null}
                    {release.releaseName ? ` · ${release.releaseName}` : null}
                  </p>
                  <p className={`mt-2 ${minimalBody()}`}>
                    Platform: <strong>macOS, Apple Silicon</strong>
                  </p>
                  <div className="flex flex-wrap gap-3 pt-4">
                    <MarketingButton
                      href={LATEST_RELEASE_DOWNLOAD_PATH}
                      variant="primary"
                      arrow="right"
                    >
                      Download for macOS
                    </MarketingButton>
                    <MarketingButton
                      href="https://github.com/LayerNorm/overlay-desktop/releases/latest"
                      external
                      variant="secondary"
                      arrow="up-right"
                    >
                      Release notes
                    </MarketingButton>
                  </div>
                </>
              )}
            </div>

            <ul className={`mt-10 space-y-3 ${minimalBody()}`}>
              <li>
                <a
                  className={minimalTextLink()}
                  href="https://getoverlay.io/docs/desktop/system-requirements"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  System requirements
                </a>
              </li>
              <li>
                <Link className={minimalTextLink()} href="/privacy">
                  Privacy policy
                </Link>
              </li>
              <li>
                <a
                  className={minimalTextLink()}
                  href="https://github.com/LayerNorm/overlay-desktop"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Source repository
                </a>
              </li>
              {canDownload ? (
                <li>
                  <a
                    className={minimalTextLink()}
                    href="https://github.com/LayerNorm/overlay-desktop/releases/latest"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Checksums & provenance (GitHub Release assets)
                  </a>
                </li>
              ) : null}
            </ul>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </StaticMarketingShell>
  )
}
