import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from 'react'
import { navigate, toAppHref } from './router'

type Href = string | { pathname?: string; query?: Record<string, string> }
type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: Href; prefetch?: boolean; replace?: boolean; scroll?: boolean; shallow?: boolean }

function hrefString(href: Href): string {
  if (typeof href === 'string') return href
  const query = href.query ? '?' + new URLSearchParams(href.query).toString() : ''
  return (href.pathname ?? '') + query
}

/** Links move the hash router instead of loading a page. */
const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ href, prefetch: _prefetch, replace, scroll: _scroll, shallow: _shallow, onClick, ...props }, ref) {
  const target = toAppHref(hrefString(href))
  const external = /^(https?:|mailto:)/.test(target)
  return (
    <a
      ref={ref}
      href={external ? target : '#' + target}
      {...props}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event)
        if (event.defaultPrevented || external || event.metaKey || event.ctrlKey) return
        event.preventDefault()
        navigate(target, replace)
      }}
    />
  )
})
export default Link
