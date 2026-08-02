import { formatOverlayConfigError, isOverlayConfigError } from '@/server/config'

/**
 * App-shell startup failure.
 *
 * Two different faults reach this component and they need different copy: a
 * genuine configuration problem, where a provider is missing required values,
 * and a dependency that could not be reached at all. Reporting a network
 * failure as "configuration is invalid" sends the reader hunting for a missing
 * setting that does not exist, so the unreachable case says what failed.
 */
export function AppConfigurationErrorState({ error }: { error: unknown }) {
  const formatted = formatOverlayConfigError(error)
  const isConfigurationFault = isOverlayConfigError(error)

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-8 text-[var(--foreground)]">
      <div className="w-full max-w-2xl rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-6 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted-light)]">
          Runtime configuration
        </p>
        {isConfigurationFault ? (
          <>
            <h1 data-testid="app-configuration-error" className="mt-2 text-xl font-medium text-[var(--foreground)]">
              Overlay provider configuration is invalid
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              The app shell cannot start because the selected auth, billing, storage, database, or
              model providers are missing required runtime values.
            </p>
          </>
        ) : (
          <>
            <h1 data-testid="app-dependency-error" className="mt-2 text-xl font-medium text-[var(--foreground)]">
              Overlay could not reach a required service
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Configuration loaded, but a backend the app shell depends on did not respond. This is
              usually the app-data provider or the identity provider: check that its URL is correct
              for this environment, that the deployment is running, and that the runtime was
              redeployed after the value last changed.
            </p>
          </>
        )}

        <div className="mt-5 rounded-md border border-[var(--border)] bg-[var(--background)] p-4">
          <p className="text-sm font-medium text-[var(--foreground)]">{formatted.message}</p>
          {formatted.issues.length > 0 && formatted.issues.join('\n') !== formatted.message ? (
            <ul className="mt-3 space-y-2 text-sm leading-5 text-[var(--muted)]">
              {formatted.issues.map((issue) => (
                <li key={issue} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--muted-light)]" />
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {isConfigurationFault ? (
          <div className="mt-5 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
            <p className="text-sm font-medium text-[var(--foreground)]">For local UI smoke tests</p>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
              Start from the minimal on-prem profile, then replace placeholder values before using
              real uploads, auth, billing, or model providers.
            </p>
            <code className="mt-3 block overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)]">
              cp docs/config/onprem-minimal.example.json overlay.config.json
            </code>
          </div>
        ) : null}
      </div>
    </div>
  )
}
