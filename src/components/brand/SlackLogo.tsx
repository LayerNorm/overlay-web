export function SlackLogo({ size = 24, className = '' }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/assets/svg/landing/slack.svg" width={size} height={size} className={`shrink-0 ${className}`} alt="" />
}
