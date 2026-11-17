import { createElement, forwardRef, type ForwardRefExoticComponent, type RefAttributes, type SVGProps } from 'react'

export type LucideProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & {
  size?: number | string
  absoluteStrokeWidth?: boolean
}

export type LucideIcon = ForwardRefExoticComponent<LucideProps & RefAttributes<SVGSVGElement>>

type Outline = Array<[string, Record<string, string>]>

/** Draws a Hugeicons outline behind lucide-react's component contract, so production components render unchanged. */
export function icon(name: string, outline: Outline): LucideIcon {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(function Icon(
    { size = 24, color, strokeWidth = 1.5, absoluteStrokeWidth, className, children, style, ...rest },
    ref,
  ) {
    const width = absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden={rest['aria-label'] ? undefined : true}
        data-hugeicon={name}
        className={className ? `lucide ${className}` : 'lucide'}
        style={color ? { color, ...style } : style}
        {...rest}
      >
        {outline.map(([tag, attributes], index) =>
          createElement(tag, { key: index, ...attributes, ...(attributes.stroke ? { strokeWidth: width } : null) }),
        )}
        {children}
      </svg>
    )
  })
  Icon.displayName = name
  return Icon
}
