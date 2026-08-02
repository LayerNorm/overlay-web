import { formatOverlayConfigError } from '@/server/config'

export function AppConfigurationErrorState({ error }: { error: unknown }) {
  const formatted = formatOverlayConfigError(error)

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-8 text-[var(--foreground)]">
      <div className="w-full max-w-2xl rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-6 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted-light)]">
          Runtime configuration
        </p>
        <h1 className="mt-2 text-xl font-medium text-[var(--foreground)]">
          Overlay provider configuration is invalid
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          The app shell cannot start because the selected auth, billing, storage, database, or model
          providers are missing required runtime values.
        </p>

        <div className="mt-5 rounded-md border border-[var(--border)] bg-[var(--background)] p-4">
          <p className="text-sm font-medium text-[var(--foreground)]">{formatted.message}</p>
          {formatted.issues.length > 0 ? (
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

        <div className="mt-5 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
          <p className="text-sm font-medium text-[var(--foreground)]">For local UI smoke tests</p>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            Start from the minimal on-prem profile, then replace placeholder values before using real
            uploads, auth, billing, or model providers.
          </p>
          <code className="mt-3 block overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)]">
            cp docs/config/onprem-minimal.example.json overlay.config.json
          </code>
        </div>
      </div>
    </div>
  )
}
