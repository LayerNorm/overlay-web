import assert from 'node:assert/strict'
import test from 'node:test'
import { BUILTIN_SKILLS, getBuiltinSkill } from './builtin-skills'
import {
  builtinSkillsAsDiscoverable,
  extractSkillSection,
  normalizeSkillMdResults,
  normalizeSkillsShResults,
  rankSkills,
  searchSkillRegistries,
  skillOutline,
  summarizeDomains,
  type DiscoverableSkill,
  type RegistryFetch,
} from './skill-discovery'

const skills: DiscoverableSkill[] = [
  { _id: 'a', name: 'pbr-texturing-blender', description: 'Create PBR materials and textures in Blender.', instructions: '## Procedure\nBake maps.', domain: '3d-design', triggers: ['texture a model'] },
  { _id: 'b', name: '3d-design-map', description: 'Map of the 3D design field.', instructions: '## Subareas', domain: '3d-design', kind: 'domain_map' },
  { _id: 'c', name: 'cold-email', description: 'Write outbound cold emails for GTM.', instructions: '## Procedure', domain: 'gtm' },
  { _id: 'd', name: 'disabled-texturing', description: 'Textures', instructions: '', enabled: false },
]

test('rankSkills puts the best fit first and skips disabled skills', () => {
  const ranked = rankSkills(skills, 'texture a blender model with PBR materials')
  assert.equal(ranked[0]?.id, 'a')
  assert.ok(ranked[0]!.score > 0.3)
  assert.ok(!ranked.some(r => r.id === 'd'))
})

test('rankSkills with a domain lists the domain map first, even with an empty query', () => {
  const ranked = rankSkills(skills, '', { domain: '3d-design' })
  assert.deepEqual(ranked.map(r => r.id), ['b', 'a'])
})

test('rankSkills returns nothing for an unrelated task', () => {
  assert.deepEqual(rankSkills(skills, 'quantum chromodynamics lattice'), [])
})

test('summarizeDomains groups skills into folders', () => {
  assert.deepEqual(summarizeDomains(skills), [
    { domain: '3d-design', skillCount: 1, hasMap: true },
    { domain: 'gtm', skillCount: 1, hasMap: false },
  ])
})

test('skill sections load in layers', () => {
  const body = '# Skill\n## When to use\nx\n## Procedure\n1. a\n### Detail\nd\n## Pitfalls\np'
  assert.deepEqual(skillOutline(body), ['When to use', 'Procedure', 'Detail', 'Pitfalls'])
  assert.equal(extractSkillSection(body, 'procedure'), '## Procedure\n1. a\n### Detail\nd')
  assert.equal(extractSkillSection(body, 'missing'), null)
})

test('built-in self-verticalization skills are found and loadable', () => {
  assert.equal(BUILTIN_SKILLS.length, 5)
  assert.equal(getBuiltinSkill('self-verticalize')?.id, 'builtin:self-verticalize')
  const ranked = rankSkills(builtinSkillsAsDiscoverable(), 'find existing public skills on skills.sh')
  assert.equal(ranked[0]?.id, 'builtin:skill-reuse')
  const research = rankSkills(builtinSkillsAsDiscoverable(), 'learn the latest techniques in 3D design')
  assert.equal(research[0]?.id, 'builtin:frontier-research')
})

test('registry results normalize and drop unsafe paths', () => {
  const sh = normalizeSkillsShResults({ skills: [
    { id: 'roble3/cc-blender-skill/blender-modeling', source: 'roble3/cc-blender-skill', skillId: 'blender-modeling', name: 'blender-modeling', installs: 3998 },
    { id: 'x', source: '../evil', skillId: 'y' },
  ] })
  assert.equal(sh.length, 1)
  assert.equal(sh[0]!.url, 'https://skills.sh/roble3/cc-blender-skill/blender-modeling')
  assert.equal(sh[0]!.sourceRepo, 'https://github.com/roble3/cc-blender-skill')

  const md = normalizeSkillMdResults({ items: [
    { slug: 'endlessbaum/blender', title: 'blender', description: 'Blender MCP', verified: false, avg_rating: 0, raw_url: 'https://api.skillmd.com/api/skills/endlessbaum/blender/raw' },
    { slug: 'a/b', raw_url: 'https://evil.example/raw' },
  ] })
  assert.equal(md[0]!.rawUrl, 'https://api.skillmd.com/api/skills/endlessbaum/blender/raw')
  assert.equal(md[1]!.rawUrl, undefined)
})

test('searchSkillRegistries calls only fixed hosts and survives one registry failing', async () => {
  const calls: string[] = []
  const fetchImpl: RegistryFetch = async (url) => {
    calls.push(url)
    if (url.startsWith('https://skills.sh/')) return { ok: false, status: 503, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({ items: [{ slug: 'o/s', title: 's' }] }) }
  }
  const { results, errors } = await searchSkillRegistries('3d design & more', { fetchImpl })
  assert.ok(calls.every(u => u.startsWith('https://skills.sh/api/search?') || u.startsWith('https://api.skillmd.com/v1/search?')))
  assert.ok(calls[0]!.includes('q=3d%20design%20%26%20more'))
  assert.equal(results.length, 1)
  assert.deepEqual(errors, [{ registry: 'skills.sh', error: 'HTTP 503' }])
})

test('rankSkills keeps the domain map first under a task query and a small limit', () => {
  const ranked = rankSkills(skills, 'texture a blender model with PBR materials', { domain: '3d-design', limit: 1 })
  assert.deepEqual(ranked.map(r => r.id), ['b'])
})

test('extractSkillSection ignores # lines inside code fences', () => {
  const body = '## Procedure\n```bash\n# Bake textures\nblender -b scene.blend\n```\nThen review.\n## Pitfalls\nNone.'
  const section = extractSkillSection(body, 'Procedure')
  assert.ok(section?.includes('blender -b scene.blend'))
  assert.ok(section?.includes('Then review.'))
  assert.ok(!section?.includes('Pitfalls'))
})
