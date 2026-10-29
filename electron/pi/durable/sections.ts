import { defineExtension, section } from '@earendil-works/pi-durable'
import type { Extension, PromptSection, ToolRegistration } from '@earendil-works/pi-durable'
import { expandPromptTemplateText } from '../../../src/lib/sessionPrompt'
import type { DurableCustomizations } from './customizations'

/**
 * Phase 8.2a: customizations parity for the durable runtime.
 *
 * A prompt template's *body* must not enter the model context: it carries `$1`/`$ARGUMENTS`
 * placeholders that only make sense at invocation time. The section therefore advertises the
 * catalog (name + description, like Pi's slash-command list), and `expandInput()` expands the
 * body with the user's arguments when they actually send `/name args`.
 * Themes stay renderer-owned (presentation only).
 */

/** Render the model-invocable skills as one section; `undefined` when there are none. */
export function skillsSection(all: DurableCustomizations['skills']): PromptSection {
  // `disableModelInvocation` skills are offered only by `/skill:name`, never in the prompt.
  const skills = all.filter((skill) => !skill.slashOnly)
  return section('skills', () => {
    if (skills.length === 0) return undefined
    // The base directory matters: a skill may reference bundled files relative to it.
    const body = skills
      .map(
        (skill) =>
          `## ${skill.name}\n${skill.description}\nBase directory: ${skill.baseDir}\n\n${skill.body}`
      )
      .join('\n\n')
    return `Load a skill when its description matches the task.\n\n${body}`
  })
}

/** Advertise the prompt templates; bodies are expanded on invocation, never offered as context. */
export function promptsSection(prompts: DurableCustomizations['prompts']): PromptSection {
  return section('prompts', () => {
    if (prompts.length === 0) return undefined
    const lines = prompts.map((prompt) => {
      const hint = prompt.argumentHint ? ` ${prompt.argumentHint}` : ''
      const description = prompt.description ? ` — ${prompt.description}` : ''
      return `- /${prompt.name}${hint}${description}`
    })
    return `The user can invoke these prompt templates by name:\n\n${lines.join('\n')}`
  })
}

/** The customizations extension, built from already-discovered resources. */
export function customizationsExtension(found: DurableCustomizations): Extension<ToolRegistration> {
  return defineExtension({
    name: 'openpi.customizations',
    sections: [skillsSection(found.skills), promptsSection(found.prompts)],
  })
}

/** Discover, then build the extension. Kept together so callers cannot forget the await. */
export async function loadCustomizationsExtension(
  roots: Parameters<typeof import('./customizations').discoverCustomizations>[0]
): Promise<{ extension: Extension<ToolRegistration>; found: DurableCustomizations }> {
  const { discoverCustomizations } = await import('./customizations')
  const found = await discoverCustomizations(roots)
  return { extension: customizationsExtension(found), found }
}

/**
 * Expand a `/template args` or `/skill:name` input into its body. Input that is neither is returned
 * unchanged, so an unknown `/name` reaches the model as typed, as on the SDK path.
 */
export function expandInput(text: string, found: DurableCustomizations): string {
  const skill = skillInvocation(text, found)
  if (skill !== undefined) return skill
  const templates = found.prompts.map((prompt) => ({ name: prompt.name, content: prompt.body }))
  return expandPromptTemplateText(text, templates).text
}

/** `/skill:name args` → the skill's instructions, with any arguments appended. */
function skillInvocation(text: string, found: DurableCustomizations): string | undefined {
  if (!text.startsWith('/skill:')) return undefined
  const rest = text.slice('/skill:'.length)
  const space = rest.indexOf(' ')
  const name = space === -1 ? rest : rest.slice(0, space)
  const args = space === -1 ? '' : rest.slice(space + 1).trim()
  const skill = found.skills.find((candidate) => candidate.name === name)
  if (!skill) return undefined
  const body = `# ${skill.name}\n\n${skill.body}\n\nBase directory: ${skill.baseDir}`
  return args ? `${body}\n\n${args}` : body
}
