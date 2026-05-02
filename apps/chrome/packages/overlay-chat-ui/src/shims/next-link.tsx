/**
 * Minimal `next/link` stand-in for the side panel, which has no Next.js
 * runtime. Renders a plain `<a>` with the same public props shape used
 * across overlay-landing's chat surface.
 */
import type { AnchorHTMLAttributes, ReactNode } from 'react'

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string
  children?: ReactNode
  prefetch?: boolean
  replace?: boolean
  scroll?: boolean
}

export default function NextLink({
  href,
  children,
  // Next-only props are accepted and ignored.
  prefetch: _prefetch,
  replace: _replace,
  scroll: _scroll,
  ...rest
}: Props) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}
