/**
 * `next/image` replacement that degrades to a plain `<img>`. We intentionally
 * drop the optimization pipeline — the side panel already serves small,
 * pre-sized assets and avoiding a Next dependency keeps the bundle lean.
 */
import type { ImgHTMLAttributes } from 'react'

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | { src: string }
  width?: number | string
  height?: number | string
  priority?: boolean
  unoptimized?: boolean
}

export default function NextImage({
  src,
  priority: _priority,
  unoptimized: _unoptimized,
  alt = '',
  ...rest
}: Props) {
  const resolved = typeof src === 'string' ? src : src.src
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return <img src={resolved} alt={alt} {...rest} />
}
