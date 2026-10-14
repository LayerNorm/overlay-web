export function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? '')
  if (!match) throw new Error('Expected --shard INDEX/TOTAL (for example 1/2)')
  const index = Number(match[1]); const total = Number(match[2])
  if (!Number.isSafeInteger(total) || total < 1 || index < 1 || index > total) {
    throw new Error('Shard index must be between 1 and TOTAL')
  }
  return { index, total }
}

export function selectShard(groups, { index, total }) {
  return groups.flatMap(([name, group], groupIndex) => {
    // Package scripts build and run their own complete glob. Keep each atomic.
    const files = group.kind === 'npm-test'
      ? (groupIndex % total === index - 1 ? group.files : [])
      : group.files.filter((_, fileIndex) => fileIndex % total === index - 1)
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
