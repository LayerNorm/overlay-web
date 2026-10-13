"use client";

import { ArrowRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, MouseEventHandler, ReactNode } from "react";

/**
 * Shared marketing button primitive.
 *
 * Mirrors the app's `Button` (packages/overlay-ui) variant names and rectangular
 * shape (`rounded-lg`/`rounded-xl`, fixed heights) so marketing CTAs no longer
 * look like a separate product from the authenticated app. Uses the same CSS
 * variable tokens as the app `Button` (`--foreground`/`--background` for primary,
 * `--surface-subtle`/`--border` for secondary, `--muted`/`--surface-subtle` for
 * ghost), which resolve correctly under `LandingThemeProvider`.
 *
 * Supports three render modes:
 *  - `href` + `external`  → `<a target="_blank">`
 *  - `href` (internal)    → Next.js `<Link>`
 *  - `onClick` / no href  → `<button>`
 */
export type MarketingButtonVariant = "primary" | "secondary" | "ghost";
export type MarketingButtonSize = "sm" | "md" | "lg";

const variantClasses: Record<MarketingButtonVariant, string> = {
  primary:
    "bg-(--foreground) text-(--background) hover:opacity-90 disabled:opacity-50",
  secondary:
    "border border-(--border) bg-(--surface-subtle) text-(--foreground) hover:bg-(--border) disabled:opacity-50",
  ghost:
    "bg-transparent text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground) disabled:opacity-50",
};

const sizeClasses: Record<MarketingButtonSize, string> = {
  sm: "h-8 rounded-md px-3 text-xs",
  md: "h-9 rounded-lg px-4 text-sm",
  lg: "h-10 rounded-xl px-5 text-sm",
};

const baseClass =
  "inline-flex shrink-0 items-center justify-center gap-2 font-medium transition-colors disabled:cursor-not-allowed";

type ArrowKind = "right" | "up-right" | "none";

function arrowIcon(kind: ArrowKind) {
  if (kind === "none") return null;
  const Icon: LucideIcon = kind === "up-right" ? ArrowUpRight : ArrowRight;
  return <Icon className="h-4 w-4" strokeWidth={1.8} />;
}

export interface MarketingButtonProps {
  children: ReactNode;
  variant?: MarketingButtonVariant;
  size?: MarketingButtonSize;
  /** Internal route — renders a Next.js `<Link>`. */
  href?: string;
  /** Render an external `<a target="_blank">`. Requires `href`. */
  external?: boolean;
  /** Click handler for button mode (no `href`). */
  onClick?: MouseEventHandler<HTMLElement>;
  disabled?: boolean;
  /** Show a trailing arrow. Defaults to `"none"`. */
  arrow?: ArrowKind;
  className?: string;
  /** Optional inline style (e.g. `fontFamily`). */
  style?: CSSProperties;
  /** Pass-through for `<button>` type. */
  type?: "button" | "submit" | "reset";
  "aria-label"?: string;
}

export function MarketingButton({
  children,
  variant = "primary",
  size = "lg",
  href,
  external = false,
  onClick,
  disabled = false,
  arrow = "none",
  className,
  style,
  type = "button",
  ...rest
}: MarketingButtonProps) {
  const classes = `${baseClass} ${variantClasses[variant]} ${sizeClasses[size]}${
    className ? ` ${className}` : ""
  }`;
  const content = (
    <>
      {children}
      {arrowIcon(arrow)}
    </>
  );

  if (href) {
    if (external) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={classes}
          style={style}
          aria-label={rest["aria-label"]}
        >
          {content}
        </a>
      );
    }
    return (
      <Link href={href} className={classes} style={style} aria-label={rest["aria-label"]}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={classes}
      style={style}
      aria-label={rest["aria-label"]}
    >
      {content}
    </button>
  );
}
