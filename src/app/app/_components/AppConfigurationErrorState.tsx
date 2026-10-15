import { formatOverlayConfigError } from '@/server/config'

export function AppConfigurationErrorState({ error }: { error: unknown }) {
  const formatted = formatOverlayConfigError(error)

  return (
    <div
      data-testid="app-configuration-error"
      className="flex min-h-screen items-center justify-center bg-(--background) px-4 py-8 text-(--foreground)"
    >
      <div className="w-full max-w-2xl rounded-lg border border-(--border) bg-(--surface-elevated) p-6 shadow-xs">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-(--muted-light)">
          Runtime configuration
        </p>
        <h1 className="mt-2 text-xl font-medium text-(--foreground)">
          Overlay provider configuration is invalid
        </h1>
        <p className="mt-2 text-sm leading-6 text-(--muted)">
          The app shell cannot start because the selected auth, billing, storage, database, or model
          providers are missing required runtime values.
        </p>

        <div className="mt-5 rounded-md border border-(--border) bg-(--background) p-4">
          <p className="text-sm font-medium text-(--foreground)">{formatted.message}</p>
          {formatted.issues.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm leading-5 text-(--muted)">
              {formatted.issues.map((issue) => (
                <li key={issue} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-(--muted-light)" />
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="mt-5 rounded-md border border-(--border) bg-(--surface-subtle) p-4">
          <p className="text-sm font-medium text-(--foreground)">For local UI smoke tests</p>
          <p className="mt-1 text-sm leading-6 text-(--muted)">
            Start from the minimal on-prem profile, then replace placeholder values before using real
            uploads, auth, billing, or model providers.
          </p>
          <code className="mt-3 block overflow-x-auto rounded-md border border-(--border) bg-(--background) px-3 py-2 text-xs text-(--foreground)">
            cp docs/config/onprem-minimal.example.json overlay.config.json
          </code>
        </div>
      </div>
    </div>
  )
}
