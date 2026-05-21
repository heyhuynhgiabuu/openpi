export interface RefBadge {
  type: 'head' | 'tag' | 'remote' | 'branch'
  name: string
}

export function parseGitHubUrl(remoteUrl: string): string | null {
  if (!remoteUrl) return null

  let owner: string | undefined
  let repo: string | undefined

  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)/)
  if (httpsMatch) {
    owner = httpsMatch[1]
    repo = httpsMatch[2]
  } else {
    const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/.]+)/)
    if (sshMatch) {
      owner = sshMatch[1]
      repo = sshMatch[2]
    }
  }

  if (owner && repo) {
    return `https://github.com/${owner}/${repo}`
  }
  return null
}

export function parseRefBadges(refs: string): RefBadge[] {
  if (!refs) return []
  const badges: RefBadge[] = []
  const parts = refs
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const part of parts) {
    const headMatch = part.match(/^HEAD -> (.+)$/)
    if (headMatch) {
      badges.push({ type: 'head', name: `HEAD → ${headMatch[1]}` })
      continue
    }
    const tagMatch = part.match(/^tag: (?:refs\/tags\/)?(.+)$/)
    if (tagMatch) {
      badges.push({ type: 'tag', name: tagMatch[1] })
      continue
    }
    if (part === 'HEAD') {
      badges.push({ type: 'head', name: 'HEAD' })
      continue
    }
    if (part.startsWith('origin/') || part.startsWith('upstream/')) {
      badges.push({ type: 'remote', name: part })
      continue
    }
    if (part.startsWith('remotes/')) {
      badges.push({ type: 'remote', name: part.replace(/^remotes\//, '') })
      continue
    }
    badges.push({ type: 'branch', name: part })
  }
  return badges
}

export function parseFileStats(statsStr: string): {
  files: string[]
  added: number
  removed: number
} {
  const lines = statsStr.split('\n').filter((line) => line.trim())
  const files: string[] = []
  let added = 0
  let removed = 0

  for (const line of lines) {
    const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)?\+?(\s+)?(\d+)?-?/)
    if (match?.[1]) {
      const file = match[1].trim()
      files.push(file)
      if (match[2]) added += parseInt(match[2], 10)
      if (match[4]) removed += parseInt(match[4], 10)
    }
  }

  return { files, added, removed }
}
