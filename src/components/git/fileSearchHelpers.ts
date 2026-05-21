import fuzzysort from 'fuzzysort'

export interface FlatFile {
  name: string
  path: string
  dir: string
}

export interface FileHit {
  item: FlatFile
  nameRanges?: [number, number][]
  pathRanges?: [number, number][]
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getMatchRanges(text: string, regex: RegExp): [number, number][] {
  const ranges: [number, number][] = []
  const r = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`)
  let m: RegExpExecArray | null
  m = r.exec(text)
  while (m !== null) {
    ranges.push([m.index, m.index + m[0].length - 1])
    if (m[0].length === 0) r.lastIndex += 1
    m = r.exec(text)
  }
  return ranges
}

export function computeFileHits(
  query: string,
  files: FlatFile[],
  matchCase: boolean,
  wholeWord: boolean,
  useRegex: boolean
): { hits: FileHit[]; error: boolean } {
  const anyModifier = matchCase || wholeWord || useRegex

  if (!query.trim()) {
    return { hits: files.slice(0, 20).map((item) => ({ item })), error: false }
  }

  if (!anyModifier) {
    const results = fuzzysort.go(query, files, { keys: ['name', 'path'], limit: 30 })
    const hits: FileHit[] = results.map((r) => ({
      item: r.obj,
    }))
    return { hits, error: false }
  }

  let regex: RegExp
  try {
    let pattern = useRegex ? query : escapeRegex(query)
    if (wholeWord) pattern = `\\b${pattern}\\b`
    regex = new RegExp(pattern, matchCase ? 'g' : 'gi')
  } catch {
    return { hits: [], error: true }
  }

  const hits: FileHit[] = []
  for (const f of files) {
    regex.lastIndex = 0
    const nameMatch = regex.test(f.name)
    regex.lastIndex = 0
    const pathMatch = regex.test(f.path)
    if (!nameMatch && !pathMatch) continue
    hits.push({
      item: f,
      nameRanges: nameMatch ? getMatchRanges(f.name, regex) : undefined,
      pathRanges: !nameMatch && pathMatch ? getMatchRanges(f.dir, regex) : undefined,
    })
    if (hits.length >= 30) break
  }
  return { hits, error: false }
}
