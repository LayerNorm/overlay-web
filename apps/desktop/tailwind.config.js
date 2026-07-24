/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/src/**/*.{js,ts,jsx,tsx}',
    'packages/overlay-chat-react/src/**/*.{js,ts,jsx,tsx}',
    'packages/overlay-ui/src/**/*.{js,ts,jsx,tsx}',
    'packages/overlay-modules-react/src/**/*.{js,ts,jsx,tsx}',
  ],
  // Preflight disabled — the desktop renderer has its own styling system (inline
  // styles + <style> tags). Enabling the full Tailwind reset would break existing
  // UI. Scoped resets for shared components are provided in shared-chat-scope.css.
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'monospace'],
        serif: ['var(--font-serif-family)', 'Georgia', 'serif'],
      },
    },
  },
}
