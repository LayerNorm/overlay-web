import type { AnchorHTMLAttributes } from 'react'

/** A plain anchor: the harness has no Next.js router, so links just navigate. */
export default function Link({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a href={href} {...props} />
}
