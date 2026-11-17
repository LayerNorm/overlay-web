// Hugeicons: the whole app with every Lucide icon swapped for its Hugeicons counterpart, to judge the icon system
// before migrating. map.json pairs each Lucide name the app imports with a Hugeicons outline; generate.mjs copies
// those outlines into lucide-react.generated.tsx, which stands in for the lucide-react package in this build only.
//   MOCKUP_FEATURE=hugeicons node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const feature = {
  out: 'hugeicons.html',
  title: 'Overlay | Hugeicons mockup',
  aliases: { 'lucide-react': fileURLToPath(new URL('./lucide-react.generated.tsx', import.meta.url)) },
}

export default feature
