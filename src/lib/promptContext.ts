import type { SkillItem } from './ipc'

interface ReadFileContent {
  content: string
}

/**
 * Strip YAML frontmatter from a SKILL.md file before sending to the LLM.
 * Mirrors Pi SDK's `stripFrontmatter` (`utils/frontmatter.js`), which normalizes
 * line endings and only treats a `---` at the very start as frontmatter: a
 * leading-space `---` is body text there, and a CRLF file must not leak `\r`
 * into the prompt.
 */
export function stripSkillFrontmatter(content: string): string {
  const normalized = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
  if (!normalized.startsWith('---')) return normalized
  const endIndex = normalized.indexOf('\n---', 3)
  if (endIndex === -1) return normalized
  return normalized.slice(endIndex + 4).trim()
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
      // Pi's own expansion trims the body (`agent-session.js`), so a skill that
      // reaches the model through this path reads the same as `/skill:`.
      const body = stripSkillFrontmatter(content).trim()
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
