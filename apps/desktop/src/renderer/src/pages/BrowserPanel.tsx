// Re-export from the refactored component structure
// The BrowserPanel has been refactored from a 3000+ line monolith into clean architecture:
// - src/components/browser/BrowserPanel.tsx (main component)
// - src/components/browser/types/ (type definitions)
// - src/components/browser/hooks/ (custom hooks for state management)
// - src/components/browser/TabBar/ (tab bar components)
// - src/components/browser/Toolbar/ (navigation, URL bar, action buttons)
// - src/components/browser/Sidebars/ (history, downloads, bookmarks)
// - src/components/browser/SiteInfoSidebar/ (site info with sub-views)
// - src/components/browser/Settings/ (settings panel with tabs)
// - src/components/browser/common/ (shared utilities)
export { BrowserPanel } from '../components/browser'
