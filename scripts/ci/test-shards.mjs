export function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? '')
  if (!match) throw new Error('Expected --shard INDEX/TOTAL (for example 1/2)')
  const index = Number(match[1]); const total = Number(match[2])
  if (!Number.isSafeInteger(total) || total < 1 || index < 1 || index > total) {
    throw new Error('Shard index must be between 1 and TOTAL')
  }
  return { index, total }
}

// Relative scheduling weights from CI group timings, not test exclusions.
// In particular the Host build/tests must count against its shard's TSX load.
const WEIGHTS = {
  'package:overlay-agent-host': 120,
  'package:overlay-agent-bridge-protocol': 6,
  'vitest:convex': 2,
  'vitest:workflow': 25,
}

export function selectShard(groups, { index, total }) {
  parseShard(`${index}/${total}`)
  const units = groups.flatMap(([name, group]) => {
    // Packages build before executing their complete selected file list.
    if (group.kind === 'npm-test') return [{ name, files: group.files, weight: WEIGHTS[name] ?? group.files.length }]
    return group.files.map(file => ({ name, files: [file], weight: WEIGHTS[name] ?? 1 }))
  })
  units.sort((a, b) => b.weight - a.weight)
  const loads = Array(total).fill(0)
  const selected = new Map()
  for (const unit of units) {
    const target = loads.indexOf(Math.min(...loads))
    loads[target] += unit.weight
    if (target !== index - 1) continue
    if (!selected.has(unit.name)) selected.set(unit.name, new Set())
    for (const file of unit.files) selected.get(unit.name).add(file)
  }
  // Preserve discovery order within each runner even though assignment is weighted.
  return groups.flatMap(([name, group]) => {
    const files = group.files.filter(file => selected.get(name)?.has(file))
    return files.length ? [[name, { ...group, files }]] : []
  })
}

export function verifyShards(groups, total) {
  parseShard(`1/${total}`)
  const expected = groups.flatMap(([name, group]) => group.files.map(file => `${name}:${file}`)).sort()
  if (!expected.length || new Set(expected).size !== expected.length) throw new Error('Empty or duplicate test inventory')
  const actual = []
  for (let index = 1; index <= total; index++) {
    const selected = selectShard(groups, { index, total })
    if (!selected.length) throw new Error(`Shard ${index}/${total} is empty`)
    actual.push(...selected.flatMap(([name, group]) => group.files.map(file => `${name}:${file}`)))
  }
  if (actual.sort().join('\n') !== expected.join('\n')) throw new Error('Shards must cover every test exactly once')
  return expected.length
}
