/**
 * Brand logos used on the landing page. The SVGs are self-hosted in
 * `public/assets/svg/landing` (downloaded once from SVGL), so the page makes no
 * third-party requests at runtime.
 *
 * Logos with a separate dark variant render both images; the landing stylesheet
 * shows exactly one (`.lt` / `.dk`) based on the active landing theme.
 */

const BASE = '/assets/svg/landing'

type LogoFiles = { light: string; dark?: string }

const LOGOS = {
  slack: { light: 'slack' },
  github: { light: 'github', dark: 'github_dark' },
  gmail: { light: 'gmail' },
  linear: { light: 'linear' },
  notion: { light: 'notion' },
  calendar: { light: 'google-calendar' },
  perplexity: { light: 'perplexity' },
  sentry: { light: 'sentry' },
  playwright: { light: 'playwright' },
  apple: { light: 'apple', dark: 'apple_dark' },
  windows: { light: 'windows' },
  android: { light: 'android' },
  mcp: { light: 'mcp', dark: 'mcp_dark' },
  claude: { light: 'claude' },
  openai: { light: 'openai', dark: 'openai_dark' },
  cursor: { light: 'cursor', dark: 'cursor_dark' },
} satisfies Record<string, LogoFiles>

export type LogoName = keyof typeof LOGOS

const src = (file: string) => `${BASE}/${file}.svg`

export function LandingLogo({ name, className = '' }: { name: LogoName; className?: string }) {
  const files: LogoFiles = LOGOS[name]
  /* eslint-disable @next/next/no-img-element -- tiny self-hosted SVGs that must swap per theme */
  if (!files.dark) return <img src={src(files.light)} alt="" className={className} />
  return (
    <>
      <img src={src(files.light)} alt="" className={`${className} lt`.trim()} />
      <img src={src(files.dark)} alt="" className={`${className} dk`.trim()} />
    </>
  )
  /* eslint-enable @next/next/no-img-element */
}
