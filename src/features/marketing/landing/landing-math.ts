/** Tiny numeric helpers shared by the scroll engine and the scene graphics. */

export const clamp = (n: number, a = 0, b = 1): number => Math.min(b, Math.max(a, n))

/** Ease in/out (quadratic) over 0..1. */
export const ease = (r: number): number =>
  r < 0.5 ? 2 * r * r : 1 - Math.pow(-2 * r + 2, 2) / 2

/** Eased progress of `g` through the window [a, b]. */
export const segE = (g: number, a: number, b: number): number =>
  ease(clamp((g - a) / (b - a)))

export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'
