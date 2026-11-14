import type { ImgHTMLAttributes } from 'react'

export default function Image({ src, alt, fill: _fill, priority: _priority, unoptimized: _unoptimized, quality: _quality, placeholder: _placeholder, ...props }: ImgHTMLAttributes<HTMLImageElement> & { src: string | { src: string }; fill?: boolean; priority?: boolean; unoptimized?: boolean; quality?: number; placeholder?: string }) {
  return <img src={typeof src === 'string' ? src : src.src} alt={alt ?? ''} {...props} />
}
