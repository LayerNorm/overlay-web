// Personal/Workspace scope toggle: three placements that sit better beside the primary rail than today's full-width
// segmented control. The bar at the top switches between them; everything else is the production app.
//   MOCKUP_FEATURE=scope-toggle node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const components = JSON.stringify(fileURLToPath(new URL('./components.tsx', import.meta.url)))
const onChange = '(next) => { if (next !== scope) { if (scopedNav) scopedNav.onSelect(next); else rememberScope(next) } }'

export default {
  out: 'scope-toggle.html',
  title: 'Overlay | Scope toggle mockup',
  patches: [
    {
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { mountVariantBar } from ${components}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\nmountVariantBar()\n']],
    },
    {
      file: 'packages/overlay-shell-react/src/sidebar/DoubleSidebar.tsx',
      imports: `import { ScopeRow, ScopeTitle } from ${components}\n`,
      replace: [
        [
          '<h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold capitalize tracking-tight">{title}</h2>',
          `<ScopeTitle title={title} scope={settingsNav ? undefined : scope} onChange={${onChange}} />`,
        ],
        [
          `{!settingsNav ? <ScopeToggle scope={scope} workspaceLocked={false} onChange={${onChange}} /> : null}`,
          `{!settingsNav ? <ScopeRow scope={scope} onChange={${onChange}} /> : null}`,
        ],
      ],
    },
  ],
}
