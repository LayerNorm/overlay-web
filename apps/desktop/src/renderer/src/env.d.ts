/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly WORKOS_CLIENT_ID: string
  readonly DEV_WORKOS_CLIENT_ID: string
  readonly WORKOS_REDIRECT_URI: string
  readonly AUTH_STORAGE_KEY: string
  readonly APP_SERVER_URL: string
  readonly IS_DEV: string
  readonly SENTRY_DSN: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
