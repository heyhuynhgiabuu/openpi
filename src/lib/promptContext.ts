import type { SkillItem } from './ipc'

interface ReadFileContent {
  content: string
}

/**
 * Strip YAML frontmatter from a SKILL.md file before sending to the LLM.
 * Matches Pi SDK's internal stripFrontmatter() used in _expandSkillCommand().
 * Frontmatter is metadata for the skill registry — the LLM only needs the body.
 */
export function stripSkillFrontmatter(content: string): string {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return trimmed
  const afterOpen = trimmed.slice(3)
  const closeIdx = afterOpen.indexOf('\n---')
  if (closeIdx === -1) return trimmed
  return afterOpen.slice(closeIdx + 4).trimStart()
}

export function buildSkillContextBlocks(
  skills: SkillItem[],
  contents: Array<string | null>
): string[] {
  return contents
    .map((content, index) => {
      if (!content) return null
      const skill = skills[index]
      if (!skill) return null
      const body = stripSkillFrontmatter(content)
      return `<skill name="${skill.name}" location="${skill.path}/SKILL.md">\nReferences are relative to ${skill.path}.\n\n${body}\n</skill>`
    })
    .filter((block): block is string => Boolean(block))
}

export function buildFileContextBlocks(
  paths: string[],
  contents: Array<ReadFileContent | null>
): string[] {
  return contents
    .map((content, index) => {
      if (!content) return null
      const path = paths[index]
      if (!path) return null
      return `<file path="${path}">\n${content.content}\n</file>`
    })
    .filter((block): block is string => Boolean(block))
}
