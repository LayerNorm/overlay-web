#!/usr/bin/env node
// Sync canonical markdown source files (docs/*.md) into Mintlify MDX pages (docs/**/*.mdx).
//
// The docs/ directory is the Mintlify site root AND the source of truth.
// MDX files in the SYNC_MAP below are generated from their .md counterparts
// and should not be edited directly. All other docs/ .mdx files are hand-written.
//
// Run: npm run docs:sync
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))

// Map from docs/ source filenames (lowercase) to Mintlify page paths (without .mdx)
const DOC_TO_SITE = {
  'docs/architecture.md': 'develop/architecture',
  'docs/self_hosting.md': 'deploy-operate/self-hosting',
  'docs/security.md': 'deploy-operate/security',
  'docs/phase6_release_gates.md': 'deploy-operate/release-gates',
  'docs/licensing.md': 'legal/licensing',
  'docs/legal_self_hosting_notes.md': 'legal/self-hosting-obligations',
  'docs/tenancy.md': 'deploy-operate/tenancy',
  'docs/customization.md': 'develop/customization',
  'docs/feature-modules.md': 'develop/feature-modules',
  'docs/api-source-of-truth.md': 'develop/api-source-of-truth',
}

const SYNC_MAP = [
  {
    source: 'docs/architecture.md',
    dest: 'docs/develop/architecture.mdx',
    title: 'Web Architecture',
    description: 'How Overlay Web routes, services, schemas, and feature modules fit together.',
  },
  {
    source: 'docs/SELF_HOSTING.md',
    dest: 'docs/deploy-operate/self-hosting.mdx',
    title: 'Self-Hosting',
    description: 'Run Overlay Web outside the hosted SaaS environment.',
  },
  {
    source: 'docs/security.md',
    dest: 'docs/deploy-operate/security.mdx',
    title: 'Security Model',
    description: 'Auth, route validation, object access, and logging expectations for Overlay Web.',
  },
  {
    source: 'docs/PHASE6_RELEASE_GATES.md',
    dest: 'docs/deploy-operate/release-gates.mdx',
    title: 'Release Gates',
    description: 'Checks to run before shipping web app or self-hosting changes.',
  },
  {
    source: 'docs/LICENSING.md',
    dest: 'docs/legal/licensing.mdx',
    title: 'Licensing',
    description: 'License boundaries for Overlay Web and related packages.',
  },
  {
    source: 'docs/LEGAL_SELF_HOSTING_NOTES.md',
    dest: 'docs/legal/self-hosting-obligations.mdx',
    title: 'Self-Hosting Obligations',
    description: 'Operational and branding obligations for self-hosted Overlay Web deployments.',
  },
  {
    source: 'docs/TENANCY.md',
    dest: 'docs/deploy-operate/tenancy.mdx',
    title: 'Tenancy And Role Model',
    description: 'Single-customer deployment boundary, role model, and multi-tenant roadmap.',
  },
  {
    source: 'docs/customization.md',
    dest: 'docs/develop/customization.mdx',
    title: 'Customizing Overlay',
    description: 'Brand, theme, navigation, extensions, and feature visibility for enterprise deployments.',
  },
  {
    source: 'docs/feature-modules.md',
    dest: 'docs/develop/feature-modules.mdx',
    title: 'Adding Feature Modules',
    description: 'Package boundaries, module checklist, and settings panel registration.',
  },
  {
    source: 'docs/api-source-of-truth.md',
    dest: 'docs/develop/api-source-of-truth.mdx',
    title: 'API Routes As Source Of Truth',
    description: 'Why the web app owns backend route contracts and how other surfaces should consume them.',
  },
]

function stripH1(markdown) {
  return markdown.replace(/^#\s+.+\n+/, '')
}

function buildFrontmatter(entry) {
  return `---\ntitle: "${entry.title}"\ndescription: "${entry.description}"\n---\n`
}

// Rewrite relative markdown links so they work from the MDX destination path.
// Since source and dest are both inside docs/, we mainly need to:
// - Map .md links to synced pages → relative path to the .mdx page (no extension)
// - Map docs/config/ links → relative path within docs/
// - Map ../X.md root-level links → relative path from dest to repo root
function rewriteLinks(body, sourceRel, destRel) {
  const sourceDir = dirname(sourceRel) // e.g. "docs"
  const destDir = dirname(destRel)     // e.g. "docs/deploy-operate"

  return body.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (match, text, href) => {
    // Skip external links and anchors
    if (href.startsWith('http') || href.startsWith('#')) return match

    // Strip anchor fragments for path resolution, reattach later
    const hashIdx = href.indexOf('#')
    const hash = hashIdx >= 0 ? href.slice(hashIdx) : ''
    const linkPath = hashIdx >= 0 ? href.slice(0, hashIdx) : href

    // Resolve the link target relative to the source file's directory
    const resolved = join(sourceDir, linkPath).replace(/\\/g, '/')

    // Check if it maps to a synced page
    const sitePage = DOC_TO_SITE[resolved.toLowerCase()]
    if (sitePage) {
      const newHref = relative(join(root, destDir), join(root, 'docs', sitePage)).replace(/\\/g, '/')
      return `[${text}](${newHref}${hash})`
    }

    // Check if it points to docs/config/ — keep relative within docs/
    if (resolved.startsWith('docs/config/')) {
      const newHref = relative(join(root, destDir), join(root, resolved)).replace(/\\/g, '/')
      return `[${text}](${newHref}${hash})`
    }

    // Check if it points to a root-level file (../X.md) — rewrite from dest to root
    if (!resolved.startsWith('docs/') && resolved.endsWith('.md')) {
      const newHref = relative(join(root, destDir), join(root, resolved)).replace(/\\/g, '/')
      return `[${text}](${newHref}${hash})`
    }

    return match
  })
}

function sync(entry) {
  const sourcePath = join(root, entry.source)
  const destPath = join(root, entry.dest)
  const raw = readFileSync(sourcePath, 'utf8')
  const body = stripH1(raw).trimStart()
  const rewritten = rewriteLinks(body, entry.source, entry.dest)
  const frontmatter = buildFrontmatter(entry)
  const header = '<!-- DO NOT EDIT — synced from docs/ by scripts/sync-docs-to-site.mjs — run `npm run docs:sync` to regenerate -->\n\n'
  const output = `${frontmatter}\n${header}${rewritten}`

  mkdirSync(dirname(destPath), { recursive: true })
  writeFileSync(destPath, output, 'utf8')
  console.log(`  ${entry.source} → ${entry.dest}`)
}

console.log('Syncing docs/*.md → docs/**/*.mdx...')
for (const entry of SYNC_MAP) {
  sync(entry)
}
console.log(`Done. ${SYNC_MAP.length} pages synced.`)
