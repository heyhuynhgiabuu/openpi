/**
 * Slash-command recognition and prompt-text assembly for the sidecar:
 * skill-command expansion, prompt-template expansion, and the friendly
 * rejection message for TUI-only commands.
 */

import fs from 'node:fs'
import { expandPromptTemplateText } from '../../src/lib/sessionPrompt'
import type { createAgentSession } from '@earendil-works/pi-coding-agent'
import { send } from './sidecarContext'

type Session = Awaited<ReturnType<typeof createAgentSession>>['session']

function stripFrontmatter(content: string): string {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return trimmed
  const afterOpen = trimmed.slice(3)
  const closeIdx = afterOpen.indexOf('\n---')
  if (closeIdx === -1) return trimmed
  return afterOpen.slice(closeIdx + 4).trimStart()
}

function expandSkillCommandForContext(
  text: string,
  session: Session
): {
  text: string
  expanded: boolean
} {
  if (!text.startsWith('/skill:')) return { text, expanded: false }
  const spaceIndex = text.indexOf(' ')
  const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex)
  const args = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim()
  const skill = session.resourceLoader
    .getSkills()
    .skills.find((candidate) => candidate.name === skillName)
  if (!skill) return { text, expanded: false }
  const body = stripFrontmatter(fs.readFileSync(skill.filePath, 'utf-8')).trim()
  const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`
  return { text: args ? `${skillBlock}\n\n${args}` : skillBlock, expanded: true }
}

export function slashInvocationName(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const name = trimmed.slice(1).split(/\s+/, 1)[0]?.trim()
  return name || null
}

export function isKnownSessionSlashCommand(session: Session, invocationName: string): boolean {
  if (invocationName.startsWith('skill:')) {
    const skillName = invocationName.slice('skill:'.length)
    return session.resourceLoader.getSkills().skills.some((skill) => skill.name === skillName)
  }
  return (
    session.extensionRunner
      .getRegisteredCommands()
      .some((command) => command.invocationName === invocationName) ||
    session.promptTemplates.some((template) => template.name === invocationName)
  )
}

export function sendUnsupportedSlashCommand(invocationName: string): void {
  send({
    type: 'session_event',
    event: {
      type: 'message_start',
      message: {
        role: 'custom',
        content: `/${invocationName} is not available in OpenPi. Extension commands and prompt templates are supported; TUI-only commands are hidden from the picker until they have desktop handlers.`,
        details: { level: 'warn' },
        timestamp: Date.now(),
      },
    },
  })
}

/**
 * Build the final prompt text sent to Pi SDK.
 * Always runs expansion (skill commands, then prompt templates) regardless of contextPrefix.
 */
export function buildSidecarPromptText(
  text: string,
  contextPrefix: string | undefined,
  session: Session
): string {
  const trimmed = text.trim()
  const prefix = contextPrefix?.trim()

  // 1. Try skill command expansion
  const skillExpanded = expandSkillCommandForContext(trimmed, session)
  if (skillExpanded.expanded) {
    return prefix ? `${prefix}\n\n${skillExpanded.text}` : skillExpanded.text
  }

  // 3. Try prompt template expansion (user-installed .md templates)
  const templateExpanded = expandPromptTemplateText(trimmed, session.promptTemplates)
  if (templateExpanded.expanded) {
    return prefix ? `${prefix}\n\n${templateExpanded.text}` : templateExpanded.text
  }

  // 4. Fall through: wrap raw text with context prefix if present
  return prefix ? `${prefix}\n\n${trimmed}` : trimmed
}
